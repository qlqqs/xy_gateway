import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import { ApiFormat, FailedCode, SgRecordStatus } from "../../../src/constants";
import type { SgModel } from "../../../src/model/sgModel";
import type { SgRecord } from "../../../src/model/sgRecord";
import type { SgUser } from "../../../src/model/sgUser";
import type { SgVendor } from "../../../src/model/sgVendor";

const mocks = vi.hoisted(() => ({
    recordService: {
        create: vi.fn(),
        update: vi.fn(),
        recordFailedRequest: vi.fn(),
    },
    requestActivityService: { append: vi.fn() },
    pluginService: { applyRequestPlugins: vi.fn() },
    hostService: { getHostKey: vi.fn() },
    streamLogService: { writeRequestLog: vi.fn() },
    responseHandlerService: {
        prepareStreamResponse: vi.fn(),
        handleStreamResponse: vi.fn(),
        handleNonStreamResponse: vi.fn(),
    },
    fetchUtil: { getDispatcher: vi.fn() },
    routingService: { selectUpstream: vi.fn() },
    configService: { isModuleBillingEnabled: vi.fn() },
    upstreamHealthService: {
        shouldMarkFailure: vi.fn(),
        markFailure: vi.fn(),
    },
    concurrencyService: { acquire: vi.fn() },
}));

vi.mock("../../../src/service/recordService", () => ({ default: mocks.recordService }));
vi.mock("../../../src/service/requestActivityService", () => ({ default: mocks.requestActivityService }));
vi.mock("../../../src/service/pluginService", () => ({ default: mocks.pluginService }));
vi.mock("../../../src/service/hostService", () => ({ default: mocks.hostService }));
vi.mock("../../../src/service/streamLogService", () => ({ default: mocks.streamLogService }));
vi.mock("../../../src/service/responseHandlerService", () => ({
    default: mocks.responseHandlerService,
    RetryableUpstreamResponseError: class extends Error {
        readonly statusCode = 502;


        constructor(
            readonly stage: string,
            message: string,
            readonly originalError: unknown,
            readonly failedCode: string = "upstream_error",
        ) {
            super(message);
            this.code = failedCode;
        }


        readonly code: string;
    },
}));
vi.mock("../../../src/util/fetchUtil", () => ({ default: mocks.fetchUtil }));
vi.mock("../../../src/service/routingService/core", () => ({ default: mocks.routingService }));
vi.mock("../../../src/service/configService", () => ({ default: mocks.configService }));
vi.mock("../../../src/service/upstreamHealthService", () => ({ default: mocks.upstreamHealthService }));
vi.mock("../../../src/service/concurrencyService", () => ({ default: mocks.concurrencyService }));

import senderService from "../../../src/service/senderService";
import { RetryableUpstreamResponseError } from "../../../src/service/responseHandlerService";


function createContext(
    user: SgUser,
    signal?: AbortSignal,
    includeAuthContext: boolean = true,
): Context {
    const values = new Map<string, unknown>([["api_format", ApiFormat.OPENAI]]);
    if (includeAuthContext) {
        values.set("authContext", { user, key: null, group: null });
    }
    const request = new Request("http://gateway.test/llm/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "terminal-record-model" }),
        signal,
    });

    return {
        req: { raw: request },
        get: (key: string) => values.get(key),
        set: (key: string, value: unknown) => values.set(key, value),
        status: vi.fn(),
        header: vi.fn(),
        body: vi.fn(),
        json: vi.fn((body: unknown, status: number) => new Response(JSON.stringify(body), { status })),
    } as unknown as Context;
}


describe("senderService terminal settlement protection", () => {
    const vendor = {
        id: 17,
        name: "terminal-record-vendor",
        token: "test-token",
        concurrency: 0,
        config: {},
        getUrlByFormat: () => "https://upstream.test/chat/completions",
    } as unknown as SgVendor;
    const model = {
        id: 23,
        name: "terminal-record-model",
        prices: {},
        hasBilling: () => false,
    } as unknown as SgModel;
    const user = {
        id: 31,
        name: "terminal-record-user",
        type: "normal",
        balance: 0,
    } as unknown as SgUser;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", {
            status: 200,
            headers: { "Content-Type": "application/json" },
        })));
        mocks.configService.isModuleBillingEnabled.mockResolvedValue(false);
        mocks.recordService.update.mockResolvedValue(undefined);
        mocks.requestActivityService.append.mockResolvedValue(undefined);
        mocks.pluginService.applyRequestPlugins.mockImplementation(async (body: string) => body);
        mocks.hostService.getHostKey.mockResolvedValue("host-key");
        mocks.streamLogService.writeRequestLog.mockResolvedValue(undefined);
        mocks.fetchUtil.getDispatcher.mockResolvedValue(null);
        mocks.responseHandlerService.prepareStreamResponse.mockImplementation(async (_context, response) => response);
        mocks.concurrencyService.acquire.mockReturnValue(null);
        mocks.routingService.selectUpstream.mockResolvedValue({
            vendor,
            vendorModelName: model.name,
            upstreamFormat: ApiFormat.OPENAI,
            priority: 1,
            weight: 1,
            hasUpstream: () => true,
        });
    });

    it("rejects a missing auth context before creating records or selecting an upstream", async () => {
        await expect(senderService.sendRequest(
            createContext(user, undefined, false),
            user,
            model,
            ApiFormat.OPENAI,
            JSON.stringify({ model: model.name }),
        )).rejects.toMatchObject({
            statusCode: 401,
            code: "authentication_error",
        });

        expect(mocks.recordService.create).not.toHaveBeenCalled();
        expect(mocks.routingService.selectUpstream).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });


    it.each([
        ["settled", 0.25],
        ["skipped", 0],
    ] as const)(
        "does not overwrite a successful %s record after a local finalization error",
        async (settlementStatus, cost) => {
            const record = {
                id: 41,
                created_at: new Date(),
                status: SgRecordStatus.PROCESSING,
                settlement_status: "pending",
                cost: 0,
            } as SgRecord;
            mocks.recordService.create.mockResolvedValue(record);
            mocks.responseHandlerService.handleNonStreamResponse.mockImplementation(async () => {
                record.status = SgRecordStatus.SUCCESS;
                record.settlement_status = settlementStatus;
                record.cost = cost;
                throw new Error("local response finalization failed");
            });

            await expect(senderService.sendRequest(
                createContext(user),
                user,
                model,
                ApiFormat.OPENAI,
                JSON.stringify({ model: model.name }),
            )).rejects.toThrow("local response finalization failed");

            expect(record).toMatchObject({
                status: SgRecordStatus.SUCCESS,
                settlement_status: settlementStatus,
                cost,
            });
            expect(mocks.recordService.update).toHaveBeenCalledTimes(1);
            expect(mocks.recordService.update).not.toHaveBeenCalledWith(
                record.id,
                expect.objectContaining({
                    status: SgRecordStatus.FAILED,
                    settlement_status: "skipped",
                    cost: 0,
                }),
            );
            expect(mocks.upstreamHealthService.markFailure).not.toHaveBeenCalled();
        },
    );


    it("不会将客户端 x-goog-api-key 转发到上游或诊断快照", async () => {
        const context = createContext(user);
        context.req.raw.headers.set("x-goog-api-key", "client-secret");
        mocks.recordService.create.mockResolvedValue({ id: 44, created_at: new Date() });
        mocks.responseHandlerService.handleNonStreamResponse.mockResolvedValue(new Response("{}"));

        await senderService.sendRequest(context, user, model, ApiFormat.OPENAI,
            JSON.stringify({ model: model.name }), { inspect: true });

        const request = vi.mocked(globalThis.fetch).mock.calls[0][1];
        const headers = new Headers(request?.headers);
        expect(headers.has("x-goog-api-key")).toBe(false);
        expect(headers.get("authorization")).toBe("Bearer test-token");
        expect(context.get("upstreamRequestSnapshot").headers).not.toHaveProperty("x-goog-api-key");
    });


    it("结算提交状态无法确认时不覆盖费用，也不触发上游 failover", async () => {
        mocks.recordService.create.mockResolvedValue({ id: 45, created_at: new Date() });
        mocks.responseHandlerService.handleNonStreamResponse.mockRejectedValue(
            Object.assign(new Error("Unable to confirm request settlement"), { code: "billing_error" }),
        );

        await expect(senderService.sendRequest(createContext(user), user, model, ApiFormat.OPENAI,
            JSON.stringify({ model: model.name }))).rejects.toThrow("Unable to confirm request settlement");

        expect(mocks.recordService.update).toHaveBeenCalledTimes(1);
        expect(mocks.recordService.update).not.toHaveBeenCalledWith(45,
            expect.objectContaining({ settlement_status: "skipped" }));
        expect(mocks.routingService.selectUpstream).toHaveBeenCalledTimes(1);
        expect(mocks.upstreamHealthService.markFailure).not.toHaveBeenCalled();
    });


    it("records client_disconnected when the client aborts before upstream headers arrive", async () => {
        const record = {
            id: 42,
            created_at: new Date(),
            status: SgRecordStatus.PROCESSING,
            settlement_status: "pending",
            cost: 0,
        } as SgRecord;
        mocks.recordService.create.mockResolvedValue(record);
        vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("client aborted"));

        const abortController = new AbortController();
        abortController.abort();

        await expect(senderService.sendRequest(
            createContext(user, abortController.signal),
            user,
            model,
            ApiFormat.OPENAI,
            JSON.stringify({ model: model.name }),
        )).rejects.toThrow("client aborted");

        expect(mocks.recordService.update).toHaveBeenCalledWith(
            record.id,
            expect.objectContaining({
                status: SgRecordStatus.FAILED,
                failed_code: FailedCode.CLIENT_DISCONNECTED,
                settlement_status: "skipped",
                cost: 0,
            }),
        );
        expect(mocks.recordService.update).not.toHaveBeenCalledWith(
            record.id,
            expect.objectContaining({ failed_code: FailedCode.UPSTREAM_DISCONNECTED }),
        );
        expect(mocks.upstreamHealthService.markFailure).not.toHaveBeenCalled();
        expect(mocks.responseHandlerService.handleNonStreamResponse).not.toHaveBeenCalled();
    });

    it("excludes a failed upstream, resets the record, and releases each non-stream lease", async () => {
        const firstVendor = { ...vendor, id: 18, name: "invalid-json-vendor" } as unknown as SgVendor;
        const secondVendor = { ...vendor, id: 19, name: "healthy-vendor" } as unknown as SgVendor;
        const record = {
            id: 43,
            created_at: new Date(),
            status: SgRecordStatus.PROCESSING,
            settlement_status: "pending",
            cost: 0,
        } as SgRecord;
        const firstLease = { release: vi.fn() };
        const secondLease = { release: vi.fn() };
        let firstRoutingContext: {
            hasTried: (vendorId: number, modelName: string, format: ApiFormat) => boolean;
        };

        mocks.recordService.create.mockResolvedValue(record);
        mocks.concurrencyService.acquire
            .mockReturnValueOnce(firstLease)
            .mockReturnValueOnce(secondLease);
        mocks.routingService.selectUpstream
            .mockImplementationOnce(async (_model, _format, routingContext) => {
                firstRoutingContext = routingContext;
                return {
                    vendor: firstVendor,
                    vendorModelName: model.name,
                    upstreamFormat: ApiFormat.OPENAI,
                    priority: 1,
                    weight: 1,
                    hasUpstream: () => true,
                };
            })
            .mockImplementationOnce(async (_model, _format, routingContext) => {
                expect(routingContext).toBe(firstRoutingContext);
                expect(routingContext.hasTried(firstVendor.id, model.name, ApiFormat.OPENAI)).toBe(true);
                return {
                    vendor: secondVendor,
                    vendorModelName: model.name,
                    upstreamFormat: ApiFormat.OPENAI,
                    priority: 2,
                    weight: 1,
                    hasUpstream: () => true,
                };
            });
        mocks.responseHandlerService.handleNonStreamResponse
            .mockRejectedValueOnce(new RetryableUpstreamResponseError(
                "response_parse",
                "invalid upstream JSON",
                new SyntaxError("Unexpected end of JSON input"),
            ))
            .mockResolvedValueOnce(new Response("{}", {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }));
        mocks.upstreamHealthService.shouldMarkFailure.mockReturnValue(true);

        const response = await senderService.sendRequest(
            createContext(user),
            user,
            model,
            ApiFormat.OPENAI,
            JSON.stringify({ model: model.name }),
        );

        expect(response.status).toBe(200);
        expect(mocks.routingService.selectUpstream).toHaveBeenCalledTimes(2);
        expect(mocks.upstreamHealthService.markFailure).toHaveBeenCalledWith(
            firstVendor.id,
            model.name,
            ApiFormat.OPENAI,
        );
        expect(firstLease.release).toHaveBeenCalledTimes(1);
        expect(secondLease.release).toHaveBeenCalledTimes(1);
        expect(mocks.recordService.update).toHaveBeenNthCalledWith(
            2,
            record.id,
            expect.objectContaining({
                status: SgRecordStatus.PROCESSING,
                vendor_id: secondVendor.id,
                failed_code: null,
                response_data: null,
                usage: null,
                end_at: null,
                settlement_status: "pending",
            }),
        );
    });


    it("流式预检失败后排除首个候选并释放租约，再由第二候选响应", async () => {
        const firstVendor = { ...vendor, id: 20, name: "malformed-stream-vendor", concurrency: 1 } as unknown as SgVendor;
        const secondVendor = { ...vendor, id: 21, name: "healthy-stream-vendor", concurrency: 1 } as unknown as SgVendor;
        const record = {
            id: 46,
            created_at: new Date(),
            status: SgRecordStatus.PROCESSING,
            settlement_status: "pending",
            cost: 0,
        } as SgRecord;
        const firstLease = { release: vi.fn() };
        const secondLease = { release: vi.fn() };
        let firstRoutingContext: {
            hasTried: (vendorId: number, modelName: string, format: ApiFormat) => boolean;
        };
        const firstResponse = new Response("data: {invalid}\n\n", {
            headers: { "Content-Type": "text/event-stream" },
        });
        const secondResponse = new Response("data: {}\n\n", {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        });

        mocks.recordService.create.mockResolvedValue(record);
        mocks.concurrencyService.acquire
            .mockReturnValueOnce(firstLease)
            .mockReturnValueOnce(secondLease);
        mocks.routingService.selectUpstream
            .mockImplementationOnce(async (_model, _format, routingContext) => {
                firstRoutingContext = routingContext;
                return {
                    vendor: firstVendor,
                    vendorModelName: model.name,
                    upstreamFormat: ApiFormat.OPENAI,
                    priority: 1,
                    weight: 1,
                    hasUpstream: () => true,
                };
            })
            .mockImplementationOnce(async (_model, _format, routingContext) => {
                expect(routingContext).toBe(firstRoutingContext);
                expect(routingContext.hasTried(firstVendor.id, model.name, ApiFormat.OPENAI)).toBe(true);
                return {
                    vendor: secondVendor,
                    vendorModelName: model.name,
                    upstreamFormat: ApiFormat.OPENAI,
                    priority: 2,
                    weight: 1,
                    hasUpstream: () => true,
                };
            });
        vi.mocked(globalThis.fetch)
            .mockResolvedValueOnce(firstResponse)
            .mockResolvedValueOnce(secondResponse);
        mocks.responseHandlerService.prepareStreamResponse
            .mockRejectedValueOnce(new RetryableUpstreamResponseError(
                "stream_preflight",
                "malformed first stream event",
                new SyntaxError("Unexpected token"),
            ))
            .mockResolvedValueOnce(secondResponse);
        mocks.responseHandlerService.handleStreamResponse.mockImplementation(async (...args: unknown[]) => {
            const onComplete = args[8] as (() => void) | undefined;
            onComplete?.();
            return new Response(null, { headers: { "Content-Type": "Text/Event-Stream; Charset=UTF-8" } });
        });
        mocks.upstreamHealthService.shouldMarkFailure.mockReturnValue(true);

        const response = await senderService.sendRequest(
            createContext(user),
            user,
            model,
            ApiFormat.OPENAI,
            JSON.stringify({ model: model.name, stream: true }),
        );

        expect(response.headers.get("content-type")).toContain("Text/Event-Stream");
        expect(mocks.routingService.selectUpstream).toHaveBeenCalledTimes(2);
        expect(mocks.responseHandlerService.prepareStreamResponse).toHaveBeenCalledTimes(2);
        expect(mocks.responseHandlerService.handleStreamResponse).toHaveBeenCalledTimes(1);
        expect(mocks.upstreamHealthService.markFailure).toHaveBeenCalledWith(
            firstVendor.id,
            model.name,
            ApiFormat.OPENAI,
        );
        expect(firstLease.release).toHaveBeenCalledTimes(1);
        expect(secondLease.release).toHaveBeenCalledTimes(1);
        expect(mocks.recordService.update).toHaveBeenNthCalledWith(
            2,
            record.id,
            expect.objectContaining({
                status: SgRecordStatus.PROCESSING,
                vendor_id: secondVendor.id,
                failed_code: null,
                response_data: null,
                settlement_status: "pending",
            }),
        );
    });
});
