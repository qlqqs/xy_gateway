import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import requestHelper from "../../helpers/requestHelper";
import mockHelper from "../../helpers/mockHelper";
import modelFixtures from "../../fixtures/modelFixtures";
import dbHelper from "../../helpers/dbHelper";
import { setupAdminUser } from "../../globalSetup";
import config from "../../config";
import upstreamCaptureHelper from "../../helpers/upstreamCaptureHelper";

/**
 * OpenAI Responses API Endpoint Tests
 */

let testUserId: number;
let testUserToken: string;
let responsesVendorId: number;
let responsesModelId: number;
let responsesModelName: string;
let responsesErrorModelId: number;
let responsesErrorModelName: string;
let adminToken: string;


function createUniqueInput(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
}


async function setResponsesPromptCacheKeyEnabled(enabled: boolean): Promise<void> {
    const response = await requestHelper.put(
        "/config.json",
        { responses_prompt_cache_key_enabled: enabled ? "true" : "false" },
        adminToken,
    );

    expect(response.status).toBe(200);
}


describe("AI Responses API", () => {
    beforeAll(async () => {
        await dbHelper.truncate();
        adminToken = await setupAdminUser();

        const userResponse = await requestHelper.post(
            "/user/create.json",
            mockHelper.generateUser(),
            adminToken,
        );
        testUserId = userResponse.body.id;
        testUserToken = userResponse.body.keys[0].value;

        // 使用 base URL（不含 /chat/completions），让网关自动拼接 /responses
        const mockBaseUrl = config.UPSTREAM_CONFIG.mock.url;
        const vendorResponse = await requestHelper.post(
            "/vendor/create.json",
            {
                type: "other",
                name: "Mock Responses Vendor",
                token: "mock-responses-token",
                urls: { responses: mockBaseUrl },
            },
            adminToken,
        );
        responsesVendorId = vendorResponse.body.id;

        responsesModelName = "gpt-4o";
        const modelResponse = await requestHelper.post(
            "/model/create.json",
            modelFixtures.createRandomModel(responsesVendorId, responsesModelName),
            adminToken,
        );
        responsesModelId = modelResponse.body.id;

        const errorVendorResponse = await requestHelper.post(
            "/vendor/create.json",
            {
                type: "other",
                name: "Mock Responses Error Vendor",
                token: "mock-responses-error-token",
                urls: { responses: `${mockBaseUrl}/responses/error` },
            },
            adminToken,
        );
        responsesErrorModelName = `responses-error-model-${Date.now()}`;
        const errorModelResponse = await requestHelper.post(
            "/model/create.json",
            modelFixtures.createRandomModel(errorVendorResponse.body.id, responsesErrorModelName),
            adminToken,
        );
        responsesErrorModelId = errorModelResponse.body.id;
    });

    describe("POST /llm/v1/responses", () => {
        it("should handle non-streaming responses request", async () => {
            const input = createUniqueInput("responses-non-stream");
            const req = mockHelper.generateResponsesRequest({
                model: responsesModelName,
                input,
                stream: false,
                cached_tokens: 4,
            });

            const response = await requestHelper.post(
                "/llm/v1/responses",
                req,
                testUserToken,
            );

            expect(response.status).toBe(200);
            // 非流式 JSON 响应必须以 application/json 返回（见 messages.test.ts 同类断言说明）
            expect(response.headers.get("content-type")).toContain("application/json");
            expect(response.body.object).toBe("response");
            expect(response.body.status).toBe("completed");
            expect(Array.isArray(response.body.output)).toBe(true);
            expect(response.body.output[0].role).toBe("assistant");
            expect(response.body.output[0].content[0].type).toBe("output_text");
            expect(response.body.output[0].content[0].text.length).toBeGreaterThan(0);
            expect(response.body.usage.input_tokens).toBeGreaterThan(0);
            expect(response.body.usage.output_tokens).toBeGreaterThan(0);

            // 验证 record 已创建
            const recordsResponse = await requestHelper.get(
                "/record/latest.json?limit=1",
                adminToken,
            );
            expect(recordsResponse.status).toBe(200);
            const record = recordsResponse.body[0];
            expect(record.user_id).toBe(testUserId);
            expect(record.model_id).toBe(responsesModelId);
            expect(record.status).toBe("success");
            const usageR1 = record.usage;
            expect(usageR1.prompt_tokens).toBeGreaterThan(0);
            expect(usageR1.completion_tokens).toBeGreaterThan(0);
            expect(usageR1.cache_read_tokens).toBe(4);

            const upstreamRequests = await upstreamCaptureHelper.waitForRequestsByInput(input);
            expect(upstreamRequests).toHaveLength(1);
            expect(upstreamRequests[0].json?.prompt_cache_key).toMatch(/^[0-9a-f]{8}:.+/);
        }, 30000);

        it("supports the standard /v1/responses path", async () => {
            const req = mockHelper.generateResponsesRequest({
                model: responsesModelName,
                input: createUniqueInput("standard-responses-path"),
                stream: false,
            });

            const response = await requestHelper.post(
                "/v1/responses",
                req,
                testUserToken,
            );

            expect(response.status).toBe(200);
            expect(response.body.object).toBe("response");
            expect(response.body.status).toBe("completed");
        }, 30000);

        it("should persist cache, image and cost breakdown using usage v3", async () => {
            const modelName = `responses-billing-${randomUUID()}`;
            const modelResponse = await requestHelper.post(
                "/model/create.json",
                {
                    ...modelFixtures.createRandomModel(responsesVendorId, modelName),
                    prices: {
                        input: 10,
                        output: 20,
                        cache_write: 4,
                        cache_write_5m: 5,
                        cache_write_1h: 8,
                        cache_read: 2,
                        image_input: 30,
                        image_output: 40,
                    },
                },
                adminToken,
            );
            expect(modelResponse.status).toBe(200);

            const userResponse = await requestHelper.post(
                "/user/create.json",
                mockHelper.generateUser(),
                adminToken,
            );
            const input = createUniqueInput("responses-billing");
            const response = await requestHelper.post(
                "/llm/v1/responses",
                {
                    ...mockHelper.generateResponsesRequest({ model: modelName, input, stream: false }),
                    mock_usage: {
                        input_tokens: 1_000,
                        input_tokens_details: {
                            cached_tokens: 600,
                            cache_creation_tokens: 250,
                            cache_creation_5m_tokens: 200,
                            cache_creation_1h_tokens: 50,
                            image_tokens: 30,
                        },
                        output_tokens: 50,
                        output_tokens_details: { reasoning_tokens: 0, image_tokens: 10 },
                        total_tokens: 1_050,
                    },
                },
                userResponse.body.keys[0].value,
            );
            expect(response.status).toBe(200);

            const recordsResponse = await requestHelper.get(
                `/record/list.json?user_ids=${userResponse.body.id}`,
                adminToken,
            );
            expect(recordsResponse.body.total).toBe(1);
            const record = recordsResponse.body.list[0];
            expect(record.usage).toMatchObject({
                prompt_tokens: 150,
                completion_tokens: 50,
                cache_read_tokens: 600,
                cache_creation_tokens: 250,
                cache_creation_5m_tokens: 200,
                cache_creation_1h_tokens: 50,
                image_input_tokens: 30,
                image_output_tokens: 10,
            });
            const breakdown = record.usage.cost_breakdown;
            expect(breakdown.input_cost).toBeCloseTo(0.0012, 12);
            expect(breakdown.image_input_cost).toBeCloseTo(0.0009, 12);
            expect(breakdown.output_cost).toBeCloseTo(0.0008, 12);
            expect(breakdown.image_output_cost).toBeCloseTo(0.0004, 12);
            expect(breakdown.cache_creation_cost).toBeCloseTo(0.0014, 12);
            expect(breakdown.cache_creation_5m_cost).toBeCloseTo(0.001, 12);
            expect(breakdown.cache_creation_1h_cost).toBeCloseTo(0.0004, 12);
            expect(breakdown.cache_read_cost).toBeCloseTo(0.0012, 12);
            expect(breakdown.request_cost).toBe(0);
            expect(breakdown.total_cost).toBeCloseTo(0.0059, 12);

            const recordId = Number(record.id);
            expect(Number.isSafeInteger(recordId)).toBe(true);
            const storedRows = await dbHelper.query<{ usage: string }>(
                `SELECT usage FROM record WHERE id = ${recordId}`,
            );
            expect(storedRows).toHaveLength(1);
            expect(JSON.parse(storedRows[0].usage)).toMatchObject({
                usage_version: 3,
                prompt_tokens: 1_000,
                cache_read_tokens: 600,
                cache_creation_tokens: 250,
                cost_breakdown: { total_cost: 0.0059 },
            });
        }, 30000);

        it("should accept x-api-key authentication", async () => {
            const req = mockHelper.generateResponsesRequest({
                model: responsesModelName,
                input: createUniqueInput("responses-api-key"),
                stream: false,
            });

            const response = await requestHelper.postWithAnthropicStyleApiKey(
                "/llm/v1/responses",
                req,
                testUserToken,
            );

            expect(response.status).toBe(200);
            expect(response.body.object).toBe("response");
        }, 30000);

        it("should handle streaming responses request", async () => {
            await setResponsesPromptCacheKeyEnabled(true);

            const input = createUniqueInput("responses-stream");
            const req = mockHelper.generateResponsesRequest({
                model: responsesModelName,
                input,
                stream: true,
                cached_tokens: 4,
            });

            const response = await requestHelper.post(
                "/llm/v1/responses",
                req,
                testUserToken,
            );

            expect(response.status).toBe(200);
            expect(typeof response.body).toBe("string");
            expect(response.body).toContain("response.created");
            expect(response.body).toContain("response.output_text.delta");
            expect(response.body).toContain("response.completed");

            // 验证 record 已创建且 usage 正确
            const records = await requestHelper.getFinalizedRecords(adminToken, 1);
            const record = records[0];
            expect(record.user_id).toBe(testUserId);
            expect(record.model_id).toBe(responsesModelId);
            expect(record.status).toBe("success");
            const recordedUsage = record.usage;
            expect(recordedUsage.prompt_tokens).toBeGreaterThan(0);
            expect(recordedUsage.completion_tokens).toBeGreaterThan(0);
            expect(recordedUsage.cache_read_tokens).toBe(4);

            const upstreamRequests = await upstreamCaptureHelper.waitForRequestsByInput(input);
            expect(upstreamRequests).toHaveLength(1);
            expect(upstreamRequests[0].json?.prompt_cache_key).toMatch(/^[0-9a-f]{8}:.+/);
        }, 30000);

        it("should pass through Responses upstream 400 response", async () => {
            const input = createUniqueInput("responses-error");
            const req = mockHelper.generateResponsesRequest({
                model: responsesErrorModelName,
                input,
                stream: false,
            });

            const response = await requestHelper.post(
                "/llm/v1/responses",
                req,
                testUserToken,
            );

            expect(response.status).toBe(400);
            expect(response.body).toEqual({
                error: {
                    code: "400",
                    message: "Param Incorrect",
                    param: `Not supported model ${responsesErrorModelName}`,
                },
            });

            const recordsResponse = await requestHelper.get("/record/latest.json?limit=1", adminToken);
            const record = recordsResponse.body[0];
            expect(record.user_id).toBe(testUserId);
            expect(record.model_id).toBe(responsesErrorModelId);
            expect(record.status).toBe("failed");
            expect(JSON.parse(record.response_data)).toEqual(response.body);
        }, 30000);

        it("should omit prompt_cache_key when Responses prompt cache key is disabled", async () => {
            const input = createUniqueInput("responses-cache-disabled");
            await setResponsesPromptCacheKeyEnabled(false);

            try {
                const req = mockHelper.generateResponsesRequest({
                    model: responsesModelName,
                    input,
                    stream: false,
                });

                const response = await requestHelper.post(
                    "/llm/v1/responses",
                    req,
                    testUserToken,
                );

                expect(response.status).toBe(200);

                const upstreamRequests = await upstreamCaptureHelper.waitForRequestsByInput(input);
                expect(upstreamRequests).toHaveLength(1);
                expect(upstreamRequests[0].json?.prompt_cache_key).toBeUndefined();
            } finally {
                await setResponsesPromptCacheKeyEnabled(true);
            }
        }, 30000);
    });
});
