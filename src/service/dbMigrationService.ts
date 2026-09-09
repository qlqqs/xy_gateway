import { join } from "path";
import { readFileSync } from "fs";
import { createInterface } from "readline";
import {
    DBAdapter,
    MIGRATION_DIR,
    MIGRATION_START_MARKER,
    MIGRATION_END_MARKER,
    canonicalMigrationName,
    getDialect,
    migrationSqlFile,
    listMigrations,
    migrationsTableDdl,
} from "../util/db/dbAdapter";
import { SQLiteDBAdapter } from "../util/db/sqliteDBAdapter";
import { MySQLDBAdapter, MySQLConnOptions } from "../util/db/mysqlDBAdapter";
import customError from "../util/customErrorUtil";
import userKeyMigrationService from "./userKeyMigrationService";

const LOCAL_DB_PATH = process.env.DB_PATH || join(process.cwd(), "local.db");

export interface Migration {
    id?: number;
    name: string;
    applied_at?: string;
}

const LEGACY_KEY_CUTOVER_MIGRATION = "migrate_0032";
const MIN_MYSQL_VERSION = [8, 0, 13] as const;

/**
 * 现有 MySQL 迁移使用 LONGTEXT 括号表达式默认值，领域切换还使用
 * CTE、JSON_TABLE 和窗口函数；这些能力在 MySQL 5.7 中不可用。先检查版本，
 * 再创建迁移标记，避免不支持的服务器留下半成品 schema。
 */
export async function ensureSupportedMySqlVersion(adapter: DBAdapter): Promise<void> {
    let rawVersion = "";
    try {
        const rows = await adapter.query<{ version?: string }>(
            "SELECT VERSION() AS version",
        );
        rawVersion = String(rows[0]?.version ?? "");
    } catch {
        throw new customError.AppError(
            "无法读取 MySQL 版本；请确认连接目标是受支持的 MySQL 服务",
            500,
            "mysql_version_check_failed",
        );
    }

    if (/mariadb/i.test(rawVersion)) {
        throw new customError.AppError(
            "当前项目的 MySQL 迁移不支持 MariaDB，请使用 MySQL 8.0.13 或更高版本",
            500,
            "mysql_version_unsupported",
        );
    }

    const match = rawVersion.match(/^(\d+)\.(\d+)\.(\d+)/);
    const version = match ? match.slice(1).map(Number) : [];
    // 按组件逐段比较；转换成浮点数会错误排序 8.0.9 这类版本。
    const [major, minor, patch] = version;
    const isSupported = version.length === 3
        && (major > MIN_MYSQL_VERSION[0]
            || (major === MIN_MYSQL_VERSION[0] && minor > MIN_MYSQL_VERSION[1])
            || (major === MIN_MYSQL_VERSION[0]
                && minor === MIN_MYSQL_VERSION[1]
                && patch >= MIN_MYSQL_VERSION[2]));

    if (!isSupported) {
        throw new customError.AppError(
            `当前 MySQL 版本 ${rawVersion || "未知"} 不受支持；需要 MySQL 8.0.13 或更高版本`,
            500,
            "mysql_version_unsupported",
        );
    }
}

/**
 * 领域切换包含连接中断后不能安全重放的 DDL。MySQL 的 ALTER TABLE
 * 可能隐式提交单条语句，因此不能只依赖迁移标记：执行切换前
 * 先检查 schema，遇到无法判断的半迁移状态就停止，要求从迁移前备份恢复。
 */
interface SchemaSnapshot {
    tables: Set<string>;
    columns: Map<string, Set<string>>;
}

const DOMAIN031_TABLES = ["user_group", "user_key", "model_upstream"];
const DOMAIN031_VENDOR_COLUMNS = [
    "auth_mode",
    "skip_tls_verify",
    "proxy",
    "supplier_name",
    "channel_code",
    "api_type",
    "openai_protocol",
    "status",
    "remark",
    "available_models",
    "concurrency",
    "load_factor",
    "priority",
    "group_id",
];
const DOMAIN031_RECORD_COLUMNS = [
    "key_id",
    "group_id",
    "requested_model",
    "billing_mode",
    "base_cost",
    "rate_multiplier",
    "settlement_status",
];

async function readSchemaSnapshot(adapter: DBAdapter, dialect: "sqlite" | "mysql"): Promise<SchemaSnapshot> {
    const tables = new Set<string>();
    const columns = new Map<string, Set<string>>();

    if (dialect === "mysql") {
        const tableRows = await adapter.query<{ name?: string; TABLE_NAME?: string }>(
            "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = DATABASE()",
        );
        for (const row of tableRows) {
            const name = String(row.name ?? row.TABLE_NAME ?? "");
            if (name) tables.add(name.toLowerCase());
        }
        const columnRows = await adapter.query<{ table_name?: string; TABLE_NAME?: string; name?: string; COLUMN_NAME?: string }>(
            "SELECT TABLE_NAME AS table_name, COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema = DATABASE()",
        );
        for (const row of columnRows) {
            const table = String(row.table_name ?? row.TABLE_NAME ?? "").toLowerCase();
            const column = String(row.name ?? row.COLUMN_NAME ?? "").toLowerCase();
            if (!table || !column) continue;
            if (!columns.has(table)) columns.set(table, new Set());
            columns.get(table)!.add(column);
        }
        return { tables, columns };
    }

    const tableRows = await adapter.query<{ name?: string }>(
        "SELECT name FROM sqlite_master WHERE type='table'",
    );
    for (const row of tableRows) {
        const name = String(row.name ?? "");
        if (name) tables.add(name.toLowerCase());
    }
    // PRAGMA 不能使用参数绑定；这里的表名是固定常量。
    for (const table of ["user", "model", "vendor", "record", ...DOMAIN031_TABLES]) {
        if (!tables.has(table)) continue;
        const rows = await adapter.query<{ name?: string }>(`PRAGMA table_info("${table}")`);
        columns.set(table, new Set(rows.map(row => String(row.name ?? "").toLowerCase()).filter(Boolean)));
    }
    return { tables, columns };
}

function hasAllColumns(snapshot: SchemaSnapshot, table: string, expected: string[]): boolean {
    const actual = snapshot.columns.get(table.toLowerCase());
    return Boolean(actual && expected.every(column => actual.has(column.toLowerCase())));
}

function hasAnyColumns(snapshot: SchemaSnapshot, table: string, expected: string[]): boolean {
    const actual = snapshot.columns.get(table.toLowerCase());
    return Boolean(actual && expected.some(column => actual.has(column.toLowerCase())));
}

async function validateDomainCutoverState(
    adapter: DBAdapter,
    dialect: "sqlite" | "mysql",
    appliedNames: Set<string>,
    pendingNames: string[],
): Promise<void> {
    const needsCheck = appliedNames.has("migrate_0031")
        || appliedNames.has("migrate_0032")
        || pendingNames.includes("migrate_0031")
        || pendingNames.includes("migrate_0032");
    if (!needsCheck) return;

    const snapshot = await readSchemaSnapshot(adapter, dialect);
    const newTables = DOMAIN031_TABLES.filter(table => snapshot.tables.has(table));
    const allNewTables = newTables.length === DOMAIN031_TABLES.length;
    const anyNewTables = newTables.length > 0;
    const vendorFormalComplete = hasAllColumns(snapshot, "vendor", DOMAIN031_VENDOR_COLUMNS);
    const vendorFormalPartial = hasAnyColumns(snapshot, "vendor", DOMAIN031_VENDOR_COLUMNS);
    const recordFormalComplete = hasAllColumns(snapshot, "record", DOMAIN031_RECORD_COLUMNS);
    const recordFormalPartial = hasAnyColumns(snapshot, "record", DOMAIN031_RECORD_COLUMNS);
    const domain031Complete = allNewTables && vendorFormalComplete && recordFormalComplete;
    const domain031Partial = anyNewTables || vendorFormalPartial || recordFormalPartial;

    if (appliedNames.has("migrate_0031") && !domain031Complete) {
        throw new customError.AppError(
            "Migration state is inconsistent: migrate_0031 is marked applied but its domain tables/columns are incomplete. Restore the pre-migration backup before retrying.",
            500,
            "migration_schema_inconsistent",
        );
    }
    if (!appliedNames.has("migrate_0031") && pendingNames.includes("migrate_0031") && domain031Partial) {
        throw new customError.AppError(
            "Detected a partial migrate_0031 schema (some new domain tables or columns already exist without a migration marker). Restore the pre-migration backup; the cutover will not be replayed automatically.",
            500,
            "migration_partial_schema",
        );
    }

    const userColumns = snapshot.columns.get("user") ?? new Set<string>();
    const modelColumns = snapshot.columns.get("model") ?? new Set<string>();
    const legacyColumnsPresent = ["token"].every(column => userColumns.has(column))
        && ["routing_mode", "routing_config"].every(column => modelColumns.has(column));
    const legacyColumnsAbsent = !userColumns.has("token")
        && !modelColumns.has("routing_mode")
        && !modelColumns.has("routing_config");
    const legacyColumnsPartial = !legacyColumnsPresent && !legacyColumnsAbsent;

    if (appliedNames.has("migrate_0032") && !legacyColumnsAbsent) {
        throw new customError.AppError(
            "Migration state is inconsistent: migrate_0032 is marked applied but legacy authentication/routing columns remain. Restore the pre-migration backup before retrying.",
            500,
            "migration_schema_inconsistent",
        );
    }
    if (!appliedNames.has("migrate_0032") && pendingNames.includes("migrate_0032")
        && (legacyColumnsPartial || (!legacyColumnsPresent && domain031Complete))) {
        throw new customError.AppError(
            "Detected a partial migrate_0032 cutover (legacy columns are neither fully present nor fully removed). Restore the pre-migration backup; the destructive DDL will not be replayed automatically.",
            500,
            "migration_partial_schema",
        );
    }
}

async function runPreMigrationHook(name: string, adapter: DBAdapter): Promise<void> {
    if (name !== LEGACY_KEY_CUTOVER_MIGRATION) return;

    // migrate_0032 会删除 user.token 和 model.routing_* 列。执行 DDL 前先导入
    // 旧凭据，使升级可重试，并确保请求链路不会继续读取旧 schema。
    const report = await userKeyMigrationService.importLegacyUserKeys(adapter);
    if (report.imported > 0 || report.skipped > 0) {
        console.log(
            `Imported ${report.imported} legacy API keys; skipped ${report.skipped} already migrated rows.`,
        );
    }
}

// 从环境变量读取 MySQL 连接参数（DB_URL 优先于离散变量）
export function mysqlConnFromEnv(): MySQLConnOptions {
    if (process.env.DB_URL) {
        return { uri: process.env.DB_URL };
    }
    return {
        host: process.env.DB_HOST || "127.0.0.1",
        port: parseInt(process.env.DB_PORT || "3306", 10),
        user: process.env.DB_USER || "",
        password: process.env.DB_PASSWORD || "",
        database: process.env.DB_NAME || "",
    };
}

// 工厂：按 DB_DRIVER 创建对应的迁移适配器。
export function createDBAdapter(env: "node" | "test" = "node"): DBAdapter {
    if (getDialect() === "mysql") {
        return new MySQLDBAdapter(mysqlConnFromEnv());
    }
    return new SQLiteDBAdapter(LOCAL_DB_PATH);
}

export async function migrate(
    adapter: DBAdapter,
    env: "node" | "test" = "node",
) {
    const dialect = getDialect();
    console.log(`${MIGRATION_START_MARKER} env=${env} dialect=${dialect}`);
    let success = false;

    try {
        if (dialect === "mysql") {
            await ensureSupportedMySqlVersion(adapter);
        }
        console.log(`Initializing migrations table in ${env}...`);
        await adapter.exec(migrationsTableDdl(dialect));

        console.log("Fetching applied migrations...");
        let applied: Migration[] = [];
        try {
            applied = (await adapter.query<Migration>(
                "SELECT name FROM _migrations ORDER BY name",
            )) as Migration[];
        } catch (e) {
            console.log("Error fetching applied migrations, assuming empty.", e);
        }

        // 兼容旧版记录名（migrate_XXXX.sql），归一化为目录名后与 listMigrations 比对
        const appliedNames = new Set(applied.map((m) => canonicalMigrationName(m.name)));

        console.log("Scanning available migrations in", MIGRATION_DIR);
        let pendingMigrations: string[] = [];
        try {
            // 每个迁移一个目录，目录名（如 migrate_0001）即迁移标识
            pendingMigrations = listMigrations(MIGRATION_DIR).filter(
                (name) => !appliedNames.has(name),
            );
        } catch (e) {
            console.warn(`Could not read migration directory: ${MIGRATION_DIR}`);
        }

        const availableCount = listMigrations(MIGRATION_DIR).length;

        console.log(
            `Applied: ${applied.length}, Available: ${availableCount}, Pending: ${pendingMigrations.length}`,
        );

        // 在判断数据库已是最新或执行待处理脚本前，先校验领域切换状态。
        // 这也能发现只提交了部分 DDL 却已经写入迁移标记的情况。
        await validateDomainCutoverState(adapter, dialect, appliedNames, pendingMigrations);

        if (pendingMigrations.length === 0) {
            console.log("Database is up to date.");
            success = true;
            return;
        }

        // 每个迁移单独执行，并与迁移标记放在同一个事务中。
        for (const name of pendingMigrations) {
            console.log(`\nApplying migration: ${name}...`);
            await runPreMigrationHook(name, adapter);
            const sql = readFileSync(migrationSqlFile(join(MIGRATION_DIR, name), dialect), "utf-8");
            const insertRecord = `INSERT INTO _migrations (name) VALUES ('${name}')`;

            try {
                if (!adapter.execTransaction) {
                    throw new Error("Database adapter does not support transactions");
                }
                await adapter.execTransaction([sql, insertRecord]);
                console.log(`✅ Successfully applied: ${name}`);
            } catch (e) {
                console.error(`❌ Failed to apply migration ${name}:`, e);
                throw e;
            }
        }

        console.log("\nAll pending migrations applied.");
        success = true;
    } finally {
        const status = success ? "success" : "failed";
        console.log(`${MIGRATION_END_MARKER} env=${env} status=${status}`);
    }
}

export async function status(adapter: DBAdapter, env: string) {
    const dialect = getDialect();
    if (dialect === "mysql") {
        await ensureSupportedMySqlVersion(adapter);
    }
    console.log("Initializing migrations table...");
    await adapter.exec(migrationsTableDdl(dialect));

    let applied: Migration[] = [];
    try {
        applied = (await adapter.query<Migration>(
            "SELECT name, applied_at FROM _migrations ORDER BY name",
        )) as Migration[];
    } catch (e) {
        console.log("Error fetching applied migrations", e);
    }

    let migs: string[] = [];
    try {
        migs = listMigrations(MIGRATION_DIR);
    } catch (e) {
        console.warn(`Could not read migration directory: ${MIGRATION_DIR}`);
    }

    console.log(`\n=== Migration Status ===`);

    if (migs.length === 0) {
        console.log("No migrations found in resource/migrate.");
        return;
    }

    const appliedMap = new Map<string, string>();
    // 同样归一化旧版记录名，确保旧库的 status 也能正确显示已应用状态
    applied.forEach((m) => appliedMap.set(canonicalMigrationName(m.name), m.applied_at || "unknown"));

    migs.forEach((file) => {
        if (appliedMap.has(file)) {
            console.log(`✅ ${file} (Applied at: ${appliedMap.get(file)})`);
        } else {
            console.log(`[ ] ${file} (Pending)`);
        }
    });

    const version = applied.length > 0 ? parseInt(applied[applied.length - 1].name.replace(/\D/g, ""), 10) || 0 : 0;

    console.log(`\nCurrent Database Version: ${version}`);
    console.log(`Migrations to apply: ${migs.length - applied.length}`);
}

export async function clear(adapter: DBAdapter, env: string) {
    const dialect = getDialect();
    if (dialect === "mysql") {
        await ensureSupportedMySqlVersion(adapter);
    }
    // 注意：这个操作很危险
    console.warn(
        `\n⚠️  WARNING: You are about to CLEAR the database in environment: ${env}`,
    );
    console.warn(
        `All tables EXCEPT sqlite_schema / mysql system tables will be DROPPED.\n`,
    );

    // 按方言列出业务表：sqlite 用 sqlite_master，mysql 用 information_schema
    const listSql =
        dialect === "mysql"
            // `_migrations` 也属于可恢复的应用 schema；如果保留它而删除业务表，
            // 下次 migrate 会把已应用标记与空 schema 判定为半迁移状态。
            ? "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"
            : "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";

    let tables: any[] = [];
    try {
        tables = (await adapter.query<{ name: string }>(listSql)) as any[];
    } catch (e) {
        console.error("Failed to query tables:", e);
        return;
    }

    if (tables.length === 0) {
        console.log("No custom tables found to drop.");
        return;
    }

    console.log(
        `Found ${tables.length} tables to drop:`,
        tables.map((t) => t.name).join(", "),
    );

    // 用户确认
    const confirmed = await new Promise<boolean>((resolve) => {
        const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        rl.question("Are you sure? (y/N): ", (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === "y");
        });
    });

    if (!confirmed) {
        console.log("Aborted.");
        return;
    }

    const disableForeignKeys = dialect === "mysql"
        || dialect === "sqlite";
    let foreignKeysDisabled = false;
    try {
        if (disableForeignKeys) {
            await adapter.exec(dialect === "mysql"
                ? "SET FOREIGN_KEY_CHECKS = 0"
                : "PRAGMA foreign_keys = OFF");
            foreignKeysDisabled = true;
        }

        for (const table of tables) {
            try {
                console.log(`Dropping table: ${table.name}...`);
                await adapter.exec(`DROP TABLE IF EXISTS ${table.name}`);
            } catch (e) {
                console.error(`Failed to drop table ${table.name}:`, e);
            }
        }
    } finally {
        if (foreignKeysDisabled) {
            await adapter.exec(dialect === "mysql"
                ? "SET FOREIGN_KEY_CHECKS = 1"
                : "PRAGMA foreign_keys = ON");
        }
    }

    console.log("\nDatabase cleared.");
}

export async function init(adapter: DBAdapter, env: "node" | "test" = "node") {
    console.log(`\nInitializing database in ${env}...`);
    // The database connection automatically creates the file if it doesn't exist.
    // We just need to execute the migrations.
    await migrate(adapter, env);
    console.log(`\nDatabase initialized successfully.`);
}

export default {
    migrate,
    status,
    clear,
    init,
    createDBAdapter,
    mysqlConnFromEnv,
    ensureSupportedMySqlVersion,
    MIGRATION_DIR,
};
