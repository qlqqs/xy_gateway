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

        expect(updated.body.channelCount).toBe(0);
        const removed = await requestHelper.del(`/group/${created.body.id}`, adminToken);
        expect(removed.status).toBe(200);
        expect(removed.body).toEqual({ success: true });

        const afterDelete = await requestHelper.get(`/group/${created.body.id}`, adminToken);
        expect(afterDelete.status).toBe(404);
    });


    it("counts a vendor in every assigned group and preserves remaining groups on deletion", async () => {
        const groupPayload = (name: string) => ({
            name,
            description: "多分组供应商回归",
            inboundProtocols: ["openai_chat"],
            customModels: [],
            whitelistEnabled: false,
            rateMultiplier: 1,
            status: "active",
        });
        const firstGroup = await requestHelper.post(
            "/group/create.json",
            groupPayload("供应商分组一"),
            adminToken,
        );
        const secondGroup = await requestHelper.post(
            "/group/create.json",
            groupPayload("供应商分组二"),
            adminToken,
        );
        const vendor = await requestHelper.post(
            "/vendor/create.json",
            {
                type: "other",
                name: "多分组删除回归供应商",
                token: "multi-group-delete-token",
                urls: { openai: "https://example.test/v1/chat/completions" },
                config: { group_ids: [firstGroup.body.id, secondGroup.body.id] },
            },
            adminToken,
        );
        expect(vendor.status).toBe(200);

        const listed = await requestHelper.get("/group/list.json", adminToken);
        expect(listed.body.list.find((item: { id: number }) => item.id === firstGroup.body.id)?.channelCount).toBe(1);
        expect(listed.body.list.find((item: { id: number }) => item.id === secondGroup.body.id)?.channelCount).toBe(1);

        const updatedSecondGroup = await requestHelper.put(
            `/group/${secondGroup.body.id}`,
            { name: "供应商分组二（已更新）" },
            adminToken,
        );
        expect(updatedSecondGroup.status).toBe(200);
        expect(updatedSecondGroup.body).toMatchObject({
            name: "供应商分组二（已更新）",
            channelCount: 1,
        });

        const removed = await requestHelper.del(`/group/${firstGroup.body.id}`, adminToken);
        expect(removed.status).toBe(200);

        const updatedVendor = await requestHelper.get(`/vendor/${vendor.body.id}`, adminToken);
        expect(updatedVendor.body.config).toMatchObject({
            group_id: secondGroup.body.id,
            group_ids: [secondGroup.body.id],
        });
        const remainingGroup = await requestHelper.get(`/group/${secondGroup.body.id}`, adminToken);
        expect(remainingGroup.body.channelCount).toBe(1);
    });
});
