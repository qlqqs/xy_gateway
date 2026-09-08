import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFormat, UserType } from "../../../src/constants";
import { ModelUpstreamConfig, SgModel } from "../../../src/model/sgModel";
import { SgVendor } from "../../../src/model/sgVendor";
import RoutingContext from "../../../src/service/routingService/routingContext";

const mocks = vi.hoisted(() => ({
    vendorManager: { findById: vi.fn() },
    vendorModelManager: {
        findById: vi.fn(),
        findByVendorAndModel: vi.fn(),
    },
    concurrencyService: { current: vi.fn() },
}));

vi.mock("../../../src/manager/vendorManager", () => ({ default: mocks.vendorManager }));
vi.mock("../../../src/manager/vendorModelManager", () => ({ default: mocks.vendorModelManager }));
vi.mock("../../../src/service/concurrencyService", () => ({ default: mocks.concurrencyService }));

import routingService from "../../../src/service/routingService/core";
import modelController from "../../../src/controller/modelController";


describe("routingService candidate resolution", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.concurrencyService.current.mockReturnValue(0);
    });

    it("deduplicates automatic and explicit mappings that resolve to the same route", async () => {
        const vendor = {
            id: 7,
            status: "active",
            priority: 1,
            concurrency: 10,
            load_factor: null,
            getGroupIds: () => [],
            getEffectiveWeight: () => 10,
            getSupportedFormats: () => [ApiFormat.OPENAI],
            getUrlByFormat: () => "https://upstream.example/v1/chat/completions",
        } as unknown as SgVendor;
        const vendorModel = {
            id: 19,
            vendor_id: 7,
            model_id: "gateway-model",
            getSupportedFormats: () => null,
        };
        mocks.vendorManager.findById.mockResolvedValue(vendor);
        mocks.vendorModelManager.findByVendorAndModel.mockResolvedValue(vendorModel);
        mocks.vendorModelManager.findById.mockResolvedValue(vendorModel);

        const model = new SgModel({ name: "gateway-model", enable: true });
        model.mapping = {
            upstreams: [
                new ModelUpstreamConfig({ vendor_id: 7, enabled: true, sort_order: 0 }),
                new ModelUpstreamConfig({
                    vendor_id: 7,
                    vendor_model_id: 19,
                    enabled: true,
                    sort_order: 1,
                }),
            ],
        };

        const candidates = await routingService.resolveAvailableCandidates(
            model,
            ApiFormat.OPENAI,
            null,
        );

        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({
            vendor,
            vendorModelName: "gateway-model",
            upstreamFormat: ApiFormat.OPENAI,
            weight: 10,
            sortOrder: 0,
            vendorModelId: null,
        });
    });


    it("rejects vendor models with an empty format allowlist", async () => {
        const vendor = {
            id: 8,
            status: "active",
            priority: 1,
            concurrency: 10,
            load_factor: null,
            getGroupIds: () => [],
            getEffectiveWeight: () => 10,
            getSupportedFormats: () => [ApiFormat.OPENAI],
            getUrlByFormat: () => "https://upstream.example/v1/chat/completions",
        } as unknown as SgVendor;
        const vendorModel = {
            id: 20,
            vendor_id: 8,
            model_id: "restricted-model",
            getSupportedFormats: () => [],
        };
        mocks.vendorManager.findById.mockResolvedValue(vendor);
        mocks.vendorModelManager.findById.mockResolvedValue(vendorModel);

        const model = new SgModel({ name: "gateway-model", enable: true });
        model.mapping = {
            upstreams: [new ModelUpstreamConfig({
                vendor_id: 8,
                vendor_model_id: 20,
                enabled: true,
            })],
        };

        const candidates = await routingService.resolveAvailableCandidates(
            model,
            ApiFormat.OPENAI,
            null,
        );

        expect(candidates).toEqual([]);
    });


    it("rejects a dangling explicit vendor model instead of treating it as automatic", async () => {
        const vendor = {
            id: 8,
            status: "active",
            priority: 1,
            concurrency: 10,
            load_factor: null,
            getGroupIds: () => [],
            getEffectiveWeight: () => 10,
            getSupportedFormats: () => [ApiFormat.OPENAI],
            getUrlByFormat: () => "https://upstream.example/v1/chat/completions",
        } as unknown as SgVendor;
        mocks.vendorManager.findById.mockResolvedValue(vendor);
        mocks.vendorModelManager.findById.mockResolvedValue(null);

        const model = new SgModel({ name: "gateway-model", enable: true });
        model.mapping = {
            upstreams: [new ModelUpstreamConfig({
                vendor_id: 8,
                vendor_model_id: 404,
                enabled: true,
            })],
        };

        const candidates = await routingService.resolveAvailableCandidates(
            model,
            ApiFormat.OPENAI,
            null,
        );

        expect(candidates).toEqual([]);
        expect(mocks.vendorModelManager.findByVendorAndModel).not.toHaveBeenCalled();
    });


    it("uses the OpenAI-to-Responses converter for a Responses-only vendor model", async () => {
        const vendor = {
            id: 9,
            status: "active",
            priority: 1,
            concurrency: 10,
            load_factor: null,
            getGroupIds: () => [],
            getEffectiveWeight: () => 10,
            getSupportedFormats: () => [ApiFormat.OPENAI, ApiFormat.RESPONSES],
            getUrlByFormat: (format: ApiFormat) => format === ApiFormat.RESPONSES
                ? "https://upstream.example/v1/responses"
                : "https://upstream.example/v1/chat/completions",
        } as unknown as SgVendor;
        const vendorModel = {
            id: 21,
            vendor_id: 9,
            model_id: "responses-model",
            getSupportedFormats: () => [ApiFormat.RESPONSES],
        };
        mocks.vendorManager.findById.mockResolvedValue(vendor);
        mocks.vendorModelManager.findById.mockResolvedValue(vendorModel);

        const model = new SgModel({ name: "gateway-model", enable: true });
        model.mapping = {
            upstreams: [new ModelUpstreamConfig({
                vendor_id: 9,
                vendor_model_id: 21,
                enabled: true,
            })],
        };

        const candidates = await routingService.resolveAvailableCandidates(
            model,
            ApiFormat.OPENAI,
            null,
        );

        expect(candidates).toHaveLength(1);
        expect(candidates[0].upstreamFormat).toBe(ApiFormat.RESPONSES);
    });

    it("先取供应商能力与模型白名单交集，再选择可转换协议", async () => {
        const vendor = new SgVendor({
            id: 9,
            type: "openai",
            config: { api_type: "openai", openai_protocol: "responses", group_ids: [] },
        });
        mocks.vendorManager.findById.mockResolvedValue(vendor);
        mocks.vendorModelManager.findById.mockResolvedValue({
            id: 21,
            vendor_id: 9,
            model_id: "responses-model",
            getSupportedFormats: () => [ApiFormat.OPENAI, ApiFormat.RESPONSES],
        });
        const model = new SgModel({ name: "gateway-model", enable: true });
        model.mapping = {
            upstreams: [new ModelUpstreamConfig({ vendor_id: 9, vendor_model_id: 21, enabled: true })],
        };

        const candidates = await routingService.resolveAvailableCandidates(model, ApiFormat.OPENAI, null);

        expect(candidates).toHaveLength(1);
        expect(candidates[0].upstreamFormat).toBe(ApiFormat.RESPONSES);
    });


    it("filters vendors whose concurrency capacity is exhausted", async () => {
        const vendor = {
            id: 10,
            status: "active",
            concurrency: 2,
            getGroupIds: () => [],
            getEffectiveWeight: () => 2,
            getSupportedFormats: () => [ApiFormat.OPENAI],
            getUrlByFormat: () => "https://upstream.example/v1/chat/completions",
        } as unknown as SgVendor;
        mocks.vendorManager.findById.mockResolvedValue(vendor);
        mocks.vendorModelManager.findByVendorAndModel.mockResolvedValue(null);
        mocks.concurrencyService.current.mockReturnValue(2);

        const model = new SgModel({ name: "gateway-model", enable: true });
        model.mapping = {
            upstreams: [new ModelUpstreamConfig({ vendor_id: 10, enabled: true })],
        };

        await expect(routingService.resolveAvailableCandidates(
            model,
            ApiFormat.OPENAI,
            null,
        )).resolves.toEqual([]);
        expect(mocks.concurrencyService.current).toHaveBeenCalledWith("vendor", 10);
    });


    it("does not treat a missing auth context as a group wildcard", async () => {
        const vendor = {
            id: 11,
            status: "active",
            concurrency: 2,
            getGroupIds: () => [],
            getEffectiveWeight: () => 2,
            getSupportedFormats: () => [ApiFormat.OPENAI],
            getUrlByFormat: () => "https://upstream.example/v1/chat/completions",
        } as unknown as SgVendor;
        mocks.vendorManager.findById.mockResolvedValue(vendor);
        mocks.vendorModelManager.findByVendorAndModel.mockResolvedValue(null);

        const model = new SgModel({ name: "gateway-model", enable: true });
        model.mapping = {
            upstreams: [new ModelUpstreamConfig({ vendor_id: 11, enabled: true })],
        };

        const selected = await routingService.selectUpstream(
            model,
            ApiFormat.OPENAI,
            new RoutingContext(),
        );

        expect(selected.hasUpstream()).toBe(false);
        expect(mocks.vendorManager.findById).not.toHaveBeenCalled();
    });


    it("allows group wildcard only for root or protected admin diagnostics", async () => {
        const vendor = {
            id: 12,
            status: "active",
            concurrency: 2,
            group_id: 9,
            getGroupIds: () => [9],
            getEffectiveWeight: () => 2,
            getSupportedFormats: () => [ApiFormat.OPENAI],
            getUrlByFormat: () => "https://upstream.example/v1/chat/completions",
        } as unknown as SgVendor;
        mocks.vendorManager.findById.mockResolvedValue(vendor);
        mocks.vendorModelManager.findByVendorAndModel.mockResolvedValue(null);

        const model = new SgModel({ name: "gateway-model", enable: true });
        model.mapping = {
            upstreams: [new ModelUpstreamConfig({ vendor_id: 12, enabled: true })],
        };
        const rootContext = {
            get: (key: string) => key === "authContext" ? { user: { id: -1, type: UserType.ROOT } } : undefined,
        } as any;
        const adminDiagnosticContext = {
            get: (key: string) => {
                if (key === "authContext") return { user: { id: 1, type: UserType.ADMIN }, group: null };
                if (key === "inspectUpstream") return true;
                return undefined;
            },
        } as any;
        const ordinaryAdminContext = {
            get: (key: string) => key === "authContext"
                ? { user: { id: 1, type: UserType.ADMIN }, group: null }
                : undefined,
        } as any;

        const root = await routingService.selectUpstream(model, ApiFormat.OPENAI, new RoutingContext(), rootContext);
        const diagnostic = await routingService.selectUpstream(
            model,
            ApiFormat.OPENAI,
            new RoutingContext(),
            adminDiagnosticContext,
        );
        const ordinaryAdmin = await routingService.selectUpstream(
            model,
            ApiFormat.OPENAI,
            new RoutingContext(),
            ordinaryAdminContext,
        );

        expect(root.hasUpstream()).toBe(true);
        expect(diagnostic.hasUpstream()).toBe(true);
        expect(ordinaryAdmin.hasUpstream()).toBe(false);
    });
});


describe("modelController LLM model catalogue", () => {
    it("rejects a missing auth context instead of synthesizing root", async () => {
        const context = {
            get: () => undefined,
        } as any;

        await expect(modelController.listLlmModels(context)).rejects.toMatchObject({
            message: "Invalid token",
            statusCode: 401,
        });
    });
});
