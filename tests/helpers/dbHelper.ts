import Database from "better-sqlite3";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";
import config from "../config";
import { DBAdapter } from "../../src/util/db/dbAdapter";
import { migrate as runMigrations } from "../../src/service/dbMigrationService";
import configService from "../../src/service/configService";

const isMysql = config.DB_CONFIG.driver === "mysql";

let mysqlPool: any = null;

function getMysqlPool(): any {
    if (!mysqlPool) {
        const m = config.DB_CONFIG.mysql;
        const mysql = require("mysql2/promise");
        mysqlPool = mysql.createPool({
            host: m.host,
            port: m.port,
            user: m.user,
            password: m.password,
            database: m.database,
            connectionLimit: 10,
            multipleStatements: true,
            charset: "utf8mb4",
            dateStrings: true,
        });
    }
    return mysqlPool;
}

class LocalDBAdapter implements DBAdapter {
    constructor(private readonly db: Database.Database) {}

    exec(sql: string): void {
        this.db.exec(sql);
    }

    execTransaction(sqls: string[]): void {
        const run = this.db.transaction(() => {
            for (const sql of sqls) {
                this.db.exec(sql);
            }
        });
        run();
    }

    query<T>(sql: string): T[] {
        return this.db.prepare(sql).all() as T[];
    }

    run(sql: string, ...params: any[]): void {
        this.db.prepare(sql).run(...params);
    }

    close(): void {
        this.db.close();
    }
}

class MySQLTestAdapter implements DBAdapter {
    async exec(sql: string): Promise<void> {
        await getMysqlPool().query(sql);
    }

    async query<T>(sql: string): Promise<T[]> {
        const [rows] = await getMysqlPool().query(sql);
        return rows as T[];
    }

    async run(sql: string, ...params: any[]): Promise<void> {
        await getMysqlPool().execute(sql, params);
    }

    async execTransaction(sqls: string[]): Promise<void> {
        const conn = await getMysqlPool().getConnection();
        try {
            await conn.beginTransaction();
            for (const sql of sqls) {
                await conn.query(sql);
            }
            await conn.commit();
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    async close(): Promise<void> {
        if (mysqlPool) {
            await mysqlPool.end();
            mysqlPool = null;
        }
    }
}

let localDb: Database.Database | null = null;
let adapter: DBAdapter | null = null;

function createAdapter(): DBAdapter {
    if (isMysql) {
        console.log("Using MySQLTestAdapter (mysql2)");
        return new MySQLTestAdapter();
    }

    if (!localDb) {
        localDb = new Database(config.DB_CONFIG.path);
    }
    console.log("Using LocalDBAdapter (better-sqlite3)");
    return new LocalDBAdapter(localDb);
}

function removeDatabaseFile(): void {
    if (existsSync(config.DB_CONFIG.path)) {
        console.log("Removing test database file:", config.DB_CONFIG.path);
        unlinkSync(config.DB_CONFIG.path);
    }
}

async function listBusinessTables(excludeMigrations: boolean): Promise<{ name: string }[]> {
    if (isMysql) {
        const exclude = excludeMigrations ? " AND table_name != '_migrations'" : "";
        const [rows] = await getMysqlPool().query(
            `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()${exclude}`,
        );
        return (rows as any[]).map((row: any) => ({ name: row.name }));
    }

    if (!localDb) {
        throw new Error("SQLite test database is not initialized");
    }

    const exclude = excludeMigrations ? " AND name != '_migrations'" : "";
    return localDb
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'${exclude}`)
        .all() as { name: string }[];
}

async function dropAllMysqlTables(): Promise<void> {
    await getMysqlPool().query("SET FOREIGN_KEY_CHECKS = 0");
    try {
        const [tables] = await getMysqlPool().query(
            "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()",
        );
        for (const table of tables as any[]) {
            await getMysqlPool().query(`DROP TABLE IF EXISTS ${table.name}`);
        }
    } finally {
        await getMysqlPool().query("SET FOREIGN_KEY_CHECKS = 1");
    }
}

async function init(): Promise<void> {
    if (adapter) {
        console.log("Database already initialized");
        return;
    }

    adapter = createAdapter();
    await runMigrations(adapter, "test");
    console.log("Test database initialized successfully");
}

async function initDatabase(): Promise<void> {
    if (isMysql) {
        console.log("[INIT_DATABASE] MySQL mode: clearing test database schema");
        await dropAllMysqlTables();
    } else {
        removeDatabaseFile();
        console.log("[INIT_DATABASE] SQLite test database file deleted");
    }

    await init();
    console.log("[INIT_DATABASE] Database initialized");
}

async function cleanup(): Promise<void> {
    if (!adapter) {
        console.log("Database not initialized, nothing to cleanup");
        return;
    }

    console.log("Cleaning up test database...");
    const tables = await listBusinessTables(false);

    if (isMysql) {
        await adapter.exec("SET FOREIGN_KEY_CHECKS = 0");
    } else {
        await adapter.exec("PRAGMA foreign_keys = OFF");
    }

    try {
        for (const table of tables) {
            try {
                await adapter.exec(`DROP TABLE IF EXISTS ${table.name}`);
            } catch (error) {
                console.error(`Failed to drop table ${table.name}:`, error);
            }
        }
    } finally {
        if (isMysql) {
            await adapter.exec("SET FOREIGN_KEY_CHECKS = 1");
        } else {
            await adapter.exec("PRAGMA foreign_keys = ON");
        }
    }

    console.log("Database cleaned up");
}

async function truncate(): Promise<void> {
    if (!adapter) {
        adapter = createAdapter();
    }

    console.log("Truncating tables...");
    const tables = await listBusinessTables(true);

    if (isMysql) {
        await getMysqlPool().query("SET FOREIGN_KEY_CHECKS = 0");
        try {
            for (const table of tables) {
                try {
                    await getMysqlPool().query(`DELETE FROM ${table.name}`);
                } catch (error) {
                    console.error(`Failed to truncate table ${table.name}:`, error);
                }
            }
        } finally {
            await getMysqlPool().query("SET FOREIGN_KEY_CHECKS = 1");
        }
    } else {
        for (const table of tables) {
            try {
                await adapter.exec(`DELETE FROM ${table.name}`);
            } catch (error) {
                console.error(`Failed to truncate table ${table.name}:`, error);
            }
        }
    }

    configService.clearCache();

    try {
        await fetch(`http://127.0.0.1:${config.SERVER_CONFIG.port}/test/cache/clear`, {
            method: "DELETE",
        });
    } catch (error) {
        console.error("Failed to clear server cache:", error);
    }

    console.log("Tables truncated");
}

async function clearDatabase(shouldCleanup: boolean = true): Promise<void> {
    try {
        if (shouldCleanup) {
            await cleanup();
            if (!isMysql) {
                removeDatabaseFile();
            }
        }
    } finally {
        await close();
    }
}

async function query<T>(sql: string, params: any[] = []): Promise<T[]> {
    if (!adapter) {
        throw new Error("Database not initialized");
    }

    try {
        if (isMysql) {
            const [rows] = await getMysqlPool().execute(sql, params);
            return rows as T[];
        }
        return localDb!.prepare(sql).all(...params) as T[];
    } catch (error) {
        console.error("Query failed:", sql, params, error);
        throw error;
    }
}

async function execute(sql: string, params: any[] = []): Promise<unknown> {
    if (!adapter) {
        throw new Error("Database not initialized");
    }

    try {
        if (isMysql) {
            const [result] = await getMysqlPool().execute(sql, params);
            return result;
        }
        return localDb!.prepare(sql).run(...params);
    } catch (error) {
        console.error("Execute failed:", sql, params, error);
        throw error;
    }
}

function getAdapter(): DBAdapter {
    if (!adapter) {
        throw new Error("Database not initialized");
    }
    return adapter;
}

async function close(): Promise<void> {
    if (adapter) {
        await adapter.close();
        adapter = null;
        localDb = null;
        console.log("Database connection closed");
    } else if (localDb) {
        localDb.close();
        localDb = null;
    }
}

export default {
    initDatabase,
    clearDatabase,
    init,
    cleanup,
    truncate,
    query,
    execute,
    getAdapter,
    close,
};
