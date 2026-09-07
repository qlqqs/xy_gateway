import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SgModel } from "../../src/model/sgModel";
import { SgVendor, SgVendorConfig } from "../../src/model/sgVendor";
import modelManager from "../../src/manager/modelManager";
import modelUpstreamManager from "../../src/manager/modelUpstreamManager";
import vendorManager from "../../src/manager/vendorManager";
import dbHelper from "../helpers/dbHelper";
import ormTestHelper from "../helpers/ormTestHelper";


describe("modelManager (node, real db)", () => {
    let testVendorId: number;

    beforeAll(async () => {
        await ormTestHelper.connectNodeOrm();
    });

    beforeEach(async () => {
        await dbHelper.truncate();
        const vendor = await vendorManager.create(new SgVendor({
            type: "openai",
            name: `model-test-vendor-${Math.random()}`,
            token: "sk-test",
            urls: {},
            config: new SgVendorConfig({}),
        }));
        testVendorId = Number(vendor.id);
    });

    function buildModel(name: string) {
        return new SgModel({
            name,
            enable: true,
            prices: {},
        });
    }

    async function saveModel(name: string): Promise<SgModel> {
        const model = await modelManager.save(buildModel(name));
        await modelUpstreamManager.create({
            model_id: Number(model.id),
            vendor_id: testVendorId,
            enabled: true,
            sort_order: 0,
        });
        return model;
    }

    it("save + findById + getModel + listModels", async () => {
        const model = await saveModel("gpt-4o");

        expect((await modelManager.findById(model.id))?.name).toBe("gpt-4o");
        expect((await modelManager.getModel("gpt-4o"))?.id).toBe(model.id);
        expect(await modelManager.getModel("missing")).toBeNull();

        const { list, total } = await modelManager.listModels({ pageSize: 10, offset: 0 });
        expect(total).toBe(1);
        expect(list.length).toBe(1);
    });

    it("checkDuplicateModel + deleteModel", async () => {
        const model = await saveModel("gpt-4o");

        expect(await modelManager.checkDuplicateModel("gpt-4o")).toBe(true);
        expect(await modelManager.checkDuplicateModel("gpt-4o", model.id)).toBe(false);

        expect(await modelManager.deleteModel(model.id)).toBe(true);
        expect(await modelManager.findById(model.id)).toBeNull();
        expect(await modelManager.deleteModel(model.id)).toBe(false);
    });

    it("getModel with enable filter", async () => {
        const model = await saveModel("gpt-4o");
        expect((await modelManager.getModel("gpt-4o", true))?.id).toBe(model.id);
        expect(await modelManager.getModel("gpt-4o", false)).toBeNull();
        expect(await modelManager.getModel(null as any)).toBeNull();
    });

    it("getByIds: empty returns [], non-empty returns models", async () => {
        expect(await modelManager.getByIds([])).toEqual([]);
        const m1 = await saveModel("m1");
        const m2 = await saveModel("m2");
        const models = await modelManager.getByIds([m1.id, m2.id]);
        expect(models.length).toBe(2);
    });

    it("listModels: keyword filter", async () => {
        await saveModel("alpha-one");
        await saveModel("beta-two");
        const { total } = await modelManager.listModels({ keyword: "alpha", pageSize: 10, offset: 0 });
        expect(total).toBe(1);
    });

    it("listModels: vendorId filter", async () => {
        await saveModel("with-vendor");
        const { total } = await modelManager.listModels({ vendorId: testVendorId, pageSize: 10, offset: 0 });
        expect(total).toBe(1);
        const { total: none } = await modelManager.listModels({ vendorId: 999, pageSize: 10, offset: 0 });
        expect(none).toBe(0);
    });

    it("hasModelsUsingVendor", async () => {
        await saveModel("with-vendor");
        expect(await modelManager.hasModelsUsingVendor(testVendorId)).toBe(true);
        expect(await modelManager.hasModelsUsingVendor(999)).toBe(false);
    });

    it("listEnabledModels returns formatted model list", async () => {
        await saveModel("enabled-model");
        const list = await modelManager.listEnabledModels();
        expect(list.length).toBe(1);
        expect(list[0].id).toBe("enabled-model");
        expect(list[0].object).toBe("model");
        expect(list[0].owned_by).toBe("gateway");
    });

    it("count", async () => {
        expect(await modelManager.count()).toBe(0);
        await saveModel("count-me");
        expect(await modelManager.count()).toBe(1);
    });
});
