import { Context, MiddlewareHandler } from "hono";
import { ApiFormat, FailedCode } from "../constants";
import llmRequestService from "../service/llmRequestService";
import recordService from "../service/recordService";
import customError from "../util/customErrorUtil";
import authContextService from "../service/authContextService";
import accessPolicyService from "../service/accessPolicyService";


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
    // Cloudflare supplies a single trusted address.  For Node/Tauri deployments
    // use the conventional proxy headers when present and fall back to null;
    // policy code treats a missing address as not matching an enabled whitelist.
    const candidates = [
        c.req.header("CF-Connecting-IP"),
        c.req.header("X-Real-IP"),
        c.req.header("X-Forwarded-For")?.split(",")[0],
    ];
    return candidates.find(value => value?.trim())?.trim() ?? null;
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
        // Run identity/status/IP/protocol/model-whitelist gates before
        // looking up the model.  This keeps policy ordering deterministic and
        // avoids exposing model existence to a disabled/expired key.  The
        // second pass below adds the price-dependent balance/quota checks once
        // the model entity is available.
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
            // A policy rejection still represents a user request.  Persist
            // the balance failure before returning so operators can explain
            // why a request was denied; the sender is never reached in this
            // branch, so this cannot create a duplicate record.
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
        // Keep the catalogue endpoint's historical error wording; request
        // endpoints still use the protocol-standard "Invalid API key" below.
        throw new customError.AppError("Invalid token", 401, "authentication_error");
    }
    accessPolicyService.assertModelsAccess(authContext, ApiFormat.OPENAI, getClientIp(c));
    c.set("user", authContext.user);
    c.set("authContext", authContext);
    await next();
};

export default { requireLlmRequestContext, requireLlmModelsAuth };
