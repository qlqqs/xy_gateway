import { Model } from "sutando";
import { CastsAttributes } from "sutando";
import { inspect, InspectOptions } from "util";
import { ApiFormat, VendorAuthMode } from "../constants";
import vendorDefaultUrls from "../util/vendorDefaultUrlsUtil";
import urlUtil from "../util/protocol/urlUtil";


type VendorRawAttributes = Record<string, unknown>;

function isRecord(value: unknown): value is VendorRawAttributes {
    return !!value && typeof value === "object" && !Array.isArray(value);
}


function parseStoredValue(value: unknown): unknown {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
}


function parseStoredObject(value: unknown): VendorRawAttributes {
    const parsed = parseStoredValue(value);
    if (isRecord(parsed)) return parsed;
    if (parsed && typeof (parsed as { toJSON?: unknown }).toJSON === "function") {
        const serialized = (parsed as { toJSON: () => unknown }).toJSON();
        return isRecord(serialized) ? serialized : {};
    }
    return {};
}


function toPositiveGroupId(value: unknown): number | null {
    if (typeof value !== "number" && typeof value !== "string" && typeof value !== "bigint") {
        return null;
    }
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}


function normalizeVendorGroupIds(value: unknown, fallback?: unknown): number[] {
    const fallbackId = toPositiveGroupId(fallback);
    const fallbackIds = fallbackId === null ? [] : [fallbackId];
    if (value === undefined) return fallbackIds;

    // 显式空数组是“未分组”的规范值。其他损坏的持久化值不得把已分组供应商
    // 放宽到未分组路由池，此时保留正式列的投影。
    if (!Array.isArray(value)) return fallbackIds;
    const normalized = [...new Set(value
        .map(toPositiveGroupId)
        .filter((groupId): groupId is number => groupId !== null))];
    return normalized.length > 0 || value.length === 0 ? normalized : fallbackIds;
}


function hasOwn(attributes: VendorRawAttributes | undefined, key: string): boolean {
    return attributes !== undefined && Object.prototype.hasOwnProperty.call(attributes, key);
}


function toStoredBoolean(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "true") return true;
    return false;
}


function toStoredNumber(value: unknown): number | undefined {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : undefined;
}


/**
 * 将供应商正式列合并到 JSON 传输配置。Sutando 的 hydrate 路径会调用
 * `newFromBuilder` 并绕过子类构造函数，因此在 cast 中合并可保证 hydrate 与新建模型一致。
 */
function mergeFormalConfig(value: unknown, attributes?: VendorRawAttributes): VendorRawAttributes {
    const result = { ...parseStoredObject(value) };

    if (hasOwn(attributes, "auth_mode") && attributes?.auth_mode != null) {
        result.auth_mode = attributes.auth_mode;
    }
    if (hasOwn(attributes, "skip_tls_verify") && attributes?.skip_tls_verify != null) {
        result.skip_tls_verify = toStoredBoolean(attributes.skip_tls_verify);
    }
    if (hasOwn(attributes, "proxy")) {
        result.proxy = parseStoredValue(attributes?.proxy) ?? null;
    }
    for (const key of ["supplier_name", "channel_code", "api_type", "openai_protocol", "status", "remark"] as const) {
        if (!hasOwn(attributes, key)) continue;
        const raw = attributes?.[key];
        if (raw === null || raw === undefined) {
            delete result[key];
        } else {
            result[key] = raw;
        }
    }
    if (hasOwn(attributes, "available_models")) {
        const parsed = parseStoredValue(attributes?.available_models);
        result.available_models = Array.isArray(parsed) ? parsed : [];
    }
    for (const key of ["concurrency", "priority"] as const) {
        if (!hasOwn(attributes, key)) continue;
        const number = toStoredNumber(attributes?.[key]);
        if (number === undefined) delete result[key];
        else result[key] = number;
    }
    if (hasOwn(attributes, "load_factor")) {
        const raw = attributes?.load_factor;
        result.load_factor = raw === null || raw === undefined ? null : toStoredNumber(raw);
        if (result.load_factor === undefined) delete result.load_factor;
    }

    const hasConfiguredGroupIds = hasOwn(result, "group_ids") && result.group_ids !== undefined;
    const hasStoredGroupId = hasOwn(attributes, "group_id");
    const hasConfiguredGroupId = hasOwn(result, "group_id") && result.group_id !== undefined;
    if (hasConfiguredGroupIds || hasStoredGroupId || hasConfiguredGroupId) {
        const groupIds = normalizeVendorGroupIds(
            hasConfiguredGroupIds ? result.group_ids : undefined,
            hasStoredGroupId ? attributes?.group_id : result.group_id,
        );
        result.group_ids = groupIds;
        result.group_id = groupIds[0] ?? null;
    }

    return result;
}


/**
 * 供应商配置对象，同时作为 Sutando 自定义 cast（Sutando 通过 instanceof CastsAttributes 识别）。
 * vendor.config 的类型即为此类，读写一致。
 */
// @ts-expect-error Sutando .d.ts 声明 static get/set() 无参，运行时传 4 个实参
class SgVendorConfig extends CastsAttributes {
    /** 认证模式，未配置时默认为 bearer_token */
    auth_mode: VendorAuthMode = VendorAuthMode.BEARER_TOKEN;

    /** 是否跳过 TLS 证书验证（用于自签证书等内网环境） */
    skip_tls_verify: boolean = false;

    /** 代理配置 */
    proxy?: { type: "http" | "socks5"; url: string } | null;

    /** 新版供应商管理表单字段，保存在 config 中以兼容既有数据库结构 */
    supplier_name?: string;
    channel_code?: string;
    api_type?: "openai" | "anthropic";
    openai_protocol?: "chat_completions" | "responses";
    status?: "active" | "disabled";
    remark?: string;
    available_models?: string[];
    concurrency?: number;
    load_factor?: number | null;
    priority?: number;
    group_id?: number | null;
    group_ids?: number[];

    constructor(data?: Partial<SgVendorConfig>) {
        super();
        if (data) {
            if (data.auth_mode !== undefined) this.auth_mode = data.auth_mode;
            if (data.skip_tls_verify !== undefined) this.skip_tls_verify = data.skip_tls_verify;
            if (data.proxy !== undefined) this.proxy = data.proxy;
            if (data.supplier_name !== undefined) this.supplier_name = data.supplier_name;
            if (data.channel_code !== undefined) this.channel_code = data.channel_code;
            if (data.api_type !== undefined) this.api_type = data.api_type;
            if (data.openai_protocol !== undefined) this.openai_protocol = data.openai_protocol;
            if (data.status !== undefined) this.status = data.status;
            if (data.remark !== undefined) this.remark = data.remark;
            if (data.available_models !== undefined) this.available_models = data.available_models;
            if (data.concurrency !== undefined) this.concurrency = data.concurrency;
            if (data.load_factor !== undefined) this.load_factor = data.load_factor;
            if (data.priority !== undefined) this.priority = data.priority;
            if (data.group_ids !== undefined) {
                this.group_ids = normalizeVendorGroupIds(data.group_ids);
                this.group_id = this.group_ids[0] ?? null;
            } else if (data.group_id !== undefined) {
                this.group_id = toPositiveGroupId(data.group_id);
                this.group_ids = normalizeVendorGroupIds(undefined, this.group_id);
            }
        }
    }

    /** API 响应序列化（JSON.stringify 自动调用） */
    toJSON() {
        const result: Record<string, any> = {
            auth_mode: this.auth_mode,
            skip_tls_verify: this.skip_tls_verify,
        };
        if (this.proxy != null) result.proxy = this.proxy;
        if (this.supplier_name) result.supplier_name = this.supplier_name;
        if (this.channel_code) result.channel_code = this.channel_code;
        if (this.api_type) result.api_type = this.api_type;
        if (this.openai_protocol) result.openai_protocol = this.openai_protocol;
        if (this.status) result.status = this.status;
        if (this.remark) result.remark = this.remark;
        if (this.available_models?.length) result.available_models = this.available_models;
        if (this.concurrency !== undefined) result.concurrency = this.concurrency;
        if (this.load_factor !== undefined) result.load_factor = this.load_factor;
        if (this.priority !== undefined) result.priority = this.priority;
        if (this.group_ids !== undefined) {
            const groupIds = normalizeVendorGroupIds(this.group_ids);
            result.group_ids = groupIds;
            result.group_id = groupIds[0] ?? null;
        } else if (this.group_id !== undefined) {
            result.group_id = toPositiveGroupId(this.group_id);
        }
        return result;
    }

    // ---- Sutando custom cast ----

    /** DB string → SgVendorConfig 实例 */
    static get(self: SgVendor, key: string, value: unknown): SgVendorConfig {
        const attributes = self && typeof self.getAttributes === "function"
            ? self.getAttributes() as VendorRawAttributes
            : undefined;
        return new SgVendorConfig(mergeFormalConfig(value, attributes) as Partial<SgVendorConfig>);
    }

    // 创建时收到纯对象，读改保存时收到 SgVendorConfig 实例，两者都需支持
    static set(self: SgVendor, key: string, value: SgVendorConfig | Record<string, any>): string {
        return JSON.stringify(mergeFormalConfig(value));
    }
}

class SgVendor extends Model {
    table = "vendor";

    id!: number;
    type!: string;
    name!: string;
    token!: string;
    urls!: Record<string, string>;
    config!: SgVendorConfig;

    // migrate_0031 引入的正式调度/领域列。嵌套 config 对象仍是现有 sender/plugin
    // 代码的对外传输结构，service 在写入时保持两者同步。
    auth_mode!: VendorAuthMode;
    skip_tls_verify!: boolean;
    proxy!: { type: "http" | "socks5"; url: string } | null;
    supplier_name!: string | null;
    channel_code!: string | null;
    api_type!: "openai" | "anthropic" | null;
    openai_protocol!: "chat_completions" | "responses" | null;
    status!: "active" | "disabled";
    remark!: string | null;
    available_models!: string[];
    concurrency!: number;
    load_factor!: number | null;
    priority!: number;
    group_id!: number | null;

    casts = {
        urls: 'json',
        config: SgVendorConfig,
        proxy: 'json',
        available_models: 'json',
        skip_tls_verify: 'boolean',
        concurrency: 'integer',
        load_factor: 'float',
        priority: 'integer',
    };

    created_at!: Date;
    updated_at!: Date;

    /**
     * 直接构造与 Sutando `query().create()` 路径都需要保持正式列与 JSON 传输对象同步。
     * 后者会先创建空模型，再调用 `fill(attributes)`，仅在构造函数同步会静默持久化默认值。
     */
    fill(attributes: VendorRawAttributes): this {
        // Sutando 基类的 `fill` 会在正式列同步之前替换自定义 cast 属性。保留旧 JSON
        // 快照，避免部分 config 更新擦除无关领域字段。
        const previousAttributes = this.getAttributes() as VendorRawAttributes;
        const previousConfig = parseStoredObject(previousAttributes.config);
        const safeAttributes = { ...attributes };
        const hasTopLevelGroupIds = hasOwn(safeAttributes, "group_ids");
        const hasTopLevelGroupId = hasOwn(safeAttributes, "group_id");
        const topLevelGroupIds = safeAttributes.group_ids;
        const config = parseStoredObject(safeAttributes.config);
        const hasConfigGroupIds = hasOwn(config, "group_ids") && config.group_ids !== undefined;
        const hasConfigGroupId = hasOwn(config, "group_id") && config.group_id !== undefined;

        // `group_ids` 是规范传输字段。单独 fill 的标量值必须能清空/替换旧数组，
        // 但构造参数同时包含两个字段时，以显式数组为准。
        if (hasTopLevelGroupIds) {
            config.group_ids = topLevelGroupIds;
            safeAttributes.config = config;
        } else if (hasTopLevelGroupId && !hasConfigGroupIds && !hasConfigGroupId) {
            config.group_id = safeAttributes.group_id;
            config.group_ids = normalizeVendorGroupIds(undefined, safeAttributes.group_id);
            safeAttributes.config = config;
        }
        delete safeAttributes.group_ids;

        super.fill(safeAttributes);
        const formalKeys = [
            "config", "auth_mode", "skip_tls_verify", "proxy", "supplier_name",
            "channel_code", "api_type", "openai_protocol", "status", "remark",
            "available_models", "concurrency", "load_factor", "priority", "group_id",
        ];
        if (formalKeys.some(key => hasOwn(safeAttributes, key))) {
            this.syncFormalColumns(safeAttributes, previousConfig);
        }
        return this;
    }

    private syncFormalColumns(input: VendorRawAttributes, previousConfig: VendorRawAttributes = {}): void {
        const currentAttributes = this.getAttributes() as VendorRawAttributes;
        const currentConfig = {
            ...previousConfig,
            ...parseStoredObject(currentAttributes.config),
        };
        const incomingConfig = hasOwn(input, "config") ? parseStoredObject(input.config) : {};
        const mergedConfig: VendorRawAttributes = { ...currentConfig, ...incomingConfig };

        // 保留部分更新意图：归一化后的标量更新不得被 currentConfig 中的旧
        // `group_ids` 数组覆盖；反之，同一 payload 中的显式数组（包括 []）优先于标量兼容字段。
        const incomingHasGroupIds = hasOwn(incomingConfig, "group_ids")
            && incomingConfig.group_ids !== undefined;
        const incomingHasGroupId = hasOwn(incomingConfig, "group_id")
            && incomingConfig.group_id !== undefined;
        if (incomingHasGroupIds) {
            mergedConfig.group_ids = incomingConfig.group_ids;
        } else if (incomingHasGroupId) {
            delete mergedConfig.group_ids;
            mergedConfig.group_id = incomingConfig.group_id;
        }
        for (const key of [
            "auth_mode", "skip_tls_verify", "proxy", "supplier_name", "channel_code",
            "api_type", "openai_protocol", "status", "remark", "available_models",
            "concurrency", "load_factor", "priority", "group_id",
        ]) {
            if (hasOwn(input, key)) {
                // 标量物理列是兼容投影，不得覆盖显式多分组数组。
                if (key === "group_id" && incomingHasGroupIds) continue;
                mergedConfig[key] = input[key];
            }
        }
        if (hasOwn(input, "group_id") && !incomingHasGroupIds && !incomingHasGroupId) {
            delete mergedConfig.group_ids;
            mergedConfig.group_id = input.group_id;
        }

        const config = new SgVendorConfig(mergeFormalConfig(mergedConfig) as Partial<SgVendorConfig>);
        this.setAttribute("config", config);
        this.setAttribute("auth_mode", config.auth_mode);
        this.setAttribute("skip_tls_verify", config.skip_tls_verify);
        this.setAttribute("proxy", config.proxy ?? null);
        this.setAttribute("supplier_name", config.supplier_name ?? null);
        this.setAttribute("channel_code", config.channel_code ?? null);
        this.setAttribute("api_type", config.api_type ?? null);
        this.setAttribute("openai_protocol", config.openai_protocol ?? null);
        this.setAttribute("status", config.status ?? "active");
        this.setAttribute("remark", config.remark ?? null);
        this.setAttribute("available_models", config.available_models ?? []);
        this.setAttribute("concurrency", config.concurrency ?? 10);
        this.setAttribute("load_factor", config.load_factor ?? null);
        this.setAttribute("priority", config.priority ?? 1);
        this.setAttribute("group_id", config.group_id ?? null);
    }

    constructor(attributes: Record<string, unknown> = {}) {
        super();
        // groupService 的事务删除路径会用原始数据库行直接构造模型，而不是走
        // Sutando hydrate/cast。这里同样合并正式列，确保损坏的 group_ids 不会
        // 抹掉 group_id 的安全回退；显式空数组仍由 normalizeVendorGroupIds 保留。
        const configData = mergeFormalConfig(attributes.config, attributes);
        if (attributes.group_ids !== undefined) {
            configData.group_ids = attributes.group_ids;
        }
        const inputConfig = new SgVendorConfig(configData as Partial<SgVendorConfig>);
        const fillAttributes = { ...attributes };
        delete fillAttributes.config;
        // group_ids 是 JSON config 字段，不是 vendor 物理列。
        delete fillAttributes.group_ids;
        this.fill({
            // 原始行中的 JSON/布尔/数字列已经由 mergeFormalConfig 解码；
            // 不得让驱动原始值再次覆盖归一化结果，否则 Sutando 会重复编码 JSON。
            ...fillAttributes,
            urls: parseStoredObject(attributes.urls),
            config: inputConfig,
            auth_mode: inputConfig.auth_mode,
            skip_tls_verify: inputConfig.skip_tls_verify,
            proxy: inputConfig.proxy ?? null,
            supplier_name: inputConfig.supplier_name ?? null,
            channel_code: inputConfig.channel_code ?? null,
            api_type: inputConfig.api_type ?? null,
            openai_protocol: inputConfig.openai_protocol ?? null,
            status: inputConfig.status ?? "active",
            remark: inputConfig.remark ?? null,
            available_models: inputConfig.available_models ?? [],
            concurrency: inputConfig.concurrency ?? 10,
            load_factor: inputConfig.load_factor ?? null,
            priority: inputConfig.priority ?? 1,
            group_id: inputConfig.group_id ?? null,
        });
    }

    /** 返回归一化的分组集合，同时兼容旧单分组数据。 */
    getGroupIds(): number[] {
        const config = this.config;
        return normalizeVendorGroupIds(
            config?.group_ids,
            this.group_id !== undefined ? this.group_id : config?.group_id,
        );
    }

    /** 返回优先级/权重调度器使用的有效权重。 */
    getEffectiveWeight(): number {
        // migrate_0031 之后以正式列为真值源。仅 hydrate 前构造的对象（或旧 fixture）
        // 回退到嵌套传输对象；已持久化的 NULL load_factor 不得恢复过期 config 值。
        const explicit = this.load_factor !== undefined ? this.load_factor : this.config?.load_factor;
        const concurrency = this.concurrency !== undefined
            ? this.concurrency
            : (this.config?.concurrency ?? 1);
        const weight = explicit ?? concurrency;
        return Number.isFinite(weight) && weight > 0 ? weight : 1;
    }

    /**
     * 合并预设 URL 与数据库中的自定义 URL。
     * 自定义 URL 覆盖同一协议键的预设值。
     */
    getMergedUrls(): Record<string, string> {
        const presetUrls = vendorDefaultUrls.getAllUrls()[this.type] ?? {};
        const merged = { ...presetUrls, ...this.urls };
        delete merged['label'];
        return merged;
    }

    /**
     * 返回供应商领域字段显式声明的协议。
     *
     * null 表示该对象早于正式能力列（例如内存 fixture），此时按 URL 探测。
     * 一旦存在 `api_type`，它就是真值源：Responses 渠道不得仅因供应商类型
     * 包含 Chat Completions 预设 URL 而被误识别为 Chat Completions 渠道。
     */
    private getDeclaredFormat(): ApiFormat | null {
        const apiType = this.api_type ?? this.config?.api_type;
        const protocol = this.openai_protocol ?? this.config?.openai_protocol;
        if (apiType === "anthropic") return ApiFormat.ANTHROPIC;
        if (apiType === "openai") {
            return protocol === "responses" ? ApiFormat.RESPONSES : ApiFormat.OPENAI;
        }
        return null;
    }

    /** 在不应用正式能力门禁的情况下解析 URL。 */
    private resolveUrlByFormat(format: ApiFormat): string | null {
        const urls = this.getMergedUrls();

        if (format === ApiFormat.RESPONSES) {
            const responsesUrl = urls[ApiFormat.RESPONSES];
            if (responsesUrl) {
                return responsesUrl.includes("/responses")
                    ? responsesUrl
                    : responsesUrl.replace(/\/$/, "") + "/responses";
            }
            // Responses 渠道可以有意复用 OpenAI 基础 URL；此处派生端点时不递归应用
            // 能力门禁（门禁由 getUrlByFormat 自身检查）。
            const openaiUrl = this.resolveUrlByFormat(ApiFormat.OPENAI);
            return openaiUrl === null ? null : urlUtil.convertOpenaiToResponses(openaiUrl);
        }

        if (format === ApiFormat.ANTHROPIC) {
            const anthropicUrl = urls[ApiFormat.ANTHROPIC];
            if (anthropicUrl) {
                return anthropicUrl.includes("/v1/messages")
                    ? anthropicUrl
                    : anthropicUrl.replace(/\/$/, "") + "/v1/messages";
            }
        }

        if (format === ApiFormat.OPENAI) {
            const openaiUrl = urls[ApiFormat.OPENAI];
            if (openaiUrl) {
                return openaiUrl.includes("/chat/completions")
                    ? openaiUrl
                    : openaiUrl.replace(/\/$/, "") + "/chat/completions";
            }
        }

        return null;
    }

    /**
     * 根据 API 格式获取对应的 URL
     * @param format - API 格式（openai, anthropic, responses）
     * @returns 完整的 URL 字符串；无法解析（缺 URL 或无法派生）时返回 null，由调用方处理
     */
    getUrlByFormat(format: ApiFormat): string | null {
        const declared = this.getDeclaredFormat();
        if (declared !== null && declared !== format) return null;
        return this.resolveUrlByFormat(format);
    }

    /**
     * 获取当前 vendor 支持的格式列表
     * 口径与 getUrlByFormat 完全一致：能拿到某格式的 URL（含自动补全后缀后的派生）即视为支持，
     * 避免「getUrlByFormat 能解析但 getSupportedFormats 不认可」的不一致。
     * @returns 支持的格式数组
     */
    getSupportedFormats(): ApiFormat[] {
        const declared = this.getDeclaredFormat();
        if (declared !== null) {
            return this.resolveUrlByFormat(declared) === null ? [] : [declared];
        }

        const formats: ApiFormat[] = [];

        if (this.getUrlByFormat(ApiFormat.OPENAI) !== null) {
            formats.push(ApiFormat.OPENAI);
        }
        if (this.getUrlByFormat(ApiFormat.ANTHROPIC) !== null) {
            formats.push(ApiFormat.ANTHROPIC);
        }
        if (this.getUrlByFormat(ApiFormat.RESPONSES) !== null) {
            formats.push(ApiFormat.RESPONSES);
        }

        return formats;
    }

    [inspect.custom](depth: number, options: InspectOptions) {
        return JSON.stringify(this.toData(), null, 2);
    }
}

export { SgVendor, SgVendorConfig };
export { normalizeVendorGroupIds };
