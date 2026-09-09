import { sutando } from "sutando";
import { DatabaseAdapter, SQLiteAdapter, MySQLAdapter } from "../util/dbAdapterUtil";
import { MySQLDBAdapter } from "../util/db/mysqlDBAdapter";
import { SQLiteDBAdapter } from "../util/db/sqliteDBAdapter";
import dbMigrationService from "./dbMigrationService";
import customError from "../util/customErrorUtil";

interface ORMOptions {
    dbPath?: string;
}

class ORMService {
    private _dbAdapter: DatabaseAdapter | null = null;

    async init(options: ORMOptions): Promise<DatabaseAdapter> {
        const { dbPath } = options;

        if (process.env.DB_DRIVER === "mysql") {
            // MySQL 分支：建立 sutando(mysql2) 连接 + 运行时 MySQLAdapter + 执行迁移
            const mysql = (await import("mysql2/promise")).default;
            const conn = dbMigrationService.mysqlConnFromEnv();

            const pool = mysql.createPool({
                ...conn,
                connectionLimit: 10,
                multipleStatements: true,
                charset: "utf8mb4",
                dateStrings: true,
            });

            sutando.addConnection({
                client: "mysql2",
                connection: {
                    ...conn,
                },
                // 静默 knex 对 mysql 不支持 .returning() 的警告（mysql 通过 insertId 取回自增 id，无需 returning）
                log: {
                    warn: () => {},
                    deprecate: () => {},
                    debug: () => {},
                },
                useNullAsDefault: true,
            });

            this._dbAdapter = new MySQLAdapter(pool);

            const migrateAdapter = new MySQLDBAdapter(conn);
            await dbMigrationService.migrate(migrateAdapter);
            await migrateAdapter.close();
        } else {
            if (!dbPath) {
                throw new customError.AppError("dbPath is required", 500);
            }
            const Database = (await import("better-sqlite3")).default;

            sutando.addConnection({
                client: "better-sqlite3",
                connection: {
                    filename: dbPath,
                },
                useNullAsDefault: true,
            });

            const db = new Database(dbPath);
            this._dbAdapter = new SQLiteAdapter(db);

            const migrateAdapter = new SQLiteDBAdapter(dbPath);
            await dbMigrationService.migrate(migrateAdapter);
            migrateAdapter.close();
        }

        return this._dbAdapter;
    }

    get dbAdapter(): DatabaseAdapter {
        if (!this._dbAdapter) {
            throw new customError.AppError("ORMService not initialized", 500);
        }
        return this._dbAdapter;
    }

    getKnex(): any {
        const queryBuilder = (sutando as any).connection();
        return (queryBuilder as any).connector;
    }

    private static readonly EXPECTED_TABLES = [
        "client_config",
        "config",
        "model",
        "recharge_records",
        "record",
        "user",
        "user_group",
        "user_key",
        "vendor",
        "vendor_model",
        "model_upstream",
    ];

    async verifySchema(): Promise<void> {
        try {
            if (!this._dbAdapter) return;

            // 按驱动选择列表业务表的 SQL：sqlite 用 sqlite_master，mysql 用 information_schema
            const isMysql = process.env.DB_DRIVER === "mysql";
            const tableSql = isMysql
                ? "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()"
                : "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";

            const result = await this._dbAdapter.prepare(tableSql).all();

            const rows = Array.isArray(result) ? result : [];
            const actualTables = new Set(rows.map((row: any) => row.name));

            const missingTables = ORMService.EXPECTED_TABLES.filter(table => !actualTables.has(table));

            if (missingTables.length > 0) {
                console.error(`\x1b[31m[CRITICAL WARNING] Database schema verification failed! Missing expected tables: ${missingTables.join(", ")}\x1b[0m`);
            }
        } catch (e) {
            console.error("\x1b[31m[CRITICAL WARNING] Failed to verify database schema:\x1b[0m", e);
        }
    }
}

const ormService = new ORMService();

export default ormService;
