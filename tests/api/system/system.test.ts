import { beforeAll, describe, it, expect } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import dbHelper from "../../helpers/dbHelper";
import { setupAdminUser } from "../../globalSetup";
import packageJson from "../../../package.json";

/**
 * System Endpoint Tests
 */

describe("System API", () => {
    let adminToken: string;

    beforeAll(async () => {
        await dbHelper.truncate();
        adminToken = await setupAdminUser();
    });

    describe("GET /welcome", () => {
        it("should return the Node welcome message", async () => {
            const response = await requestHelper.get("/welcome");

            expect(response.status).toBe(200);
            expect(response.body).toContain("Hello");
            expect(response.body).toContain("XY Gateway");
            expect(response.body).toContain("星野网关");
            expect(response.body).toContain("node mode");
        });

        it("should return a text response", async () => {
            const response = await requestHelper.get("/welcome");

            expect(typeof response.body).toBe("string");
            expect(response.headers.get("content-type")).toContain("text/plain");
        });
    });

    describe("GET /status.json", () => {
        it("should return the Node runtime status", async () => {
            const response = await requestHelper.get("/status.json", adminToken);

            expect(response.status).toBe(200);
            expect(response.body.status).toBe("ok");
            expect(response.body.system.environment).toMatch(/Node|Desktop App/);
            expect(response.body.system.memory).toMatch(/^\d+(\.\d+)? MB$/);
            expect(response.body.mode).toBeUndefined();
            expect(response.body.storage).toBeUndefined();
        });
    });

    describe("GET /status.json version", () => {
        it("returns the code-defined version by default", async () => {
            const response = await requestHelper.get("/status.json", adminToken);

            expect(response.status).toBe(200);
            expect(response.body.system.version).toBe(packageJson.version);
        });
    });
});
