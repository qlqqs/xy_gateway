import { beforeAll, describe, expect, it } from "vitest";
import requestHelper from "../../helpers/requestHelper";
import dbHelper from "../../helpers/dbHelper";
import { setupAdminUser } from "../../globalSetup";

let adminToken: string;

describe("Group API (Positive)", () => {
    beforeAll(async () => {
        await dbHelper.truncate();
        adminToken = await setupAdminUser();
    });

    it("returns the canonical paginated DTO and derived channel count", async () => {
        const created = await requestHelper.post(
            "/group/create.json",
            {
                name: "结构测试分组",
                description: "验证返回结构",
                inboundProtocols: ["openai_chat", "anthropic"],
                customModels: ["gpt-test"],
                whitelistEnabled: true,
                rateMultiplier: 1.25,
                status: "active",
            },
            adminToken,
        );

        expect(created.status).toBe(200);
        expect(Number.isSafeInteger(created.body.id)).toBe(true);
        expect(created.body).toMatchObject({
            name: "结构测试分组",
            inboundProtocols: ["openai_chat", "anthropic"],
            customModels: ["gpt-test"],
            whitelistEnabled: true,
            rateMultiplier: 1.25,
            status: "active",
        });

        const listed = await requestHelper.get("/group/list.json", adminToken);
        expect(listed.status).toBe(200);
        expect(Array.isArray(listed.body.list)).toBe(true);
        expect(typeof listed.body.total).toBe("number");
        const listedGroup = listed.body.list.find((item: { id: number }) => item.id === created.body.id);
        expect(listedGroup).toMatchObject({
            id: created.body.id,
            name: "结构测试分组",
            channelCount: 0,
        });

        const fetched = await requestHelper.get(`/group/${created.body.id}`, adminToken);
        expect(fetched.status).toBe(200);
        expect(fetched.body).toMatchObject({
            id: created.body.id,
            name: "结构测试分组",
            channelCount: 0,
        });

        const updated = await requestHelper.put(
            `/group/${created.body.id}`,
            { description: "已更新" },
            adminToken,
        );
        expect(updated.status).toBe(200);
        expect(updated.body.description).toBe("已更新");

        const removed = await requestHelper.del(`/group/${created.body.id}`, adminToken);
        expect(removed.status).toBe(200);
        expect(removed.body).toEqual({ success: true });

        const afterDelete = await requestHelper.get(`/group/${created.body.id}`, adminToken);
        expect(afterDelete.status).toBe(404);
    });
});
