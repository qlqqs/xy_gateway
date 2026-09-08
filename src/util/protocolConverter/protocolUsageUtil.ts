import type {
    AnthropicResponse,
    CacheCreationDetails,
    InputTokenDetails,
    OpenAIResponse,
    OutputTokenDetails,
} from "./protocolTypes";
import type { ResponsesNonStreamResponse } from "./responsesTypes";


type Dict = Record<string, any>;

export interface CanonicalProtocolUsage {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    cacheCreation5mTokens?: number;
    cacheCreation1hTokens?: number;
    imageInputTokens?: number;
    imageOutputTokens?: number;
    reasoningTokens?: number;
}


function tokenValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.max(0, value)
        : undefined;
}


function firstTokenValue(...values: unknown[]): number | undefined {
    for (const value of values) {
        const parsed = tokenValue(value);
        if (parsed !== undefined) return parsed;
    }
    return undefined;
}


function firstPositiveTokenValue(...values: unknown[]): number | undefined {
    let zeroValue: number | undefined;
    for (const value of values) {
        const parsed = tokenValue(value);
        if (parsed === undefined) continue;
        if (parsed > 0) return parsed;
        zeroValue = 0;
    }
    return zeroValue;
}


function asDict(value: unknown): Dict | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Dict
        : undefined;
}


function mergeDefinedDict(base: unknown, update: unknown): Dict | undefined {
    const baseDict = asDict(base);
    const updateDict = asDict(update);
    if (!baseDict && !updateDict) return undefined;

    return {
        ...Object.fromEntries(Object.entries(baseDict ?? {}).filter(([, value]) => value !== null && value !== undefined)),
        ...Object.fromEntries(Object.entries(updateDict ?? {}).filter(([, value]) => value !== null && value !== undefined)),
    };
}


function extractCacheCreationDetails(usage: Dict, inputDetails?: Dict, preferPositive = false): {
    cacheCreationTokens?: number;
    cacheCreation5mTokens?: number;
    cacheCreation1hTokens?: number;
} {
    const cacheCreation = usage.cache_creation as Dict | undefined;
    const selectToken = preferPositive ? firstPositiveTokenValue : firstTokenValue;
    const cacheCreation5mTokens = selectToken(
        cacheCreation?.ephemeral_5m_input_tokens,
        inputDetails?.cache_creation_5m_tokens,
        usage.cache_creation_5m_tokens,
    );
    const cacheCreation1hTokens = selectToken(
        cacheCreation?.ephemeral_1h_input_tokens,
        inputDetails?.cache_creation_1h_tokens,
        usage.cache_creation_1h_tokens,
    );
    const detailedTotal = cacheCreation5mTokens !== undefined || cacheCreation1hTokens !== undefined
        ? (cacheCreation5mTokens ?? 0) + (cacheCreation1hTokens ?? 0)
        : undefined;
    let cacheCreationTokens = selectToken(
        inputDetails?.cache_write_tokens,
        inputDetails?.cache_creation_tokens,
        usage.cache_creation_input_tokens,
        usage.cache_write_input_tokens,
        usage.cache_write_tokens,
        usage.cache_creation_tokens,
        detailedTotal,
    );
    if ((cacheCreationTokens === undefined || cacheCreationTokens === 0) && (detailedTotal ?? 0) > 0) {
        cacheCreationTokens = detailedTotal;
    }
    return { cacheCreationTokens, cacheCreation5mTokens, cacheCreation1hTokens };
}


function fromTotalInputUsage(usage: Dict, inputKey: "prompt_tokens" | "input_tokens", outputKey: "completion_tokens" | "output_tokens"): CanonicalProtocolUsage {
    const inputDetails = (usage[`${inputKey.replace("tokens", "tokens_details")}`]
        ?? (inputKey === "prompt_tokens" ? usage.prompt_tokens_details : usage.input_tokens_details)) as Dict | undefined;
    const outputDetails = (usage[`${outputKey.replace("tokens", "tokens_details")}`]
        ?? (outputKey === "completion_tokens" ? usage.completion_tokens_details : usage.output_tokens_details)) as Dict | undefined;
    const cacheReadTokens = firstTokenValue(
        inputDetails?.cached_tokens,
        usage.cache_read_input_tokens,
        usage.cache_read_tokens,
        usage.cached_tokens,
    );
    const cacheCreation = extractCacheCreationDetails(usage, inputDetails);
    const inputTotal = firstTokenValue(usage[inputKey]);
    const cacheCreationTokens = cacheCreation.cacheCreationTokens;

    return {
        inputTokens: inputTotal !== undefined
            ? Math.max(0, inputTotal - (cacheReadTokens ?? 0) - (cacheCreationTokens ?? 0))
            : undefined,
        outputTokens: firstTokenValue(usage[outputKey]),
        cacheReadTokens,
        ...cacheCreation,
        imageInputTokens: firstTokenValue(inputDetails?.image_tokens, usage.image_input_tokens),
        imageOutputTokens: firstTokenValue(outputDetails?.image_tokens, usage.image_output_tokens),
        reasoningTokens: firstTokenValue(outputDetails?.reasoning_tokens),
    };
}


function fromOpenAIUsage(usage: Dict | null | undefined): CanonicalProtocolUsage {
    if (!usage) return {};
    const normalized = {
        ...usage,
        prompt_tokens: usage.prompt_tokens ?? usage.input_tokens,
        completion_tokens: usage.completion_tokens ?? usage.output_tokens,
        // Chat Completions 使用 prompt/completion 命名；兼容上游可能在同一 payload 中混用 Responses 别名。
        prompt_tokens_details: mergeDefinedDict(usage.input_tokens_details, usage.prompt_tokens_details),
        completion_tokens_details: mergeDefinedDict(usage.output_tokens_details, usage.completion_tokens_details),
    };
    return fromTotalInputUsage(normalized, "prompt_tokens", "completion_tokens");
}


function fromResponsesUsage(usage: Dict | null | undefined): CanonicalProtocolUsage {
    if (!usage) return {};
    const normalized = {
        ...usage,
        input_tokens: usage.input_tokens ?? usage.prompt_tokens,
        output_tokens: usage.output_tokens ?? usage.completion_tokens,
        // Responses 字段优先，缺失的明细再由 Chat 兼容别名补齐；明确返回 0 时仍保留 0。
        input_tokens_details: mergeDefinedDict(usage.prompt_tokens_details, usage.input_tokens_details),
        output_tokens_details: mergeDefinedDict(usage.completion_tokens_details, usage.output_tokens_details),
    };
    return fromTotalInputUsage(normalized, "input_tokens", "output_tokens");
}


function fromAnthropicUsage(usage: Dict | null | undefined): CanonicalProtocolUsage {
    if (!usage) return {};
    const inputDetails = asDict(usage.input_tokens_details);
    const promptDetails = asDict(usage.prompt_tokens_details);
    const outputDetails = asDict(usage.output_tokens_details);
    const completionDetails = asDict(usage.completion_tokens_details);
    return {
        inputTokens: firstTokenValue(usage.input_tokens),
        outputTokens: firstTokenValue(usage.output_tokens),
        cacheReadTokens: firstPositiveTokenValue(
            usage.cache_read_input_tokens,
            usage.cache_read_tokens,
            usage.cached_tokens,
            inputDetails?.cached_tokens,
            promptDetails?.cached_tokens,
        ),
        ...extractCacheCreationDetails(usage, mergeDefinedDict(promptDetails, inputDetails), true),
        imageInputTokens: firstTokenValue(inputDetails?.image_tokens, promptDetails?.image_tokens, usage.image_input_tokens),
        imageOutputTokens: firstTokenValue(outputDetails?.image_tokens, completionDetails?.image_tokens, usage.image_output_tokens),
        reasoningTokens: firstTokenValue(outputDetails?.reasoning_tokens, completionDetails?.reasoning_tokens),
    };
}


function totalInputTokens(usage: CanonicalProtocolUsage): number {
    return (usage.inputTokens ?? 0)
        + (usage.cacheReadTokens ?? 0)
        + (usage.cacheCreationTokens ?? 0);
}


function buildInputDetails(usage: CanonicalProtocolUsage): InputTokenDetails | undefined {
    const details: InputTokenDetails = {};
    if (usage.cacheReadTokens !== undefined) details.cached_tokens = usage.cacheReadTokens;
    if (usage.cacheCreationTokens !== undefined) details.cache_write_tokens = usage.cacheCreationTokens;
    if (usage.cacheCreation5mTokens !== undefined) details.cache_creation_5m_tokens = usage.cacheCreation5mTokens;
    if (usage.cacheCreation1hTokens !== undefined) details.cache_creation_1h_tokens = usage.cacheCreation1hTokens;
    if (usage.imageInputTokens !== undefined) details.image_tokens = usage.imageInputTokens;
    return Object.keys(details).length > 0 ? details : undefined;
}


function buildOutputDetails(usage: CanonicalProtocolUsage): OutputTokenDetails | undefined {
    const details: OutputTokenDetails = {};
    if (usage.reasoningTokens !== undefined) details.reasoning_tokens = usage.reasoningTokens;
    if (usage.imageOutputTokens !== undefined) details.image_tokens = usage.imageOutputTokens;
    return Object.keys(details).length > 0 ? details : undefined;
}


function buildCacheCreationDetails(usage: CanonicalProtocolUsage): CacheCreationDetails | undefined {
    const details: CacheCreationDetails = {};
    if (usage.cacheCreation5mTokens !== undefined) {
        details.ephemeral_5m_input_tokens = usage.cacheCreation5mTokens;
    }
    if (usage.cacheCreation1hTokens !== undefined) {
        details.ephemeral_1h_input_tokens = usage.cacheCreation1hTokens;
    }
    return Object.keys(details).length > 0 ? details : undefined;
}


function toOpenAIUsage(usage: CanonicalProtocolUsage): OpenAIResponse["usage"] {
    const promptTokens = totalInputTokens(usage);
    const completionTokens = usage.outputTokens ?? 0;
    return {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
        prompt_tokens_details: buildInputDetails(usage),
        completion_tokens_details: buildOutputDetails(usage),
    };
}


function toAnthropicUsage(usage: CanonicalProtocolUsage): AnthropicResponse["usage"] {
    return {
        input_tokens: usage.inputTokens ?? 0,
        output_tokens: usage.outputTokens ?? 0,
        ...(usage.cacheReadTokens !== undefined ? { cache_read_input_tokens: usage.cacheReadTokens } : {}),
        ...(usage.cacheCreationTokens !== undefined
            ? { cache_creation_input_tokens: usage.cacheCreationTokens }
            : {}),
        ...(buildCacheCreationDetails(usage) ? { cache_creation: buildCacheCreationDetails(usage) } : {}),
        ...(usage.imageInputTokens !== undefined
            ? { input_tokens_details: { image_tokens: usage.imageInputTokens } }
            : {}),
        ...(usage.imageOutputTokens !== undefined
            ? { output_tokens_details: { image_tokens: usage.imageOutputTokens } }
            : {}),
    };
}


function toResponsesUsage(usage: CanonicalProtocolUsage): NonNullable<ResponsesNonStreamResponse["usage"]> {
    const inputTokens = totalInputTokens(usage);
    const outputTokens = usage.outputTokens ?? 0;
    return {
        input_tokens: inputTokens,
        input_tokens_details: buildInputDetails(usage),
        output_tokens: outputTokens,
        output_tokens_details: buildOutputDetails(usage),
        total_tokens: inputTokens + outputTokens,
        ...(buildCacheCreationDetails(usage) ? { cache_creation: buildCacheCreationDetails(usage) } : {}),
    };
}


function mergeUsage(base: Dict | null | undefined, update: Dict | null | undefined): Dict {
    if (!update) return { ...(base ?? {}) };
    const result: Dict = {
        ...(base ?? {}),
        ...Object.fromEntries(Object.entries(update).filter(([, value]) => value !== null && value !== undefined)),
    };

    for (const key of [
        "prompt_tokens_details",
        "completion_tokens_details",
        "input_tokens_details",
        "output_tokens_details",
        "cache_creation",
    ]) {
        const merged = mergeDefinedDict(base?.[key], update[key]);
        if (merged !== undefined) result[key] = merged;
    }

    return result;
}


function preservePositiveTokenValues(base: unknown, update: unknown, result: Dict): void {
    const baseDict = asDict(base);
    const updateDict = asDict(update);
    if (!baseDict || !updateDict) return;

    for (const [key, updateValue] of Object.entries(updateDict)) {
        const baseValue = baseDict[key];
        if (updateValue === 0 && typeof baseValue === "number" && baseValue > 0) {
            result[key] = baseValue;
            continue;
        }

        const nestedResult = asDict(result[key]);
        if (nestedResult) {
            preservePositiveTokenValues(baseValue, updateValue, nestedResult);
        }
    }
}


/** Anthropic 流末帧常用 0 作为未携带字段的占位值，需保留前帧已经获得的正数。 */
function mergeAnthropicUsage(base: Dict | null | undefined, update: Dict | null | undefined): Dict {
    const result = mergeUsage(base, update);
    preservePositiveTokenValues(base, update, result);
    return result;
}


export default {
    fromOpenAIUsage,
    fromResponsesUsage,
    fromAnthropicUsage,
    toOpenAIUsage,
    toAnthropicUsage,
    toResponsesUsage,
    mergeUsage,
    mergeAnthropicUsage,
};
