import { describe, expect, it } from "vitest";
import { ModelUpstreamConfig, SgModel } from "../../../src/model/sgModel";


describe("canonical model mapping value objects", () => {
    it("hydrates mapping.upstreams into ModelUpstreamConfig instances", () => {
        const model = new SgModel({
            name: "canonical-model",
        });
        model.mapping = {
            upstreams: [new ModelUpstreamConfig({ vendor_id: 3, vendor_model_id: 7, enabled: true, sort_order: 2 })],
        };

        const mapping = model.getMapping();
        expect(mapping.upstreams[0]).toBeInstanceOf(ModelUpstreamConfig);
        expect(mapping).toEqual({
            upstreams: [{ vendor_id: 3, vendor_model_id: 7, enabled: true, sort_order: 2 }],
        });
    });

    it("defaults to an empty canonical mapping", () => {
        const model = new SgModel();
        expect(model.getMapping()).toEqual({ upstreams: [] });
    });

    it("does not expose removed routing fields in the model data", () => {
        const model = new SgModel({
            name: "canonical-model",
            mapping: { upstreams: [{ vendor_id: 3, enabled: true }] },
        });
        const data = model.toData() as Record<string, unknown>;
        expect(data).not.toHaveProperty("routing_mode");
        expect(data).not.toHaveProperty("routing_config");
    });
});
