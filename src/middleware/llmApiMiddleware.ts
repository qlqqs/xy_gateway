import { Context, MiddlewareHandler } from "hono";
import { ApiFormat, FailedCode } from "../constants";
import llmRequestService from "../service/llmRequestService";
import recordService from "../service/recordService";
import customError from "../util/customErrorUtil";
import authContextService from "../service/authContextService";
import accessPolicyService from "../service/accessPolicyService";
import ormService from "../service/ormService";


function extractLlmToken(c: Context): string {
    const authHeader = c.req.header("Authorization");
    if (authHeader) {
        const match = authHeader.match(/^Bearer\s+(\S+)\s*$/i);
        if (!match) {
            throw new customError.AppError("Invalid Authorization header", 401, "authentication_error");
        }
        return match[1];
    }

    const apiKey = c.req.header("x-api-key")?.trim();
    if (apiKey) {
        return apiKey;
    }

    const googleApiKey = c.req.header("x-goog-api-key")?.trim();
    if (googleApiKey) {
        return googleApiKey;
    }

    throw new customError.AppError(
        "Authorization or x-api-key header is missing",
        401,
        "authentication_error",
    );
}


function parseLlmRequestBody(body: string): string {
    let payload: unknown;
    try {
        payload = JSON.parse(body);
    } catch {
        throw new customError.AppError("Invalid JSON body", 400, "invalid_request_error");
    }

    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new customError.AppError("Request body must be a JSON object", 400, "invalid_request_error");
    }

    const modelName = (payload as Record<string, unknown>).model;
    if (typeof modelName !== "string" || modelName.trim() === "") {
        throw new customError.AppError("model parameter is missing or invalid", 400, "invalid_request_error");
    }

    return modelName;
}


function getClientIp(c: Context): string | null {
    if (ormService.isWorker) {
        return c.req.header("CF-Connecting-IP")?.trim() || null;
    }

    const env = c.env as {
        server?: { incoming?: { socket?: { remoteAddress?: string } } };
    };
    return env.server?.incoming?.socket?.remoteAddress?.trim() || null;
}

async function authenticateLlmContext(c: Context) {
    const token = extractLlmToken(c);
    return { token, authContext: await authContextService.resolve(token, c.env.ROOT_TOKEN) };
}


const requireLlmRequestContext = (format: ApiFormat): MiddlewareHandler => {
    return async (c: Context, next) => {
        c.set("api_format", format);
        const { authContext } = await authenticateLlmContext(c);
        if (!authContext) {
            throw new customError.AppError("Invalid API key", 401, "authentication_error");
        }

        const body = await c.req.text();
        const modelName = parseLlmRequestBody(body);
        const clientIp = getClientIp(c);
        // 查找模型前先执行身份、状态、IP、协议和模型白名单检查，避免向无权限 Key
        // 暴露模型是否存在；拿到模型后再执行依赖价格的余额与额度检查。
        await accessPolicyService.assertLlmAccess(
            authContext,
            format,
            modelName,
            clientIp,
            null,
        );
        const { modelConfig } = await llmRequestService.resolveContext(
            authContext.user.id >= 0 ? authContext.user.id : null,
            modelName,
            body,
            format,
            {
                keyId: authContext.key?.id ?? null,
                groupId: authContext.group?.id ?? null,
                requestedModel: modelName,
            },
        );
        try {
            await accessPolicyService.assertLlmAccess(
                authContext,
                format,
                modelName,
                clientIp,
                modelConfig,
            );
        } catch (error: any) {
            // 策略拒绝仍是一条用户请求。余额不足时先写失败记录，便于定位拒绝原因；
            // 此分支不会进入 sender，因此不会重复创建记录。
            if (error?.code === "insufficient_balance") {
                await recordService.recordFailedRequest(
                    authContext.user.id >= 0 ? authContext.user.id : null,
                    modelName,
                    body,
                    format,
                    FailedCode.INSUFFICIENT_BALANCE,
                    modelConfig.id,
                    {
                        keyId: authContext.key?.id ?? null,
                        groupId: authContext.group?.id ?? null,
                        requestedModel: modelName,
                        billingMode: typeof modelConfig.prices?.billing_mode === "string"
                            ? modelConfig.prices.billing_mode
                            : null,
                    },
                );
            }
            throw error;
        }

        c.set("user", authContext.user);
        c.set("authContext", authContext);
        c.set("requestBody", body);
        c.set("modelConfig", modelConfig);

        await next();
    };
};


const requireLlmModelsAuth: MiddlewareHandler = async (c: Context, next) => {
    c.set("api_format", ApiFormat.OPENAI);
    const { authContext } = await authenticateLlmContext(c);
    if (!authContext) {
        // 保留模型目录接口的历史错误文案；推理接口仍使用协议约定的 Invalid API key。
        throw new customError.AppError("Invalid token", 401, "authentication_error");
    }
    accessPolicyService.assertModelsAccess(authContext, ApiFormat.OPENAI, getClientIp(c));
    c.set("user", authContext.user);
    c.set("authContext", authContext);
    await next();
};

export default { requireLlmRequestContext, requireLlmModelsAuth };
