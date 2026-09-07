import { Model } from "sutando";
import { CastsAttributes } from "sutando";
import { inspect, InspectOptions } from "util";
import { ApiFormat, VendorAuthMode } from "../constants";
import vendorDefaultUrls from "../util/vendorDefaultUrlsUtil";
import urlUtil from "../util/protocol/urlUtil";


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
            if (data.group_id !== undefined) this.group_id = data.group_id;
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
        if (this.group_id !== undefined) result.group_id = this.group_id;
        return result;
    }

    // ---- Sutando custom cast ----

    /** DB string → SgVendorConfig 实例 */
    static get(self: SgVendor, key: string, value: string): SgVendorConfig {
        let parsed: Record<string, any> = {};
        try { parsed = value ? JSON.parse(value) : {}; } catch {}
        return new SgVendorConfig(parsed);
    }

    // 创建时收到纯对象，读改保存时收到 SgVendorConfig 实例，两者都需支持
    static set(self: SgVendor, key: string, value: SgVendorConfig | Record<string, any>): string {
        return JSON.stringify(value instanceof SgVendorConfig ? value.toJSON() : value);
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

    // Formal scheduling/domain columns introduced in migrate_0031.  The
    // nested config object remains the public transport shape for existing
    // sender/plugin code; services keep these fields in sync on writes.
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

    constructor(attributes: Record<string, unknown> = {}) {
        super();
        const inputConfig = attributes.config instanceof SgVendorConfig
            ? attributes.config
            : new SgVendorConfig((attributes.config ?? {}) as Partial<SgVendorConfig>);
        this.fill({
            urls: {},
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
            ...attributes,
        });
        // A hydrated row may contain formal columns but an old/empty config
        // JSON.  Reconstruct the nested runtime object from the columns so all
        // callers observe one canonical value.
        this.config = new SgVendorConfig({
            ...(this.config ?? {}),
            auth_mode: this.auth_mode,
            skip_tls_verify: this.skip_tls_verify,
            proxy: this.proxy,
            supplier_name: this.supplier_name ?? undefined,
            channel_code: this.channel_code ?? undefined,
            api_type: this.api_type ?? undefined,
            openai_protocol: this.openai_protocol ?? undefined,
            status: this.status ?? undefined,
            remark: this.remark ?? undefined,
            available_models: this.available_models ?? [],
            concurrency: this.concurrency,
            load_factor: this.load_factor,
            priority: this.priority,
            group_id: this.group_id,
        });
    }

    /** Effective scheduling weight used by the priority/weight scheduler. */
    getEffectiveWeight(): number {
        // Formal columns are the source of truth after migrate_0031.  Fall
        // back to the nested transport object only for an object constructed
        // before hydration (or by a legacy fixture); a persisted NULL
        // load_factor must not resurrect a stale config value.
        const explicit = this.load_factor !== undefined ? this.load_factor : this.config?.load_factor;
        const concurrency = this.concurrency !== undefined
            ? this.concurrency
            : (this.config?.concurrency ?? 1);
        const weight = explicit ?? concurrency;
        return Number.isFinite(weight) && weight > 0 ? weight : 1;
    }

    /**
     * Merge preset URLs and DB-stored custom URLs.
     * Custom URLs override presets with the same format key.
     */
    getMergedUrls(): Record<string, string> {
        const presetUrls = vendorDefaultUrls.getAllUrls()[this.type] ?? {};
        const merged = { ...presetUrls, ...this.urls };
        delete merged['label'];
        return merged;
    }

    /**
     * Return the protocol explicitly declared by the vendor domain fields.
     *
     * A null result means that the object predates the formal capability
     * columns (for example an in-memory fixture) and URL discovery is used.
     * Once `api_type` is present, however, it is the source of truth: a
     * response-capable OpenAI channel must not accidentally become a Chat
     * Completions channel merely because its vendor type has a preset URL for
     * that protocol.
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

    /** Resolve a URL without applying the formal capability gate. */
    private resolveUrlByFormat(format: ApiFormat): string | null {
        const urls = this.getMergedUrls();

        if (format === ApiFormat.RESPONSES) {
            const responsesUrl = urls[ApiFormat.RESPONSES];
            if (responsesUrl) {
                return responsesUrl.includes("/responses")
                    ? responsesUrl
                    : responsesUrl.replace(/\/$/, "") + "/responses";
            }
            // A Responses channel may intentionally reuse an OpenAI base URL;
            // derive the endpoint without recursively applying the capability
            // gate (the gate is checked by getUrlByFormat itself).
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
