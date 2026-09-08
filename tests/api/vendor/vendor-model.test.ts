import { describe, it, expect, beforeAll } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import vendorFixtures from "../../fixtures/vendorFixtures";
import dbHelper from "../../helpers/dbHelper";
import { setupAdminUser } from "../../globalSetup";

/**
 * Vendor Model & Preset URLs Tests
 */

let adminToken: string;
let vendorId: number;

describe("Vendor Model API", () => {
    beforeAll(async () => {
        await dbHelper.truncate();
        adminToken = await setupAdminUser();

        const vendor = await requestHelper.post(
            "/vendor/create.json",
            vendorFixtures.VENDOR_FIXTURES.openai(),
            adminToken,
        );
        vendorId = vendor.body.id;
    });

    describe("GET /vendor/preset-urls.json", () => {
        it("should return preset URL configuration", async () => {
            const response = await requestHelper.get("/vendor/preset-urls.json", adminToken);

            expect(response.status).toBe(200);
            expect(typeof response.body).toBe("object");
        });

        it("should include standard vendor types with correct URL keys", async () => {
            const response = await requestHelper.get("/vendor/preset-urls.json", adminToken);

            expect(response.body).toHaveProperty("openai");
            expect(response.body.openai).toHaveProperty("openai");

            expect(response.body).toHaveProperty("deepseek");
            expect(response.body.deepseek).toHaveProperty("openai");
            expect(response.body.deepseek).toHaveProperty("anthropic");

            expect(response.body).toHaveProperty("aliyun");
            expect(response.body.aliyun).toHaveProperty("openai");
            expect(response.body.aliyun).toHaveProperty("anthropic");
        });

        it("should include anthropic and google vendor types", async () => {
            const response = await requestHelper.get("/vendor/preset-urls.json", adminToken);

            expect(response.body).toHaveProperty("anthropic");
            expect(response.body.anthropic).toHaveProperty("anthropic");
            expect(typeof response.body.anthropic.anthropic).toBe("string");

            expect(response.body).toHaveProperty("google");
            expect(response.body.google).toHaveProperty("openai");
            expect(typeof response.body.google.openai).toBe("string");
        });

        it("should include opencode_go vendor type", async () => {
            const response = await requestHelper.get("/vendor/preset-urls.json", adminToken);

            expect(response.body).toHaveProperty("opencode_go");
            expect(response.body.opencode_go).toHaveProperty("openai");
        });

        it("should require authentication", async () => {
            const response = await requestHelper.get("/vendor/preset-urls.json");
            expect(response.status).toBe(401);
        });
    });

    describe("GET /vendor/:id/model/list.json", () => {
        it("should return empty array when no models added", async () => {
            const response = await requestHelper.get(
                `/vendor/${vendorId}/model/list.json`,
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body).toHaveLength(0);
        });
    });

    describe("POST /vendor/:id/model/add.json", () => {
        let firstModelId: number;

        it("should add a vendor model", async () => {
            const response = await requestHelper.post(
                `/vendor/${vendorId}/model/add.json`,
                { model_id: "gpt-4o" },
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("id");
            expect(response.body.vendor_id).toBe(vendorId);
            expect(response.body.model_id).toBe("gpt-4o");
            expect(response.body).toHaveProperty("created_at");
            expect(response.body).toHaveProperty("updated_at");

            firstModelId = response.body.id;
        });

        it("should appear in the list after adding", async () => {
            const response = await requestHelper.get(
                `/vendor/${vendorId}/model/list.json`,
                adminToken,
            );

            expect(response.body).toHaveLength(1);
            expect(response.body[0].model_id).toBe("gpt-4o");

            const vendorResponse = await requestHelper.get(`/vendor/${vendorId}`, adminToken);
            expect(vendorResponse.body.config.available_models).toEqual(["gpt-4o"]);
            expect(vendorResponse.body.model_count).toBe(1);
        });

        it("should add a second model", async () => {
            await requestHelper.post(
                `/vendor/${vendorId}/model/add.json`,
                { model_id: "gpt-4o-mini" },
                adminToken,
            );

            const listResponse = await requestHelper.get(
                `/vendor/${vendorId}/model/list.json`,
                adminToken,
            );

            expect(listResponse.body).toHaveLength(2);
            const modelIds = listResponse.body.map((m: any) => m.model_id);
            expect(modelIds).toContain("gpt-4o");
            expect(modelIds).toContain("gpt-4o-mini");
        });

        it("should return 409 for duplicate model_id", async () => {
            const response = await requestHelper.post(
                `/vendor/${vendorId}/model/add.json`,
                { model_id: "gpt-4o" },
                adminToken,
            );

            expect(response.status).toBe(409);
        });

        it("should return 404 for non-existent vendor", async () => {
            const response = await requestHelper.post(
                `/vendor/99999/model/add.json`,
                { model_id: "gpt-4o" },
                adminToken,
            );

            expect(response.status).toBe(404);
        });

        it("should trim whitespace from model_id", async () => {
            const response = await requestHelper.post(
                `/vendor/${vendorId}/model/add.json`,
                { model_id: "  gpt-3.5-turbo  " },
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(response.body.model_id).toBe("gpt-3.5-turbo");
        });

        describe("POST /vendor-model/batch.json", () => {
            it("should return vendor models by IDs", async () => {
                const addRes = await requestHelper.post(
                    `/vendor/${vendorId}/model/add.json`,
                    { model_id: "batch-test-model" },
                    adminToken,
                );
                const batchModelId = addRes.body.id;

                const response = await requestHelper.post(
                    "/vendor-model/batch.json",
                    { ids: [firstModelId, batchModelId] },
                    adminToken,
                );

                expect(response.status).toBe(200);
                expect(Array.isArray(response.body)).toBe(true);
                const returnedIds = response.body.map((m: any) => m.id);
                expect(returnedIds).toContain(firstModelId);
                expect(returnedIds).toContain(batchModelId);
            });

            it("should return empty array for empty ids", async () => {
                const response = await requestHelper.post(
                    "/vendor-model/batch.json",
                    { ids: [] },
                    adminToken,
                );

                expect(response.status).toBe(200);
                expect(response.body).toEqual([]);
            });
        });
    });

    describe("POST /vendor/:id/model/sync.json", () => {
        it("should replace all vendor models with the given list", async () => {
            const response = await requestHelper.post(
                `/vendor/${vendorId}/model/sync.json`,
                { model_ids: ["claude-3-5-sonnet", "claude-3-haiku"] },
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body).toHaveLength(2);

            const ids = response.body.map((m: any) => m.model_id);
            expect(ids).toContain("claude-3-5-sonnet");
            expect(ids).toContain("claude-3-haiku");
            expect(ids).not.toContain("gpt-4o");

            const vendorResponse = await requestHelper.get(`/vendor/${vendorId}`, adminToken);
            expect(vendorResponse.body.config.available_models).toEqual([
                "claude-3-5-sonnet",
                "claude-3-haiku",
            ]);
            expect(vendorResponse.body.model_count).toBe(2);
        });

        it("should return records ordered by model_id", async () => {
            const response = await requestHelper.post(
                `/vendor/${vendorId}/model/sync.json`,
                { model_ids: ["z-model", "a-model", "m-model"] },
                adminToken,
            );

            const ids = response.body.map((m: any) => m.model_id);
            expect(ids).toEqual(["a-model", "m-model", "z-model"]);
        });

        it("should trim and deduplicate model IDs", async () => {
            const response = await requestHelper.post(
                `/vendor/${vendorId}/model/sync.json`,
                { model_ids: ["  gpt-4o  ", "gpt-4o", "claude-3-haiku"] },
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(response.body.map((m: any) => m.model_id)).toEqual([
                "claude-3-haiku",
                "gpt-4o",
            ]);
        });

        it("should preserve IDs for unchanged models during synchronization", async () => {
            const initial = await requestHelper.post(
                `/vendor/${vendorId}/model/sync.json`,
                { model_ids: ["stable-model", "removed-model"] },
                adminToken,
            );
            const stableId = initial.body.find((model: any) => model.model_id === "stable-model")?.id;
            expect(stableId).toEqual(expect.any(Number));
            const routedModel = await requestHelper.post(
                "/model/create.json",
                {
                    name: `stable-sync-route-${Date.now()}`,
                    enable: true,
                    prices: {},
                    mapping: {
                        upstreams: [{
                            vendor_id: vendorId,
                            vendor_model_id: stableId,
                            enabled: true,
                        }],
                    },
                },
                adminToken,
            );
            expect(routedModel.status).toBe(200);

            const updated = await requestHelper.post(
                `/vendor/${vendorId}/model/sync.json`,
                { model_ids: ["stable-model", "added-model"] },
                adminToken,
            );

            expect(updated.status).toBe(200);
            expect(updated.body.find((model: any) => model.model_id === "stable-model")?.id).toBe(stableId);
            expect(updated.body.map((model: any) => model.model_id)).toEqual([
                "added-model",
                "stable-model",
            ]);
            const persistedRoute = await requestHelper.get(
                `/model/${routedModel.body.id}`,
                adminToken,
            );
            expect(persistedRoute.body.mapping.upstreams[0].vendor_model_id).toBe(stableId);
        });

        it("should reject non-string and blank model IDs without replacing existing models", async () => {
            const before = await requestHelper.get(
                `/vendor/${vendorId}/model/list.json`,
                adminToken,
            );
            const invalidPayloads = [
                { model_ids: ["valid-model", 42] },
                { model_ids: ["valid-model", "   "] },
            ];

            for (const payload of invalidPayloads) {
                const response = await requestHelper.post(
                    `/vendor/${vendorId}/model/sync.json`,
                    payload,
                    adminToken,
                );
                expect(response.status).toBe(400);
            }

            const listResponse = await requestHelper.get(
                `/vendor/${vendorId}/model/list.json`,
                adminToken,
            );
            expect(listResponse.body).toEqual(before.body);
        });

        it("should clear all models when syncing with empty list", async () => {
            const response = await requestHelper.post(
                `/vendor/${vendorId}/model/sync.json`,
                { model_ids: [] },
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(0);

            const listResponse = await requestHelper.get(
                `/vendor/${vendorId}/model/list.json`,
                adminToken,
            );
            expect(listResponse.body).toHaveLength(0);
        });

        it("should return 404 for non-existent vendor", async () => {
            const response = await requestHelper.post(
                `/vendor/99999/model/sync.json`,
                { model_ids: ["some-model"] },
                adminToken,
            );

            expect(response.status).toBe(404);
        });
    });

    describe("PUT /vendor/:id/model/:modelId", () => {
        it("should preserve null and empty-array semantics and reject invalid formats", async () => {
            const added = await requestHelper.post(
                `/vendor/${vendorId}/model/add.json`,
                { model_id: "format-contract-model" },
                adminToken,
            );
            const endpoint = `/vendor/${vendorId}/model/${added.body.id}`;

            const inherited = await requestHelper.put(endpoint, { allowed_formats: null }, adminToken);
            expect(inherited.status).toBe(200);
            expect(inherited.body.allowed_formats).toBeNull();

            const disabled = await requestHelper.put(endpoint, { allowed_formats: [] }, adminToken);
            expect(disabled.status).toBe(200);
            expect(disabled.body.allowed_formats).toEqual([]);

            const restricted = await requestHelper.put(
                endpoint,
                { allowed_formats: ["openai", "openai", "anthropic"] },
                adminToken,
            );
            expect(restricted.status).toBe(200);
            expect(restricted.body.allowed_formats).toEqual(["openai", "anthropic"]);

            for (const payload of [
                {},
                { allowed_formats: "openai" },
                { allowed_formats: ["openai", "invalid"] },
                { allowed_formats: ["openai", null] },
            ]) {
                const response = await requestHelper.put(endpoint, payload, adminToken);
                expect(response.status).toBe(400);
            }

            const models = await requestHelper.get(
                `/vendor/${vendorId}/model/list.json`,
                adminToken,
            );
            expect(models.body.find((model: any) => model.id === added.body.id)?.allowed_formats)
                .toEqual(["openai", "anthropic"]);

            const cleanup = await requestHelper.post(
                `/vendor/${vendorId}/model/sync.json`,
                { model_ids: [] },
                adminToken,
            );
            expect(cleanup.status).toBe(200);
        });
    });

    describe("DELETE /vendor/:id/model/:modelId", () => {
        let modelToDeleteId: number;

        beforeAll(async () => {
            const res = await requestHelper.post(
                `/vendor/${vendorId}/model/add.json`,
                { model_id: "delete-test-model" },
                adminToken,
            );
            modelToDeleteId = res.body.id;
        });

        it("should reject malformed numeric IDs without deleting the matching vendor model", async () => {
            const response = await requestHelper.del(
                `/vendor/${vendorId}/model/${modelToDeleteId}abc`,
                adminToken,
            );

            expect(response.status).toBe(400);
            expect(response.body.error).toBe("Invalid ID format");

            const listResponse = await requestHelper.get(
                `/vendor/${vendorId}/model/list.json`,
                adminToken,
            );
            expect(listResponse.body.some((model: any) => model.id === modelToDeleteId)).toBe(true);
        });

        it("should delete a specific vendor model", async () => {
            const response = await requestHelper.del(
                `/vendor/${vendorId}/model/${modelToDeleteId}`,
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);

            const listResponse = await requestHelper.get(
                `/vendor/${vendorId}/model/list.json`,
                adminToken,
            );
            const ids = listResponse.body.map((m: any) => m.id);
            expect(ids).not.toContain(modelToDeleteId);

            const vendorResponse = await requestHelper.get(`/vendor/${vendorId}`, adminToken);
            expect(vendorResponse.body.config.available_models).toEqual([]);
            expect(vendorResponse.body.model_count).toBe(0);
        });

        it("should return 404 when deleting non-existent model", async () => {
            const response = await requestHelper.del(
                `/vendor/${vendorId}/model/99999`,
                adminToken,
            );

            expect(response.status).toBe(404);
        });

        it("should return 404 when vendor_id does not match the model's vendor", async () => {
            const vendor2 = await requestHelper.post(
                "/vendor/create.json",
                vendorFixtures.createRandomVendor(),
                adminToken,
            );
            const addRes = await requestHelper.post(
                `/vendor/${vendor2.body.id}/model/add.json`,
                { model_id: "vendor2-model" },
                adminToken,
            );
            const modelId = addRes.body.id;

            const response = await requestHelper.del(
                `/vendor/${vendorId}/model/${modelId}`,
                adminToken,
            );

            expect(response.status).toBe(404);
        });
    });

    describe("GET /vendor/:id/model/fetch.json", () => {
        it("should return filtered LLM model list from upstream", async () => {
            const response = await requestHelper.get(
                `/vendor/${vendorId}/model/fetch.json`,
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("models");
            expect(Array.isArray(response.body.models)).toBe(true);

            // Mock server returns 5 models but whisper and dall-e are filtered out
            const models = response.body.models;
            expect(models).toContain("mock-gpt-4o");
            expect(models).toContain("mock-gpt-4o-mini");
            expect(models).toContain("mock-gpt-3.5-turbo");
            expect(models).not.toContain("mock-whisper-1");
            expect(models).not.toContain("mock-dall-e-3");
        });
    });
});
