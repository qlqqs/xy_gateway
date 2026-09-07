import { describe, expect, it } from "vitest";
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

describe("legacy user key migration", () => {
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
});
