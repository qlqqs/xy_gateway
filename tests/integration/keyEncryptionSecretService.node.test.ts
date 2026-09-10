import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConfigKey } from "../../src/constants";
import configManager from "../../src/manager/configManager";
import configService from "../../src/service/configService";
import keyEncryptionSecretService from "../../src/service/keyEncryptionSecretService";
import dbHelper from "../helpers/dbHelper";
import ormTestHelper from "../helpers/ormTestHelper";


describe("keyEncryptionSecretService (node, real db)", () => {
    const originalSecret = process.env.KEY_ENCRYPTION_SECRET;

    beforeAll(async () => {
        await ormTestHelper.connectNodeOrm();
    });

    beforeEach(async () => {
        await dbHelper.truncate();
        delete process.env.KEY_ENCRYPTION_SECRET;
    });

    afterEach(() => {
        if (originalSecret === undefined) {
            delete process.env.KEY_ENCRYPTION_SECRET;
        } else {
            process.env.KEY_ENCRYPTION_SECRET = originalSecret;
        }
    });

    it("generates a secret once and reuses the stored value", async () => {
        const first = await keyEncryptionSecretService.ensure();
        expect(first).toMatch(/^[0-9a-f]{64}$/);
        expect((await configManager.get(ConfigKey.KEY_ENCRYPTION_SECRET))?.value).toBe(first);

        delete process.env.KEY_ENCRYPTION_SECRET;
        const second = await keyEncryptionSecretService.ensure();
        expect(second).toBe(first);
    });

    it("persists the env secret when the database is empty", async () => {
        process.env.KEY_ENCRYPTION_SECRET = "env-integration-secret";
        const secret = await keyEncryptionSecretService.ensure();
        expect(secret).toBe("env-integration-secret");
        expect((await configManager.get(ConfigKey.KEY_ENCRYPTION_SECRET))?.value)
            .toBe("env-integration-secret");
    });

    it("does not overwrite a stored secret when env differs", async () => {
        await configManager.set(ConfigKey.KEY_ENCRYPTION_SECRET, "stored-integration-secret");
        process.env.KEY_ENCRYPTION_SECRET = "env-integration-secret";
        const secret = await keyEncryptionSecretService.ensure();
        expect(secret).toBe("env-integration-secret");
        expect((await configManager.get(ConfigKey.KEY_ENCRYPTION_SECRET))?.value)
            .toBe("stored-integration-secret");
    });

    it("hides and rejects the reserved encryption secret through configService", async () => {
        await configManager.set(ConfigKey.KEY_ENCRYPTION_SECRET, "hidden-secret");
        configService.clearCache();

        const all = await configService.getAll();
        expect(all).not.toHaveProperty("key_encryption_secret");
        expect((await configService.getConfig(ConfigKey.KEY_ENCRYPTION_SECRET)).getString()).toBe("");

        await expect(configService.setValue(ConfigKey.KEY_ENCRYPTION_SECRET, "overwrite"))
            .rejects.toMatchObject({ code: "reserved_config", statusCode: 400 });
        await expect(configService.updateAll({
            cch_rewrite_enabled: "false",
            key_encryption_secret: "overwrite",
        })).rejects.toMatchObject({ code: "reserved_config", statusCode: 400 });

        expect((await configManager.get(ConfigKey.KEY_ENCRYPTION_SECRET))?.value).toBe("hidden-secret");
        expect((await configService.getAll()).cch_rewrite_enabled).toBe("true");
    });
});
