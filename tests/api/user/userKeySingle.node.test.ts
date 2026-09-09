import { beforeAll, describe, expect, it } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import dbHelper from "../../helpers/dbHelper";
import { setupAdminUser } from "../../globalSetup";

const ADMIN_TOKEN = "root-token-123";

let userId: number;
let otherUserId: number;
let firstKeyId: number;
let siblingKeyId: number;
let firstKeyValue: string;


describe("单个用户 Key 管理 API", () => {
    beforeAll(async () => {
        await dbHelper.truncate();
        await setupAdminUser();

        const user = await requestHelper.post(
            "/user/create.json",
            {
                name: "Single Key Owner",
                keys: [
                    {
                        value: "single-key-primary",
                        name: "primary",
                        quota: 1.5,
                        rateLimit: 7,
                    },
                    {
                        value: "single-key-sibling",
                        name: "sibling",
                        quota: 2,
                    },
                ],
            },
            ADMIN_TOKEN,
        );
        expect(user.status).toBe(200);
        userId = user.body.id;
        firstKeyId = user.body.keys[0].id;
        siblingKeyId = user.body.keys[1].id;
        firstKeyValue = user.body.keys[0].value;

        const other = await requestHelper.post(
            "/user/create.json",
            { name: "Single Key Other", keys: [{ value: "single-key-other" }] },
            ADMIN_TOKEN,
        );
        expect(other.status).toBe(200);
        otherUserId = other.body.id;
    });

    it("lists and reads keys through the external single-key paths", async () => {
        const list = await requestHelper.get(`/api/v1/admin/users/${userId}/api-keys`, ADMIN_TOKEN);
        expect(list.status).toBe(200);
        expect(list.body).toHaveLength(2);
        expect(list.body.map((key: any) => key.id)).toEqual([firstKeyId, siblingKeyId]);

        const detail = await requestHelper.get(
            `/api/v1/admin/users/${userId}/api-keys/${firstKeyId}`,
            ADMIN_TOKEN,
        );
        expect(detail.status).toBe(200);
        expect(detail.body.id).toBe(firstKeyId);
        expect(detail.body.value).toBe(firstKeyValue);
        expect(detail.body.quota).toBe(1.5);
        expect(detail.body.rateLimit).toBe(7);
    });

    it("creates one key without replacing its sibling keys", async () => {
        const created = await requestHelper.post(
            `/api/v1/admin/users/${userId}/api-keys`,
            { value: "single-key-created", name: "created" },
            ADMIN_TOKEN,
        );
        expect(created.status).toBe(200);
        expect(created.body.value).toBe("single-key-created");

        const list = await requestHelper.get(`/api/v1/admin/users/${userId}/api-keys`, ADMIN_TOKEN);
        expect(list.body).toHaveLength(3);
        expect(list.body.some((key: any) => key.id === siblingKeyId && key.value === "single-key-sibling")).toBe(true);
    });

    it("updates only submitted fields and rejects duplicate values", async () => {
        const expiresAt = "2030-01-02T03:04:05.000Z";
        const updated = await requestHelper.put(
            `/api/v1/admin/users/${userId}/api-keys/${firstKeyId}`,
            { name: "renamed primary", expiresAt },
            ADMIN_TOKEN,
        );
        expect(updated.status).toBe(200);
        expect(updated.body.name).toBe("renamed primary");
        expect(updated.body.value).toBe(firstKeyValue);
        expect(updated.body.quota).toBe(1.5);
        expect(updated.body.rateLimit).toBe(7);
        expect(updated.body.expiresAt).toBe(expiresAt);

        const duplicate = await requestHelper.post(
            `/api/v1/admin/users/${userId}/api-keys`,
            { value: "single-key-sibling" },
            ADMIN_TOKEN,
        );
        expect(duplicate.status).toBe(409);

        const duplicateUpdate = await requestHelper.put(
            `/api/v1/admin/users/${userId}/api-keys/${firstKeyId}`,
            { value: "single-key-sibling" },
            ADMIN_TOKEN,
        );
        expect(duplicateUpdate.status).toBe(409);
    });

    it("hides missing and cross-user keys behind the same 404", async () => {
        const paths = [
            `/api/v1/admin/users/${userId}/api-keys/999999`,
            `/api/v1/admin/users/${otherUserId}/api-keys/${firstKeyId}`,
        ];
        for (const path of paths) {
            expect((await requestHelper.get(path, ADMIN_TOKEN)).status).toBe(404);
            expect((await requestHelper.put(path, { name: "must fail" }, ADMIN_TOKEN)).status).toBe(404);
            expect((await requestHelper.del(path, ADMIN_TOKEN)).status).toBe(404);
        }
    });

    it("deletes only the selected key and keeps the old internal route contract", async () => {
        const deleted = await requestHelper.del(
            `/api/v1/admin/users/${userId}/api-keys/${siblingKeyId}`,
            ADMIN_TOKEN,
        );
        expect(deleted.status).toBe(200);
        expect(deleted.body).toEqual({ success: true });

        const sibling = await requestHelper.get(
            `/api/v1/admin/users/${userId}/api-keys/${siblingKeyId}`,
            ADMIN_TOKEN,
        );
        expect(sibling.status).toBe(404);

        const remaining = await requestHelper.get(`/user/${userId}/keys.json`, ADMIN_TOKEN);
        expect(remaining.status).toBe(200);
        expect(remaining.body).toHaveLength(2);
        expect(remaining.body.some((key: any) => key.id === firstKeyId)).toBe(true);

        const internalCreated = await requestHelper.post(
            `/user/${userId}/keys.json`,
            { value: "single-key-internal" },
            ADMIN_TOKEN,
        );
        expect(internalCreated.status).toBe(200);
        expect(internalCreated.body.value).toBe("single-key-internal");
    });

    it("rejects malformed IDs without accepting a .json external alias", async () => {
        const malformed = await requestHelper.get(
            `/api/v1/admin/users/${userId}/api-keys/not-an-id`,
            ADMIN_TOKEN,
        );
        expect(malformed.status).toBe(400);

        const jsonAlias = await requestHelper.get(
            `/api/v1/admin/users/${userId}/api-keys/${firstKeyId}.json`,
            ADMIN_TOKEN,
        );
        expect(jsonAlias.status).toBe(404);
        expect(jsonAlias.body).toEqual({ error: "Not found" });
    });
});
