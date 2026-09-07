import { describe, expect, it } from "vitest";
import type { DBAdapter } from "../../../src/util/db/dbAdapter";
import dbMigrationService from "../../../src/service/dbMigrationService";

function versionAdapter(version: string): DBAdapter {
    return {
        exec: async () => undefined,
        query: async <T>(): Promise<T[]> => [{ version }] as T[],
        run: async () => undefined,
        close: async () => undefined,
    };
}

describe("MySQL migration version boundary", () => {
    it.each(["8.0.13", "8.0.34", "8.4.7", "9.0.1"])(
        "accepts MySQL %s",
        async (version) => {
            await expect(
                dbMigrationService.ensureSupportedMySqlVersion(versionAdapter(version)),
            ).resolves.toBeUndefined();
        },
    );

    it.each(["8.0.12", "8.0.9", "5.7.44", "10.6.0-MariaDB"])(
        "rejects unsupported server %s",
        async (version) => {
            await expect(
                dbMigrationService.ensureSupportedMySqlVersion(versionAdapter(version)),
            ).rejects.toMatchObject({ code: "mysql_version_unsupported" });
        },
    );
});
