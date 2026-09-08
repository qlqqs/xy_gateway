import { Context } from "hono";
import { ApiFormat } from "../constants";
import { SgModel } from "../model/sgModel";
import modelManager from "../manager/modelManager";
import modelService from "../service/modelService";
import sender from "../service/senderService";
import customError from "../util/customErrorUtil";
import idUtil from "../util/idUtil";
import { createListResponse, parsePaginationQuery } from "../util/paginationUtil";
import accessPolicyService from "../service/accessPolicyService";
import routingService from "../service/routingService/core";
import RoutingContext from "../service/routingService/routingContext";


function parseJsonLike(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}


// 构建模型路由测试的客户端请求体（与前端 runRoutingTest 原请求一致）
function buildTestRequestBody(format: ApiFormat, model: string): string {
    if (format === ApiFormat.ANTHROPIC) {
        return JSON.stringify({
            model,
            messages: [{ role: "user", content: "你好" }],
            max_tokens: 256,
        });
    }
    if (format === ApiFormat.RESPONSES) {
        return JSON.stringify({
            model,
            input: "你好",
            max_output_tokens: 256,
        });
    }
    return JSON.stringify({
        model,
        messages: [{ role: "user", content: "你好" }],
        max_tokens: 256,
        stream: false,
    });
}


function serializeModel(model: any) {
    const mapping = model.getMapping ? model.getMapping() : (model.mapping ?? { upstreams: [] });
    return {
        id: Number(model.id),
        name: model.name,
        // `sort_order` is an internal persistence detail.  The frontend owns
        // array order and should receive the canonical mapping contract only.
        mapping: {
            upstreams: (mapping.upstreams ?? []).map((upstream: any) => ({
                vendor_id: Number(upstream.vendor_id),
                ...(upstream.vendor_model_id === undefined || upstream.vendor_model_id === null
                    ? {}
                    : { vendor_model_id: Number(upstream.vendor_model_id) }),
                enabled: Boolean(upstream.enabled),
            })),
        },
        enable: Boolean(model.enable),
        prices: model.prices ?? {},
        created_at: model.created_at,
        updated_at: model.updated_at,
    };
}


async function createModel(c: Context) {
    const body = await c.req.json();
    const instance = await modelService.createModel(body);

    console.log("[modelController] Model created successfully:", instance);
    return c.json(serializeModel(instance));
}


async function listModels(c: Context) {
    const query = c.req.query();
    const { pageSize, offset } = parsePaginationQuery(query);
    const vendorId = query.vendor_id
        ? idUtil.requirePositiveInteger(query.vendor_id)
        : undefined;
    const result = await modelManager.listModels({
        vendorId,
        keyword: query.keyword,
        pageSize,
        offset,
    });
    return c.json(createListResponse(result.list.map(serializeModel), result.total));
}


async function listLlmModels(c: Context) {
    const authContext = c.get("authContext");
    if (!authContext) {
        throw new customError.AppError("Invalid token", 401, "authentication_error");
    }
    const entities = await modelManager.listEnabledModelEntities();
    const format = c.get("api_format") ?? ApiFormat.OPENAI;
    const visible = accessPolicyService.visibleModels(entities, authContext, format);
    // 复用规范选择器，使模型列表与真实请求使用相同的分组、协议和健康冷却规则。
    // 每个模型使用独立路由上下文，因为选择器会把已选上游标记为已尝试。
    const models = (await Promise.all(visible.map(async model => {
        const candidate = await routingService.selectUpstream(
            model,
            format,
            new RoutingContext(),
            c,
        );
        return candidate.hasUpstream() ? model : null;
    }))).filter((model): model is SgModel => model !== null);
    return c.json({
        object: "list",
        data: models.map(model => ({
            id: model.name,
            object: "model",
            created: Math.floor(new Date(model.created_at).getTime() / 1000),
            owned_by: "gateway",
        })),
    });
}


async function getModel(c: Context) {
    const modelId = idUtil.requirePositiveInteger(c.req.param("id"));

    const model = await modelManager.findById(modelId);

    if (!model) {
        throw new customError.NotFoundError("Model not found");
    }

    return c.json(serializeModel(model));
}

async function getModelsByIds(c: Context) {
    const body = await c.req.json();
    const ids = body.ids;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return c.json([]);
    }

    const idList = idUtil.normalizePositiveIntegers(ids);
    if (idList.length === 0) {
        return c.json([]);
    }

    const models = await modelManager.getByIds(idList);
    return c.json(models.map(serializeModel));
}


// 模型路由测试：走真实网关路由 + failover（senderService.sendRequest），返回上游实际请求快照与上游响应。
// sender 在 inspect 模式下把最终命中的上游请求注入 c（upstreamRequestSnapshot），此处读出并组装成
// 与供应商直连测试一致的 VendorTestResponse，前端据此展示请求详情。
async function testModelRoute(c: Context) {
    const bodyJson = await c.req.json().catch(() => ({}));
    const modelName = (bodyJson as any).model;
    const formatRaw = (bodyJson as any).format || "openai";

    if (!modelName) {
        throw new customError.AppError("model is required");
    }
    if (![ApiFormat.OPENAI, ApiFormat.ANTHROPIC, ApiFormat.RESPONSES].includes(formatRaw)) {
        throw new customError.AppError("format must be one of openai, anthropic, responses");
    }
    const format = formatRaw as ApiFormat;

    // requireAdmin 已经解析了统一 AuthContext；把它传入 sender。路由
    // 测试由管理员专用标记触发诊断池，不套用 LLM Key/分组/计费策略。
    const authContext = c.get("authContext");
    const user = authContext?.user;
    if (!user) {
        throw new customError.NotFoundError("User not found");
    }

    const modelConfig = await modelManager.getModel(modelName, true);
    if (!modelConfig) {
        return c.json({
            success: false,
            error: "model not found",
            url: null,
            request_method: "POST",
            request_headers: {},
            request_body: null,
        });
    }

    const body = buildTestRequestBody(format, modelName);
    const startTime = Date.now();

    let response: Response;
    try {
        response = await sender.sendRequest(c, user, modelConfig, format, body, {
            inspect: true,
            skipBilling: true,
        });
    } catch (e: any) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        const snapshot = c.get("upstreamRequestSnapshot") as any;
        c.status(200);
        return c.json({
            success: false,
            status: typeof e?.statusCode === "number"
                ? e.statusCode
                : (typeof e?.status === "number" ? e.status : undefined),
            duration: Date.now() - startTime,
            url: snapshot?.url ?? null,
            converted_from:
                snapshot && snapshot.client_format !== snapshot.upstream_format ? snapshot.client_format : undefined,
            converted_to:
                snapshot && snapshot.client_format !== snapshot.upstream_format ? snapshot.upstream_format : undefined,
            proxy: snapshot?.proxy ?? null,
            request_method: "POST",
            request_headers: snapshot?.headers ?? {},
            request_body: snapshot?.body ? parseJsonLike(snapshot.body) : null,
            error: errorMessage,
        });
    }

    const responseText = await response.text();
    const snapshot = c.get("upstreamRequestSnapshot") as any;
    c.status(200);
    return c.json({
        success: response.ok,
        status: response.status,
        duration: Date.now() - startTime,
        url: snapshot?.url ?? null,
        converted_from:
            snapshot && snapshot.client_format !== snapshot.upstream_format ? snapshot.client_format : undefined,
        converted_to:
            snapshot && snapshot.client_format !== snapshot.upstream_format ? snapshot.upstream_format : undefined,
        proxy: snapshot?.proxy ?? null,
        request_method: "POST",
        request_headers: snapshot?.headers ?? {},
        request_body: snapshot?.body ? parseJsonLike(snapshot.body) : null,
        response: parseJsonLike(responseText),
    });
}


async function updateModel(c: Context) {
    const modelId = idUtil.requirePositiveInteger(c.req.param("id"));

    const updatedModel = await modelService.updateModel(modelId, await c.req.json());

    if (!updatedModel) {
        throw new customError.NotFoundError("Model not found");
    }

    console.log("[modelController] Model updated successfully:", updatedModel);
    return c.json(serializeModel(updatedModel));
}


async function deleteModel(c: Context) {
    const modelId = idUtil.requirePositiveInteger(c.req.param("id"));

    const deleted = await modelService.deleteModel(modelId);

    if (!deleted) {
        throw new customError.NotFoundError("Model not found");
    }

    return c.json({ success: true });
}

export default {
    createModel,
    listModels,
    listLlmModels,
    getModel,
    getModelsByIds,
    testModelRoute,
    updateModel,
    deleteModel,
};
