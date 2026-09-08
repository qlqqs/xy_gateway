import { SgVendor } from "../model/sgVendor";
import { ApiFormat, VendorAuthMode } from "../constants";
import customError from "../util/customErrorUtil";
import vendorManager from "../manager/vendorManager";
import vendorModelManager from "../manager/vendorModelManager";
import modelUpstreamManager from "../manager/modelUpstreamManager";
import modelManager from "../manager/modelManager";
import userGroupManager from "../manager/userGroupManager";
import ormService from "./ormService";


const DOMAIN_STRING_FIELDS = ["supplier_name", "channel_code", "remark"] as const;


function hasOwn(value: unknown, key: string): boolean {
    return !!value
        && typeof value === "object"
        && Object.prototype.hasOwnProperty.call(value, key);
}


function toPositiveGroupId(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") {
        return Number.isSafeInteger(value) && value > 0 ? value : null;
    }
    if (typeof value === "string" && /^\+?\d+$/.test(value.trim())) {
        const number = Number(value);
        return Number.isSafeInteger(number) && number > 0 ? number : null;
    }
    return null;
}


function normalizeGroupIds(value: unknown): number[] {
    if (!Array.isArray(value)) {
        throw new customError.AppError("group_ids must be an array of positive integers");
    }
    const normalized: number[] = [];
    for (const rawGroupId of value) {
        const groupId = toPositiveGroupId(rawGroupId);
        if (groupId === null) {
            throw new customError.AppError("group_ids must be an array of positive integers");
        }
        if (!normalized.includes(groupId)) normalized.push(groupId);
    }
    return normalized;
}


function normalizeAvailableModels(value: unknown, fieldName = "available_models"): string[] {
    if (!Array.isArray(value)) {
        throw new customError.AppError(`${fieldName} must be an array of non-empty strings`);
    }
    const normalized: string[] = [];
    for (const rawModel of value) {
        if (typeof rawModel !== "string" || !rawModel.trim()) {
            throw new customError.AppError(`${fieldName} must be an array of non-empty strings`);
        }
        const model = rawModel.trim();
        if (!normalized.includes(model)) normalized.push(model);
    }
    return normalized;
}


/**
 * 合并供应商的部分配置更新，同时保留调用方对分组字段的明确意图。
 * 显式传入 `group_ids` 时以它为准；否则显式 `group_id` 会替换原数组，
 * 包括传入 null 解绑的场景。
 */
function mergeDomainConfig(
    currentConfig: Record<string, any>,
    incomingConfig: Record<string, any>,
    incomingRaw: unknown,
): Record<string, any> {
    const merged: Record<string, any> = { ...currentConfig, ...incomingConfig };
    if (hasOwn(incomingRaw, "group_ids")
        && (incomingRaw as Record<string, any>).group_ids !== undefined) {
        merged.group_ids = incomingConfig.group_ids;
        merged.group_id = incomingConfig.group_id;
    } else if (hasOwn(incomingRaw, "group_id")
        && (incomingRaw as Record<string, any>).group_id !== undefined) {
        delete merged.group_ids;
        merged.group_id = incomingConfig.group_id;
    }

    // 两类 API 协议互斥。管理端更新是部分更新，切换为 Anthropic 时必须清理
    // 旧 OpenAI 协议；反向切换且未传新值时则补上确定的默认协议。
    if (incomingConfig.api_type === "anthropic") {
        delete merged.openai_protocol;
    } else if (incomingConfig.api_type === "openai"
        && currentConfig.api_type !== "openai"
        && !hasOwn(incomingRaw, "openai_protocol")) {
        merged.openai_protocol = "chat_completions";
    }
    return normalizeDomainConfig(merged);
}


/**
 * 规范化管理表单传入的供应商领域字段。
 * 可选空字符串统一表示为 null，确保数据库唯一约束与 API 使用同一语义。
 */
function normalizeDomainConfig(config: unknown): Record<string, any> {
    if (config === undefined || config === null) return {};
    if (typeof config !== "object" || Array.isArray(config)) {
        throw new customError.AppError("config must be an object");
    }
    const normalized: Record<string, any> = { ...(config as Record<string, any>) };
    for (const field of DOMAIN_STRING_FIELDS) {
        if (normalized[field] === undefined || normalized[field] === null) continue;
        if (typeof normalized[field] !== "string") {
            throw new customError.AppError(`${field} must be a string`);
        }
        const value = normalized[field].trim();
        normalized[field] = field === "channel_code" && value.length === 0 ? null : value;
    }

    if (normalized.group_ids !== undefined) {
        normalized.group_ids = normalizeGroupIds(normalized.group_ids);
        normalized.group_id = normalized.group_ids[0] ?? null;
    } else if (normalized.group_id !== undefined) {
        if (normalized.group_id === null) {
            normalized.group_ids = [];
        } else {
            const groupId = toPositiveGroupId(normalized.group_id);
            if (groupId === null) {
                throw new customError.AppError("group_id must be null or a positive integer");
            }
            normalized.group_id = groupId;
            normalized.group_ids = [groupId];
        }
    }
    if (normalized.available_models !== undefined) {
        normalized.available_models = normalizeAvailableModels(normalized.available_models);
    }
    return normalized;
}


/**
 * 校验代理配置：代理类型与 URL scheme 必须匹配
 */
function validateProxyConfig(config?: Record<string, any>): void {
    const proxy = config?.proxy;
    if (proxy === undefined || proxy === null) return;
    if (typeof proxy !== "object" || Array.isArray(proxy)) {
        throw new customError.AppError("proxy must be an object or null");
    }
    if (!proxy.url || typeof proxy.url !== "string") {
        throw new customError.AppError("proxy.url must be a non-empty string");
    }
    if (proxy.type !== "http" && proxy.type !== "socks5") {
        throw new customError.AppError("proxy.type must be http or socks5");
    }

    const url = proxy.url as string;
    const isSocks = url.startsWith("socks");

    if (proxy.type === "http" && isSocks) {
        throw new customError.AppError("代理类型为 HTTP，但 URL 使用了 SOCKS 协议");
    }
    if (proxy.type === "socks5" && !isSocks) {
        throw new customError.AppError("代理类型为 SOCKS5，但 URL 不是 SOCKS 协议");
    }
}


async function createVendor(vendor: SgVendor): Promise<SgVendor> {
    const modelIds = normalizeAvailableModels(
        vendor.config?.available_models ?? vendor.available_models ?? [],
    );
    vendor.fill({
        config: {
            ...normalizeDomainConfig(vendor.config?.toJSON?.() ?? {}),
            available_models: modelIds,
        },
    });
    const knex = ormService.getKnex();

    const persist = async (db: any): Promise<void> => {
        await vendor.save({ client: db });
        await vendorModelManager.syncByVendorWithConnection(db, Number(vendor.id), modelIds);
    };

    if (ormService.isWorker) {
        try {
            await persist(knex);
        } catch (error) {
            if (Number.isSafeInteger(Number(vendor.id)) && Number(vendor.id) > 0) {
                await knex("vendor_model").where("vendor_id", Number(vendor.id)).delete().catch(() => undefined);
                await knex("vendor").where("id", Number(vendor.id)).delete().catch(() => undefined);
            }
            throw error;
        }
    } else {
        await knex.transaction(persist);
    }

    const created = await vendorManager.findById(Number(vendor.id));
    if (!created) throw new customError.NotFoundError("Vendor not found");
    return created;
}


async function updateVendor(
    vendorId: number,
    data: { type?: string; name?: string; token?: string; urls?: Record<string, string>; config?: Record<string, any> },
): Promise<SgVendor | null> {
    const vendor = await vendorManager.findById(vendorId);

    if (!vendor) {
        return null;
    }

    if (data.name !== undefined && (typeof data.name !== "string" || !data.name.trim())) {
        throw new customError.AppError("Vendor name cannot be empty");
    }
    if (data.token !== undefined && (typeof data.token !== "string" || !data.token.trim())) {
        throw new customError.AppError("Vendor token cannot be empty");
    }

    const incomingConfig = normalizeDomainConfig(data.config);
    validateProxyConfig(incomingConfig);
    const currentConfig = normalizeDomainConfig(vendor.config?.toJSON?.() ?? {});
    const mergedConfig: Record<string, any> = mergeDomainConfig(
        currentConfig,
        incomingConfig,
        data.config,
    );
    const shouldSyncModels = hasOwn(data.config, "available_models");
    const modelIds = shouldSyncModels
        ? normalizeAvailableModels(mergedConfig.available_models)
        : [];

    validateSchedulingConfig(mergedConfig);
    await validateDomainConfig(mergedConfig, vendorId);

    const updateData: any = {
        type: data.type ?? vendor.type,
        name: data.name === undefined ? vendor.name : data.name.trim(),
        token: data.token === undefined ? vendor.token : data.token.trim(),
    };

    // query().update() 是裸 SQL 拼接，不走 casts，对象类型字段需手动序列化
    if (data.urls !== undefined) {
        updateData.urls = JSON.stringify(data.urls);
    }

    if (data.config !== undefined) {
        updateData.config = JSON.stringify(mergedConfig);
        // query().update() 不经过 Sutando cast，因此所有正式字段都需显式序列化。
        updateData.auth_mode = mergedConfig.auth_mode ?? vendor.auth_mode ?? "bearer_token";
        updateData.skip_tls_verify = mergedConfig.skip_tls_verify ?? vendor.skip_tls_verify ?? false;
        updateData.proxy = mergedConfig.proxy === undefined ? null : JSON.stringify(mergedConfig.proxy);
        updateData.supplier_name = mergedConfig.supplier_name ?? null;
        updateData.channel_code = mergedConfig.channel_code ?? null;
        updateData.api_type = mergedConfig.api_type ?? null;
        updateData.openai_protocol = mergedConfig.openai_protocol ?? null;
        updateData.status = mergedConfig.status ?? vendor.status ?? "active";
        updateData.remark = mergedConfig.remark ?? null;
        updateData.available_models = JSON.stringify(mergedConfig.available_models ?? []);
        updateData.concurrency = mergedConfig.concurrency ?? vendor.concurrency ?? 1;
        updateData.load_factor = mergedConfig.load_factor ?? null;
        updateData.priority = mergedConfig.priority ?? vendor.priority ?? 1;
        updateData.group_id = Array.isArray(mergedConfig.group_ids)
            ? (mergedConfig.group_ids[0] ?? null)
            : (mergedConfig.group_id ?? null);
    }

    const knex = ormService.getKnex();
    const persist = async (db: any): Promise<void> => {
        await findVendorRow(db, vendorId, !ormService.isWorker);
        await db("vendor").where("id", vendorId).update(updateData);
        if (shouldSyncModels) {
            await vendorModelManager.syncByVendorWithConnection(db, vendorId, modelIds);
        }
    };

    if (ormService.isWorker) {
        const previousModels = shouldSyncModels
            ? (await vendorModelManager.listByVendor(vendorId)).map(model => String(model.model_id))
            : [];
        const attributes = vendor.getAttributes() as Record<string, unknown>;
        const restoreData = Object.fromEntries(
            Object.keys(updateData).map(key => [key, attributes[key] ?? null]),
        );
        try {
            await persist(knex);
        } catch (error) {
            await knex("vendor").where("id", vendorId).update(restoreData).catch(() => undefined);
            if (shouldSyncModels) {
                await vendorModelManager.syncByVendorWithConnection(knex, vendorId, previousModels)
                    .catch(() => undefined);
            }
            throw error;
        }
    } else {
        await knex.transaction(persist);
    }

    return await vendorManager.findById(vendorId);
}


async function findVendorRow(db: any, vendorId: number, lock: boolean): Promise<Record<string, unknown>> {
    let query = db("vendor").where("id", vendorId);
    if (lock && process.env.DB_DRIVER === "mysql") {
        query = query.forUpdate();
    }
    const row = await query.first();
    if (!row) throw new customError.NotFoundError("Vendor not found");
    return row as Record<string, unknown>;
}


/** 在同一数据库连接中同步模型差异以及供应商的模型配置投影。 */
async function syncVendorModelsWithConnection(
    db: any,
    vendorId: number,
    modelIds: string[],
    row?: Record<string, unknown>,
): Promise<void> {
    const currentRow = row ?? await findVendorRow(db, vendorId, false);
    const current = new SgVendor(currentRow);
    const config = {
        ...current.config.toJSON(),
        available_models: modelIds,
    };

    await vendorModelManager.syncByVendorWithConnection(db, vendorId, modelIds);
    await db("vendor").where("id", vendorId).update({
        config: JSON.stringify(config),
        available_models: JSON.stringify(modelIds),
    });
}


async function syncVendorModels(
    vendorId: number,
    modelIds: unknown,
): Promise<Awaited<ReturnType<typeof vendorModelManager.listByVendor>>> {
    const normalized = normalizeAvailableModels(modelIds, "model_ids");
    const knex = ormService.getKnex();

    if (ormService.isWorker) {
        const row = await knex("vendor").where("id", vendorId).first();
        if (!row) throw new customError.NotFoundError("Vendor not found");
        const previousModels = (await vendorModelManager.listByVendor(vendorId))
            .map(model => String(model.model_id));
        try {
            await syncVendorModelsWithConnection(knex, vendorId, normalized, row);
        } catch (error) {
            await knex("vendor").where("id", vendorId).update({
                config: row.config,
                available_models: row.available_models,
            }).catch(() => undefined);
            await vendorModelManager.syncByVendorWithConnection(knex, vendorId, previousModels)
                .catch(() => undefined);
            throw error;
        }
    } else {
        await knex.transaction(async (transaction: any) => {
            const row = await findVendorRow(transaction, vendorId, true);
            await syncVendorModelsWithConnection(transaction, vendorId, normalized, row);
        });
    }
    return await vendorModelManager.listByVendor(vendorId);
}


async function addVendorModel(vendorId: number, modelId: string) {
    if (typeof modelId !== "string" || !modelId.trim()) {
        throw new customError.AppError("model_id is required");
    }
    const normalizedModelId = modelId.trim();
    const knex = ormService.getKnex();

    if (ormService.isWorker) {
        const existing = await vendorModelManager.listByVendor(vendorId);
        if (existing.some(model => String(model.model_id) === normalizedModelId)) {
            throw new customError.AppError("Model already exists", 409);
        }
        await syncVendorModels(vendorId, [
            ...existing.map(model => String(model.model_id)),
            normalizedModelId,
        ]);
    } else {
        await knex.transaction(async (transaction: any) => {
            const row = await findVendorRow(transaction, vendorId, true);
            const existing = await transaction("vendor_model")
                .where("vendor_id", vendorId)
                .orderBy("model_id", "asc")
                .select("model_id");
            if (existing.some((model: any) => String(model.model_id) === normalizedModelId)) {
                throw new customError.AppError("Model already exists", 409);
            }
            await syncVendorModelsWithConnection(
                transaction,
                vendorId,
                [...existing.map((model: any) => String(model.model_id)), normalizedModelId],
                row,
            );
        });
    }

    return await vendorModelManager.findByVendorAndModel(vendorId, normalizedModelId);
}


async function removeVendorModel(vendorId: number, recordId: number): Promise<boolean> {
    const knex = ormService.getKnex();

    if (ormService.isWorker) {
        const target = await vendorModelManager.findVendorModel(recordId, vendorId);
        if (!target) return false;
        const existing = await vendorModelManager.listByVendor(vendorId);
        await syncVendorModels(
            vendorId,
            existing
                .filter(model => Number(model.id) !== recordId)
                .map(model => String(model.model_id)),
        );
        return true;
    }

    return await knex.transaction(async (transaction: any) => {
        const row = await findVendorRow(transaction, vendorId, true);
        const target = await transaction("vendor_model")
            .where("id", recordId)
            .where("vendor_id", vendorId)
            .first();
        if (!target) return false;
        const existing = await transaction("vendor_model")
            .where("vendor_id", vendorId)
            .where("id", "!=", recordId)
            .orderBy("model_id", "asc")
            .select("model_id");
        await syncVendorModelsWithConnection(
            transaction,
            vendorId,
            existing.map((model: any) => String(model.model_id)),
            row,
        );
        return true;
    });
}

async function validateDomainConfig(config: Record<string, any>, excludeVendorId?: number): Promise<void> {
    const normalized = normalizeDomainConfig(config);
    if (normalized.channel_code !== undefined && normalized.channel_code !== null) {
        const duplicate = await vendorManager.findByChannelCode(normalized.channel_code, excludeVendorId);
        if (duplicate) throw new customError.AppError("channel_code already exists", 409);
    }
    if (normalized.group_ids !== undefined) {
        for (const groupId of normalized.group_ids) {
            if (!await userGroupManager.findById(Number(groupId))) {
                throw new customError.NotFoundError("User group not found");
            }
        }
    } else if (normalized.group_id !== undefined && normalized.group_id !== null) {
        if (!await userGroupManager.findById(Number(normalized.group_id))) {
            throw new customError.NotFoundError("User group not found");
        }
    }
    if (normalized.status !== undefined && normalized.status !== "active" && normalized.status !== "disabled") {
        throw new customError.AppError("status must be active or disabled");
    }
    if (normalized.skip_tls_verify !== undefined && typeof normalized.skip_tls_verify !== "boolean") {
        throw new customError.AppError("skip_tls_verify must be a boolean");
    }
    if (normalized.auth_mode !== undefined
        && normalized.auth_mode !== VendorAuthMode.API_KEY
        && normalized.auth_mode !== VendorAuthMode.BEARER_TOKEN) {
        throw new customError.AppError("auth_mode is invalid");
    }
    if (normalized.api_type !== undefined && normalized.api_type !== null
        && normalized.api_type !== "openai" && normalized.api_type !== "anthropic") {
        throw new customError.AppError("api_type is invalid");
    }
    if (normalized.openai_protocol !== undefined && normalized.openai_protocol !== null
        && normalized.openai_protocol !== "chat_completions" && normalized.openai_protocol !== "responses") {
        throw new customError.AppError("openai_protocol is invalid");
    }
    // `openai_protocol` has meaning only for an OpenAI-compatible channel.
    // Rejecting contradictory combinations here prevents a persisted vendor
    // from advertising one protocol while the URL/configuration describes
    // another.  A missing protocol remains valid for imported/legacy rows and
    // is interpreted as Chat Completions by the model's capability resolver.
    if (normalized.api_type === "anthropic" && normalized.openai_protocol != null) {
        throw new customError.AppError("openai_protocol is only valid for api_type=openai");
    }
    if ((normalized.api_type === undefined || normalized.api_type === null)
        && normalized.openai_protocol != null) {
        throw new customError.AppError("api_type=openai is required when openai_protocol is set");
    }
    if (normalized.available_models !== undefined
        && (!Array.isArray(normalized.available_models)
            || normalized.available_models.some((model: unknown) => typeof model !== "string"))) {
        throw new customError.AppError("available_models must be an array of strings");
    }
    validateProxyConfig(normalized);
}

function validateSchedulingConfig(config?: Record<string, any>): void {
    if (!config) return;
    const concurrency = config.concurrency ?? 1;
    const priority = config.priority ?? 1;
    const loadFactor = config.load_factor;
    if (typeof concurrency !== "number" || !Number.isSafeInteger(concurrency) || concurrency < 1) {
        throw new customError.AppError("concurrency must be a positive integer");
    }
    if (typeof priority !== "number" || !Number.isSafeInteger(priority) || priority < 1) {
        throw new customError.AppError("priority must be a positive integer");
    }
    if (loadFactor !== null && loadFactor !== undefined
        && (typeof loadFactor !== "number" || !Number.isFinite(loadFactor) || loadFactor < 1)) {
        throw new customError.AppError("load_factor must be null or a number >= 1");
    }
    if (config.group_id !== null && config.group_id !== undefined
        && (typeof config.group_id !== "number" || !Number.isSafeInteger(config.group_id) || config.group_id <= 0)) {
        throw new customError.AppError("group_id must be null or a positive integer");
    }
    if (config.group_ids !== undefined
        && (!Array.isArray(config.group_ids)
            || config.group_ids.some((groupId: unknown) =>
                typeof groupId !== "number" || !Number.isSafeInteger(groupId) || groupId <= 0))) {
        throw new customError.AppError("group_ids must be an array of positive integers");
    }
}

async function findVendorByUrl(gatewayUrl: string, protocol: ApiFormat): Promise<number | null> {
    if (!gatewayUrl) return null;

    const vendors = await vendorManager.listAll();
    for (const vendor of vendors) {
        const mergedUrls = vendor.getMergedUrls();
        let vendorUrl: string | undefined;

        if (protocol === ApiFormat.RESPONSES) {
            vendorUrl = mergedUrls[ApiFormat.RESPONSES] || mergedUrls[ApiFormat.OPENAI];
        } else {
            vendorUrl = mergedUrls[protocol];
        }

        if (vendorUrl && gatewayUrl.startsWith(vendorUrl)) {
            return Number(vendor.id);
        }
    }

    return null;
}

/**
 * Remove a vendor and reconcile every normalized model mapping that points to
 * it.  Empty models are disabled instead of retaining a dead route.
 */
async function deleteVendor(vendorId: number): Promise<boolean> {
    const vendor = await vendorManager.findById(vendorId);
    if (!vendor) return false;

    const mappings = await modelUpstreamManager.listByVendor(vendorId);
    const affectedModelIds = [...new Set(mappings.map(item => Number(item.model_id)))];
    await modelUpstreamManager.removeByVendor(vendorId);
    await modelManager.disableWithoutUpstreams(affectedModelIds);
    await vendorModelManager.removeByVendor(vendorId);
    return await vendorManager.deleteById(vendorId);
}


const NON_LLM_PATTERNS = [
    /embedding/i,
    /rerank/i,
    /\btts\b/i,
    /text-to-speech/i,
    /speech-to-text/i,
    /whisper/i,
    /dall-e/i,
    /stable-diffusion/i,
    /image/i,
    /image2video/i,
    /video-gen/i,
    /video/i,
    /ocr/i,
    /livetranslate/i,
    /realtime-asr/i,
    /moderation/i,
    /^wanx/i,
    /^wan\d/i,
    /^cosyvoice/i,
    /^sensevoice/i,
    /^sambert/i,
    /^paraformer/i,
];

function isLlmModel(modelId: string): boolean {
    return !NON_LLM_PATTERNS.some(pattern => pattern.test(modelId));
}


function resolveModelListTarget(vendor: SgVendor): { format: ApiFormat; sourceUrl: string } {
    const apiType = vendor.api_type ?? vendor.config?.api_type;
    const openaiProtocol = vendor.openai_protocol ?? vendor.config?.openai_protocol;
    const formats = apiType === "anthropic"
        ? [ApiFormat.ANTHROPIC]
        : apiType === "openai"
            ? [openaiProtocol === "responses" ? ApiFormat.RESPONSES : ApiFormat.OPENAI]
            : [ApiFormat.OPENAI, ApiFormat.RESPONSES, ApiFormat.ANTHROPIC];

    for (const format of formats) {
        const sourceUrl = vendor.getUrlByFormat(format);
        if (sourceUrl !== null) return { format, sourceUrl };
    }

    throw new customError.AppError("vendor does not have a URL for fetching models", 400);
}


function buildModelListUrl(sourceUrl: string): string {
    let url: URL;
    try {
        url = new URL(sourceUrl);
    } catch {
        throw new customError.AppError("vendor model list URL is invalid", 400);
    }

    const pathname = url.pathname.replace(/\/+$/, "");
    const siblingPath = pathname.replace(/\/(?:chat\/completions|responses|messages|models)$/i, "/models");
    url.pathname = siblingPath === pathname ? `${pathname}/models` : siblingPath;
    url.hash = "";
    return url.toString();
}


function buildModelListHeaders(vendor: SgVendor, format: ApiFormat): Headers {
    const token = typeof vendor.token === "string" ? vendor.token.trim() : "";
    if (!token) {
        throw new customError.AppError("vendor token is required", 400);
    }

    const headers = new Headers({ Accept: "application/json" });
    const authMode = vendor.auth_mode ?? vendor.config?.auth_mode ?? VendorAuthMode.BEARER_TOKEN;
    if (format === ApiFormat.ANTHROPIC) {
        headers.set("anthropic-version", "2023-06-01");
        if (authMode === VendorAuthMode.API_KEY) {
            headers.set("x-api-key", token);
        } else {
            headers.set("Authorization", token.startsWith("Bearer ") ? token : `Bearer ${token}`);
        }
    } else {
        headers.set("Authorization", token.startsWith("Bearer ") ? token : `Bearer ${token}`);
    }
    return headers;
}


function parseUpstreamModelIds(value: unknown): string[] {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const data = (value as { data?: unknown }).data;
    if (!Array.isArray(data)) return [];

    const modelIds = data.flatMap(item => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const id = (item as { id?: unknown }).id;
        if (typeof id !== "string") return [];
        const normalized = id.trim();
        return normalized && isLlmModel(normalized) ? [normalized] : [];
    });
    return [...new Set(modelIds)];
}


/**
 * 从上游 API 获取模型列表
 */
export async function fetchUpstreamModels(vendor: SgVendor): Promise<string[]> {
    const target = resolveModelListTarget(vendor);
    const modelsUrl = buildModelListUrl(target.sourceUrl);
    const headers = buildModelListHeaders(vendor, target.format);

    try {
        const response = await fetch(modelsUrl, {
            method: "GET",
            headers,
        });

        if (!response.ok) {
            const text = await response.text();
            throw new customError.AppError(
                `Upstream returned ${response.status}: ${text}`,
                502,
            );
        }

        return parseUpstreamModelIds(await response.json());
    } catch (error: unknown) {
        if (error instanceof customError.AppError) throw error;
        const message = error instanceof Error ? error.message : "Unknown upstream error";
        throw new customError.AppError(`Failed to fetch models: ${message}`, 502);
    }
}


export default {
    normalizeDomainConfig,
    createVendor,
    updateVendor,
    syncVendorModels,
    addVendorModel,
    removeVendorModel,
    findVendorByUrl,
    deleteVendor,
    fetchUpstreamModels,
    validateProxyConfig,
    validateSchedulingConfig,
    validateDomainConfig,
};
