import { readFileSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const migrationDirectory = join(process.cwd(), "resource", "migrate");
let db: Database.Database | null = null;


afterEach(() => {
    db?.close();
    db = null;
});


describe("model upstream migration", () => {
    it("expands legacy routing config into model_upstream before dropping removed columns", () => {
        db = new Database(":memory:");
        db.pragma("foreign_keys = ON");
        db.exec(`
            CREATE TABLE user (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                token TEXT NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE UNIQUE INDEX token_index ON user(token);

            CREATE TABLE model (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                enable INTEGER NOT NULL DEFAULT 1,
                prices TEXT NOT NULL DEFAULT '{}',
                routing_mode TEXT DEFAULT NULL,
                routing_config TEXT DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE UNIQUE INDEX name_index ON model(name);

            CREATE TABLE vendor (
                id INTEGER PRIMARY KEY,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                token TEXT NOT NULL,
                urls TEXT NOT NULL DEFAULT '{}',
                config TEXT NOT NULL DEFAULT '{}',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE vendor_model (
                id INTEGER PRIMARY KEY,
                vendor_id INTEGER NOT NULL,
                model_id TEXT NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE record (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                model_id INTEGER,
                status TEXT NOT NULL,
                cost REAL NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        `);

        db.prepare("INSERT INTO user (id, name, token) VALUES (?, ?, ?)")
            .run(1, "legacy-user", "legacy-token");
        db.prepare("INSERT INTO vendor (id, type, name, token, urls, config) VALUES (?, ?, ?, ?, ?, ?)")
            .run(3, "other", "legacy-vendor", "vendor-token", '{"openai":"http://localhost:9999"}', "{}");
        db.prepare("INSERT INTO vendor_model (id, vendor_id, model_id) VALUES (?, ?, ?)")
            .run(7, 3, "legacy-upstream-model");
        db.prepare(
            "INSERT INTO model (id, name, routing_mode, routing_config) VALUES (?, ?, ?, ?)",
        ).run(
            1,
            "legacy-model",
            "single",
            JSON.stringify({
                upstreams: [{ vendor_id: 3, vendor_model_id: 7, enabled: true }],
                failover: { enabled: true },
            }),
        );
        db.prepare(
            "INSERT INTO model (id, name, routing_mode, routing_config) VALUES (?, ?, ?, ?)",
        ).run(2, "unconfigured-model", null, null);

        db.exec(readFileSync(join(migrationDirectory, "migrate_0031", "sqlite.sql"), "utf8"));

        const mappings = db.prepare(
            "SELECT model_id, vendor_id, vendor_model_id, enabled, sort_order FROM model_upstream ORDER BY model_id",
        ).all() as Array<Record<string, number>>;
        expect(mappings).toEqual([{
            model_id: 1,
            vendor_id: 3,
            vendor_model_id: 7,
            enabled: 1,
            sort_order: 0,
        }]);

        const defaultGroup = db.prepare(
            "SELECT id FROM user_group WHERE name = '默认分组'",
        ).get() as { id: number };
        const vendor = db.prepare("SELECT group_id FROM vendor WHERE id = 3").get() as { group_id: number };
        expect(vendor.group_id).toBe(defaultGroup.id);

        // migrate_0031 is the only step that reads the legacy route columns;
        // they are still present until the hard cutover migration runs.
        const preCutoverColumns = db.prepare("PRAGMA table_info(model)").all() as Array<{ name: string }>;
        expect(preCutoverColumns.map(column => column.name)).toEqual(expect.arrayContaining([
            "routing_mode",
            "routing_config",
        ]));

        db.exec(readFileSync(join(migrationDirectory, "migrate_0032", "sqlite.sql"), "utf8"));

        const modelColumns = db.prepare("PRAGMA table_info(model)").all() as Array<{ name: string }>;
        expect(modelColumns.map(column => column.name)).not.toContain("routing_mode");
        expect(modelColumns.map(column => column.name)).not.toContain("routing_config");
        const userColumns = db.prepare("PRAGMA table_info(user)").all() as Array<{ name: string }>;
        expect(userColumns.map(column => column.name)).not.toContain("token");

        // The normalized mapping is the durable source of truth after cutover.
        const persistedMapping = db.prepare(
            "SELECT model_id, vendor_id, vendor_model_id, enabled, sort_order FROM model_upstream WHERE model_id = 1",
        ).get();
        expect(persistedMapping).toEqual(mappings[0]);
    });
});
