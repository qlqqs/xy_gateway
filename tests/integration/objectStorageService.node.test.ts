import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import objectStorageService from "../../src/service/objectStorageService";
import dbHelper from "../helpers/dbHelper";
import ormTestHelper from "../helpers/ormTestHelper";

async function getStoredDatabaseObject(key: string): Promise<{ object_key: string; data: Buffer } | null> {
    const rows = await dbHelper.query<{ object_key: string; data: Buffer }>(
        "SELECT object_key, data FROM storage_record WHERE object_key = ?",
        [key],
    );
    return rows[0] ?? null;
}

describe("objectStorageService", () => {
    beforeAll(async () => {
        await ormTestHelper.connectNodeOrm();
    });

    beforeEach(async () => {
        await dbHelper.truncate();
    });

    it("stores and reads binary data in storage_record", async () => {
        const key = "object-storage/binary";
        const data = new Uint8Array([0, 1, 2, 255]);

        await objectStorageService.put(key, data);

        const stored = await objectStorageService.get(key);
        expect(Array.from(stored!)).toEqual([0, 1, 2, 255]);
        expect((await getStoredDatabaseObject(key))?.object_key).toBe(key);
    });

    it("overwrites existing objects by key", async () => {
        const key = "object-storage/overwrite";

        await objectStorageService.put(key, new Uint8Array([1, 2, 3]));
        await objectStorageService.put(key, new Uint8Array([9, 8]));

        const stored = await objectStorageService.get(key);
        expect(Array.from(stored!)).toEqual([9, 8]);
        const rows = await dbHelper.query<{ count: number }>(
            "SELECT COUNT(*) AS count FROM storage_record WHERE object_key = ?",
            [key],
        );
        expect(Number(rows[0].count)).toBe(1);
    });

    it("preserves empty binary data", async () => {
        const key = "object-storage/empty";

        await objectStorageService.put(key, new Uint8Array());

        const stored = await objectStorageService.get(key);
        expect(stored).not.toBeNull();
        expect(stored!.byteLength).toBe(0);
    });

    it("supports text helpers and deletion", async () => {
        const key = "object-storage/text";

        await objectStorageService.putText(key, "hello 数据");
        expect(await objectStorageService.getText(key)).toBe("hello 数据");

        await objectStorageService.delete(key);
        expect(await objectStorageService.get(key)).toBeNull();
    });

    it("deletes objects by prefix without touching other keys", async () => {
        await objectStorageService.put("record/clear-a", new Uint8Array([1]));
        await objectStorageService.put("recording/clear-b", new Uint8Array([2]));
        await objectStorageService.put("other/clear-c", new Uint8Array([3]));

        const cleared = await objectStorageService.deleteByPrefix("record/");

        expect(cleared).toBe(1);
        expect(await objectStorageService.get("record/clear-a")).toBeNull();
        expect(Array.from((await objectStorageService.get("recording/clear-b"))!)).toEqual([2]);
        expect(Array.from((await objectStorageService.get("other/clear-c"))!)).toEqual([3]);
    });

    it("rejects empty keys and prefixes", async () => {
        await expect(objectStorageService.get(" ")).rejects.toMatchObject({ statusCode: 400 });
        await expect(objectStorageService.deleteByPrefix("")).rejects.toMatchObject({ statusCode: 400 });
    });
});
