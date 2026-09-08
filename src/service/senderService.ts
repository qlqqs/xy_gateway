import { Context } from "hono";
import { SgModel } from "../model/sgModel";
import { SgUser } from "../model/sgUser";
import { SgVendor } from "../model/sgVendor";
import { SgRecord } from "../model/sgRecord";
import recordService from "./recordService";
import requestActivityService from "./requestActivityService";
import { SgRecordStatus, ApiFormat, VendorAuthMode, FailedCode, RequestActivityStage, ActivityLevel } from "../constants";
import pluginService from "./pluginService";
import hostService from "./hostService";
import { ConverterFactory } from "../util/protocolConverter/ConverterFactory";
import type { BaseConverter } from "../util/protocolConverter/BaseConverter";
import customError from "../util/customErrorUtil";
import streamLogService from "./streamLogService";
import responseHandlerService, { RetryableUpstreamResponseError } from "./responseHandlerService";
import fetchUtil from "../util/fetchUtil";
import routingService, { type ModelRoutingResult } from "./routingService/core";
import configService from "./configService";
import upstreamHealthService from "./upstreamHealthService";
import RoutingContext from "./routingService/routingContext";
import concurrencyService from "./concurrencyService";
import type { AuthContext } from "./authContextService";


// 可重试的 HTTP 错误响应转成异常，与网络异常汇入同一个失败处理点
class UpstreamResponseError extends Error {
    constructor(readonly response: Response) {
        super(`Upstream returned retryable status ${response.status}`);
    }
}


class UpstreamTransportError extends Error {
    constructor(readonly originalError: unknown) {
        super(originalError instanceof Error ? originalError.message : String(originalError));
        this.name = "UpstreamTransportError";
    }
}


function isRetryableUpstreamError(error: unknown): boolean {
    return error instanceof UpstreamResponseError
        || error instanceof UpstreamTransportError
        || error instanceof RetryableUpstreamResponseError;
}


function isEventStreamResponse(response: Response): boolean {
    const contentType = response.headers.get("content-type");
    if (!contentType) return false;
    return contentType.split(";", 1)[0].trim().toLowerCase() === "text/event-stream";
}


// 网络异常合成 502 错误响应，与 HTTP 错误响应统一为 Response 回传
function buildUpstreamFailureResponse(c: Context, error: unknown): Response {
    const errorCode = error instanceof RetryableUpstreamResponseError
        ? error.code
        : undefined;
    const appError = new customError.AppError(
        `All upstreams failed: ${error instanceof Error ? error.message : String(error)}`,
        502,
        errorCode,
    );
    const apiFormat = c.get("api_format");
    const body = apiFormat
        ? customError.buildLlmErrorResponse(appError, apiFormat)
        : { error: appError.message, code: appError.code };
    return c.json(body, 502);
}


// inspect 模式下脱敏上游请求头，避免认证信息泄露给调用方
function sanitizeUpstreamHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        result[key] =
            lower === "authorization" || lower === "x-api-key"
                ? (value.length > 12 ? value.slice(0, 8) + "****" + value.slice(-4) : "****")
                : value;
    });
    return result;
}


async function sendRequestToUpstream(
    c: Context,
    user: SgUser,
    modelConfig: SgModel,
    record: SgRecord,
    vendor: SgVendor,
    vendorModelName: string,
    clientFormat: ApiFormat,
    upstreamFormat: ApiFormat,
    body: string,
    onComplete?: () => void,
    onStreamComplete?: () => void,
): Promise<Response> {
    // 客户端格式与最终上游格式已在 sendRequest 解析好，这里直接使用
    const needsConversion = clientFormat !== upstreamFormat;

    const url = vendor.getUrlByFormat(upstreamFormat);
    if (url === null) {
        throw new customError.AppError(`vendor does not have url for ${upstreamFormat} format`, 400);
    }

    console.log("sendRequestToUpstream: modelConfig={}, clientFormat={}, upstreamFormat={}", modelConfig, clientFormat, upstreamFormat);

    // 余额扣减在响应处理阶段完成（responseHandlerService），这里仅对非 root 用户记录余额快照（单位：整数微元）
    if (user.type !== "root") {
        console.log(`[senderService] Checking balance for user ${user.id}: ${user.balance}`);
    }

    // 1. 跨尝试复用同一条 record。上一上游可能已写入失败终态，
    // 新尝试开始前必须恢复待结算状态，并清空上一尝试的响应与统计数据。
    const recordId = Number(record.id);
    await recordService.update(recordId, {
        status: SgRecordStatus.PROCESSING,
        vendor_id: vendor.id,
        vendor_model_name: vendorModelName,
        upstream_format: upstreamFormat !== clientFormat ? upstreamFormat : null,
        failed_code: null,
        response_data: null,
        usage: null,
        first_token_latency: null,
        end_at: null,
        base_cost: 0,
        cost: 0,
        settlement_status: "pending",
    });

    // 2. 构建上游请求 headers，过滤掉 Cloudflare 注入的 cf- 前缀 header
    // 并且必须排除客户端自带的鉴权 header，避免泄露或导致合并错误
    // 同时排除浏览器相关的元数据 header，避免上游校验失败
    const finalHeaders = new Headers();
    const EXCLUDED_HEADERS = [
        "authorization",
        "x-api-key",
        "x-goog-api-key",
        "anthropic-version",
        "content-length",
        "host",
        "origin",
        "referer",
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "cookie",
        "accept",
        "accept-encoding",
        "accept-language",
        "priority",
        "user-agent",
    ];

    for (const [key, value] of c.req.raw.headers.entries()) {
        const lowerKey = key.toLowerCase();
        if (
            !lowerKey.startsWith("cf-") &&
            !lowerKey.startsWith("sec-") &&
            !EXCLUDED_HEADERS.includes(lowerKey)
        ) {
            finalHeaders.set(key, value);
        }
    }

    const vendorAuthMode = vendor.auth_mode ?? vendor.config?.auth_mode ?? VendorAuthMode.BEARER_TOKEN;
    const vendorProxy = vendor.proxy !== undefined ? vendor.proxy : (vendor.config?.proxy ?? null);
    const vendorSkipTlsVerify = vendor.skip_tls_verify ?? vendor.config?.skip_tls_verify ?? false;

    if (upstreamFormat === ApiFormat.ANTHROPIC) {
        finalHeaders.set("anthropic-version", "2023-06-01");
        if (vendorAuthMode === VendorAuthMode.BEARER_TOKEN) {
            finalHeaders.set("Authorization", vendor.token.startsWith("Bearer ") ? vendor.token : `Bearer ${vendor.token}`);
        } else {
            finalHeaders.set("x-api-key", vendor.token);
        }
    } else {
        finalHeaders.set("Authorization", vendor.token.startsWith("Bearer ") ? vendor.token : `Bearer ${vendor.token}`);
    }

    // 强制设置 content-type
    finalHeaders.set("Content-Type", "application/json");

    // 3. 替换上游模型名
    let upstreamBody = body;
    // 显式上游替换成 vendor model 名；自动上游名与网关模型名一致，替换为无操作
    if (vendorModelName) {
        try {
            const bodyJson = JSON.parse(upstreamBody);
            bodyJson.model = vendorModelName;
            upstreamBody = JSON.stringify(bodyJson);
        } catch (e) {
            console.log("[senderService] Failed to substitute model name:", e);
        }
    }

    // 4. 应用插件 (转换前)
    const hostKey = await hostService.getHostKey();
    const prePluginBody = upstreamBody;
    upstreamBody = await pluginService.applyRequestPlugins(upstreamBody, clientFormat, hostKey, user.name);
    if (upstreamBody !== prePluginBody) {
        await requestActivityService.append(recordId, RequestActivityStage.PLUGIN, "应用请求插件（转换前）", {
            format: clientFormat,
            body_len_before: prePluginBody.length,
            body_len_after: upstreamBody.length,
        });
    }

    let converter: BaseConverter | null = null;
    if (needsConversion) {
        converter = ConverterFactory.create(clientFormat, upstreamFormat);
        if (!converter) {
            throw new customError.AppError(
                `Unsupported protocol conversion: ${clientFormat} → ${upstreamFormat}`,
                400,
            );
        }
        console.log(`[senderService] Using protocol converter: ${converter.constructor.name}, client=${clientFormat}, upstream=${upstreamFormat}`);
        upstreamBody = converter.convertRequestBody(upstreamBody);
        await requestActivityService.append(recordId, RequestActivityStage.CONVERSION, "协议转换", {
            from: clientFormat,
            to: upstreamFormat,
            converter: converter.constructor.name,
        });
    }

    let requestModel = "unknown";
    try {
        const parsedBody = JSON.parse(upstreamBody);
        requestModel = parsedBody.model || "unknown";
    } catch (e) {}
    converter?.updateModel(requestModel);

    // 5. OpenAI 流式请求注入 stream_options，让上游在最后一帧返回 usage
    if (upstreamFormat === ApiFormat.OPENAI) {
        try {
            const bodyJson = JSON.parse(upstreamBody);
            if (bodyJson.stream === true) {
                bodyJson.stream_options = { include_usage: true };
                upstreamBody = JSON.stringify(bodyJson);
            }
        } catch (e) {
            console.log("Failed to inject stream_options:", e);
        }
    }

    // 6. 应用插件 (转换后)
    if (needsConversion) {
        const prePostPluginBody = upstreamBody;
        upstreamBody = await pluginService.applyRequestPlugins(upstreamBody, upstreamFormat, hostKey, user.name);
        if (upstreamBody !== prePostPluginBody) {
            await requestActivityService.append(recordId, RequestActivityStage.PLUGIN, "应用请求插件（转换后）", {
                format: upstreamFormat,
                body_len_before: prePostPluginBody.length,
                body_len_after: upstreamBody.length,
            });
        }
    }

    await streamLogService.writeRequestLog(record, upstreamBody);

    // inspect 模式（专用测试接口使用）：把本次（最终命中的）上游实际请求快照注入 c，
    // 供调用方返回给前端展示。生产路径不带 inspect 标记，此处零开销。
    if (c.get("inspectUpstream")) {
        c.set("upstreamRequestSnapshot", {
            url,
            method: "POST",
            headers: sanitizeUpstreamHeaders(finalHeaders),
            body: upstreamBody,
            client_format: clientFormat,
            upstream_format: upstreamFormat,
            vendor: { id: vendor.id, name: vendor.name },
            vendor_model_name: vendorModelName,
            proxy: vendorProxy,
        });
    }

    // 7. 发起上游请求，拿到响应头后立即判断响应类型
    await requestActivityService.append(recordId, RequestActivityStage.UPSTREAM_ATTEMPT, "发起上游请求", {
        vendor_id: vendor.id,
        vendor_name: vendor.name,
        vendor_model_name: vendorModelName,
        url,
        upstream_format: upstreamFormat,
    });

    let upstreamRes: Response;
    try {
        // 如果该 vendor 配置了跳过 TLS 验证（内网自签证书场景），注入 undici Agent
        const dispatcher = await fetchUtil.getDispatcher({
            skip_tls_verify: vendorSkipTlsVerify,
            proxy: vendorProxy,
        });
        upstreamRes = await fetch(url, {
            method: "POST",
            headers: finalHeaders,
            body: upstreamBody,
            signal: c.req.raw.signal,
            // dispatcher 是 undici (Node.js) 特有选项，不在 Cloudflare Workers 的 RequestInit 类型定义中
            ...(dispatcher ? { dispatcher: dispatcher } as any : {}),
        });
    } catch (e: any) {
        console.error("Upstream fetch failed:", e);
        const failedCode = c.req.raw.signal.aborted
            ? FailedCode.CLIENT_DISCONNECTED
            : FailedCode.UPSTREAM_DISCONNECTED;
        await recordService.update(recordId, {
            status: SgRecordStatus.FAILED,
            failed_code: failedCode,
            response_data: String(e),
            settlement_status: "skipped",
            cost: 0,
            end_at: new Date(),
        });
        await requestActivityService.append(recordId, RequestActivityStage.UPSTREAM_ATTEMPT, failedCode === FailedCode.CLIENT_DISCONNECTED
            ? "客户端在上游响应前断开"
            : "上游请求失败", {
            vendor_id: vendor.id,
            vendor_name: vendor.name,
            url,
            failed_code: failedCode,
            error: e instanceof Error ? e.message : String(e),
        }, ActivityLevel.ERROR);
        onComplete?.();
        throw new UpstreamTransportError(e);
    }
    console.log("upstream response status:", upstreamRes.status);

    const isStream = upstreamRes.ok && isEventStreamResponse(upstreamRes);

    // 8. 按响应类型分发处理（三种协议统一走 responseHandlerService，按 clientFormat 选累加器/解析口径）
    if (isStream) {
        // 预检会推进转换器状态，必须使用独立实例；正式转换器只消费回放后的流。
        const probeConverter = needsConversion
            ? ConverterFactory.create(clientFormat, upstreamFormat)
            : null;
        probeConverter?.updateModel(requestModel);
        const preparedResponse = await responseHandlerService.prepareStreamResponse(
            c,
            upstreamRes,
            record,
            clientFormat,
            upstreamFormat,
            probeConverter,
        );
        let streamFailureReported = false;
        const reportStreamFailure = () => {
            if (streamFailureReported) return;
            streamFailureReported = true;
            upstreamHealthService.markFailure(vendor.id, vendorModelName, upstreamFormat);
        };
        return responseHandlerService.handleStreamResponse(
            c,
            preparedResponse,
            record,
            modelConfig,
            user,
            clientFormat,
            upstreamFormat,
            converter,
            () => {
                onComplete?.();
                onStreamComplete?.();
            },
            reportStreamFailure,
        );
    }
    return responseHandlerService.handleNonStreamResponse(c, upstreamRes, record, modelConfig, user, upstreamFormat, converter, onComplete);
}


async function sendRequest(
    c: Context,
    user: SgUser,
    modelConfig: SgModel,
    clientFormat: ApiFormat,
    body: string,
    options: { inspect?: boolean; skipBilling?: boolean } = {},
): Promise<Response> {
    // inspect 模式：在 c 上打标记，sendRequestToUpstream 据此把上游请求快照注入 c（供专用测试接口使用）
    if (options.inspect) {
        c.set("inspectUpstream", true);
    }
    if (options.skipBilling) {
        // 受保护的管理诊断接口可以复用真实路由池，但不扣管理员余额。
        // 该标记只由 route-test controller 设置，不能通过请求头或请求体注入。
        c.set("skipBilling", true);
    }

    const authContext = c.get("authContext") as AuthContext | null | undefined;
    if (!authContext) {
        throw new customError.AppError("Invalid API key", 401, "authentication_error");
    }
    const key = authContext.key;
    const keyLease = key
        ? concurrencyService.acquire("key", Number(key.id), Number(key.concurrency_limit ?? 0))
        : null;
    if (key && Number(key.concurrency_limit ?? 0) > 0 && !keyLease) {
        throw new customError.AppError("API key concurrency limit reached", 429, "rate_limit_error");
    }
    let keyReleased = false;
    const releaseKey = () => {
        if (keyReleased) return;
        keyReleased = true;
        keyLease?.release();
    };
    let streamLeasePending = false;

    try {
        // 预检：仅全局计费开启时检查余额（module_billing_enabled 关闭则完全不拦）。
        const billingEnabled = !options.skipBilling && await configService.isModuleBillingEnabled();
        const groupMultiplier = Math.max(0, Number(authContext?.group?.rate_multiplier ?? 1));
        const billingMode = modelConfig.prices?.billing_mode;
        const knownSingleCost = Number(modelConfig.prices?.per_request ?? 0);
        const requiresBalance = groupMultiplier > 0 && (
            billingMode === "per_request" || billingMode === "image"
                ? knownSingleCost > 0
                : modelConfig.hasBilling()
        );
        if (billingEnabled && user.balance < 0 && requiresBalance) {
            await recordService.recordFailedRequest(
                user.id >= 0 ? user.id : null,
                modelConfig.name,
                body,
                clientFormat,
                FailedCode.INSUFFICIENT_BALANCE,
                modelConfig.id,
                {
                    keyId: key?.id ?? null,
                    groupId: authContext?.group?.id ?? null,
                    requestedModel: modelConfig.name,
                    billingMode: typeof modelConfig.prices?.billing_mode === "string"
                        ? modelConfig.prices.billing_mode
                        : null,
                },
            );
            throw new customError.AppError("Insufficient balance", 400, "insufficient_balance");
        }

        // 一条用户请求 = 一条 record：进入路由循环前创建一次，跨上游尝试更新同一条记录
        const record = await recordService.create(user.id, modelConfig.id, body, clientFormat, {
            keyId: key?.id ?? null,
            groupId: authContext?.group?.id ?? null,
            requestedModel: modelConfig.name,
            billingMode: typeof modelConfig.prices?.billing_mode === "string"
                ? modelConfig.prices.billing_mode
                : null,
            rateMultiplier: Number(authContext?.group?.rate_multiplier ?? 1),
        });
        const recordId = Number(record.id);

        // 每个原始请求一个路由上下文，记录已用后端，避免重试循环
        const routingContext = new RoutingContext();
        let lastFailure: Response | null = null;

        while (true) {
            let routingResult: ModelRoutingResult;
            try {
                routingResult = await routingService.selectUpstream(
                    modelConfig,
                    clientFormat,
                    routingContext,
                    c,
                );
            } catch (e) {
                await recordService.update(recordId, {
                    status: SgRecordStatus.FAILED,
                    settlement_status: "skipped",
                    cost: 0,
                    end_at: new Date(),
                });
                throw e;
            }

            if (!routingResult.hasUpstream()) {
                const exhausted = lastFailure !== null;
                await recordService.update(recordId, {
                    status: SgRecordStatus.FAILED,
                    ...(exhausted ? {} : { failed_code: FailedCode.NO_AVAILABLE_UPSTREAM }),
                    settlement_status: "skipped",
                    cost: 0,
                    end_at: new Date(),
                });
                await requestActivityService.append(
                    recordId,
                    RequestActivityStage.ROUTING,
                    exhausted ? "所有上游均已尝试，无可用上游" : "无可用上游",
                    exhausted ? undefined : { failed_code: FailedCode.NO_AVAILABLE_UPSTREAM },
                    ActivityLevel.ERROR,
                );
                if (lastFailure) return lastFailure;
                throw new customError.AppError("No available upstream", 503);
            }

            const vendor = routingResult.vendor;
            const vendorModelName = routingResult.vendorModelName;
            const upstreamFormat = routingResult.upstreamFormat;

            await requestActivityService.append(recordId, RequestActivityStage.ROUTING, "路由选择", {
                strategy: "priority_weight",
                priority: routingResult.priority,
                weight: routingResult.weight,
                client: { model: modelConfig.name, format: clientFormat },
                upstream: {
                    vendor: vendor.name,
                    vendor_model: vendorModelName,
                    format: upstreamFormat,
                },
            });

            const vendorConcurrency = Number(vendor.concurrency ?? vendor.config?.concurrency ?? 0);
            const vendorLease = concurrencyService.acquire("vendor", Number(vendor.id), vendorConcurrency);
            if (vendorConcurrency > 0 && !vendorLease) {
                routingContext.markTried(vendor.id, vendorModelName, upstreamFormat);
                await requestActivityService.append(recordId, RequestActivityStage.ROUTING, "供应商并发已满", {
                    vendor_id: vendor.id,
                    concurrency: vendorConcurrency,
                }, ActivityLevel.WARN);
                continue;
            }
            let vendorReleased = false;
            const releaseVendor = () => {
                if (vendorReleased) return;
                vendorReleased = true;
                vendorLease?.release();
            };

            try {
                const response = await sendRequestToUpstream(
                    c,
                    user,
                    modelConfig,
                    record,
                    vendor,
                    vendorModelName,
                    clientFormat,
                    upstreamFormat,
                    body,
                    releaseVendor,
                    releaseKey,
                );

                if (!response.ok) {
                    throw new UpstreamResponseError(response);
                }

                const isStream = isEventStreamResponse(response);
                if (isStream) {
                    // 返回 SSE 后由后台收尾器持有并释放两个并发租约。
                    streamLeasePending = true;
                } else {
                    releaseVendor();
                    releaseKey();
                }
                return response;
            } catch (e: any) {
                releaseVendor();
                const retryableUpstreamError = isRetryableUpstreamError(e);
                if (c.req.raw.signal.aborted || !retryableUpstreamError) {
                    const hasSuccessfulSettlement = record.status === SgRecordStatus.SUCCESS
                        && (record.settlement_status === "settled"
                            || record.settlement_status === "skipped");
                    // 结算错误由 responseHandler 管理终态；重读失败时提交结果仍未知，
                    // 此处不得用 skipped/零费用覆盖可能已提交的扣款。
                    if (!hasSuccessfulSettlement && e?.code !== "billing_error") {
                        await recordService.update(recordId, {
                            status: SgRecordStatus.FAILED,
                            settlement_status: "skipped",
                            cost: 0,
                            end_at: new Date(),
                        }).catch(() => undefined);
                    }
                    throw e;
                }

                const httpFailure = e instanceof UpstreamResponseError;
                const failureStatus = httpFailure
                    ? e.response.status
                    : (e instanceof RetryableUpstreamResponseError ? e.statusCode : null);
                if (upstreamHealthService.shouldMarkFailure(failureStatus)) {
                    upstreamHealthService.markFailure(vendor.id, vendorModelName, upstreamFormat);
                }
                routingContext.markTried(vendor.id, vendorModelName, upstreamFormat);

                // 规范化模型路由始终允许故障转移，不再读取旧模型级开关。
                lastFailure = httpFailure
                    ? e.response
                    : buildUpstreamFailureResponse(c, e);
                c.status(200);
            }
        }
    } finally {
        // 流式收尾器会在消费完响应体后释放 Key；其余路径在此处或非流式处理器中释放。
        if (!streamLeasePending) releaseKey();
    }
}

export { UpstreamResponseError, UpstreamTransportError, isRetryableUpstreamError, isEventStreamResponse };
export default {
    sendRequest,
};
