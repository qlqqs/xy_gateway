import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import type { SSEStreamingApi } from "hono/streaming";
import { ApiFormat, FailedCode, SgRecordStatus } from "../../../src/constants";
import { SgModel } from "../../../src/model/sgModel";
import type { SgRecord } from "../../../src/model/sgRecord";
import type { SgUser } from "../../../src/model/sgUser";
import type { BaseConverter } from "../../../src/util/protocolConverter/BaseConverter";
import type { ProtocolStreamEvent } from "../../../src/util/protocolConverter/protocolTypes";

const mocks = vi.hoisted(() => ({
    recordService: { create: vi.fn(), update: vi.fn(), recordFailedRequest: vi.fn() },
    recordManager: { findById: vi.fn() },
    requestActivityService: { append: vi.fn() },
    billingService: { settle: vi.fn() },
    streamLogService: { prepareStreamLog: vi.fn(), appendStreamLog: vi.fn(), writeRequestLog: vi.fn() },
    pluginService: { applyRequestPlugins: vi.fn() },
    hostService: { getHostKey: vi.fn() },
    fetchUtil: { getDispatcher: vi.fn() },
    routingService: { selectUpstream: vi.fn() },
    configService: { isModuleBillingEnabled: vi.fn() },
    upstreamHealthService: { shouldMarkFailure: vi.fn(), markFailure: vi.fn() },
    concurrencyService: { acquire: vi.fn() },
    streamSSE: vi.fn(),
    writeSSE: vi.fn(),
    streamTasks: [] as Promise<void>[],
    backgroundTasks: [] as Promise<void>[],
    backgroundErrors: [] as unknown[],
}));

vi.mock("../../../src/service/recordService", () => ({ default: mocks.recordService }));
vi.mock("../../../src/manager/recordManager", () => ({ default: mocks.recordManager }));
vi.mock("../../../src/service/requestActivityService", () => ({ default: mocks.requestActivityService }));
vi.mock("../../../src/service/billingService", () => ({ default: mocks.billingService }));
vi.mock("../../../src/service/streamLogService", () => ({ default: mocks.streamLogService }));
vi.mock("../../../src/service/pluginService", () => ({ default: mocks.pluginService }));
vi.mock("../../../src/service/hostService", () => ({ default: mocks.hostService }));
vi.mock("../../../src/util/fetchUtil", () => ({ default: mocks.fetchUtil }));
vi.mock("../../../src/service/routingService/core", () => ({ default: mocks.routingService }));
vi.mock("../../../src/service/configService", () => ({ default: mocks.configService }));
vi.mock("../../../src/service/upstreamHealthService", () => ({ default: mocks.upstreamHealthService }));
vi.mock("../../../src/service/concurrencyService", () => ({ default: mocks.concurrencyService }));
vi.mock("hono/streaming", () => ({ streamSSE: mocks.streamSSE }));
vi.mock("../../../src/util/runInBackgroundUtil", () => ({
    runInBackground: (task: () => Promise<void>) => {
        mocks.backgroundTasks.push(task().catch(error => { mocks.backgroundErrors.push(error); }));
    },
}));

import responseHandlerService from "../../../src/service/responseHandlerService";
import senderService from "../../../src/service/senderService";
import { ConverterFactory } from "../../../src/util/protocolConverter/ConverterFactory";


const user = { id: 31, name: "测试用户", type: "normal", balance: 10_000_000 } as SgUser;
const model = new SgModel({ id: 23, name: "gateway-model", prices: { billing_mode: "per_request", per_request: 1 } });


function makeRecord(): SgRecord {
    return {
        id: 41,
        created_at: new Date(),
        status: SgRecordStatus.PROCESSING,
        settlement_status: "pending",
        group_id: null,
        rate_multiplier: 1,
        cost: 0,
    } as SgRecord;
}


function makeContext(format = ApiFormat.OPENAI, signal?: AbortSignal): Context {
    const values = new Map<string, unknown>([
        ["api_format", format],
        ["authContext", { user, key: { id: 32, concurrency_limit: 1 }, group: null }],
    ]);
    let status = 200;
    return {
        req: { raw: new Request("http://gateway.test/llm", { signal }) },
        res: { headers: new Headers() },
        get: (key: string) => values.get(key),
        set: (key: string, value: unknown) => values.set(key, value),
        status: (value: number) => { status = value; },
        header: vi.fn(),
        body: (body: string) => new Response(body, { status }),
        json: (body: unknown, code: number) => new Response(JSON.stringify(body), { status: code }),
    } as unknown as Context;
}


function makeStream(chunks: string[], keepOpen = false) {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
            if (!keepOpen) controller.close();
        },
        cancel,
    });
    return { response: new Response(stream, { headers: { "Content-Type": "text/event-stream" } }), cancel };
}


function makeErroredResponse(message = "upstream read failed"): Response {
    return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
            controller.error(new Error(message));
        },
    }), { headers: { "Content-Type": "application/json" } });
}


function chatUsage(outputTokens: number) {
    return { prompt_tokens: 10, completion_tokens: outputTokens, total_tokens: 10 + outputTokens };
}


function chatEvent(
    content: string,
    finishReason: string | null = null,
    outputTokens = 1,
    includeUsage = true,
): string {
    return `data: ${JSON.stringify({
        id: "chatcmpl-regression",
        model: "upstream-model",
        choices: [{ index: 0, delta: { content }, finish_reason: finishReason }],
        ...(includeUsage ? { usage: chatUsage(outputTokens) } : {}),
    })}\n\n`;
}


function chatUsageEvent(outputTokens: number): string {
    return `data: ${JSON.stringify({
        id: "chatcmpl-regression",
        model: "upstream-model",
        choices: [],
        usage: chatUsage(outputTokens),
    })}\n\n`;
}


async function drainStream(): Promise<void> {
    await Promise.all(mocks.streamTasks);
    await Promise.all(mocks.backgroundTasks);
}


function expectNoBillingFailure(): void {
    expect(mocks.recordService.update).not.toHaveBeenCalledWith(41,
        expect.objectContaining({ failed_code: FailedCode.BILLING_ERROR }));
}


describe("响应处理与 sender 的纯单元链路", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.streamTasks.length = 0;
        mocks.backgroundTasks.length = 0;
        mocks.backgroundErrors.length = 0;
        mocks.recordService.create.mockResolvedValue(makeRecord());
        mocks.recordService.update.mockResolvedValue(undefined);
        mocks.recordManager.findById.mockResolvedValue({ ...makeRecord(), status: SgRecordStatus.SUCCESS });
        mocks.requestActivityService.append.mockResolvedValue(undefined);
        mocks.billingService.settle.mockResolvedValue({ status: "settled", baseCost: 1, rateMultiplier: 1, cost: 1 });
        mocks.streamLogService.prepareStreamLog.mockResolvedValue(null);
        mocks.streamLogService.writeRequestLog.mockResolvedValue(undefined);
        mocks.pluginService.applyRequestPlugins.mockImplementation(async (body: string) => body);
        mocks.hostService.getHostKey.mockResolvedValue("test-host");
        mocks.fetchUtil.getDispatcher.mockResolvedValue(null);
        mocks.configService.isModuleBillingEnabled.mockResolvedValue(false);
        mocks.upstreamHealthService.shouldMarkFailure.mockReturnValue(true);
        mocks.writeSSE.mockResolvedValue(undefined);
        mocks.streamSSE.mockImplementation((_context: Context, callback: (stream: SSEStreamingApi) => Promise<void>) => {
            mocks.streamTasks.push(callback({ writeSSE: mocks.writeSSE } as unknown as SSEStreamingApi));
            return new Response(null, { headers: { "Content-Type": "text/event-stream" } });
        });
        let vendorId = 0;
        mocks.routingService.selectUpstream.mockImplementation(async () => ({
            vendor: {
                id: ++vendorId,
                name: "测试上游",
                token: "upstream-token",
                concurrency: 1,
                getUrlByFormat: () => "https://upstream.test/v1/chat/completions",
            },
            vendorModelName: "upstream-model",
            upstreamFormat: ApiFormat.OPENAI,
            priority: 1,
            weight: 1,
            hasUpstream: () => true,
        }));
        vi.stubGlobal("fetch", vi.fn());
    });


    afterEach(async () => {
        await drainStream();
        vi.unstubAllGlobals();
    });


    it.each([
        [ApiFormat.OPENAI, {}],
        [ApiFormat.OPENAI, { choices: [], error: { message: "upstream failed" } }],
        [ApiFormat.ANTHROPIC, { type: "error", error: { message: "failed" } }],
        [ApiFormat.ANTHROPIC, { type: "message", content: "invalid" }],
        [ApiFormat.RESPONSES, { status: "failed", output: [] }],
        [ApiFormat.RESPONSES, { status: "cancelled", output: [] }],
        [ApiFormat.RESPONSES, { status: "completed" }],
    ])("%s 的 2xx 无效协议在转换和计费前拒绝：%j", async (format, payload) => {
        const convertResponse = vi.fn();
        const release = vi.fn();
        await expect(responseHandlerService.handleNonStreamResponse(
            makeContext(), new Response(JSON.stringify(payload), { status: 201 }),
            makeRecord(), model, user, format,
            { convertResponse } as unknown as BaseConverter, release,
        )).rejects.toMatchObject({ stage: "response_validation", statusCode: 502 });

        expect(convertResponse).not.toHaveBeenCalled();
        expect(mocks.billingService.settle).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledTimes(1);
    });


    it.each([
        [ApiFormat.OPENAI, { choices: [] }],
        [ApiFormat.ANTHROPIC, { type: "message", content: [] }],
        [ApiFormat.RESPONSES, { status: "completed", output: [] }],
    ])("%s 的最小合法 2xx 响应可进入结算：%j", async (format, payload) => {
        const release = vi.fn();
        const response = await responseHandlerService.handleNonStreamResponse(
            makeContext(), new Response(JSON.stringify(payload)), makeRecord(), model, user,
            format, null, release,
        );

        expect(response.status).toBe(200);
        expect(mocks.billingService.settle).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledTimes(1);
    });


    it.each([
        [false, FailedCode.UPSTREAM_DISCONNECTED],
        [true, FailedCode.CLIENT_DISCONNECTED],
    ])("非流式 body 读取失败保留精确错误分类（aborted=%s）", async (aborted, failedCode) => {
        const abortController = new AbortController();
        if (aborted) abortController.abort();
        const release = vi.fn();

        await expect(responseHandlerService.handleNonStreamResponse(
            makeContext(ApiFormat.OPENAI, abortController.signal),
            makeErroredResponse(),
            makeRecord(),
            model,
            user,
            ApiFormat.OPENAI,
            null,
            release,
        )).rejects.toMatchObject({
            stage: "body_read",
            failedCode,
            code: failedCode,
        });

        expect(mocks.recordService.update).toHaveBeenCalledWith(41,
            expect.objectContaining({ failed_code: failedCode, settlement_status: "skipped", cost: 0 }));
        expect(mocks.billingService.settle).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledTimes(1);
    });


    it.each(["settled", "skipped"] as const)("非流式恢复已提交 %s，不清零或重复扣费", async status => {
        const cost = status === "settled" ? 1 : 0;
        mocks.billingService.settle.mockRejectedValue(new Error("提交后连接关闭"));
        mocks.recordManager.findById.mockResolvedValue({
            ...makeRecord(), status: SgRecordStatus.SUCCESS, settlement_status: status,
            base_cost: 1, rate_multiplier: 1, cost,
        });
        const record = makeRecord();
        const release = vi.fn();
        const response = await responseHandlerService.handleNonStreamResponse(
            makeContext(), new Response(JSON.stringify({ choices: [] })), record, model, user,
            ApiFormat.OPENAI, null, release,
        );
        expect(response.status).toBe(200);
        expect(record).toMatchObject({ settlement_status: status, cost, status: SgRecordStatus.SUCCESS });
        expect(mocks.billingService.settle).toHaveBeenCalledTimes(1);
        expect(mocks.recordManager.findById).toHaveBeenCalledWith(record.id);
        expectNoBillingFailure();
        expect(release).toHaveBeenCalledTimes(1);
    });


    it.each(["settled", "skipped"] as const)("流式恢复已提交 %s 并释放租约", async status => {
        mocks.billingService.settle.mockRejectedValue(new Error("提交后连接关闭"));
        mocks.recordManager.findById.mockResolvedValue({
            ...makeRecord(), status: SgRecordStatus.SUCCESS, settlement_status: status,
            base_cost: 1, rate_multiplier: 1, cost: status === "settled" ? 1 : 0,
        });
        const release = vi.fn();
        await responseHandlerService.handleStreamResponse(makeContext(),
            makeStream([chatEvent("answer", "stop"), "data: [DONE]\n\n"]).response,
            makeRecord(), model, user, ApiFormat.OPENAI, ApiFormat.OPENAI, null, release);
        await drainStream();
        expect(mocks.recordManager.findById).toHaveBeenCalledWith(41);
        expectNoBillingFailure();
        expect(mocks.backgroundErrors).toEqual([]);
        expect(release).toHaveBeenCalledTimes(1);
    });


    it.each([false, true])("确认未提交后才标 billing_error（stream=%s）", async stream => {
        mocks.billingService.settle.mockRejectedValue(new Error("提交前失败"));
        const release = vi.fn();
        if (stream) {
            await responseHandlerService.handleStreamResponse(makeContext(),
                makeStream([chatEvent("answer", "stop"), "data: [DONE]\n\n"]).response,
                makeRecord(), model, user, ApiFormat.OPENAI, ApiFormat.OPENAI, null, release);
            await drainStream();
        } else {
            await expect(responseHandlerService.handleNonStreamResponse(makeContext(),
                new Response(JSON.stringify({ choices: [] })), makeRecord(), model, user,
                ApiFormat.OPENAI, null, release)).rejects.toMatchObject({ code: "billing_error" });
        }
        expect(mocks.recordService.update).toHaveBeenCalledWith(41,
            expect.objectContaining({ failed_code: FailedCode.BILLING_ERROR, settlement_status: "skipped" }));
        expect(release).toHaveBeenCalledTimes(1);
    });


    it.each([false, true])("重读失败保留未知结算状态并释放租约（stream=%s）", async stream => {
        mocks.billingService.settle.mockRejectedValue(new Error("提交状态未知"));
        mocks.recordManager.findById.mockRejectedValue(new Error("数据库暂时不可读"));
        const release = vi.fn();
        if (stream) {
            await responseHandlerService.handleStreamResponse(makeContext(),
                makeStream([chatEvent("answer", "stop"), "data: [DONE]\n\n"]).response,
                makeRecord(), model, user, ApiFormat.OPENAI, ApiFormat.OPENAI, null, release);
            await drainStream();
            expect(mocks.backgroundErrors).toEqual([expect.objectContaining({ code: "billing_error" })]);
        } else {
            await expect(responseHandlerService.handleNonStreamResponse(makeContext(),
                new Response(JSON.stringify({ choices: [] })), makeRecord(), model, user,
                ApiFormat.OPENAI, null, release)).rejects.toMatchObject({ code: "billing_error" });
        }
        expectNoBillingFailure();
        expect(release).toHaveBeenCalledTimes(1);
    });


    it.each([
        ["data: {invalid}\n\n"],
        ["data: {\"error\":{\"message\":\"busy\"}}\n\n"],
        ["data: {\"choices\":"],
    ])("首条 data 预检失败时在写客户端前 failover：%s", async invalid => {
        const first = makeStream([invalid]);
        const second = makeStream([chatEvent("good", "stop"), "data: [DONE]\n\n"]);
        const leases = [{ release: vi.fn() }, { release: vi.fn() }, { release: vi.fn() }];
        for (const lease of leases) mocks.concurrencyService.acquire.mockReturnValueOnce(lease);
        vi.mocked(fetch).mockResolvedValueOnce(first.response).mockImplementationOnce(async () => {
            expect(mocks.streamSSE).not.toHaveBeenCalled();
            expect(mocks.writeSSE).not.toHaveBeenCalled();
            expect(mocks.billingService.settle).not.toHaveBeenCalled();
            return second.response;
        });

        const response = await senderService.sendRequest(makeContext(), user, model,
            ApiFormat.OPENAI, JSON.stringify({ model: model.name, stream: true }));
        await drainStream();

        expect(response.status).toBe(200);
        expect(mocks.routingService.selectUpstream).toHaveBeenCalledTimes(2);
        expect(mocks.streamSSE).toHaveBeenCalledTimes(1);
        expect(mocks.upstreamHealthService.markFailure).toHaveBeenCalledWith(1, "upstream-model", ApiFormat.OPENAI);
        expect(mocks.billingService.settle).toHaveBeenCalledTimes(1);
        for (const lease of leases) expect(lease.release).toHaveBeenCalledTimes(1);
    });


    it("预检跳过注释并等待跨 chunk 的完整事件，回放字节不丢失", async () => {
        const chunks = [": keepalive\r\n\r\n", "data: {\"choices\":", "[]}\r\n\r\n", "data: [DONE]\r\n\r\n"];
        const response = await responseHandlerService.prepareStreamResponse(makeContext(),
            makeStream(chunks).response, makeRecord(), ApiFormat.OPENAI, ApiFormat.OPENAI);
        expect(await response.text()).toBe(chunks.join(""));
        expect(mocks.streamSSE).not.toHaveBeenCalled();
        expect(mocks.billingService.settle).not.toHaveBeenCalled();
    });


    it("预检会跨过转换器连续产生的空事件并完整回放", async () => {
        const chunks = [chatEvent("first"), chatEvent("second"), chatEvent("third")];
        const convertStreamEvent = vi.fn()
            .mockReturnValueOnce([])
            .mockReturnValueOnce([])
            .mockImplementation((data: string, event?: string, id?: string) => [{ data, event, id }]);

        const response = await responseHandlerService.prepareStreamResponse(
            makeContext(),
            makeStream(chunks).response,
            makeRecord(),
            ApiFormat.OPENAI,
            ApiFormat.OPENAI,
            { convertStreamEvent } as unknown as BaseConverter,
        );

        expect(convertStreamEvent).toHaveBeenCalledTimes(3);
        expect(await response.text()).toBe(chunks.join(""));
    });


    it("预检在首个可发送事件前 EOF 时标记 stream_incomplete", async () => {
        await expect(responseHandlerService.prepareStreamResponse(
            makeContext(),
            makeStream([": keepalive\n\n"]).response,
            makeRecord(),
            ApiFormat.OPENAI,
            ApiFormat.OPENAI,
        )).rejects.toMatchObject({
            stage: "stream_preflight",
            failedCode: FailedCode.STREAM_INCOMPLETE,
            code: FailedCode.STREAM_INCOMPLETE,
        });
    });


    it("预检 reader 异常时标记 upstream_disconnected", async () => {
        await expect(responseHandlerService.prepareStreamResponse(
            makeContext(),
            makeErroredResponse("socket reset"),
            makeRecord(),
            ApiFormat.OPENAI,
            ApiFormat.OPENAI,
        )).rejects.toMatchObject({
            stage: "stream_preflight",
            failedCode: FailedCode.UPSTREAM_DISCONNECTED,
            code: FailedCode.UPSTREAM_DISCONNECTED,
        });
    });


    it("预检进入时客户端已取消会终止两个 tee 分支", async () => {
        const abortController = new AbortController();
        abortController.abort();
        const upstream = makeStream([], true);

        await expect(responseHandlerService.prepareStreamResponse(
            makeContext(ApiFormat.OPENAI, abortController.signal),
            upstream.response,
            makeRecord(),
            ApiFormat.OPENAI,
            ApiFormat.OPENAI,
        )).rejects.toMatchObject({
            stage: "stream_preflight",
            failedCode: FailedCode.CLIENT_DISCONNECTED,
            code: FailedCode.CLIENT_DISCONNECTED,
        });

        expect(upstream.cancel).toHaveBeenCalledTimes(1);
        expect(mocks.billingService.settle).not.toHaveBeenCalled();
    });


    it("正式流进入时客户端已取消会停止读取且不污染上游健康", async () => {
        const abortController = new AbortController();
        abortController.abort();
        const upstream = makeStream([], true);
        const release = vi.fn();
        const onUpstreamFailure = vi.fn();

        await responseHandlerService.handleStreamResponse(
            makeContext(ApiFormat.OPENAI, abortController.signal),
            upstream.response,
            makeRecord(),
            model,
            user,
            ApiFormat.OPENAI,
            ApiFormat.OPENAI,
            null,
            release,
            onUpstreamFailure,
        );
        await drainStream();

        expect(upstream.cancel).toHaveBeenCalledTimes(1);
        expect(mocks.writeSSE).not.toHaveBeenCalled();
        expect(mocks.recordService.update).toHaveBeenCalledWith(41,
            expect.objectContaining({ failed_code: FailedCode.CLIENT_DISCONNECTED }));
        expect(onUpstreamFailure).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledTimes(1);
    });


    it("正式流转换产生非法 SSE data 时不写给客户端", async () => {
        const release = vi.fn();
        const onUpstreamFailure = vi.fn();
        const convertStreamEvent = vi.fn().mockReturnValue([{ data: "not-json" }]);

        await responseHandlerService.handleStreamResponse(
            makeContext(ApiFormat.RESPONSES),
            makeStream([chatEvent("hello")]).response,
            makeRecord(),
            model,
            user,
            ApiFormat.RESPONSES,
            ApiFormat.OPENAI,
            { convertStreamEvent } as unknown as BaseConverter,
            release,
            onUpstreamFailure,
        );
        await drainStream();

        expect(convertStreamEvent).toHaveBeenCalledTimes(1);
        expect(mocks.writeSSE).not.toHaveBeenCalled();
        expect(mocks.recordService.update).toHaveBeenCalledWith(41,
            expect.objectContaining({
                status: SgRecordStatus.FAILED,
                failed_code: FailedCode.UPSTREAM_ERROR,
                response_data: expect.stringContaining("conversion"),
            }));
        expect(onUpstreamFailure).toHaveBeenCalledWith(FailedCode.UPSTREAM_ERROR);
        expect(mocks.billingService.settle).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledTimes(1);
    });


    it("转换流中途错误以 Responses SSE 错误结束且不 failover", async () => {
        const upstream = makeStream([
            chatEvent("hello"),
            `data: ${JSON.stringify({ error: { message: "upstream busy", code: "server_error" } })}\n\n`,
        ], true);
        vi.mocked(fetch).mockResolvedValueOnce(upstream.response);
        const releaseKey = vi.fn();
        const releaseVendor = vi.fn();
        mocks.concurrencyService.acquire.mockReturnValueOnce({ release: releaseKey })
            .mockReturnValueOnce({ release: releaseVendor });

        const response = await senderService.sendRequest(makeContext(ApiFormat.RESPONSES), user, model,
            ApiFormat.RESPONSES, JSON.stringify({ model: model.name, input: "hello", stream: true }));
        await drainStream();

        const events = mocks.writeSSE.mock.calls.map(call => call[0] as ProtocolStreamEvent);
        const payloads = events.map(event => JSON.parse(event.data));
        expect(response.status).toBe(200);
        expect(payloads.some(event => event.type === "response.output_text.delta" && event.delta === "hello"))
            .toBe(true);
        expect(events[events.length - 1].event).toBe("error");
        expect(payloads[payloads.length - 1]).toMatchObject({
            type: "error", message: "upstream busy", code: "server_error", param: null,
        });
        expect(payloads.filter(event => event.type === "error")).toHaveLength(1);
        expect(payloads.some(event => event.type === "response.completed")).toBe(false);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(mocks.routingService.selectUpstream).toHaveBeenCalledTimes(1);
        expect(mocks.recordService.update).toHaveBeenCalledWith(41,
            expect.objectContaining({
                status: SgRecordStatus.FAILED,
                failed_code: FailedCode.UPSTREAM_ERROR,
                settlement_status: "skipped",
                cost: 0,
                response_data: expect.stringContaining("upstream busy"),
            }));
        expect(mocks.upstreamHealthService.markFailure).toHaveBeenCalledExactlyOnceWith(
            1, "upstream-model", ApiFormat.OPENAI,
        );
        expect(mocks.billingService.settle).not.toHaveBeenCalled();
        expect(upstream.cancel).toHaveBeenCalledTimes(1);
        expect(releaseKey).toHaveBeenCalledTimes(1);
        expect(releaseVendor).toHaveBeenCalledTimes(1);
    });


    it("上游错误事件后的客户端写失败不会覆盖 upstream_error", async () => {
        mocks.writeSSE.mockRejectedValueOnce(new Error("client closed while writing error"));
        const release = vi.fn();
        const onUpstreamFailure = vi.fn();

        await responseHandlerService.handleStreamResponse(
            makeContext(),
            makeStream([`data: ${JSON.stringify({ error: { message: "upstream busy" } })}\n\n`]).response,
            makeRecord(),
            model,
            user,
            ApiFormat.OPENAI,
            ApiFormat.OPENAI,
            null,
            release,
            onUpstreamFailure,
        );
        await drainStream();

        expect(mocks.writeSSE).toHaveBeenCalledTimes(1);
        expect(mocks.recordService.update).toHaveBeenCalledWith(41,
            expect.objectContaining({ failed_code: FailedCode.UPSTREAM_ERROR }));
        expect(mocks.recordService.update).not.toHaveBeenCalledWith(41,
            expect.objectContaining({ failed_code: FailedCode.CLIENT_DISCONNECTED }));
        expect(onUpstreamFailure).toHaveBeenCalledWith(FailedCode.UPSTREAM_ERROR);
        expect(release).toHaveBeenCalledTimes(1);
    });


    it("独立预检转换器不吞正式首帧，中途 usage 不截断后续输出和最终用量", async () => {
        const upstream = makeStream([
            chatEvent("Hello", null, 1),
            chatEvent(" world", "stop", 5, false),
            chatUsageEvent(5),
            "data: [DONE]\n\n",
        ], true);
        vi.mocked(fetch).mockResolvedValueOnce(upstream.response);
        const releaseKey = vi.fn();
        const releaseVendor = vi.fn();
        mocks.concurrencyService.acquire.mockReturnValueOnce({ release: releaseKey })
            .mockReturnValueOnce({ release: releaseVendor });

        await senderService.sendRequest(makeContext(ApiFormat.RESPONSES), user, model,
            ApiFormat.RESPONSES, JSON.stringify({ model: model.name, input: "hello", stream: true }));
        await drainStream();

        const events = mocks.writeSSE.mock.calls.map(call => {
            const event = call[0] as ProtocolStreamEvent;
            return JSON.parse(event.data);
        });
        expect(events.filter(event => event.type === "response.created")).toHaveLength(1);
        const completed = events.filter(event => event.type === "response.completed");
        expect(completed).toHaveLength(1);
        expect(completed[0].response.output[0].content[0].text).toBe("Hello world");
        expect(completed[0].response.usage.output_tokens).toBe(5);
        expect(mocks.recordService.update).toHaveBeenCalledWith(41,
            expect.objectContaining({ response_data: expect.stringContaining("Hello world") }));
        expect(mocks.billingService.settle).toHaveBeenCalledTimes(1);
        expect(upstream.cancel).toHaveBeenCalledTimes(1);
        expect(releaseKey).toHaveBeenCalledTimes(1);
        expect(releaseVendor).toHaveBeenCalledTimes(1);
    });


    it("预检转换失败取消上游且不写出客户端响应", async () => {
        const converter = ConverterFactory.create(ApiFormat.RESPONSES, ApiFormat.OPENAI);
        if (!converter) throw new Error("缺少测试转换器");
        vi.spyOn(converter, "convertStreamEvent").mockImplementation(() => { throw new Error("转换失败"); });
        const upstream = makeStream([chatEvent("hello")], true);
        await expect(responseHandlerService.prepareStreamResponse(makeContext(), upstream.response,
            makeRecord(), ApiFormat.RESPONSES, ApiFormat.OPENAI, converter))
            .rejects.toMatchObject({ stage: "stream_preflight" });
        expect(upstream.cancel).toHaveBeenCalledTimes(1);
        expect(mocks.writeSSE).not.toHaveBeenCalled();
    });
});
