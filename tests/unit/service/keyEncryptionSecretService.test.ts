import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigKey } from "../../../src/constants";

const configMocks = vi.hoisted(() => ({
    get: vi.fn(),
    createIfAbsent: vi.fn(),
}));

vi.mock("../../../src/manager/configManager", () => ({
    default: {
        get: configMocks.get,
        createIfAbsent: configMocks.createIfAbsent,
    },
}));


async function loadService() {
    return await import("../../../src/service/keyEncryptionSecretService");
}


describe("keyEncryptionSecretService", () => {
    const originalSecret = process.env.KEY_ENCRYPTION_SECRET;

    beforeEach(() => {
        vi.resetModules();
        configMocks.get.mockReset();
        configMocks.createIfAbsent.mockReset();
        delete process.env.KEY_ENCRYPTION_SECRET;
        configMocks.createIfAbsent.mockImplementation(async (_name: string, value: string) => ({
            value,
        }));
    });

    afterEach(() => {
        if (originalSecret === undefined) {
            delete process.env.KEY_ENCRYPTION_SECRET;
        } else {
            process.env.KEY_ENCRYPTION_SECRET = originalSecret;
        }
    });

    it("reuses the stored secret when env is empty", async () => {
        configMocks.get.mockResolvedValue({ value: "stored-secret" });
        const service = await loadService();

        await expect(service.default.ensure()).resolves.toBe("stored-secret");
        expect(process.env.KEY_ENCRYPTION_SECRET).toBe("stored-secret");
        expect(configMocks.createIfAbsent).not.toHaveBeenCalled();
    });

    it("persists env secret when the database is empty", async () => {
        process.env.KEY_ENCRYPTION_SECRET = "env-secret";
        configMocks.get.mockResolvedValue(null);
        const service = await loadService();

        await expect(service.default.ensure()).resolves.toBe("env-secret");
        expect(configMocks.createIfAbsent).toHaveBeenCalledWith(
            ConfigKey.KEY_ENCRYPTION_SECRET,
            "env-secret",
        );
    });

    it("uses env and does not overwrite a different stored secret", async () => {
        process.env.KEY_ENCRYPTION_SECRET = "env-secret";
        configMocks.get.mockResolvedValue({ value: "stored-secret" });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const service = await loadService();

        await expect(service.default.ensure()).resolves.toBe("env-secret");
        expect(configMocks.createIfAbsent).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("generates and stores a secret when neither env nor database has one", async () => {
        configMocks.get.mockResolvedValue(null);
        const bytes = new Uint8Array(32).fill(0xab);
        const spy = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => {
            const target = array as Uint8Array;
            target.set(bytes);
            return array;
        });
        const service = await loadService();

        const secret = await service.default.ensure();
        expect(secret).toBe("ab".repeat(32));
        expect(process.env.KEY_ENCRYPTION_SECRET).toBe(secret);
        expect(configMocks.createIfAbsent).toHaveBeenCalledWith(
            ConfigKey.KEY_ENCRYPTION_SECRET,
            secret,
        );
        spy.mockRestore();
    });

    it("uses the concurrently persisted database value after generate", async () => {
        configMocks.get.mockResolvedValue(null);
        configMocks.createIfAbsent.mockResolvedValue({ value: "winner-secret" });
        const service = await loadService();

        await expect(service.default.ensure()).resolves.toBe("winner-secret");
        expect(process.env.KEY_ENCRYPTION_SECRET).toBe("winner-secret");
    });

    it("generates a secret through the migration adapter when env is empty", async () => {
        const inserted: Array<{ sql: string; params: unknown[] }> = [];
        let stored = "";
        const adapter = {
            exec: async () => undefined,
            query: async <T>(sql: string): Promise<T[]> => {
                if (sql.includes("FROM config")) {
                    return (stored ? [{ value: stored }] : []) as T[];
                }
                throw new Error(`Unexpected query: ${sql}`);
            },
            run: async (sql: string, ...params: unknown[]) => {
                inserted.push({ sql, params });
                stored = String(params[1] ?? "");
            },
            close: async () => undefined,
        };
        const service = await loadService();

        const secret = await service.default.ensureForAdapter(adapter);
        expect(secret).toMatch(/^[0-9a-f]{64}$/);
        expect(stored).toBe(secret);
        expect(inserted).toHaveLength(1);
        expect(inserted[0].params).toEqual([ConfigKey.KEY_ENCRYPTION_SECRET, secret]);
    });
});
