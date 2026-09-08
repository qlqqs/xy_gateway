import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import anthropicAccumulator from "../../../../src/util/accumulator/anthropicAccumulator";

function requireFixture(fileName: string): string {
    const logFile = join(__dirname, "..", "..", "..", "resource", "stream_logs", fileName);

    if (!existsSync(logFile)) {
        throw new Error(`Fixture not found: ${logFile}`);
    }

    return readFileSync(logFile, "utf-8");
}

function parseAnthropicStream(content: string) {
    const accumulator = new anthropicAccumulator.AnthropicAccumulator();
    const events = content.split("\n\n").filter((event) => event.trim());

    for (const event of events) {
        const lines = event.split("\n");
        let data = "";
        let eventType = "";

        for (const line of lines) {
            if (line.startsWith("data:")) {
                data = line.slice(5).trim();
            } else if (line.startsWith("event:")) {
                eventType = line.slice(6).trim();
            }
        }

        if (!data) continue;

        accumulator.addEvent({ data, event: eventType });
    }

    return accumulator.getResponse();
}

describe("AnthropicAccumulator fixtures", () => {
    it("parses anthropic non-tool stream fixture", () => {
        const response = parseAnthropicStream(requireFixture("anthropic-stream.log"));

        expect(response.model).toBe("glm-4.7");
        expect(response.choices).toHaveLength(1);
        expect(response.choices[0].message.role).toBe("assistant");
        expect(response.choices[0].message.content.length).toBeGreaterThan(0);
        expect(response.choices[0].message.thinking?.length).toBeGreaterThan(0);
        expect(response.choices[0].finish_reason).toBe("max_tokens");
        expect(response.usage?.prompt_tokens).toBe(6);
        expect(response.usage?.completion_tokens).toBe(223);
    });

    it("parses anthropic tool-use stream fixture", () => {
        const response = parseAnthropicStream(requireFixture("anthropic-tool-use-stream.log"));
        const toolUseList = response.choices[0].message.tool_use ?? [];
        const actualToolUse = toolUseList.find((item) => item?.name === "get_weather");

        expect(response.model).toBe("glm-4.7");
        expect(response.choices[0].message.role).toBe("assistant");
        expect(response.choices[0].finish_reason).toBe("tool_use");
        expect(actualToolUse).toBeDefined();
        expect(actualToolUse?.id).toBeTruthy();
        expect(actualToolUse?.input).toEqual({
            city: "上海",
            unit: "celsius",
        });
        expect(actualToolUse?.input_json).toBe(
            "{\"city\": \"上海\", \"unit\": \"celsius\"}",
        );
        expect(response.usage?.prompt_tokens).toBe(197);
        expect(response.usage?.completion_tokens).toBe(77);
    });
});

describe("AnthropicAccumulator stream state", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("marks completed on message_stop", () => {
        const acc = new anthropicAccumulator.AnthropicAccumulator();
        acc.addEvent({ data: JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }), event: "content_block_delta" });
        acc.addEvent({ data: JSON.stringify({ type: "message_stop" }), event: "message_stop" });

        expect(acc.isCompleted()).toBe(true);
        expect(acc.isOutputStarted()).toBe(true);
    });

    it("captures cache_write_tokens from cache_creation_input_tokens", () => {
        const acc = new anthropicAccumulator.AnthropicAccumulator();
        acc.addEvent({ data: JSON.stringify({
            type: "message_start",
            message: {
                id: "msg_1",
                type: "message",
                role: "assistant",
                content: [],
                usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 80, cache_creation_input_tokens: 15 },
            },
        }), event: "message_start" });
        acc.addEvent({ data: JSON.stringify({ type: "message_stop" }), event: "message_stop" });

        const usage = acc.getUsage()!;
        // prompt_tokens 按总量口径 = 普通输入 + 缓存读取 + 缓存创建
        expect(usage.prompt_tokens).toBe(195);
        expect(usage.cache_read_tokens).toBe(80);
        expect(usage.cache_write_tokens).toBe(15);
    });

    it("captures cache creation TTL and image token details", () => {
        const acc = new anthropicAccumulator.AnthropicAccumulator();
        acc.addEvent({ data: JSON.stringify({
            type: "message_start",
            message: {
                usage: {
                    input_tokens: 100,
                    output_tokens: 0,
                    cache_read_input_tokens: 20,
                    cache_creation_input_tokens: 10,
                    cache_creation: {
                        ephemeral_5m_input_tokens: 7,
                        ephemeral_1h_input_tokens: 3,
                    },
                    input_tokens_details: { image_tokens: 25 },
                    output_tokens_details: { image_tokens: 0 },
                },
            },
        }), event: "message_start" });

        expect(acc.getUsage()).toMatchObject({
            prompt_tokens: 130,
            cache_write_tokens: 10,
            cache_creation_5m_tokens: 7,
            cache_creation_1h_tokens: 3,
            image_input_tokens: 25,
            image_output_tokens: 0,
        });
    });

    it("keeps prior Anthropic usage when a message_delta contains zero placeholders", () => {
        const acc = new anthropicAccumulator.AnthropicAccumulator();
        acc.addEvent({ data: JSON.stringify({
            type: "message_start",
            message: {
                usage: {
                    input_tokens: 10,
                    cache_creation_input_tokens: 8,
                    cache_creation: {
                        ephemeral_5m_input_tokens: 2,
                        ephemeral_1h_input_tokens: 6,
                    },
                },
            },
        }), event: "message_start" });
        acc.addEvent({ data: JSON.stringify({
            type: "message_delta",
            usage: {
                input_tokens: 0,
                output_tokens: 5,
                cache_creation_input_tokens: 8,
                cache_read_input_tokens: 0,
                cached_tokens: 11,
                cache_creation: {
                    ephemeral_5m_input_tokens: 1,
                    ephemeral_1h_input_tokens: 0,
                },
            },
        }), event: "message_delta" });

        expect(acc.getUsage()).toMatchObject({
            prompt_tokens: 29,
            completion_tokens: 5,
            cache_read_tokens: 11,
            cache_write_tokens: 8,
            cache_creation_5m_tokens: 1,
            cache_creation_1h_tokens: 6,
        });
    });

    it("ignores invalid JSON payloads without changing state", () => {
        const acc = new anthropicAccumulator.AnthropicAccumulator();
        acc.addEvent({ data: "this is not json", event: "message_start" });

        expect(acc.isCompleted()).toBe(false);
        expect(acc.isErrored()).toBe(false);
        expect(acc.isOutputStarted()).toBe(false);
        expect(acc.getError()).toBeNull();
    });

    it("accumulates thinking signature from signature_delta", () => {
        const acc = new anthropicAccumulator.AnthropicAccumulator();
        acc.addEvent({ data: JSON.stringify({ type: "content_block_delta", delta: { type: "signature_delta", signature: "sig_abc" } }), event: "content_block_delta" });

        expect(acc.getResponse().choices[0].message.signature).toBe("sig_abc");
    });

    it("accumulates tool call arguments from input_json_delta (auto-creating the tool_use slot) and parses final input", () => {
        const acc = new anthropicAccumulator.AnthropicAccumulator();
        acc.addEvent({ data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"city\":" } }), event: "content_block_delta" });
        acc.addEvent({ data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: " \"beijing\"}" } }), event: "content_block_delta" });

        const toolUse = acc.getResponse().choices[0].message.tool_use?.[0];
        expect(toolUse?.input_json).toBe("{\"city\": \"beijing\"}");
        expect(toolUse?.input).toEqual({ city: "beijing" });
    });

    it("does not parse the trailing [DONE] marker as JSON after message_stop (issue #14)", () => {
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
        const acc = new anthropicAccumulator.AnthropicAccumulator();

        // OpenRouter's direct Anthropic stream ends with these two SSE events.
        acc.addEvent({ data: JSON.stringify({ type: "message_stop" }), event: "message_stop" });
        acc.addEvent({ data: "[DONE]", event: "data" });

        expect(acc.isCompleted()).toBe(true);
        expect(consoleLog).not.toHaveBeenCalledWith(
            "Failed to parse SSE data:",
            "[DONE]",
            expect.any(SyntaxError),
        );
    });

    it("marks completed when an Anthropic-compatible upstream only sends [DONE]", () => {
        const acc = new anthropicAccumulator.AnthropicAccumulator();

        acc.addEvent({ data: "[DONE]", event: "data" });

        expect(acc.isCompleted()).toBe(true);
    });

    it("does not mark completed when [DONE] follows an upstream error", () => {
        const acc = new anthropicAccumulator.AnthropicAccumulator();
        acc.addEvent({ data: JSON.stringify({ type: "error", error: { message: "rate limited" } }), event: "error" });

        acc.addEvent({ data: "[DONE]", event: "data" });

        expect(acc.isErrored()).toBe(true);
        expect(acc.isCompleted()).toBe(false);
    });

    it("flags output started on lifecycle events (preserves TTFT semantics)", () => {
        const acc = new anthropicAccumulator.AnthropicAccumulator();
        acc.addEvent({ data: JSON.stringify({ type: "message_start", message: { id: "m1", model: "claude" } }), event: "message_start" });

        // message_start 是非完成/非错误事件，按现行 TTFT 语义计为 outputStarted
        expect(acc.isOutputStarted()).toBe(true);
        expect(acc.isCompleted()).toBe(false);
    });

    it("marks errored on error event", () => {
        const acc = new anthropicAccumulator.AnthropicAccumulator();
        acc.addEvent({ data: JSON.stringify({ type: "error", error: { message: "rate limited" } }), event: "error" });

        expect(acc.isErrored()).toBe(true);
        expect(acc.isCompleted()).toBe(false);
    });

    it("reset clears all state", () => {
        const acc = new anthropicAccumulator.AnthropicAccumulator();
        acc.addEvent({ data: JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }), event: "content_block_delta" });
        acc.addEvent({ data: JSON.stringify({ type: "message_stop" }), event: "message_stop" });
        acc.reset();

        expect(acc.isCompleted()).toBe(false);
        expect(acc.isOutputStarted()).toBe(false);
        expect(acc.isErrored()).toBe(false);
        expect(acc.getError()).toBeNull();
        expect(acc.getResponse().choices[0].message.content).toBe("");
    });
});
