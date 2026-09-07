import { describe, it, expect, beforeAll } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import dbHelper from "../../helpers/dbHelper"

/**
 * User Endpoint Negative Tests
 */

describe("User API (Negative)", () => {
    beforeAll(async () => {
        await dbHelper.truncate();
    });
    describe("POST /user/create.json", () => {
        it("should return error when name is missing", async () => {
            const userData = { keys: [{ value: "some-key" }] };
            const response = await requestHelper.post(
                "/user/create.json",
                userData,
            );

            expect(response.status).toBeGreaterThanOrEqual(400);
        });

        it("should return error when both name and API key are missing", async () => {
            const userData = {};
            const response = await requestHelper.post(
                "/user/create.json",
                userData,
            );

            expect(response.status).toBeGreaterThanOrEqual(400);
        });
    });

    describe("GET /user/:id", () => {
        it("should return error for non-existent user ID", async () => {
            const response = await requestHelper.get("/user/99999");

            expect(response.status).toBeGreaterThanOrEqual(400);
            expect(response.body).toHaveProperty("error");
        });

        it("should return error for invalid ID format (string)", async () => {
            const response = await requestHelper.get("/user/invalid-id");

            expect(response.status).toBeGreaterThanOrEqual(400);
            expect(response.body).toHaveProperty("error");
        });

        it("should return error for negative ID", async () => {
            const response = await requestHelper.get("/user/-1");

            expect(response.status).toBeGreaterThanOrEqual(400);
            expect(response.body).toHaveProperty("error");
        });

        it("should return error for zero ID", async () => {
            const response = await requestHelper.get("/user/0");

            expect(response.status).toBeGreaterThanOrEqual(400);
            expect(response.body).toHaveProperty("error");
        });
    });

    describe("PUT /user/:id", () => {
        let adminToken: string;
        let existingUserId: number;

        beforeAll(async () => {
            const { setupAdminUser } = await import("../../globalSetup");
            adminToken = await setupAdminUser();

            const userData = { name: "Test User", keys: [{ value: "test-key-123" }] };
            const response = await requestHelper.post(
                "/user/create.json",
                userData,
                adminToken,
            );
            existingUserId = response.body.id;
        });

        it("should return error for non-existent user ID", async () => {
            const updateData = { name: "New Name" };
            const response = await requestHelper.put(
                "/user/99999",
                updateData,
                adminToken,
            );

            expect(response.status).toBeGreaterThanOrEqual(400);
            expect(response.body).toHaveProperty("error");
        });

        it("should return error for invalid ID format (string)", async () => {
            const updateData = { name: "New Name" };
            const response = await requestHelper.put(
                "/user/invalid-id",
                updateData,
                adminToken,
            );

            expect(response.status).toBeGreaterThanOrEqual(400);
            expect(response.body).toHaveProperty("error");
        });

        it("should return error for negative ID", async () => {
            const updateData = { name: "New Name" };
            const response = await requestHelper.put(
                "/user/-1",
                updateData,
                adminToken,
            );

            expect(response.status).toBeGreaterThanOrEqual(400);
            expect(response.body).toHaveProperty("error");
        });

        it("should return error for zero ID", async () => {
            const updateData = { name: "New Name" };
            const response = await requestHelper.put(
                "/user/0",
                updateData,
                adminToken,
            );

            expect(response.status).toBeGreaterThanOrEqual(400);
            expect(response.body).toHaveProperty("error");
        });

        it("should require admin authentication", async () => {
            const updateData = { name: "New Name" };
            const response = await requestHelper.put(
                `/user/${existingUserId}`,
                updateData,
            );

            expect(response.status).toBeGreaterThanOrEqual(400);
        });
    });
});
