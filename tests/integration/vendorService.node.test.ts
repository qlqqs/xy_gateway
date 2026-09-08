import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SgVendor } from "../../src/model/sgVendor";
import vendorManager from "../../src/manager/vendorManager";
import vendorModelManager from "../../src/manager/vendorModelManager";
import vendorService from "../../src/service/vendorService";
import { ApiFormat } from "../../src/constants";
import dbHelper from "../helpers/dbHelper";
import ormTestHelper from "../helpers/ormTestHelper";


describe("vendorService", () => {
    beforeAll(async () => {
        await ormTestHelper.connectNodeOrm();
    });

    beforeEach(async () => {
        await dbHelper.truncate();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function createVendor(type: string, urls: Record<string, string> = {}): Promise<SgVendor> {
        return await SgVendor.query().create({
            type,
            name: `Test ${type} Vendor`,
            token: "test-token",
            urls: urls,
        }) as SgVendor;
    }

    it("should match vendor with anthropic URL", async () => {
        const vendor = await createVendor("mimo", {
            anthropic: "https://api.xiaomimimo.com/anthropic",
        });

        const result = await vendorService.findVendorByUrl(
            "https://api.xiaomimimo.com/anthropic",
            ApiFormat.ANTHROPIC,
        );

        expect(result).toBe(Number(vendor.id));
    });

    it("should match vendor using preset URL when custom URLs is empty (real mimo case)", async () => {
        // 复现真实场景: vendor urls 字段为 {}，依赖 preset URL
        const vendor = await createVendor("mimo", {});

        const result = await vendorService.findVendorByUrl(
            "https://api.xiaomimimo.com/anthropic",
            ApiFormat.ANTHROPIC,
        );

        expect(result).toBe(Number(vendor.id));
    });

    it("should not match vendor with only openai URL for ANTHROPIC protocol", async () => {
        const vendor = await createVendor("opencode_go", {
            openai: "https://opencode.ai/zen/go/v1",
        });

        // opencode_go only has openai URL, should NOT match ANTHROPIC protocol
        const result = await vendorService.findVendorByUrl(
            "https://opencode.ai/zen/go/v1",
            ApiFormat.ANTHROPIC,
        );

        expect(result).toBeNull();
    });

    it("should match vendor with openai URL for OPENAI protocol", async () => {
        const vendor = await createVendor("deepseek", {
            openai: "https://api.deepseek.com/v1",
        });

        const result = await vendorService.findVendorByUrl(
            "https://api.deepseek.com/v1/chat/completions",
            ApiFormat.OPENAI,
        );

        expect(result).toBe(Number(vendor.id));
    });

    it("should match vendor with responses URL for RESPONSES protocol", async () => {
        const vendor = await createVendor("other", {
            responses: "https://api.example.com/responses",
        });

        const result = await vendorService.findVendorByUrl(
            "https://api.example.com/responses/123",
            ApiFormat.RESPONSES,
        );

        expect(result).toBe(Number(vendor.id));
    });

    it("should fallback to openai URL for RESPONSES protocol", async () => {
        const vendor = await createVendor("other", {
            openai: "https://api.example.com/v1",
        });

        const result = await vendorService.findVendorByUrl(
            "https://api.example.com/v1/responses",
            ApiFormat.RESPONSES,
        );

        expect(result).toBe(Number(vendor.id));
    });

    it("should return null for empty gatewayUrl", async () => {
        await createVendor("mimo", {
            anthropic: "https://api.xiaomimimo.com/anthropic",
        });

        const result = await vendorService.findVendorByUrl("", ApiFormat.ANTHROPIC);

        expect(result).toBeNull();
    });

    it("should return null when no vendor matches", async () => {
        await createVendor("mimo", {
            anthropic: "https://api.xiaomimimo.com/anthropic",
        });

        const result = await vendorService.findVendorByUrl(
            "https://api.other.com/something",
            ApiFormat.ANTHROPIC,
        );

        expect(result).toBeNull();
    });

    it("should use preset URLs when vendor has no custom URLs", async () => {
        const vendor = await createVendor("aliyun", {});

        // aliyun preset has anthropic URL: https://dashscope.aliyuncs.com/apps/anthropic
        const result = await vendorService.findVendorByUrl(
            "https://dashscope.aliyuncs.com/apps/anthropic",
            ApiFormat.ANTHROPIC,
        );

        expect(result).toBe(Number(vendor.id));
    });

    it("should prefer custom URL over preset URL", async () => {
        const vendor = await createVendor("aliyun", {
            anthropic: "https://custom.aliyun.com/anthropic",
        });

        // Custom URL should be matched, not preset
        const result = await vendorService.findVendorByUrl(
            "https://custom.aliyun.com/anthropic",
            ApiFormat.ANTHROPIC,
        );

        expect(result).toBe(Number(vendor.id));

        // Preset URL should NOT match this vendor (custom takes priority)
        const presetResult = await vendorService.findVendorByUrl(
            "https://dashscope.aliyuncs.com/apps/anthropic",
            ApiFormat.ANTHROPIC,
        );

        expect(presetResult).toBeNull();
    });

    it("should create a vendor and its normalized model projection atomically", async () => {
        const vendor = new SgVendor({
            type: "openai",
            name: "Aggregate create vendor",
            token: "secret",
            urls: {},
            config: { available_models: [" beta-model ", "alpha-model", "beta-model"] },
        });

        const created = await vendorService.createVendor(vendor);
        const models = await vendorModelManager.listByVendor(Number(created.id));

        expect(created.config.available_models).toEqual(["beta-model", "alpha-model"]);
        expect(created.available_models).toEqual(["beta-model", "alpha-model"]);
        expect(models.map(model => model.model_id)).toEqual(["alpha-model", "beta-model"]);
    });

    it("should roll back vendor creation when model synchronization fails", async () => {
        const vendor = new SgVendor({
            type: "openai",
            name: "Aggregate create rollback vendor",
            token: "secret",
            urls: {},
            config: { available_models: ["model-a"] },
        });
        vi.spyOn(vendorModelManager, "syncByVendorWithConnection")
            .mockRejectedValueOnce(new Error("sync failed"));

        await expect(vendorService.createVendor(vendor)).rejects.toThrow("sync failed");

        expect(await vendorManager.findByName("Aggregate create rollback vendor")).toBeNull();
    });

    it("should roll back vendor fields when model synchronization fails during update", async () => {
        const created = await vendorService.createVendor(new SgVendor({
            type: "openai",
            name: "Aggregate update rollback vendor",
            token: "secret",
            urls: {},
            config: { available_models: ["stable-model"] },
        }));
        vi.spyOn(vendorModelManager, "syncByVendorWithConnection")
            .mockRejectedValueOnce(new Error("sync failed"));

        await expect(vendorService.updateVendor(Number(created.id), {
            name: "Unexpected updated name",
            config: { available_models: ["replacement-model"] },
        })).rejects.toThrow("sync failed");

        const reloaded = await vendorManager.findById(Number(created.id));
        const models = await vendorModelManager.listByVendor(Number(created.id));
        expect(reloaded?.name).toBe("Aggregate update rollback vendor");
        expect(reloaded?.config.available_models).toEqual(["stable-model"]);
        expect(models.map(model => model.model_id)).toEqual(["stable-model"]);
    });
});
