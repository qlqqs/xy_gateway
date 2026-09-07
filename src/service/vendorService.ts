import { SgVendor } from "../model/sgVendor";
import { ApiFormat, VendorAuthMode } from "../constants";
import customError from "../util/customErrorUtil";
import vendorManager from "../manager/vendorManager";
import vendorModelManager from "../manager/vendorModelManager";
import modelUpstreamManager from "../manager/modelUpstreamManager";
import modelManager from "../manager/modelManager";
import userGroupManager from "../manager/userGroupManager";


const DOMAIN_STRING_FIELDS = ["supplier_name", "channel_code", "remark"] as const;


/**
 * Normalize the vendor domain fields that arrive from the management form.
 * Empty optional strings are represented as NULL so the database uniqueness
 * constraint and the API have one canonical value.
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
    const mergedConfig: Record<string, any> = normalizeDomainConfig({ ...currentConfig, ...incomingConfig });

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
        // query().update() bypasses Sutando casts, so serialize every formal
        // domain column explicitly.  These columns are the runtime source of
        // truth; config is only the API transport object.
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
        updateData.group_id = mergedConfig.group_id ?? null;
    }

    return await vendorManager.update(vendorId, updateData);
}

async function validateDomainConfig(config: Record<string, any>, excludeVendorId?: number): Promise<void> {
    const normalized = normalizeDomainConfig(config);
    if (normalized.channel_code !== undefined && normalized.channel_code !== null) {
        const duplicate = await vendorManager.findByChannelCode(normalized.channel_code, excludeVendorId);
        if (duplicate) throw new customError.AppError("channel_code already exists", 409);
    }
    if (normalized.group_id !== undefined && normalized.group_id !== null) {
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


/**
 * 从上游 API 获取模型列表
 */
export async function fetchUpstreamModels(vendor: SgVendor): Promise<string[]> {
    const openaiUrl = vendor.getUrlByFormat(ApiFormat.OPENAI);
    if (openaiUrl === null) {
        throw new customError.AppError("vendor does not have url for openai format", 400);
    }
    const baseUrl = openaiUrl.replace(/\/chat\/completions$/, "");
    const modelsUrl = `${baseUrl}/models`;

    const token = vendor.token;
    const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

    try {
        const response = await fetch(modelsUrl, {
            method: "GET",
            headers: {
                Authorization: authHeader,
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            const text = await response.text();
            throw new customError.AppError(
                `Upstream returned ${response.status}: ${text}`,
                502,
            );
        }

        const data: any = await response.json();

        const models: string[] = Array.isArray(data?.data)
            ? data.data.map((m: any) => m.id).filter(Boolean).filter(isLlmModel)
            : [];

        return models;
    } catch (err: any) {
        if (err.statusCode) throw err;
        throw new customError.AppError(`Failed to fetch models: ${err.message}`, 502);
    }
}


export default {
    normalizeDomainConfig,
    updateVendor,
    findVendorByUrl,
    deleteVendor,
    fetchUpstreamModels,
    validateProxyConfig,
    validateSchedulingConfig,
    validateDomainConfig,
};
