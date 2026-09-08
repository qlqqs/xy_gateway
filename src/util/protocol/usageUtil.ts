import { SgModel } from "../../model/sgModel";
import { ApiFormat, PRICE_UNIT_TOKENS } from "../../constants";
import { SgRecordUsage, type SgRecordCostBreakdown } from "../../model/sgRecord";
import billingUtils from "./billingUtil";

export type Dict = Record<string, unknown>;

export interface BillingTokenUsage {
    promptTokens?: number | null;
    outputTokens?: number | null;
    cacheReadTokens?: number | null;
    cacheWriteTokens?: number | null;
    cacheCreation5mTokens?: number | null;
    cacheCreation1hTokens?: number | null;
    imageInputTokens?: number | null;
    imageOutputTokens?: number | null;
}

export interface NormalizedUsage {
    recordUsage: SgRecordUsage;
    promptTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cacheCreation5mTokens: number;
    cacheCreation1hTokens: number;
    imageInputTokens: number;
    imageOutputTokens: number;
}


function asDict(value: unknown): Dict | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Dict
        : undefined;
}


function tokenValue(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.max(0, value)
        : null;
}


function firstTokenValue(...values: unknown[]): number | null {
    for (const value of values) {
        const parsed = tokenValue(value);
        if (parsed !== null) return parsed;
    }
    return null;
}


function firstPositiveTokenValue(...values: unknown[]): number | null {
    let zeroValue: number | null = null;
    for (const value of values) {
        const parsed = tokenValue(value);
        if (parsed === null) continue;
        if (parsed > 0) return parsed;
        zeroValue = 0;
    }
    return zeroValue;
}


function calculateCacheCreationCost(
    prices: NonNullable<SgModel["prices"]>,
    cacheWriteTokens: number,
    cacheCreation5mTokens: number,
    cacheCreation1hTokens: number,
): Pick<SgRecordCostBreakdown, "cache_creation_cost" | "cache_creation_5m_cost" | "cache_creation_1h_cost"> {
    const detailedTotal = cacheCreation5mTokens + cacheCreation1hTokens;
    const hasDetailedPricing = prices.cache_write_5m !== undefined || prices.cache_write_1h !== undefined;
    if (hasDetailedPricing && detailedTotal === 0 && cacheWriteTokens > 0) {
        const cacheCreation5mCost = (cacheWriteTokens / PRICE_UNIT_TOKENS)
            * (prices.cache_write_5m ?? prices.cache_write ?? 0);
        return {
            cache_creation_cost: cacheCreation5mCost,
            cache_creation_5m_cost: cacheCreation5mCost,
            cache_creation_1h_cost: 0,
        };
    }

    if (hasDetailedPricing) {
        const cacheCreation5mCost = (cacheCreation5mTokens / PRICE_UNIT_TOKENS)
            * (prices.cache_write_5m ?? prices.cache_write ?? 0);
        const cacheCreation1hCost = (cacheCreation1hTokens / PRICE_UNIT_TOKENS)
            * (prices.cache_write_1h ?? prices.cache_write ?? 0);
        return {
            cache_creation_cost: cacheCreation5mCost + cacheCreation1hCost,
            cache_creation_5m_cost: cacheCreation5mCost,
            cache_creation_1h_cost: cacheCreation1hCost,
        };
    }

    const aggregatePrice = prices.cache_write ?? 0;
    const aggregateCost = (cacheWriteTokens / PRICE_UNIT_TOKENS) * aggregatePrice;

    return {
        cache_creation_cost: aggregateCost,
        cache_creation_5m_cost: 0,
        cache_creation_1h_cost: 0,
    };
}


export function calculateCostBreakdown(
    model: SgModel,
    usage: BillingTokenUsage,
): SgRecordCostBreakdown {
    const prices = model.prices || {};
    const emptyBreakdown: SgRecordCostBreakdown = {
        input_cost: 0,
        image_input_cost: 0,
        output_cost: 0,
        image_output_cost: 0,
        cache_creation_cost: 0,
        cache_creation_5m_cost: 0,
        cache_creation_1h_cost: 0,
        cache_read_cost: 0,
        request_cost: 0,
        total_cost: 0,
    };

    if (prices.billing_mode === "per_request" || prices.billing_mode === "image") {
        const requestCost = billingUtils.quantizeAmount(prices.per_request ?? 0);
        return { ...emptyBreakdown, request_cost: requestCost, total_cost: requestCost };
    }

    const promptTokens = Math.max(0, Number(usage.promptTokens ?? 0));
    const outputTokens = Math.max(0, Number(usage.outputTokens ?? 0));
    const cacheReadTokens = Math.max(0, Number(usage.cacheReadTokens ?? 0));
    const cacheCreation5mTokens = Math.max(0, Number(usage.cacheCreation5mTokens ?? 0));
    const cacheCreation1hTokens = Math.max(0, Number(usage.cacheCreation1hTokens ?? 0));
    const cacheWriteTokens = Math.max(
        0,
        Number(usage.cacheWriteTokens ?? 0),
        cacheCreation5mTokens + cacheCreation1hTokens,
    );
    const normalInputTokens = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
    const imageInputTokens = Math.min(normalInputTokens, Math.max(0, Number(usage.imageInputTokens ?? 0)));
    const imageOutputTokens = Math.min(outputTokens, Math.max(0, Number(usage.imageOutputTokens ?? 0)));
    const textInputTokens = normalInputTokens - imageInputTokens;
    const textOutputTokens = outputTokens - imageOutputTokens;

    const inputPrice = prices.input ?? 0;
    const outputPrice = prices.output ?? 0;
    const imageInputPrice = prices.image_input ?? inputPrice;
    const imageOutputPrice = prices.image_output ?? outputPrice;
    const cacheReadPrice = prices.cache_read ?? 0;
    const cacheCreationCosts = calculateCacheCreationCost(
        prices,
        cacheWriteTokens,
        cacheCreation5mTokens,
        cacheCreation1hTokens,
    );
    const breakdown: SgRecordCostBreakdown = {
        ...emptyBreakdown,
        input_cost: (textInputTokens / PRICE_UNIT_TOKENS) * inputPrice,
        image_input_cost: (imageInputTokens / PRICE_UNIT_TOKENS) * imageInputPrice,
        output_cost: (textOutputTokens / PRICE_UNIT_TOKENS) * outputPrice,
        image_output_cost: (imageOutputTokens / PRICE_UNIT_TOKENS) * imageOutputPrice,
        cache_read_cost: (cacheReadTokens / PRICE_UNIT_TOKENS) * cacheReadPrice,
        ...cacheCreationCosts,
    };
    breakdown.total_cost = billingUtils.quantizeAmount(
        breakdown.input_cost
        + breakdown.image_input_cost
        + breakdown.output_cost
        + breakdown.image_output_cost
        + breakdown.cache_creation_cost
        + breakdown.cache_read_cost,
    );
    return breakdown;
}

export function calculateCost(
    model: SgModel,
    promptTokens: number | null,
    outputTokens: number | null,
    cacheReadTokens: number | null = 0,
    cacheWriteTokens: number | null = 0,
    cacheCreation5mTokens: number | null = 0,
    cacheCreation1hTokens: number | null = 0,
    imageInputTokens: number | null = 0,
    imageOutputTokens: number | null = 0,
): number {
    return calculateCostBreakdown(model, {
        promptTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        cacheCreation5mTokens,
        cacheCreation1hTokens,
        imageInputTokens,
        imageOutputTokens,
    }).total_cost;
}

export function normalizeUsage(format: ApiFormat, usage: Dict | null | undefined): NormalizedUsage | null {
    if (!usage) return null;

    // 存储口径原始值（v3 总量口径），交由 SgRecordUsage 构造时统一归一为展示口径；
    // 计价用数字单独计算：缺失按 0 计费，落库字段保留「缺失 = null / 返回 0 = 0」的区分。
    let promptTotal: number | null = null;
    let completionRaw: number | null = null;
    let cacheReadRaw: number | null = null;
    let cacheWriteRaw: number | null = null;
    let cacheCreation5mRaw: number | null = null;
    let cacheCreation1hRaw: number | null = null;
    let imageInputRaw: number | null = null;
    let imageOutputRaw: number | null = null;

    const inputDetails = asDict(usage.input_tokens_details);
    const promptDetails = asDict(usage.prompt_tokens_details);
    const outputDetails = asDict(usage.output_tokens_details);
    const completionDetails = asDict(usage.completion_tokens_details);
    const cacheCreationDetails = asDict(usage.cache_creation);

    cacheCreation5mRaw = firstTokenValue(
        cacheCreationDetails?.ephemeral_5m_input_tokens,
        inputDetails?.cache_creation_5m_tokens,
        promptDetails?.cache_creation_5m_tokens,
        usage.cache_creation_5m_tokens,
    );
    cacheCreation1hRaw = firstTokenValue(
        cacheCreationDetails?.ephemeral_1h_input_tokens,
        inputDetails?.cache_creation_1h_tokens,
        promptDetails?.cache_creation_1h_tokens,
        usage.cache_creation_1h_tokens,
    );
    imageInputRaw = firstTokenValue(
        inputDetails?.image_tokens,
        promptDetails?.image_tokens,
        usage.image_input_tokens,
    );
    imageOutputRaw = firstTokenValue(
        outputDetails?.image_tokens,
        completionDetails?.image_tokens,
        usage.image_output_tokens,
    );

    if (format === ApiFormat.OPENAI) {
        promptTotal = firstTokenValue(usage.prompt_tokens, usage.input_tokens);
        completionRaw = firstTokenValue(usage.completion_tokens, usage.output_tokens);
        cacheReadRaw = firstTokenValue(
            promptDetails?.cached_tokens,
            inputDetails?.cached_tokens,
            usage.cache_read_input_tokens,
            usage.cache_read_tokens,
            usage.cached_tokens,
        );
        cacheWriteRaw = firstTokenValue(
            promptDetails?.cache_write_tokens,
            inputDetails?.cache_write_tokens,
            promptDetails?.cache_creation_tokens,
            inputDetails?.cache_creation_tokens,
            usage.cache_write_tokens,
            usage.cache_creation_input_tokens,
            usage.cache_write_input_tokens,
            usage.cache_creation_tokens,
        );
    }

    if (format === ApiFormat.ANTHROPIC) {
        const inputRaw = tokenValue(usage.input_tokens);
        // 部分 Anthropic 兼容上游会把标准字段置 0，同时在兼容字段或 TTL 明细中返回真实值。
        // 此处优先取正数；所有候选都为 0 时仍保留“明确返回 0”的语义。
        cacheCreation5mRaw = firstPositiveTokenValue(
            cacheCreationDetails?.ephemeral_5m_input_tokens,
            inputDetails?.cache_creation_5m_tokens,
            promptDetails?.cache_creation_5m_tokens,
            usage.cache_creation_5m_tokens,
        );
        cacheCreation1hRaw = firstPositiveTokenValue(
            cacheCreationDetails?.ephemeral_1h_input_tokens,
            inputDetails?.cache_creation_1h_tokens,
            promptDetails?.cache_creation_1h_tokens,
            usage.cache_creation_1h_tokens,
        );
        cacheReadRaw = firstPositiveTokenValue(
            usage.cache_read_input_tokens,
            usage.cache_read_tokens,
            usage.cached_tokens,
            inputDetails?.cached_tokens,
            promptDetails?.cached_tokens,
        );
        cacheWriteRaw = firstPositiveTokenValue(
            usage.cache_creation_input_tokens,
            usage.cache_creation_tokens,
            usage.cache_write_tokens,
            usage.cache_write_input_tokens,
            inputDetails?.cache_write_tokens,
            promptDetails?.cache_write_tokens,
            inputDetails?.cache_creation_tokens,
            promptDetails?.cache_creation_tokens,
        );
        if (
            (cacheWriteRaw === null || cacheWriteRaw === 0)
            && (cacheCreation5mRaw ?? 0) + (cacheCreation1hRaw ?? 0) > 0
        ) {
            cacheWriteRaw = (cacheCreation5mRaw ?? 0) + (cacheCreation1hRaw ?? 0);
        }
        // Anthropic input_tokens 不含缓存读取和创建；存储总量需把两个缓存桶加回。
        promptTotal = inputRaw != null
            ? inputRaw + (cacheReadRaw ?? 0) + (cacheWriteRaw ?? 0)
            : null;
        completionRaw = tokenValue(usage.output_tokens);
    }

    if (format === ApiFormat.RESPONSES) {
        promptTotal = firstTokenValue(usage.input_tokens, usage.prompt_tokens);
        completionRaw = firstTokenValue(usage.output_tokens, usage.completion_tokens);
        cacheReadRaw = firstTokenValue(
            inputDetails?.cached_tokens,
            promptDetails?.cached_tokens,
            usage.cache_read_input_tokens,
            usage.cache_read_tokens,
            usage.cached_tokens,
        );
        cacheWriteRaw = firstTokenValue(
            inputDetails?.cache_write_tokens,
            promptDetails?.cache_write_tokens,
            inputDetails?.cache_creation_tokens,
            promptDetails?.cache_creation_tokens,
            usage.cache_creation_input_tokens,
            usage.cache_write_tokens,
            usage.cache_write_input_tokens,
            usage.cache_creation_tokens,
        );
    }

    if (
        (cacheWriteRaw === null || cacheWriteRaw === 0)
        && (cacheCreation5mRaw ?? 0) + (cacheCreation1hRaw ?? 0) > 0
    ) {
        cacheWriteRaw = (cacheCreation5mRaw ?? 0) + (cacheCreation1hRaw ?? 0);
    }

    const promptTokens = promptTotal ?? 0;
    const outputTokens = completionRaw ?? 0;
    const cacheReadTokens = cacheReadRaw ?? 0;
    const cacheWriteTokens = cacheWriteRaw ?? 0;
    const cacheCreation5mTokens = cacheCreation5mRaw ?? 0;
    const cacheCreation1hTokens = cacheCreation1hRaw ?? 0;
    const imageInputTokens = imageInputRaw ?? 0;
    const imageOutputTokens = imageOutputRaw ?? 0;
    const inputTokens = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);

    // 构造即归一：SgRecordUsage 实例内部为展示口径（prompt_tokens = 非缓存输入）
    const recordUsage = new SgRecordUsage({
        version: 3,
        prompt_tokens: promptTotal,
        completion_tokens: completionRaw,
        cache_read_tokens: cacheReadRaw,
        cache_creation_tokens: cacheWriteRaw,
        cache_creation_5m_tokens: cacheCreation5mRaw,
        cache_creation_1h_tokens: cacheCreation1hRaw,
        image_input_tokens: imageInputRaw,
        image_output_tokens: imageOutputRaw,
    });

    return {
        recordUsage,
        promptTokens,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        cacheCreation5mTokens,
        cacheCreation1hTokens,
        imageInputTokens,
        imageOutputTokens,
    };
}


/**
 * 把规整后的 recordUsage 序列化为落库存储串（v3 总量口径 + usage_version 标记）。
 * 写侧统一走这里（裸 query().update() 不走模型 cast，不能依赖 SgRecordUsage.set()）。
 */
export function serializeStoredUsage(recordUsage: SgRecordUsage | null | undefined): string | null {
    if (!recordUsage) return null;
    return JSON.stringify(recordUsage.toStorageJSON());
}

export default {
    calculateCost,
    calculateCostBreakdown,
    normalizeUsage,
    serializeStoredUsage,
};
