import { beforeAll, describe, expect, it } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import dbHelper from "../../helpers/dbHelper";
import { setupAdminUser } from "../../globalSetup";
import userFixtures from "../../fixtures/userFixtures";
import vendorFixtures from "../../fixtures/vendorFixtures";
import modelFixtures from "../../fixtures/modelFixtures";

const ROOT_TOKEN = "root-token-123";
const NORMAL_TOKEN = "external-normal-token";
const DISABLED_ADMIN_TOKEN = "external-disabled-admin-token";

let canonicalAdminId = 0;
let vendorId = 0;
let modelName = "";
let adminApiKey = "";

async function requestWithAdminKey(endpoint: string, options: { method?: string; body?: string } = {}) {
    return requestHelper.request(endpoint, {
        method: options.method ?? "GET",
        headers: { "x-api-key": adminApiKey },
        body: options.body,
    });
}

describe("Node Admin API authentication and domain coverage", () => {
    beforeAll(async () => {
        await dbHelper.truncate();
        await setupAdminUser();

        const users = await requestHelper.get("/user/list.json", ROOT_TOKEN);
        const canonicalAdmin = users.body.list.find((user: { type?: string }) => user.type === "admin");
        canonicalAdminId = Number(canonicalAdmin?.id);
        expect(canonicalAdminId).toBeGreaterThan(0);

        const normal = await requestHelper.post(
            "/user/create.json",
            { name: "External API Normal User", type: "normal", keys: [{ value: NORMAL_TOKEN }] },
            ROOT_TOKEN,
        );
        expect(normal.status).toBe(200);

        const disabledAdmin = await requestHelper.post(
            "/user/create.json",
            { name: "External API Disabled Admin", type: "admin", keys: [{ value: DISABLED_ADMIN_TOKEN }] },
            ROOT_TOKEN,
        );
        expect(disabledAdmin.status).toBe(200);
        const disabled = await requestHelper.put(
            `/user/${disabledAdmin.body.id}`,
            { status: "disabled" },
            ROOT_TOKEN,
        );
        expect(disabled.status).toBe(200);

        const vendor = await requestHelper.post(
            "/vendor/create.json",
            { ...vendorFixtures.VENDOR_FIXTURES.openai(), name: "External API Mock Vendor" },
            ROOT_TOKEN,
        );
        expect(vendor.status).toBe(200);
        vendorId = Number(vendor.body.id);

        modelName = `external-admin-route-${Date.now()}`;
        const model = await requestHelper.post(
            "/model/create.json",
            modelFixtures.createRandomModel(vendorId, modelName),
            ROOT_TOKEN,
        );
        expect(model.status).toBe(200);
    });

    it("enforces Admin Key priority and keeps Bearer/LLM authentication separate", async () => {
        const generated = await requestHelper.post(
            "/api/v1/admin/settings/admin-api-key/regenerate",
            {},
            ROOT_TOKEN,
        );
        expect(generated.status).toBe(200);
        adminApiKey = generated.body.key;

        expect((await requestWithAdminKey("/api/v1/admin/status")).status).toBe(200);
        expect((await requestHelper.get("/api/v1/admin/status", ROOT_TOKEN)).status).toBe(200);

        const invalidWithBearer = await requestHelper.request("/api/v1/admin/status", {
            method: "GET",
            headers: { "x-api-key": "invalid-admin-key", Authorization: `Bearer ${ROOT_TOKEN}` },
        });
        expect(invalidWithBearer.status).toBe(401);

        const normalUser = await requestHelper.get("/api/v1/admin/status", NORMAL_TOKEN);
        expect(normalUser.status).toBe(403);
        expect(normalUser.body.error).toBe("Admin access required");

        const disabledAdmin = await requestHelper.get("/api/v1/admin/status", DISABLED_ADMIN_TOKEN);
        expect(disabledAdmin.status).toBe(403);
        expect(disabledAdmin.body.error).toBe("User disabled");

        const llmWithAdminKey = await requestHelper.request("/v1/models", {
            method: "GET",
            headers: { "x-api-key": adminApiKey },
        });
        expect(llmWithAdminKey.status).toBe(401);
    });

    it("reaches every representative local management domain through the external map", async () => {
        const requests = [
            "/api/v1/admin/settings",
            "/api/v1/admin/client-config/status",
            "/api/v1/admin/groups",
            "/api/v1/admin/vendors",
            `/api/v1/admin/vendors/${vendorId}/models`,
            "/api/v1/admin/models",
            "/api/v1/admin/users",
            `/api/v1/admin/users/${canonicalAdminId}/api-keys`,
            "/api/v1/admin/balance/recharges",
            "/api/v1/admin/records",
            "/api/v1/admin/records/latest",
            "/api/v1/admin/stats/dashboard",
        ];

        for (const endpoint of requests) {
            const response = await requestWithAdminKey(endpoint);
            expect(response.status, endpoint).toBe(200);
            expect(response.headers.get("content-type"), endpoint).toContain("application/json");
        }
    });

    it("uses the real bound admin context for model route-test and preserves old routes", async () => {
        const routeTest = await requestWithAdminKey("/api/v1/admin/models/route-test", {
            method: "POST",
            body: JSON.stringify({ model: modelName, format: "openai" }),
        });
        expect(routeTest.status).toBe(200);
        expect(routeTest.body.success).toBe(true);
        expect(routeTest.body.status).toBe(200);

        const records = await requestHelper.getFinalizedRecords(ROOT_TOKEN, 10);
        expect(records.some(record => Number(record.user_id) === canonicalAdminId)).toBe(true);

        const oldStatus = await requestHelper.get("/status.json", ROOT_TOKEN);
        expect(oldStatus.status).toBe(200);
        const oldKeys = await requestHelper.get(`/user/${canonicalAdminId}/keys.json`, ROOT_TOKEN);
        expect(oldKeys.status).toBe(200);
        expect(Array.isArray(oldKeys.body)).toBe(true);
    });
});
