import { describe, it, expect, beforeAll } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import userFixtures from "../../fixtures/userFixtures";
import dbHelper from "../../helpers/dbHelper";
import { setupAdminUser } from "../../globalSetup";

/**
 * User endpoint tests for the canonical user + user_key contract.
 * Authentication credentials belong to `keys[]`; the removed `user.token`
 * field must not appear in either requests or responses.
 */

let createdUserId: number;
let createdUserKey: string;
let adminToken: string;

describe("User API (Positive)", () => {
    beforeAll(async () => {
        await dbHelper.truncate();
        adminToken = await setupAdminUser();
    });

    describe("POST /user/create.json", () => {
        it("should create a user with a specified API key", async () => {
            const keyValue = userFixtures.USER_FIXTURES.withCustomKey.keys[0].value;
            const userData = {
                name: userFixtures.USER_FIXTURES.withCustomKey.name,
                keys: [{ value: keyValue, name: "primary" }],
            };
            const response = await requestHelper.post(
                "/user/create.json",
                userData,
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("id");
            expect(response.body.name).toBe(userData.name);
            expect(response.body.keys).toHaveLength(1);
            expect(response.body.keys[0].value).toBe(keyValue);
            expect(response.body).not.toHaveProperty("token");
            expect(response.body).toHaveProperty("created_at");
            expect(response.body).toHaveProperty("updated_at");
            expect(response.body.status).toBe("active");

            createdUserId = response.body.id;
            createdUserKey = response.body.keys[0].value;
        });

        it("should create a user with an auto-generated API key", async () => {
            const userData = { name: "Auto Key User", keys: [{}] };
            const response = await requestHelper.post(
                "/user/create.json",
                userData,
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty("id");
            expect(response.body.name).toBe(userData.name);
            expect(response.body.keys).toHaveLength(1);
            expect(typeof response.body.keys[0].value).toBe("string");
            expect(response.body.keys[0].value.length).toBeGreaterThan(0);
            expect(response.body).not.toHaveProperty("token");
        });

        it("should reject duplicate user names", async () => {
            const userData = { name: "Same Name User", keys: [{ value: "same-name-key-1" }] };
            const response1 = await requestHelper.post(
                "/user/create.json",
                userData,
                adminToken,
            );
            const response2 = await requestHelper.post(
                "/user/create.json",
                { ...userData, keys: [{ value: "same-name-key-2" }] },
                adminToken,
            );

            expect(response1.status).toBe(200);
            expect(response2.status).toBe(409);
        });

        it("should handle long names", async () => {
            const userData: Record<string, unknown> = {
                name: userFixtures.USER_FIXTURES.longName.name,
                keys: [{ value: "long-name-key" }],
            };
            const response = await requestHelper.post(
                "/user/create.json",
                userData,
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(response.body.name).toBe(userData.name);
        });

        it("should generate a key when its value is empty", async () => {
            const response = await requestHelper.post(
                "/user/create.json",
                { name: "Generated Key User", keys: [{}] },
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(response.body.keys).toHaveLength(1);
            expect(typeof response.body.keys[0].value).toBe("string");
            expect(response.body.keys[0].value.length).toBeGreaterThan(0);
        });
    });

    describe("GET /user/list.json", () => {
        it("should return a paginated list without legacy token fields", async () => {
            const response = await requestHelper.get("/user/list.json", adminToken);

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.list)).toBe(true);
            expect(response.body.total).toBeGreaterThan(0);
            for (const user of response.body.list) {
                expect(user).toHaveProperty("id");
                expect(user).toHaveProperty("name");
                expect(user).toHaveProperty("keys");
                expect(user).not.toHaveProperty("token");
                expect(user).toHaveProperty("created_at");
                expect(user).toHaveProperty("updated_at");
            }
        });
    });

    describe("GET /user/:id", () => {
        it("should return a user and its API key by ID", async () => {
            const response = await requestHelper.get(`/user/${createdUserId}`, adminToken);

            expect(response.status).toBe(200);
            expect(response.body.id).toBe(createdUserId);
            expect(response.body.keys[0].value).toBe(createdUserKey);
            expect(response.body).not.toHaveProperty("token");
            expect(response.body).toHaveProperty("name");
            expect(response.body).toHaveProperty("status");
        });
    });

    describe("PUT /user/:id", () => {
        let userToUpdateId: number;
        let originalKeyId: number;
        let originalKey: string;

        beforeAll(async () => {
            const response = await requestHelper.post(
                "/user/create.json",
                { name: "User To Update", keys: [{ value: "original-key-12345" }] },
                adminToken,
            );
            userToUpdateId = response.body.id;
            originalKeyId = response.body.keys[0].id;
            originalKey = response.body.keys[0].value;
        });

        it("should update user name without changing its key", async () => {
            const response = await requestHelper.put(
                `/user/${userToUpdateId}`,
                { name: "Updated User Name" },
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(response.body.id).toBe(userToUpdateId);
            expect(response.body.name).toBe("Updated User Name");
            expect(response.body.keys[0].value).toBe(originalKey);
        });

        it("should update user status to disabled", async () => {
            const response = await requestHelper.put(
                `/user/${userToUpdateId}`,
                { status: "disabled" },
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(response.body.status).toBe("disabled");
        });

        it("should replace an API key value through the keys array", async () => {
            const newKey = "new-key-67890";
            const response = await requestHelper.put(
                `/user/${userToUpdateId}`,
                { keys: [{ id: originalKeyId, value: newKey }] },
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(response.body.keys[0].id).toBe(originalKeyId);
            expect(response.body.keys[0].value).toBe(newKey);
            originalKey = newKey;
        });

        it("should replace a key with a newly generated value", async () => {
            const response = await requestHelper.put(
                `/user/${userToUpdateId}`,
                { keys: [{}] },
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(response.body.keys).toHaveLength(1);
            expect(response.body.keys[0].value).toBeTruthy();
            expect(response.body.keys[0].value).not.toBe(originalKey);
            originalKeyId = response.body.keys[0].id;
            originalKey = response.body.keys[0].value;
        });

        it("should not change anything when no fields are provided", async () => {
            const before = await requestHelper.get(`/user/${userToUpdateId}`, adminToken);
            const response = await requestHelper.put(
                `/user/${userToUpdateId}`,
                {},
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(response.body.name).toBe(before.body.name);
            expect(response.body.keys[0].value).toBe(before.body.keys[0].value);
        });

        it("should update name and key simultaneously", async () => {
            const newKey = "simultaneous-key";
            const response = await requestHelper.put(
                `/user/${userToUpdateId}`,
                {
                    name: "Simultaneously Updated User",
                    keys: [{ id: originalKeyId, value: newKey }],
                },
                adminToken,
            );

            expect(response.status).toBe(200);
            expect(response.body.id).toBe(userToUpdateId);
            expect(response.body.name).toBe("Simultaneously Updated User");
            expect(response.body.keys[0].value).toBe(newKey);
        });

        it("should return all canonical fields after update", async () => {
            const response = await requestHelper.get(`/user/${userToUpdateId}`, adminToken);

            expect(response.body).toHaveProperty("id");
            expect(response.body).toHaveProperty("name");
            expect(response.body).toHaveProperty("keys");
            expect(response.body).not.toHaveProperty("token");
            expect(response.body).toHaveProperty("created_at");
            expect(response.body).toHaveProperty("updated_at");
        });
    });
});
