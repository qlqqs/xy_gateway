import { beforeAll, describe, expect, it } from "vitest";
import dbHelper from "../../helpers/dbHelper";
import requestHelper from "../../helpers/requestHelper";
import { setupAdminUser } from "../../globalSetup";


const restrictedToken = "node-ip-policy-restricted-token";


describe("LLM IP policy in Node mode", () => {
    beforeAll(async () => {
        await dbHelper.truncate();
        const adminToken = await setupAdminUser();
        await requestHelper.post(
            "/user/create.json",
            {
                name: "Node IP restricted user",
                keys: [{
                    value: restrictedToken,
                    ipRestrictionEnabled: true,
                    ipWhitelist: ["203.0.113.42"],
                }],
                type: "normal",
            },
            adminToken,
        );
    });


    it("does not allow forwarded headers to spoof the client address", async () => {
        const response = await requestHelper.request("/llm/v1/models", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${restrictedToken}`,
                "X-Real-IP": "203.0.113.42",
                "X-Forwarded-For": "203.0.113.42",
            },
        });

        expect(response.status).toBe(403);
        expect(response.body.error).toMatchObject({
            type: "authentication_error",
            message: "Access denied",
        });
    });
});
