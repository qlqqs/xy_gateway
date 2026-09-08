import { describe, expect, it } from "vitest";
import protocolUsage from "../../../src/util/protocolConverter/protocolUsageUtil";


const canonicalUsage = {
    inputTokens: 150,
    outputTokens: 50,
    cacheReadTokens: 600,
    cacheCreationTokens: 250,
    cacheCreation5mTokens: 200,
    cacheCreation1hTokens: 50,
    imageInputTokens: 30,
    imageOutputTokens: 10,
    reasoningTokens: 5,
};


describe("protocolUsageUtil", () => {
    it("converts OpenAI usage to Anthropic without double-counting cache creation", () => {
        const usage = protocolUsage.fromOpenAIUsage({
            prompt_tokens: 1_000,
            completion_tokens: 50,
            prompt_tokens_details: {
                cached_tokens: 600,
                cache_creation_tokens: 250,
                cache_creation_5m_tokens: 200,
                cache_creation_1h_tokens: 50,
                image_tokens: 30,
            },
            completion_tokens_details: { reasoning_tokens: 5, image_tokens: 10 },
        });

        expect(protocolUsage.toAnthropicUsage(usage)).toEqual({
            input_tokens: 150,
            output_tokens: 50,
            cache_read_input_tokens: 600,
            cache_creation_input_tokens: 250,
            cache_creation: {
                ephemeral_5m_input_tokens: 200,
                ephemeral_1h_input_tokens: 50,
            },
            input_tokens_details: { image_tokens: 30 },
            output_tokens_details: { image_tokens: 10 },
        });
    });

    it("converts Anthropic usage to OpenAI with cache and image details", () => {
        const result = protocolUsage.toOpenAIUsage(protocolUsage.fromAnthropicUsage({
            input_tokens: 150,
            output_tokens: 50,
            cache_read_input_tokens: 600,
            cache_creation_input_tokens: 250,
            cache_creation: {
                ephemeral_5m_input_tokens: 200,
                ephemeral_1h_input_tokens: 50,
            },
            input_tokens_details: { image_tokens: 30 },
            output_tokens_details: { image_tokens: 10 },
        }));

        expect(result).toMatchObject({
            prompt_tokens: 1_000,
            completion_tokens: 50,
            total_tokens: 1_050,
            prompt_tokens_details: {
                cached_tokens: 600,
                cache_write_tokens: 250,
                cache_creation_5m_tokens: 200,
                cache_creation_1h_tokens: 50,
                image_tokens: 30,
            },
            completion_tokens_details: { image_tokens: 10 },
        });
    });

    it("uses Anthropic fallback fields when standard cache fields are zero", () => {
        const usage = protocolUsage.fromAnthropicUsage({
            input_tokens: 100,
            output_tokens: 20,
            cache_read_input_tokens: 0,
            cached_tokens: 9,
            cache_creation_input_tokens: 0,
            cache_creation: {
                ephemeral_5m_input_tokens: 3,
                ephemeral_1h_input_tokens: 4,
            },
        });

        expect(usage).toMatchObject({
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 9,
            cacheCreationTokens: 7,
            cacheCreation5mTokens: 3,
            cacheCreation1hTokens: 4,
        });
    });

    it("converts OpenAI usage to Responses with total input unchanged", () => {
        const result = protocolUsage.toResponsesUsage(canonicalUsage);

        expect(result).toMatchObject({
            input_tokens: 1_000,
            output_tokens: 50,
            total_tokens: 1_050,
            input_tokens_details: {
                cached_tokens: 600,
                cache_write_tokens: 250,
                cache_creation_5m_tokens: 200,
                cache_creation_1h_tokens: 50,
                image_tokens: 30,
            },
            output_tokens_details: { reasoning_tokens: 5, image_tokens: 10 },
        });
    });

    it("converts Responses usage to OpenAI while preserving explicit zero", () => {
        const usage = protocolUsage.fromResponsesUsage({
            input_tokens: 1_000,
            output_tokens: 50,
            input_tokens_details: {
                cached_tokens: 600,
                cache_write_tokens: 250,
                cache_creation_5m_tokens: 200,
                cache_creation_1h_tokens: 50,
                image_tokens: 30,
            },
            output_tokens_details: { reasoning_tokens: 5, image_tokens: 0 },
        });

        expect(protocolUsage.toOpenAIUsage(usage)).toMatchObject({
            prompt_tokens: 1_000,
            completion_tokens_details: { reasoning_tokens: 5, image_tokens: 0 },
        });
    });

    it("converts Anthropic usage to Responses using inclusive input token semantics", () => {
        expect(protocolUsage.toResponsesUsage(canonicalUsage)).toMatchObject({
            input_tokens: 1_000,
            total_tokens: 1_050,
            cache_creation: {
                ephemeral_5m_input_tokens: 200,
                ephemeral_1h_input_tokens: 50,
            },
        });
    });

    it("converts Responses usage to Anthropic using exclusive input token semantics", () => {
        const result = protocolUsage.toAnthropicUsage(protocolUsage.fromResponsesUsage({
            input_tokens: 1_000,
            output_tokens: 50,
            input_tokens_details: {
                cached_tokens: 600,
                cache_creation_tokens: 250,
                cache_creation_5m_tokens: 200,
                cache_creation_1h_tokens: 50,
            },
        }));

        expect(result).toMatchObject({
            input_tokens: 150,
            output_tokens: 50,
            cache_read_input_tokens: 600,
            cache_creation_input_tokens: 250,
        });
    });

    it("combines official details with compatible aliases without hiding either bucket", () => {
        const usage = protocolUsage.fromOpenAIUsage({
            prompt_tokens: 1_000,
            completion_tokens: 50,
            prompt_tokens_details: { cached_tokens: 600 },
            input_tokens_details: { cache_write_tokens: 250, image_tokens: 30 },
        });

        expect(usage).toMatchObject({
            inputTokens: 150,
            cacheReadTokens: 600,
            cacheCreationTokens: 250,
            imageInputTokens: 30,
        });
    });

    it("keeps explicit zero in official OpenAI cache fields ahead of top-level aliases", () => {
        const usage = protocolUsage.fromOpenAIUsage({
            prompt_tokens: 20,
            completion_tokens: 2,
            input_tokens_details: {
                cached_tokens: 0,
                cache_write_tokens: 0,
            },
            cache_read_input_tokens: 18,
            cache_creation_input_tokens: 19,
        });

        expect(usage).toMatchObject({
            inputTokens: 20,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
        });
    });

    it("merges usage-only stream chunks before normalization", () => {
        const base = protocolUsage.mergeUsage({}, {
            prompt_tokens: 1_000,
            completion_tokens: 50,
        });
        const merged = protocolUsage.mergeUsage(base, {
            prompt_tokens_details: {
                cached_tokens: 600,
                cache_creation_tokens: 250,
            },
        });

        expect(protocolUsage.fromOpenAIUsage(merged)).toMatchObject({
            inputTokens: 150,
            cacheReadTokens: 600,
            cacheCreationTokens: 250,
        });
    });

    it("does not erase nested usage with null while preserving explicit zero", () => {
        const merged = protocolUsage.mergeUsage({
            prompt_tokens_details: {
                cached_tokens: 600,
                cache_write_tokens: 250,
            },
        }, {
            prompt_tokens_details: {
                cached_tokens: null,
                cache_write_tokens: 0,
            },
        });

        expect(merged.prompt_tokens_details).toEqual({
            cached_tokens: 600,
            cache_write_tokens: 0,
        });
        expect(merged).not.toHaveProperty("input_tokens_details");
    });

    it("preserves positive Anthropic stream values when a later frame contains zero placeholders", () => {
        const merged = protocolUsage.mergeAnthropicUsage({
            input_tokens: 10,
            cache_creation: {
                ephemeral_5m_input_tokens: 2,
                ephemeral_1h_input_tokens: 6,
            },
        }, {
            input_tokens: 0,
            output_tokens: 5,
            cache_creation: {
                ephemeral_5m_input_tokens: 1,
                ephemeral_1h_input_tokens: 0,
            },
        });

        expect(merged).toMatchObject({
            input_tokens: 10,
            output_tokens: 5,
            cache_creation: {
                ephemeral_5m_input_tokens: 1,
                ephemeral_1h_input_tokens: 6,
            },
        });
    });
});
