import { Model } from "sutando";
import { CastsAttributes } from "sutando";
import { inspect, InspectOptions } from "util";

import { SgRecordStatus } from "../constants";
import { MicroAmountCast } from "../util/protocol/billingUtil";


interface SgRecordCostBreakdown {
    input_cost: number;
    image_input_cost: number;
    output_cost: number;
    image_output_cost: number;
    cache_creation_cost: number;
    cache_creation_5m_cost: number;
    cache_creation_1h_cost: number;
    cache_read_cost: number;
    request_cost: number;
    total_cost: number;
}


/**
 * 请求记录的 usage 对象，同时作为 Sutando 自定义 cast（Sutando 通过 instanceof CastsAttributes 识别）。
 * 存储/读写在类内外一致：DB 列为 TEXT JSON 串，模型层按类读写。
 *
 * 口径约定（prompt_tokens 按 OpenAI 原生语义 = 输入总量含缓存命中）：
 * - 存储层带版本号 usage_version：v1 的 prompt_tokens 为非缓存数；v2 总量仅包含缓存读取；
 *   v3 总量同时包含缓存读取和缓存创建。
 * - 构造时按版本完成「存储 → 展示」转换，实例内部恒为展示口径（prompt_tokens = 普通输入）；
 *   toJSON() 直接输出内部字段，不再做版本判断。
 * - 各 token 字段区分「缺失」与「0」：上游未返回 → null；明确返回 0 → 0。
 */
// @ts-expect-error Sutando .d.ts 声明 static get/set() 无参，运行时传 4 个实参
class SgRecordUsage extends CastsAttributes {
    /** usage 存储版本：1 = 普通输入；2 = 普通输入 + 缓存读取；3 = 普通输入 + 缓存读取 + 缓存创建 */
    version: number = 1;

    /** 输入 token（展示口径 = 非缓存输入）；上游未返回为 null，明确为 0 则为 0 */
    prompt_tokens?: number | null;

    /** 输出 token；上游未返回为 null */
    completion_tokens?: number | null;

    /** 命中缓存的输入（prompt_tokens 的子集）；上游未返回为 null */
    cache_read_tokens?: number | null;

    /** 写入缓存 token；是否计费由模型的 cache_write 价格决定；上游未返回为 null */
    cache_creation_tokens?: number | null;

    /** 5 分钟缓存创建 token；是 cache_creation_tokens 的明细子集 */
    cache_creation_5m_tokens?: number | null;

    /** 1 小时缓存创建 token；是 cache_creation_tokens 的明细子集 */
    cache_creation_1h_tokens?: number | null;

    /** 图片输入 token；是普通输入 token 的子集 */
    image_input_tokens?: number | null;

    /** 图片输出 token；是 completion_tokens 的子集 */
    image_output_tokens?: number | null;

    /** 模型原价下的费用明细；最终倍率和实扣金额仍以 record 字段为准 */
    cost_breakdown?: SgRecordCostBreakdown | null;

    /**
     * 构造时按存储版本完成「存储 → 展示」口径转换：
     * - v2：存储的 prompt_tokens 为普通输入 + 缓存读取；
     * - v3：存储的 prompt_tokens 为普通输入 + 缓存读取 + 缓存创建；
     * - v1：存储的 prompt_tokens 本就是非缓存，原样保留。
     * 转换后字段恒为展示口径，toJSON() 直接输出。
     */
    constructor(data?: Partial<SgRecordUsage>) {
        super();
        if (data) {
            this.version = data.version ?? 1;
            if (this.version >= 2 && data.prompt_tokens != null) {
                const cacheTokens = (data.cache_read_tokens ?? 0)
                    + (this.version >= 3 ? (data.cache_creation_tokens ?? 0) : 0);
                this.prompt_tokens = Math.max(0, data.prompt_tokens - cacheTokens);
            } else {
                this.prompt_tokens = data.prompt_tokens ?? null;
            }
            this.completion_tokens = data.completion_tokens ?? null;
            this.cache_read_tokens = data.cache_read_tokens ?? null;
            this.cache_creation_tokens = data.cache_creation_tokens ?? null;
            this.cache_creation_5m_tokens = data.cache_creation_5m_tokens ?? null;
            this.cache_creation_1h_tokens = data.cache_creation_1h_tokens ?? null;
            this.image_input_tokens = data.image_input_tokens ?? null;
            this.image_output_tokens = data.image_output_tokens ?? null;
            this.cost_breakdown = data.cost_breakdown ?? null;
        }
    }

    /** API 展示口径：直接输出内部字段（构造时已按版本归一化）；缺失值输出 null（JSON.stringify 自动调用） */
    toJSON(): Record<string, unknown> {
        const result: Record<string, unknown> = {
            prompt_tokens: this.prompt_tokens ?? null,
            completion_tokens: this.completion_tokens ?? null,
            cache_read_tokens: this.cache_read_tokens ?? null,
        };
        if (this.cache_creation_tokens != null) {
            result.cache_creation_tokens = this.cache_creation_tokens;
        }
        if (this.cache_creation_5m_tokens != null) {
            result.cache_creation_5m_tokens = this.cache_creation_5m_tokens;
        }
        if (this.cache_creation_1h_tokens != null) {
            result.cache_creation_1h_tokens = this.cache_creation_1h_tokens;
        }
        if (this.image_input_tokens != null) {
            result.image_input_tokens = this.image_input_tokens;
        }
        if (this.image_output_tokens != null) {
            result.image_output_tokens = this.image_output_tokens;
        }
        if (this.cost_breakdown != null) {
            result.cost_breakdown = this.cost_breakdown;
        }
        return result;
    }

    /**
     * 存储口径：新数据使用 v3；读取后原样保存旧 v2 时继续保持 v2 语义。
     */
    toStorageJSON(): Record<string, unknown> {
        const storageVersion = this.version >= 3 ? 3 : 2;
        const cacheCreationTokens = storageVersion >= 3 ? (this.cache_creation_tokens ?? 0) : 0;
        const result: Record<string, unknown> = {
            usage_version: storageVersion,
            prompt_tokens: this.prompt_tokens != null
                ? this.prompt_tokens + (this.cache_read_tokens ?? 0) + cacheCreationTokens
                : null,
            completion_tokens: this.completion_tokens,
            cache_read_tokens: this.cache_read_tokens,
        };
        if (this.cache_creation_tokens != null) {
            result.cache_creation_tokens = this.cache_creation_tokens;
        }
        if (this.cache_creation_5m_tokens != null) {
            result.cache_creation_5m_tokens = this.cache_creation_5m_tokens;
        }
        if (this.cache_creation_1h_tokens != null) {
            result.cache_creation_1h_tokens = this.cache_creation_1h_tokens;
        }
        if (this.image_input_tokens != null) {
            result.image_input_tokens = this.image_input_tokens;
        }
        if (this.image_output_tokens != null) {
            result.image_output_tokens = this.image_output_tokens;
        }
        if (this.cost_breakdown != null) {
            result.cost_breakdown = this.cost_breakdown;
        }
        return result;
    }

    // ---- Sutando custom cast ----

    /** DB 串 → SgRecordUsage 实例；无版本标记的存量记录视为 v1 */
    static get(self: SgRecord, key: string, value: string | null): SgRecordUsage | null {
        if (value == null || value === "") {
            return null;
        }
        let parsed: Record<string, any>;
        try {
            parsed = JSON.parse(value);
        } catch {
            return null;
        }
        const version = parsed.usage_version === 3 ? 3 : parsed.usage_version === 2 ? 2 : 1;
        return new SgRecordUsage({ ...parsed, version });
    }

    // 创建时收到纯对象，读改保存时收到 SgRecordUsage 实例，两者都需支持
    static set(self: SgRecord, key: string, value: SgRecordUsage | Record<string, any> | null): string | null {
        if (value == null) {
            return null;
        }
        return JSON.stringify(value instanceof SgRecordUsage ? value.toStorageJSON() : value);
    }
}


class SgRecord extends Model {
    table = "record";

    casts = {
        start_at: "datetime",
        end_at: "datetime",
        // MySQL 下以整数微元存储（应用层仍以"元"读写），避免 DECIMAL 返回字符串
        cost: MicroAmountCast,
        base_cost: MicroAmountCast,
        usage: SgRecordUsage,
    };

    id!: number;

    user_id!: number | null;
    model_id!: number | null;
    vendor_id!: number | null;
    vendor_model_name!: string | null;

    request_data!: string | null;
    response_data!: string | null;
    status!: SgRecordStatus | null;
    failed_code!: string | null;
    client_format!: string | null;
    /** 上游实际使用的协议格式：null 表示与 client_format 一致（直接路由，未发生协议转换）；非 null 为网关转换后实际请求上游的格式（如 responses 回退到 openai 时记录为 "openai"） */
    upstream_format!: string | null;

    /** usage 按类读写（DB 为 TEXT JSON 串，cast 负责转换）；展示口径见 SgRecordUsage.toJSON */
    usage!: SgRecordUsage | null;
    first_token_latency!: number | null;
    start_at!: Date | null;
    end_at!: Date | null;
    cost!: number;
    /** 模型原始报价（倍率前，应用层单位为元）。 */
    base_cost!: number;
    /** 分组倍率快照。 */
    rate_multiplier!: number;
    key_id!: number | null;
    group_id!: number | null;
    requested_model!: string | null;
    billing_mode!: string | null;
    /** pending / settled / skipped。 */
    settlement_status!: string;

    created_at!: Date;
    updated_at!: Date;

    [inspect.custom](depth: number, options: InspectOptions) {
        return JSON.stringify(this.toData(), null, 2);
    }
}

const RECORD_SUMMARY_COLUMNS = [
    "id", "user_id", "model_id", "vendor_id", "vendor_model_name",
    "status", "failed_code", "client_format", "upstream_format",
    "usage", "first_token_latency", "start_at", "end_at", "cost",
    "key_id", "group_id", "requested_model", "billing_mode", "base_cost",
    "rate_multiplier", "settlement_status",
    "created_at", "updated_at"
];

export { SgRecord, SgRecordUsage, RECORD_SUMMARY_COLUMNS };
export type { SgRecordCostBreakdown };
