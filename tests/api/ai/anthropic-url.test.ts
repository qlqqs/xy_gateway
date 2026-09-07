import { describe, it, expect, beforeAll } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import mockHelper from "../../helpers/mockHelper";
import vendorFixtures from "../../fixtures/vendorFixtures";
import modelFixtures from "../../fixtures/modelFixtures";
import dbHelper from "../../helpers/dbHelper"
import { setupAdminUser } from "../../globalSetup";
import config from "../../config";

/**
 * Test Anthropic URL auto-completion and new vendor types
 */

let testUserToken: string;
let adminToken: string;
const mockServerUrl = config.UPSTREAM_CONFIG.mock.url;

describe("AI API - Anthropic URL & New Vendors", () => {
    beforeAll(async () => {
        await dbHelper.truncate();
        adminToken = await setupAdminUser();

        // Create test user
        const userResponse = await requestHelper.post(
            "/user/create.json",
            mockHelper.generateUser(),
            adminToken,
        );
        testUserToken = userResponse.body.keys[0].value;
    });

    it("should automatically append /llm/v1/messages to Anthropic URL if missing", async () => {
        // Create vendor with INCOMPLETE Anthropic URL (no /llm/v1/messages)
        const vendorData = {
            name: "Incomplete Anthropic Vendor",
            type: "anthropic",
            token: "test-token",
            urls: {
                anthropic: mockServerUrl // Missing /llm/v1/messages
            }
        };

        const vendorRes = await requestHelper.post("/vendor/create.json", vendorData, adminToken);
        expect(vendorRes.status).toBe(200);
        const vendorId = vendorRes.body.id;

        // Create model for this vendor
        const modelData = modelFixtures.createRandomModel(vendorId, "claude-3-haiku-20240307");
        const modelRes = await requestHelper.post("/model/create.json", modelData, adminToken);
        expect(modelRes.status).toBe(200);

        // Send request - should succeed if URL is auto-corrected to include /llm/v1/messages
        // because mock server handles requests containing "/messages"
        const messageRequest = mockHelper.generateAnthropicMessageRequest({
            model: "claude-3-haiku-20240307",
            stream: false,
        });

        const response = await requestHelper.postWithAnthropicStyleApiKey(
            "/llm/v1/messages",
            messageRequest,
            testUserToken,
        );

        expect(response.status).toBe(200);
        expect(response.body.type).toBe("message");
    }, 30000);

    it("should support volcengine_coding vendor type", async () => {
        const vendorData = {
            name: "Volcengine Coding Vendor",
            type: "volcengine_coding",
            token: "test-token",
            urls: {
                openai: `${mockServerUrl}/chat/completions`,
                anthropic: `${mockServerUrl}/messages`
            }
        };

        const vendorRes = await requestHelper.post("/vendor/create.json", vendorData, adminToken);
        expect(vendorRes.status).toBe(200);
        expect(vendorRes.body.type).toBe("volcengine_coding");
    });

    it("should support aliyun_coding vendor type", async () => {
        const vendorData = {
            name: "Aliyun Coding Vendor",
            type: "aliyun_coding",
            token: "test-token",
            urls: {
                openai: `${mockServerUrl}/chat/completions`,
                anthropic: `${mockServerUrl}/messages`
            }
        };

        const vendorRes = await requestHelper.post("/vendor/create.json", vendorData, adminToken);
        expect(vendorRes.status).toBe(200);
        expect(vendorRes.body.type).toBe("aliyun_coding");
    });
});
