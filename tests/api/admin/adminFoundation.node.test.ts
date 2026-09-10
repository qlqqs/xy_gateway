import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import dbHelper from "../../helpers/dbHelper";
import { setupAdminUser } from "../../globalSetup";
import adminApiRoutes from "../../../src/routes/adminApiRoutes";

const ROOT_TOKEN = "root-token-123";


async function clearAdminKey(): Promise<void> {
    await requestHelper.del("/admin-api-key.json", ROOT_TOKEN);
}


async function findAdminUserId(): Promise<number> {
    const response = await requestHelper.get("/user/list.json", ROOT_TOKEN);
    const users = Array.isArray(response.body?.list) ? response.body.list : [];
    const admin = users.find((user: any) => user?.type === "admin");
    return Number(admin?.id);
}


describe("Node Admin API foundation", () => {
    beforeAll(async () => {
        await dbHelper.truncate();
        await setupAdminUser();
    });

    beforeEach(async () => {
        await clearAdminKey();
    });

    it("exposes the complete 67-route map without external .json suffixes", () => {
        expect(adminApiRoutes.adminApiRouteMap).toHaveLength(67);
        expect(adminApiRoutes.adminApiRouteMap.every((spec) => !spec.externalPath.endsWith(".json"))).toBe(true);
        expect(adminApiRoutes.adminApiRouteMap.every((spec) => typeof spec.handler === "function")).toBe(true);
    });

    it("requires authentication before returning an unknown-path 404", async () => {
        const unauthenticated = await requestHelper.get("/api/v1/admin/does-not-exist");
        expect(unauthenticated.status).toBe(401);
        expect(unauthenticated.headers.get("content-type")).toContain("application/json");

        const authenticated = await requestHelper.get("/api/v1/admin/does-not-exist", ROOT_TOKEN);
        expect(authenticated.status).toBe(404);
        expect(authenticated.body).toEqual({ error: "Not found" });

        const jsonMistake = await requestHelper.get("/api/v1/admin/does-not-exist.json", ROOT_TOKEN);
        expect(jsonMistake.status).toBe(404);
        expect(jsonMistake.body).toEqual({ error: "Not found" });

        const svgMistake = await requestHelper.get(
            "/api/v1/admin/does-not-exist.svg",
            ROOT_TOKEN,
        );
        expect(svgMistake.status).toBe(404);
        expect(svgMistake.body).toEqual({ error: "Not found" });

        const rootPath = await requestHelper.get("/api/v1/admin", ROOT_TOKEN);
        expect(rootPath.status).toBe(404);
        expect(rootPath.body).toEqual({ error: "Not found" });

        const rootPathUnauthenticated = await requestHelper.get("/api/v1/admin");
        expect(rootPathUnauthenticated.status).toBe(401);

        const trailingSlash = await requestHelper.get("/api/v1/admin/", ROOT_TOKEN);
        expect(trailingSlash.status).toBe(404);
        expect(trailingSlash.body).toEqual({ error: "Not found" });

        const trailingSlashUnauthenticated = await requestHelper.get("/api/v1/admin/");
        expect(trailingSlashUnauthenticated.status).toBe(401);

        const unsupportedMethod = await requestHelper.post(
            "/api/v1/admin/status",
            {},
            ROOT_TOKEN,
        );
        expect(unsupportedMethod.status).toBe(404);
        expect(unsupportedMethod.body).toEqual({ error: "Not found" });

        const unsupportedHead = await requestHelper.request(
            "/api/v1/admin/status",
            {
                method: "HEAD",
                headers: { Authorization: `Bearer ${ROOT_TOKEN}` },
            },
        );
        expect(unsupportedHead.status).toBe(404);
        expect(unsupportedHead.headers.get("content-type")).toContain("application/json");

        const corsPreflight = await requestHelper.request(
            "/api/v1/admin/status",
            {
                method: "OPTIONS",
                headers: { Authorization: `Bearer ${ROOT_TOKEN}` },
            },
        );
        // 全局 CORS 中间件会先处理 OPTIONS；保留该既有预检行为。
        expect(corsPreflight.status).toBe(204);
    });

    it("generates, rotates, and deletes the global Admin Key", async () => {
        const initialStatus = await requestHelper.get(
            "/api/v1/admin/settings/admin-api-key",
            ROOT_TOKEN,
        );
        expect(initialStatus.status).toBe(200);
        expect(initialStatus.body).toEqual({ exists: false });

        const generated = await requestHelper.post(
            "/api/v1/admin/settings/admin-api-key/regenerate",
            {},
            ROOT_TOKEN,
        );
        expect(generated.status).toBe(200);
        expect(typeof generated.body.key).toBe("string");
        expect(generated.body.key).toMatch(/^xg_admin_[0-9a-f]{64}$/);

        const firstKey = generated.body.key as string;
        const viaAdminKey = await requestHelper.request("/api/v1/admin/status", {
            method: "GET",
            headers: { "x-api-key": firstKey },
        });
        expect(viaAdminKey.status).toBe(200);
        expect(viaAdminKey.body.status).toBe("ok");

        const rotated = await requestHelper.request(
            "/api/v1/admin/settings/admin-api-key/regenerate",
            {
                method: "POST",
                headers: { "x-api-key": firstKey },
                body: JSON.stringify({}),
            },
        );
        expect(rotated.status).toBe(200);
        const secondKey = rotated.body.key as string;
        expect(secondKey).not.toBe(firstKey);

        const oldKeyResponse = await requestHelper.request("/api/v1/admin/status", {
            method: "GET",
            headers: { "x-api-key": firstKey },
        });
        expect(oldKeyResponse.status).toBe(401);

        const removed = await requestHelper.request(
            "/api/v1/admin/settings/admin-api-key",
            {
                method: "DELETE",
                headers: { "x-api-key": secondKey },
            },
        );
        expect(removed.status).toBe(200);
        expect(removed.body).toEqual({ success: true });

        const finalStatus = await requestHelper.get(
            "/admin-api-key/status.json",
            ROOT_TOKEN,
        );
        expect(finalStatus.body).toEqual({ exists: false });
        expect((await requestHelper.del("/admin-api-key.json", ROOT_TOKEN)).status).toBe(200);
    });

    it("allows concurrent first-time regeneration and keeps only the last value active", async () => {
        const [first, second] = await Promise.all([
            requestHelper.post(
                "/api/v1/admin/settings/admin-api-key/regenerate",
                {},
                ROOT_TOKEN,
            ),
            requestHelper.post(
                "/api/v1/admin/settings/admin-api-key/regenerate",
                {},
                ROOT_TOKEN,
            ),
        ]);

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);

        const keys = [first.body.key, second.body.key];
        expect(keys[0]).toMatch(/^xg_admin_[0-9a-f]{64}$/);
        expect(keys[1]).toMatch(/^xg_admin_[0-9a-f]{64}$/);
        expect(keys[0]).not.toBe(keys[1]);

        const probes = await Promise.all(
            keys.map((key) => requestHelper.request("/api/v1/admin/status", {
                method: "GET",
                headers: { "x-api-key": key },
            })),
        );
        expect(probes.filter((probe) => probe.status === 200)).toHaveLength(1);
        expect(probes.filter((probe) => probe.status === 401)).toHaveLength(1);
    });

    it("treats x-api-key as authoritative and does not fall back to Bearer", async () => {
        const generated = await requestHelper.post(
            "/api/v1/admin/settings/admin-api-key/regenerate",
            {},
            ROOT_TOKEN,
        );
        const validKey = generated.body.key as string;

        const invalidWithBearer = await requestHelper.request("/api/v1/admin/status", {
            method: "GET",
            headers: {
                "x-api-key": "invalid-admin-key",
                Authorization: `Bearer ${ROOT_TOKEN}`,
            },
        });
        expect(invalidWithBearer.status).toBe(401);

        const emptyWithBearer = await requestHelper.request("/api/v1/admin/status", {
            method: "GET",
            headers: {
                "x-api-key": "",
                Authorization: `Bearer ${ROOT_TOKEN}`,
            },
        });
        expect(emptyWithBearer.status).toBe(401);

        const valid = await requestHelper.request("/api/v1/admin/status", {
            method: "GET",
            headers: { "x-api-key": validKey },
        });
        expect(valid.status).toBe(200);

        const llmNegative = await requestHelper.request("/v1/models", {
            method: "GET",
            headers: { "x-api-key": validKey },
        });
        expect(llmNegative.status).toBe(401);
    });

    it("returns 503 when no active real admin can be bound", async () => {
        const generated = await requestHelper.post(
            "/api/v1/admin/settings/admin-api-key/regenerate",
            {},
            ROOT_TOKEN,
        );
        const key = generated.body.key as string;
        const adminId = await findAdminUserId();
        expect(adminId).toBeGreaterThan(0);

        const disabled = await requestHelper.put(
            `/user/${adminId}`,
            { status: "disabled" },
            ROOT_TOKEN,
        );
        expect(disabled.status).toBe(200);

        const unavailable = await requestHelper.request("/api/v1/admin/status", {
            method: "GET",
            headers: { "x-api-key": key },
        });
        expect(unavailable.status).toBe(503);
        expect(unavailable.body.code).toBe("admin_identity_unavailable");

        const restored = await requestHelper.put(
            `/user/${adminId}`,
            { status: "active" },
            ROOT_TOKEN,
        );
        expect(restored.status).toBe(200);
    });

    it("hides and rejects admin_api_key through ordinary config endpoints", async () => {
        const generated = await requestHelper.post(
            "/api/v1/admin/settings/admin-api-key/regenerate",
            {},
            ROOT_TOKEN,
        );
        const key = generated.body.key as string;

        const config = await requestHelper.get("/config.json", ROOT_TOKEN);
        expect(config.status).toBe(200);
        expect(config.body).not.toHaveProperty("admin_api_key");
        expect(config.body).not.toHaveProperty("key_encryption_secret");

        const rejected = await requestHelper.put(
            "/config.json",
            {
                cch_rewrite_enabled: "false",
                admin_api_key: "attempted-overwrite",
            },
            ROOT_TOKEN,
        );
        expect(rejected.status).toBe(400);
        expect(rejected.body.code).toBe("reserved_config");

        const afterReject = await requestHelper.get("/config.json", ROOT_TOKEN);
        expect(afterReject.body.cch_rewrite_enabled).toBe("true");

        const stillValid = await requestHelper.request("/api/v1/admin/status", {
            method: "GET",
            headers: { "x-api-key": key },
        });
        expect(stillValid.status).toBe(200);
    });
});
