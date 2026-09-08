import { beforeAll, describe, expect, it } from "vitest";
import { setupAdminUser } from "../../globalSetup";
import vendorFixtures from "../../fixtures/vendorFixtures";
import userFixtures from "../../fixtures/userFixtures";
import dbHelper from "../../helpers/dbHelper";
import requestHelper from "../../helpers/requestHelper";


const adminToken = userFixtures.ADMIN_TOKEN;


describe("Model route test API", () => {
    beforeAll(async () => {
        await dbHelper.truncate();
        await setupAdminUser();
    });


    it("reports AppError statusCode when no upstream is available", async () => {
        const vendor = await requestHelper.post(
            "/vendor/create.json",
            {
                ...vendorFixtures.VENDOR_FIXTURES.openai(),
                name: "Disabled diagnostic upstream",
                config: { status: "disabled" },
            },
            adminToken,
        );
        const modelName = "disabled-route-test-model";
        const model = await requestHelper.post(
            "/model/create.json",
            {
                name: modelName,
                mapping: {
                    upstreams: [{ vendor_id: vendor.body.id, enabled: true }],
                },
            },
            adminToken,
        );
        expect(model.status).toBe(200);

        const response = await requestHelper.post(
            "/model/route-test.json",
            { model: modelName, format: "openai" },
            adminToken,
        );

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            success: false,
            status: 503,
            error: "No available upstream",
        });
    });
});
