import { Context } from "hono";
import { streamSSE, SSEStreamingApi } from "hono/streaming";
import { StatusCode } from "hono/utils/http-status";
import type { WriteStream } from "fs";
import { SgModel } from "../model/sgModel";
import { SgUser } from "../model/sgUser";
import { SgRecord, SgRecordUsage } from "../model/sgRecord";
import recordManager from "../manager/recordManager";
import { ApiFormat, FailedCode, SgRecordStatus, RequestActivityStage, ActivityLevel } from "../constants";
import { BaseConverter } from "../util/protocolConverter/BaseConverter";
import type { ProtocolStreamEvent } from "../util/protocolConverter/protocolTypes";
import { AccumulatorBase } from "../util/accumulator/accumulatorBase";
import recordService from "./recordService";
import requestActivityService from "./requestActivityService";
import billingService from "./billingService";
import streamLogService from "./streamLogService";
import usageUtils, { type Dict } from "../util/protocol/usageUtil";
import openaiChatAccumulator from "../util/accumulator/openaiChatAccumulator";
import anthropicAccumulator from "../util/accumulator/anthropicAccumulator";
import responsesAccumulator from "../util/accumulator/responsesAccumulator";
import sseEvent from "../util/protocol/sseEventUtil";
import { runInBackground } from "../util/runInBackgroundUtil";
import customError from "../util/customErrorUtil";


// ====================================================================
// 内部类型
// ====================================================================

interface StreamRunResult {
    accumulator: AccumulatorBase;
    usageAccumulator: AccumulatorBase;
    firstTokenTime: number | null;
    failedCode: FailedCode | null;
    streamErrorData: unknown | null;
    eventCount: number;
}


interface RunSseLoopOptions {
    accumulator: AccumulatorBase;
    usageAccumulator: AccumulatorBase;
    clientFormat: ApiFormat;
    upstreamFormat: ApiFormat;
    converter: BaseConverter | null;
    logPrefix: string;
}


type RetryableUpstreamResponseStage =
    | "body_read"
    | "response_parse"
    | "response_validation"
    | "conversion"
    | "stream_preflight";
type StreamProcessingStage = "upstream_validation" | "usage_accumulation" | "conversion" | "client_accumulation";
type StreamFailureHandler = (failedCode: FailedCode) => void;
type SettlementSummary = { baseCost: number; rateMultiplier: number; cost: number };


class RetryableUpstreamResponseError extends customError.AppError {
    constructor(
        readonly stage: RetryableUpstreamResponseStage,
        message: string,
        readonly originalError: unknown,
        readonly failedCode: FailedCode = FailedCode.UPSTREAM_ERROR,
    ) {
        super(message, 502, failedCode);
        this.name = "RetryableUpstreamResponseError";
    }
}


class StreamPreflightFailure extends Error {
    constructor(
        readonly failedCode: FailedCode,
        message: string,
        readonly originalError: unknown = null,
    ) {
        super(message);
        this.name = "StreamPreflightFailure";
    }
}


function buildBillingResult(
    model: SgModel,
    normalizedUsage: ReturnType<typeof usageUtils.normalizeUsage>,
) {
    const costBreakdown = usageUtils.calculateCostBreakdown(model, normalizedUsage ?? {});
    let recordUsage = normalizedUsage?.recordUsage ?? null;
    if (!recordUsage && (model.prices?.billing_mode === "per_request" || model.prices?.billing_mode === "image")) {
        recordUsage = new SgRecordUsage({ version: 3 });
    }
    if (recordUsage) {
        recordUsage.cost_breakdown = costBreakdown;
    }
    return {
        cost: costBreakdown.total_cost,
        usageJson: usageUtils.serializeStoredUsage(recordUsage),
    };
}


function createAccumulator(apiFormat: ApiFormat): AccumulatorBase {
    if (apiFormat === ApiFormat.ANTHROPIC) {
        return new anthropicAccumulator.AnthropicAccumulator();
    }
    if (apiFormat === ApiFormat.RESPONSES) {
        return new responsesAccumulator.ResponsesAccumulator();
    }
    return new openaiChatAccumulator.OpenAIChatAccumulator();
}


function validateSuccessfulResponse(format: ApiFormat, response: Dict): void {
    if (response.type === "error" || response.error !== undefined && response.error !== null) {
        throw new Error("response contains an error payload");
    }

    if (format === ApiFormat.OPENAI) {
        if (!Array.isArray(response.choices)) {
            throw new Error("OpenAI response must contain a choices array");
        }
        return;
    }

    if (format === ApiFormat.ANTHROPIC) {
        if (response.type !== "message") {
            throw new Error('Anthropic response type must be "message"');
        }
        if (!Array.isArray(response.content)) {
            throw new Error("Anthropic response must contain a content array");
        }
        return;
    }

    const status = typeof response.status === "string" ? response.status.toLowerCase() : null;
    if (status === "failed" || status === "cancelled") {
        throw new Error(`Responses response ended with status ${status}`);
    }
    if (!Array.isArray(response.output)) {
        throw new Error("Responses response must contain an output array");
    }
}


function validateStreamEventData(format: ApiFormat, event: ProtocolStreamEvent): void {
    if (event.data === "[DONE]") {
        if (format === ApiFormat.RESPONSES) {
            throw new Error("Responses stream does not accept the [DONE] marker");
        }
        return;
    }

    let payload: unknown;
    try {
        payload = JSON.parse(event.data);
    } catch (error) {
        throw new Error(`SSE data is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("SSE data must be a JSON object");
    }
}


function probeStreamEvent(
    event: ProtocolStreamEvent,
    clientFormat: ApiFormat,
    upstreamFormat: ApiFormat,
    upstreamAccumulator: AccumulatorBase,
    clientAccumulator: AccumulatorBase,
    converter: BaseConverter | null,
): number {
    try {
        validateStreamEventData(upstreamFormat, event);
        upstreamAccumulator.addEvent(event);
    } catch (error) {
        throw new StreamPreflightFailure(
            FailedCode.UPSTREAM_ERROR,
            `invalid upstream SSE event: ${error instanceof Error ? error.message : String(error)}`,
            error,
        );
    }
    if (upstreamAccumulator.isErrored()) {
        throw new StreamPreflightFailure(
            FailedCode.UPSTREAM_ERROR,
            "upstream returned a protocol error event",
            upstreamAccumulator.getError(),
        );
    }

    let clientEvents: ProtocolStreamEvent[];
    try {
        clientEvents = converter
            ? converter.convertStreamEvent(event.data, event.event, event.id)
            : [event];
    } catch (error) {
        throw new StreamPreflightFailure(
            FailedCode.UPSTREAM_ERROR,
            `failed to convert first SSE event: ${error instanceof Error ? error.message : String(error)}`,
            error,
        );
    }

    let sendableEvents = 0;
    for (const clientEvent of clientEvents) {
        if (!clientEvent.data) continue;
        try {
            validateStreamEventData(clientFormat, clientEvent);
            clientAccumulator.addEvent(clientEvent);
        } catch (error) {
            throw new StreamPreflightFailure(
                FailedCode.UPSTREAM_ERROR,
                `invalid converted SSE event: ${error instanceof Error ? error.message : String(error)}`,
                error,
            );
        }
        if (clientAccumulator.isErrored()) {
            throw new StreamPreflightFailure(
                FailedCode.UPSTREAM_ERROR,
                "converted response contains a protocol error event",
                clientAccumulator.getError(),
            );
        }
        sendableEvents++;
    }
    return sendableEvents;
}


function serializeFailureDetail(detail: unknown, fallback: string): string {
    if (typeof detail === "string") return detail;
    if (detail === null || detail === undefined || detail instanceof Error) return fallback;

    try {
        const serialized = JSON.stringify(detail);
        return typeof serialized === "string" ? serialized : fallback;
    } catch {
        return fallback;
    }
}


async function recoverCommittedSettlement(
    record: SgRecord,
    settlementError: unknown,
): Promise<SettlementSummary | null> {
    let persisted: SgRecord | null;
    try {
        persisted = await recordManager.findById(Number(record.id));
    } catch (readError) {
        console.error(`[responseHandlerService] Failed to reload record ${record.id} after settlement error:`, readError);
        throw new customError.AppError("Unable to confirm request settlement", 503, "billing_error");
    }

    const settlementStatus = persisted?.settlement_status;
    if (
        !persisted
        || persisted.status !== SgRecordStatus.SUCCESS
        || (settlementStatus !== "settled" && settlementStatus !== "skipped")
    ) {
        return null;
    }

    console.warn(`[responseHandlerService] Settlement for record ${record.id} committed before promise rejection:`, settlementError);
    record.status = SgRecordStatus.SUCCESS;
    record.settlement_status = settlementStatus;
    record.base_cost = Number(persisted.base_cost ?? 0);
    record.rate_multiplier = Number(persisted.rate_multiplier ?? 1);
    record.cost = Number(persisted.cost ?? 0);
    return {
        baseCost: record.base_cost,
        rateMultiplier: record.rate_multiplier,
        cost: record.cost,
    };
}


/** 标记已写入客户端、但结算未完成的响应记录。 */
async function markSettlementFailure(record: SgRecord, error: unknown): Promise<void> {
    console.error(`[responseHandlerService] Failed to settle record ${record.id}:`, error);
    await recordService.update(Number(record.id), {
        status: SgRecordStatus.FAILED,
        failed_code: FailedCode.BILLING_ERROR,
        settlement_status: "skipped",
        cost: 0,
        end_at: new Date(),
    }).catch((updateError) => {
        console.error(`[responseHandlerService] Failed to mark billing error for record ${record.id}:`, updateError);
    });
    await requestActivityService.append(
        Number(record.id),
        RequestActivityStage.RESULT,
        "请求结算失败",
        { status: SgRecordStatus.FAILED, failed_code: FailedCode.BILLING_ERROR },
        ActivityLevel.ERROR,
    ).catch(() => undefined);
}


// ====================================================================
// 内部方法
// ====================================================================

/**
 * 消费上游 SSE 流：decode → 拆分事件 → 协议转换 → 累加 → 实时转发给客户端。
 * 返回统一状态供收尾使用（finalizeStreamResult）。
 */
async function runSseLoop(
    c: Context,
    upstreamRes: Response,
    stream: SSEStreamingApi,
    logStream: WriteStream | null,
    opts: RunSseLoopOptions,
): Promise<StreamRunResult> {
    const { accumulator, usageAccumulator } = opts;
    const reader = upstreamRes.body!.getReader();
    const decoder = new TextDecoder();
    const signal = c.req.raw.signal;
    let buffer = "";
    let eventCount = 0;
    let failedCode: FailedCode | null = null;
    let streamErrorData: unknown | null = null;
    let firstTokenTime: number | null = null;
    let reachedEnd = false;
    let shouldRead = true;
    let cancelPromise: Promise<void> | null = null;

    const cancelReader = (): Promise<void> => {
        cancelPromise ??= reader.cancel().catch(() => undefined);
        return cancelPromise;
    };

    const abortHandler = () => {
        shouldRead = false;
        if (!failedCode) failedCode = FailedCode.CLIENT_DISCONNECTED;
        void cancelReader();
    };
    const recordProcessingFailure = (stage: StreamProcessingStage, error: unknown): void => {
        console.error(`${opts.logPrefix} Stream ${stage} error:`, error);
        if (
            failedCode !== FailedCode.CLIENT_DISCONNECTED
            && failedCode !== FailedCode.UPSTREAM_DISCONNECTED
        ) {
            failedCode = FailedCode.UPSTREAM_ERROR;
        }
        streamErrorData = {
            stage,
            message: error instanceof Error ? error.message : String(error),
        };
    };
    signal.addEventListener("abort", abortHandler);
    if (signal.aborted) abortHandler();

    try {
        while (shouldRead) {
            let done: boolean;
            let value: Uint8Array | undefined;
            try {
                const result = await reader.read();
                done = result.done;
                value = result.value;
            } catch (e: any) {
                console.error(`${opts.logPrefix} Upstream read error:`, e);
                if (failedCode !== FailedCode.CLIENT_DISCONNECTED) {
                    failedCode = FailedCode.UPSTREAM_DISCONNECTED;
                }
                break;
            }
            if (!shouldRead) break;
            if (done) {
                reachedEnd = true;
                break;
            }

            const chunk = decoder.decode(value, { stream: true });
            streamLogService.appendStreamLog(logStream, chunk);
            buffer += chunk;

            const splitResult = sseEvent.splitEvents(buffer);
            const events = splitResult.events;
            buffer = splitResult.remainingBuffer;

            let stopReading = false;
            for (const event of events) {
                if (!event.trim()) continue;
                if (!shouldRead) {
                    stopReading = true;
                    break;
                }

                eventCount++;

                const parsedEvent = sseEvent.parseEvent(event);
                if (!parsedEvent) continue;

                try {
                    validateStreamEventData(opts.upstreamFormat, parsedEvent);
                } catch (error) {
                    recordProcessingFailure("upstream_validation", error);
                    stopReading = true;
                    break;
                }

                if (usageAccumulator !== accumulator) {
                    try {
                        usageAccumulator.addEvent(parsedEvent);
                    } catch (error) {
                        recordProcessingFailure("usage_accumulation", error);
                        stopReading = true;
                        break;
                    }
                    if (usageAccumulator.isErrored()) {
                        if (failedCode !== FailedCode.CLIENT_DISCONNECTED) {
                            failedCode = FailedCode.UPSTREAM_ERROR;
                        }
                        streamErrorData = usageAccumulator.getError()
                            ?? { event: parsedEvent.event, data: parsedEvent.data };
                        stopReading = true;
                    }
                }

                let clientEvents = [parsedEvent];
                if (opts.converter) {
                    try {
                        clientEvents = opts.converter.convertStreamEvent(
                            parsedEvent.data,
                            parsedEvent.event,
                            parsedEvent.id,
                        );
                    } catch (error) {
                        recordProcessingFailure("conversion", error);
                        stopReading = true;
                        break;
                    }
                }

                for (const clientEvent of clientEvents) {
                    if (!clientEvent.data) continue;

                    try {
                        validateStreamEventData(opts.clientFormat, clientEvent);
                    } catch (error) {
                        recordProcessingFailure("conversion", error);
                        stopReading = true;
                        break;
                    }

                    try {
                        accumulator.addEvent(clientEvent);
                    } catch (error) {
                        recordProcessingFailure("client_accumulation", error);
                        stopReading = true;
                        break;
                    }

                    if (firstTokenTime === null && accumulator.isOutputStarted()) {
                        firstTokenTime = Date.now();
                    }

                    if (accumulator.isErrored()) {
                        if (failedCode !== FailedCode.CLIENT_DISCONNECTED) {
                            failedCode = FailedCode.UPSTREAM_ERROR;
                        }
                        streamErrorData = accumulator.getError()
                            ?? { event: clientEvent.event, data: clientEvent.data };
                        stopReading = true;
                    }

                    try {
                        await stream.writeSSE({
                            data: clientEvent.data,
                            event: clientEvent.event,
                            id: clientEvent.id,
                        });
                    } catch (e: any) {
                        console.error(`${opts.logPrefix} Client write error (client disconnected):`, e);
                        if (failedCode !== FailedCode.UPSTREAM_ERROR) {
                            failedCode = FailedCode.CLIENT_DISCONNECTED;
                        }
                        stopReading = true;
                        break;
                    }

                    if (stopReading) break;
                }

                // 转换器可能为一个上游完成事件生成多条客户端尾帧，必须先全部写出，
                // 再停止读取仍保持连接的上游，避免占用并发租约和悬挂客户端响应。
                if (!stopReading && accumulator.isCompleted()) {
                    stopReading = true;
                }

                if (stopReading) break;
            }

            if (stopReading) break;
        }
    } catch (e: any) {
        console.error(`${opts.logPrefix} Unexpected stream error:`, e);
        if (
            failedCode !== FailedCode.CLIENT_DISCONNECTED
            && failedCode !== FailedCode.UPSTREAM_ERROR
        ) {
            failedCode = FailedCode.UPSTREAM_DISCONNECTED;
        }
    } finally {
        signal.removeEventListener("abort", abortHandler);
        if (!reachedEnd) await cancelReader();
        reader.releaseLock();
    }

    return { accumulator, usageAccumulator, firstTokenTime, failedCode, streamErrorData, eventCount };
}


/**
 * 流式收尾（后台执行）：完成 → 记成功 + 扣费；中断 / 上游错误 / 流不完整 → 记 FAILED。
 * 成功分支统一按 OpenAI 口径解析 accumulator 输出的规范化 usage（三个 accumulator 已统一键）。
 */
function finalizeStreamResult(
    c: Context,
    record: SgRecord,
    model: SgModel,
    user: SgUser,
    state: StreamRunResult,
    onComplete?: () => void,
    onUpstreamFailure?: StreamFailureHandler,
): void {
    const { accumulator, usageAccumulator, firstTokenTime, failedCode, streamErrorData } = state;

    runInBackground(async () => {
        try {
            // 已收到协议完成事件时优先视为成功，随后发生的客户端断开不影响该终态。
            if (
                accumulator.isCompleted()
                && failedCode !== FailedCode.UPSTREAM_ERROR
                && !usageAccumulator.isErrored()
            ) {
                const fullResponse = accumulator.getResponse();
                const normalizedUsage = usageUtils.normalizeUsage(
                    ApiFormat.OPENAI,
                    usageAccumulator.getUsage() as Dict | null,
                );
                const { usageJson, cost } = buildBillingResult(model, normalizedUsage);

                await recordService.update(record.id, {
                    response_data: JSON.stringify(fullResponse),
                    status: SgRecordStatus.SUCCESS,
                    usage: usageJson,
                    first_token_latency: firstTokenTime !== null
                        ? firstTokenTime - record.created_at.getTime()
                        : null,
                    end_at: new Date(),
                });
                let settlement;
                if (c.get("skipBilling") === true) {
                    await recordService.update(Number(record.id), {
                        base_cost: cost,
                        rate_multiplier: Number(record.rate_multiplier ?? 1),
                        billing_mode: typeof model.prices?.billing_mode === "string"
                            ? model.prices.billing_mode
                            : null,
                        cost: 0,
                        settlement_status: "skipped",
                    });
                    settlement = {
                        baseCost: cost,
                        rateMultiplier: Number(record.rate_multiplier ?? 1),
                        cost: 0,
                    };
                } else {
                    try {
                        settlement = await billingService.settle(Number(record.id), {
                            model,
                            user,
                            groupId: record.group_id,
                            baseCost: cost,
                        });
                    } catch (error) {
                        // 数据库提交成功后，驱动仍可能在 Promise 收尾阶段抛错；先重读终态，
                        // 只有确认未提交时才覆盖为 billing_error。
                        settlement = await recoverCommittedSettlement(record, error);
                        if (!settlement) {
                            await markSettlementFailure(record, error);
                            return;
                        }
                    }
                }
                await requestActivityService.append(record.id, RequestActivityStage.RESULT, "请求成功", {
                    status: SgRecordStatus.SUCCESS,
                    cost: settlement.cost,
                    base_cost: settlement.baseCost,
                    rate_multiplier: settlement.rateMultiplier,
                });
                return;
            }

            if (
                failedCode === FailedCode.CLIENT_DISCONNECTED
                || failedCode === FailedCode.UPSTREAM_DISCONNECTED
            ) {
                if (failedCode === FailedCode.UPSTREAM_DISCONNECTED) {
                    onUpstreamFailure?.(FailedCode.UPSTREAM_DISCONNECTED);
                }
                await recordService.update(record.id, {
                    status: SgRecordStatus.FAILED,
                    failed_code: failedCode,
                    settlement_status: "skipped",
                    cost: 0,
                    end_at: new Date(),
                });
                await requestActivityService.append(record.id, RequestActivityStage.RESULT, "请求中断", {
                    status: SgRecordStatus.FAILED,
                    failed_code: failedCode,
                }, ActivityLevel.WARN);
                return;
            }

            if (failedCode === FailedCode.UPSTREAM_ERROR || accumulator.isErrored()) {
                onUpstreamFailure?.(FailedCode.UPSTREAM_ERROR);
                const errorData = accumulator.getError() ?? streamErrorData;
                await recordService.update(record.id, {
                    status: SgRecordStatus.FAILED,
                    failed_code: FailedCode.UPSTREAM_ERROR,
                    response_data: errorData !== null && typeof errorData !== "string"
                        ? JSON.stringify(errorData)
                        : null,
                    settlement_status: "skipped",
                    cost: 0,
                    end_at: new Date(),
                });
                await requestActivityService.append(record.id, RequestActivityStage.RESULT, "上游返回错误", {
                    status: SgRecordStatus.FAILED,
                    failed_code: FailedCode.UPSTREAM_ERROR,
                }, ActivityLevel.ERROR);
                return;
            }

            onUpstreamFailure?.(FailedCode.STREAM_INCOMPLETE);
            await recordService.update(record.id, {
                status: SgRecordStatus.FAILED,
                failed_code: FailedCode.STREAM_INCOMPLETE,
                settlement_status: "skipped",
                cost: 0,
                end_at: new Date(),
            });
            await requestActivityService.append(record.id, RequestActivityStage.RESULT, "流式响应不完整", {
                status: SgRecordStatus.FAILED,
                failed_code: FailedCode.STREAM_INCOMPLETE,
            }, ActivityLevel.WARN);
        } finally {
            onComplete?.();
        }
    });
}


// ====================================================================
// 公开入口
// ====================================================================

/**
 * 在创建客户端 SSE Response 前读取并验证第一条完整 data 事件。
 * 成功后通过回放流无损拼回已读字节；失败会抛出可重试错误，让 sender 继续选择候选。
 */
export async function prepareStreamResponse(
    c: Context,
    upstreamRes: Response,
    record: SgRecord,
    clientFormat: ApiFormat,
    upstreamFormat: ApiFormat,
    probeConverter: BaseConverter | null = null,
): Promise<Response> {
    const signal = c.req.raw.signal;
    const preflightFailure = async (failure: StreamPreflightFailure): Promise<never> => {
        const message = `Upstream stream preflight failed: ${failure.message}`;
        const responseData = serializeFailureDetail(failure.originalError, message);
        await recordService.update(Number(record.id), {
            status: SgRecordStatus.FAILED,
            failed_code: failure.failedCode,
            response_data: responseData,
            usage: null,
            settlement_status: "skipped",
            cost: 0,
            end_at: new Date(),
        }).catch(() => undefined);
        await requestActivityService.append(
            Number(record.id),
            RequestActivityStage.RESULT,
            failure.failedCode === FailedCode.CLIENT_DISCONNECTED
                ? "客户端在流式响应预检时断开"
                : "上游流式响应预检失败",
            {
                status: SgRecordStatus.FAILED,
                failed_code: failure.failedCode,
                upstream_format: upstreamFormat,
                error: message,
            },
            failure.failedCode === FailedCode.CLIENT_DISCONNECTED ? ActivityLevel.WARN : ActivityLevel.ERROR,
        ).catch(() => undefined);
        throw new RetryableUpstreamResponseError(
            "stream_preflight",
            message,
            failure.originalError ?? failure,
            failure.failedCode,
        );
    };

    if (!upstreamRes.body) {
        return preflightFailure(new StreamPreflightFailure(
            FailedCode.UPSTREAM_DISCONNECTED,
            "upstream response has no body",
        ));
    }

    let probeBody: ReadableStream<Uint8Array>;
    let replayBody: ReadableStream<Uint8Array>;
    try {
        [probeBody, replayBody] = upstreamRes.body.tee();
    } catch (error) {
        return preflightFailure(new StreamPreflightFailure(
            FailedCode.UPSTREAM_ERROR,
            "unable to duplicate upstream stream for preflight",
            error,
        ));
    }

    const probeReader = probeBody.getReader();
    const decoder = new TextDecoder();
    const upstreamAccumulator = createAccumulator(upstreamFormat);
    const clientAccumulator = createAccumulator(clientFormat);
    let buffer = "";
    let cancelBothPromise: Promise<void> | null = null;

    const cancelBoth = (): Promise<void> => {
        cancelBothPromise ??= Promise.allSettled([
            probeReader.cancel(),
            replayBody.cancel(),
        ]).then(() => undefined);
        return cancelBothPromise;
    };
    const abortHandler = () => {
        void cancelBoth();
    };

    signal.addEventListener("abort", abortHandler);
    if (signal.aborted) abortHandler();

    try {
        if (signal.aborted) {
            throw new StreamPreflightFailure(
                FailedCode.CLIENT_DISCONNECTED,
                "client disconnected before stream preflight",
            );
        }

        let firstClientEventValidated = false;
        while (!firstClientEventValidated) {
            let result: Awaited<ReturnType<typeof probeReader.read>>;
            try {
                result = await probeReader.read();
            } catch (error) {
                throw new StreamPreflightFailure(
                    signal.aborted ? FailedCode.CLIENT_DISCONNECTED : FailedCode.UPSTREAM_DISCONNECTED,
                    signal.aborted
                        ? "client disconnected during stream preflight"
                        : "upstream stream disconnected before the first client event",
                    error,
                );
            }
            if (signal.aborted) {
                throw new StreamPreflightFailure(
                    FailedCode.CLIENT_DISCONNECTED,
                    "client disconnected during stream preflight",
                );
            }
            if (result.done) {
                throw new StreamPreflightFailure(
                    FailedCode.STREAM_INCOMPLETE,
                    "upstream stream ended before the first client event",
                );
            }
            if (!result.value) continue;

            buffer += decoder.decode(result.value, { stream: true });
            const splitResult = sseEvent.splitEvents(buffer);
            buffer = splitResult.remainingBuffer;

            for (const rawEvent of splitResult.events) {
                const parsedEvent = sseEvent.parseEvent(rawEvent);
                if (!parsedEvent) continue;
                const sendableEvents = probeStreamEvent(
                    parsedEvent,
                    clientFormat,
                    upstreamFormat,
                    upstreamAccumulator,
                    clientAccumulator,
                    probeConverter,
                );
                if (sendableEvents > 0) {
                    firstClientEventValidated = true;
                    break;
                }
            }
        }
    } catch (error) {
        const failure = error instanceof StreamPreflightFailure
            ? error
            : new StreamPreflightFailure(FailedCode.UPSTREAM_ERROR, "unexpected stream preflight error", error);
        await cancelBoth();
        probeReader.releaseLock();
        return preflightFailure(failure);
    } finally {
        signal.removeEventListener("abort", abortHandler);
    }

    // tee 的 probe 分支取消 Promise 要等待 replay 分支结束，不能在这里 await。
    void probeReader.cancel().catch(() => undefined);
    probeReader.releaseLock();

    return new Response(replayBody, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: new Headers(upstreamRes.headers),
    });
}


/**
 * 非流式响应：各协议通用。协议转换按 converter 是否存在判断，上游 usage 按 upstreamFormat 解析。
 */
export async function handleNonStreamResponse(
    c: Context,
    upstreamRes: Response,
    record: SgRecord,
    model: SgModel,
    user: SgUser,
    upstreamFormat: ApiFormat,
    converter: BaseConverter | null = null,
    onComplete?: () => void,
): Promise<Response> {
    const release = once(onComplete);
    try {
        let responseText: string;
        try {
            responseText = await upstreamRes.text();
        } catch (error) {
            const failedCode = c.req.raw.signal.aborted
                ? FailedCode.CLIENT_DISCONNECTED
                : FailedCode.UPSTREAM_DISCONNECTED;
            const message = `Failed to read upstream response: ${error instanceof Error ? error.message : String(error)}`;
            await recordService.update(record.id, {
                status: SgRecordStatus.FAILED,
                failed_code: failedCode,
                response_data: message,
                usage: null,
                end_at: new Date(),
                cost: 0,
                settlement_status: "skipped",
            });
            throw new RetryableUpstreamResponseError("body_read", message, error, failedCode);
        }
        const statusCode = upstreamRes.status as StatusCode;

        if (!upstreamRes.ok) {
            console.error("[responseHandlerService] Upstream non-stream error response:", {
                recordId: record.id,
                status: statusCode,
                contentType: upstreamRes.headers.get("content-type"),
                body: responseText,
            });

            // 非流式：首 token 时间 = 整体响应耗时
            await recordService.update(record.id, {
                response_data: responseText,
                status: SgRecordStatus.FAILED,
                failed_code: FailedCode.UPSTREAM_ERROR,
                usage: null,
                end_at: new Date(),
                cost: 0,
                settlement_status: "skipped",
                first_token_latency: Date.now() - record.created_at.getTime(),
            });
            await requestActivityService.append(record.id, RequestActivityStage.RESULT, "上游返回非成功响应", {
                status: SgRecordStatus.FAILED,
                upstream_status: statusCode,
                response_body: responseText,
            }, ActivityLevel.ERROR);

            c.status(statusCode);
            c.res.headers.set("Content-Type", upstreamRes.headers.get("content-type") || "application/json");
            return c.body(responseText);
        }

        let responseJson: Dict;
        try {
            const parsed = JSON.parse(responseText) as unknown;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error("response root must be a JSON object");
            }
            responseJson = parsed as Dict;
        } catch (error) {
            console.error("[responseHandlerService] Invalid successful upstream response:", error);
            const message = `Upstream returned an invalid JSON response: ${error instanceof Error ? error.message : String(error)}`;
            await recordService.update(record.id, {
                response_data: responseText,
                status: SgRecordStatus.FAILED,
                failed_code: FailedCode.UPSTREAM_ERROR,
                usage: null,
                end_at: new Date(),
                cost: 0,
                settlement_status: "skipped",
                first_token_latency: Date.now() - record.created_at.getTime(),
            });
            await requestActivityService.append(
                record.id,
                RequestActivityStage.RESULT,
                "上游成功响应不是有效 JSON 对象",
                { error: message, upstream_status: statusCode },
                ActivityLevel.ERROR,
            );
            throw new RetryableUpstreamResponseError("response_parse", message, error);
        }

        try {
            validateSuccessfulResponse(upstreamFormat, responseJson);
        } catch (error) {
            console.error("[responseHandlerService] Invalid successful upstream protocol response:", error);
            const message = `Upstream returned an invalid ${upstreamFormat} response: ${error instanceof Error ? error.message : String(error)}`;
            await recordService.update(record.id, {
                response_data: responseText,
                status: SgRecordStatus.FAILED,
                failed_code: FailedCode.UPSTREAM_ERROR,
                usage: null,
                end_at: new Date(),
                cost: 0,
                settlement_status: "skipped",
                first_token_latency: Date.now() - record.created_at.getTime(),
            });
            await requestActivityService.append(
                record.id,
                RequestActivityStage.RESULT,
                "上游成功响应不符合协议",
                {
                    error: message,
                    upstream_format: upstreamFormat,
                    upstream_status: statusCode,
                },
                ActivityLevel.ERROR,
            );
            throw new RetryableUpstreamResponseError("response_validation", message, error);
        }

        let clientResponseText = responseText;
        if (converter) {
            try {
                const clientRes = converter.convertResponse(responseJson);
                clientResponseText = JSON.stringify(clientRes);
            } catch (e) {
                console.error("[responseHandlerService] Failed to convert response format:", e);
                const message = `Failed to convert upstream response format: ${e instanceof Error ? e.message : String(e)}`;
                await recordService.update(record.id, {
                    response_data: responseText,
                    status: SgRecordStatus.FAILED,
                    failed_code: FailedCode.UPSTREAM_ERROR,
                    usage: null,
                    end_at: new Date(),
                    cost: 0,
                    settlement_status: "skipped",
                    first_token_latency: Date.now() - record.created_at.getTime(),
                });
                await requestActivityService.append(
                    record.id,
                    RequestActivityStage.CONVERSION,
                    "上游成功响应转换失败",
                    { error: message, upstream_status: statusCode },
                    ActivityLevel.ERROR,
                );
                throw new RetryableUpstreamResponseError(
                    "conversion",
                    message,
                    e,
                );
            }
        }

        let normalizedUsage: ReturnType<typeof usageUtils.normalizeUsage> | null = null;
        try {
            normalizedUsage = usageUtils.normalizeUsage(upstreamFormat, responseJson.usage as Dict | null | undefined);
        } catch (e) {
            console.log("Failed to normalize response token stats:", e);
        }

        const { usageJson, cost } = buildBillingResult(model, normalizedUsage);

        const recordStatus = upstreamRes.ok ? SgRecordStatus.SUCCESS : SgRecordStatus.FAILED;
        // 非流式：首 token 时间 = 整体响应耗时
        const endedAt = Date.now();
        await recordService.update(record.id, {
            response_data: clientResponseText,
            status: recordStatus,
            usage: usageJson,
            end_at: new Date(endedAt),
            ...(recordStatus === SgRecordStatus.FAILED
                ? { cost: 0, settlement_status: "skipped" }
                : {}),
            first_token_latency: endedAt - record.created_at.getTime(),
        });
        let settledCost = cost;
        if (recordStatus === SgRecordStatus.SUCCESS) {
            if (c.get("skipBilling") === true) {
                await recordService.update(Number(record.id), {
                    base_cost: cost,
                    rate_multiplier: Number(record.rate_multiplier ?? 1),
                    billing_mode: typeof model.prices?.billing_mode === "string"
                        ? model.prices.billing_mode
                        : null,
                    cost: 0,
                    settlement_status: "skipped",
                });
                settledCost = 0;
                record.status = SgRecordStatus.SUCCESS;
                record.settlement_status = "skipped";
                record.cost = 0;
            } else {
                try {
                    const settlement = await billingService.settle(Number(record.id), {
                        model,
                        user,
                        groupId: record.group_id,
                        baseCost: cost,
                    });
                    settledCost = settlement.cost;
                    // sender 的异常收尾会读取这份请求内快照，必须先同步终态，
                    // 避免后续本地收尾失败把已结算记录覆盖为 skipped 并清零。
                    record.status = SgRecordStatus.SUCCESS;
                    record.settlement_status = settlement.status;
                    record.cost = settlement.cost;
                } catch (error) {
                    const committed = await recoverCommittedSettlement(record, error);
                    if (!committed) {
                        await markSettlementFailure(record, error);
                        throw new customError.AppError("Unable to settle request", 503, "billing_error");
                    }
                    settledCost = committed.cost;
                }
            }
        }
        await requestActivityService.append(
            record.id,
            RequestActivityStage.RESULT,
            recordStatus === SgRecordStatus.SUCCESS ? "请求成功" : "请求失败",
            {
                status: recordStatus,
                upstream_status: statusCode,
                ...(recordStatus === SgRecordStatus.SUCCESS ? { cost: settledCost } : {}),
            },
            recordStatus === SgRecordStatus.SUCCESS ? ActivityLevel.INFO : ActivityLevel.ERROR,
        );

        c.status(statusCode);
        c.header("Content-Type", "application/json");
        return c.body(clientResponseText);
    } finally {
        // 非流式的所有退出路径都必须释放供应商租约；once 避免外层重复释放。
        release();
    }
}


/**
 * 流式响应：按客户端协议格式选择累加器（anthropic / responses / openai chat）。
 */
export async function handleStreamResponse(
    c: Context,
    upstreamRes: Response,
    record: SgRecord,
    model: SgModel,
    user: SgUser,
    format: ApiFormat,
    upstreamFormat: ApiFormat = format,
    converter: BaseConverter | null = null,
    onComplete?: () => void,
    onUpstreamFailure?: StreamFailureHandler,
): Promise<Response> {
    const logStream = await streamLogService.prepareStreamLog(record);

    let accumulator: AccumulatorBase;
    if (format === ApiFormat.ANTHROPIC) {
        accumulator = new anthropicAccumulator.AnthropicAccumulator();
    } else if (format === ApiFormat.RESPONSES) {
        accumulator = new responsesAccumulator.ResponsesAccumulator();
    } else {
        accumulator = new openaiChatAccumulator.OpenAIChatAccumulator();
    }
    const usageAccumulator = upstreamFormat === format
        ? accumulator
        : createAccumulator(upstreamFormat);

    return streamSSE(c, async (stream: SSEStreamingApi) => {
        const release = once(onComplete);
        let finalizerScheduled = false;
        try {
            const state = await runSseLoop(c, upstreamRes, stream, logStream, {
                accumulator,
                usageAccumulator,
                clientFormat: format,
                upstreamFormat,
                converter,
                logPrefix: "[responseHandlerService]",
            });
            console.log(`[responseHandlerService] Stream ended, events: ${state.eventCount}, completed: ${state.accumulator.isCompleted()}, failedCode: ${state.failedCode}`);
            finalizerScheduled = true;
            finalizeStreamResult(c, record, model, user, state, release, onUpstreamFailure);
        } catch (error) {
            // reader 尚未建立等防御路径没有后台 finalizer，需直接记录失败并释放租约。
            onUpstreamFailure?.(FailedCode.UPSTREAM_DISCONNECTED);
            await recordService.update(Number(record.id), {
                status: SgRecordStatus.FAILED,
                failed_code: FailedCode.UPSTREAM_DISCONNECTED,
                settlement_status: "skipped",
                cost: 0,
                end_at: new Date(),
            }).catch(() => undefined);
            await requestActivityService.append(
                Number(record.id),
                RequestActivityStage.RESULT,
                "流式响应处理异常",
                { status: SgRecordStatus.FAILED, failed_code: FailedCode.UPSTREAM_DISCONNECTED },
                ActivityLevel.ERROR,
            ).catch(() => undefined);
            throw error;
        } finally {
            logStream?.end();
            if (!finalizerScheduled) release();
        }
    });
}

function once(callback?: () => void): () => void {
    let called = false;
    return () => {
        if (called) return;
        called = true;
        callback?.();
    };
}


export { RetryableUpstreamResponseError };
export default {
    prepareStreamResponse,
    handleStreamResponse,
    handleNonStreamResponse,
};
