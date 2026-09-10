import { afterEach, describe, expect, it } from "vitest";
import type { DBAdapter } from "../../../src/util/db/dbAdapter";
import userKeyMigrationService from "../../../src/service/userKeyMigrationService";
import userKeyUtil from "../../../src/util/userKeyUtil";

interface RunCall {
    sql: string;
    params: unknown[];
}

function createAdapter(runCalls: RunCall[]): DBAdapter {
    return {
        exec: async () => undefined,
        query: async <T>(sql: string): Promise<T[]> => {
            if (sql.includes("SELECT id, token FROM user")) {
                return [{ id: 7, token: "legacy-key-value" }] as T[];
            }
            if (sql.includes("SELECT id FROM user_group")) {
                return [{ id: 3 }] as T[];
            }
            if (sql.includes("SELECT id, user_id, key_hash FROM user_key")) {
                return [] as T[];
            }
            throw new Error(`Unexpected migration query: ${sql}`);
        },
        run: async (sql: string, ...params: unknown[]) => {
            runCalls.push({ sql, params });
        },
        close: async () => undefined,
    };
}


function createAutoSecretAdapter(runCalls: RunCall[], initialConfig = "") {
    let configValue = initialConfig;
    return {
        exec: async () => undefined,
        query: async <T>(sql: string): Promise<T[]> => {
            if (sql.includes("SELECT id, token FROM user")) {
                return [{ id: 7, token: "legacy-key-value" }] as T[];
            }
            if (sql.includes("SELECT id FROM user_group")) {
                return [{ id: 3 }] as T[];
            }
            if (sql.includes("SELECT id, user_id, key_hash FROM user_key")) {
                return [] as T[];
            }
            if (sql.includes("FROM config")) {
                return (configValue ? [{ value: configValue }] : []) as T[];
            }
            throw new Error(`Unexpected migration query: ${sql}`);
        },
        run: async (sql: string, ...params: unknown[]) => {
            runCalls.push({ sql, params });
            if (sql.includes("INSERT INTO config")) {
                configValue = String(params[1] ?? "");
            }
        },
        close: async () => undefined,
    };
}


describe("legacy user key migration", () => {
    const originalSecret = process.env.KEY_ENCRYPTION_SECRET;

    afterEach(() => {
        if (originalSecret === undefined) {
            delete process.env.KEY_ENCRYPTION_SECRET;
        } else {
            process.env.KEY_ENCRYPTION_SECRET = originalSecret;
        }
    });

    it("binds every required JSON/default field for strict MySQL inserts", async () => {
        const calls: RunCall[] = [];
        const report = await userKeyMigrationService.importLegacyUserKeys(
            createAdapter(calls),
            "migration-test-secret",
        );

        expect(report).toEqual({ imported: 1, skipped: 0 });
        expect(calls).toHaveLength(1);
        const [call] = calls;
        expect(call.sql).toContain("model_whitelist, ip_whitelist, ip_blacklist");
        expect(call.sql).toContain("'[]', '[]', '[]', 0, 0, 0");
        expect(call.params).toHaveLength(6);
        expect(call.params.slice(0, 3)).toEqual([7, 3, "迁移 API Key"]);
        expect(await userKeyUtil.decryptKey(String(call.params[5]), "migration-test-secret"))
            .toBe("legacy-key-value");
    });

    it("generates and stores an encryption secret when none is configured", async () => {
        delete process.env.KEY_ENCRYPTION_SECRET;
        const calls: RunCall[] = [];
        const report = await userKeyMigrationService.importLegacyUserKeys(
            createAutoSecretAdapter(calls),
        );

        expect(report).toEqual({ imported: 1, skipped: 0 });
        const configInsert = calls.find(call => call.sql.includes("INSERT INTO config"));
        const keyInsert = calls.find(call => call.sql.includes("INSERT INTO user_key"));
        expect(configInsert?.params[0]).toBe("key_encryption_secret");
        const secret = String(configInsert?.params[1]);
        expect(secret).toMatch(/^[0-9a-f]{64}$/);
        expect(await userKeyUtil.decryptKey(String(keyInsert?.params[5]), secret))
            .toBe("legacy-key-value");
    });

    it("reuses a stored encryption secret when env is empty", async () => {
        delete process.env.KEY_ENCRYPTION_SECRET;
        const calls: RunCall[] = [];
        const report = await userKeyMigrationService.importLegacyUserKeys(
            createAutoSecretAdapter(calls, "stored-migration-secret"),
        );

        expect(report).toEqual({ imported: 1, skipped: 0 });
        expect(calls.some(call => call.sql.includes("INSERT INTO config"))).toBe(false);
        const keyInsert = calls.find(call => call.sql.includes("INSERT INTO user_key"));
        expect(await userKeyUtil.decryptKey(String(keyInsert?.params[5]), "stored-migration-secret"))
            .toBe("legacy-key-value");
    });
});
