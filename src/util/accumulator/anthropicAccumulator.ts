/**
 * Anthropic Messages 流式响应累加器
 * 累积 Messages delta 流，组装成与 OpenAI Chat 同构的完整响应对象（AccumulatedResponse）。
 * 与 openaiChatAccumulator / responsesAccumulator 并列，各处理一种协议。
 */

import type { ProtocolStreamEvent } from "../protocolConverter/protocolTypes";
import { AccumulatorBase } from "./accumulatorBase";
import type { AccumulatedResponse } from "./accumulatorTypes";

interface AnthropicChunk {
    type?: string;
    message?: {
        id?: string;
        type?: string;
        role?: string;
        content?: any[];
        model?: string;
        stop_reason?: string | null;
        stop_sequence?: string | null;
        usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_read_tokens?: number;
            cached_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_creation_tokens?: number;
            cache_write_input_tokens?: number;
            cache_write_tokens?: number;
            cache_creation?: {
                ephemeral_5m_input_tokens?: number;
                ephemeral_1h_input_tokens?: number;
            };
            input_tokens_details?: {
                cached_tokens?: number;
                cache_creation_tokens?: number;
                cache_write_tokens?: number;
                cache_creation_5m_tokens?: number;
                cache_creation_1h_tokens?: number;
                image_tokens?: number;
            };
            output_tokens_details?: { image_tokens?: number };
        };
    };
    content_block?: {
        type?: "thinking" | "text" | "tool_use";
        thinking?: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
    };
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_read_tokens?: number;
        cached_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_creation_tokens?: number;
        cache_write_input_tokens?: number;
        cache_write_tokens?: number;
        cache_creation?: {
            ephemeral_5m_input_tokens?: number;
            ephemeral_1h_input_tokens?: number;
        };
        input_tokens_details?: {
            cached_tokens?: number;
            cache_creation_tokens?: number;
            cache_write_tokens?: number;
            cache_creation_5m_tokens?: number;
            cache_creation_1h_tokens?: number;
            image_tokens?: number;
        };
        output_tokens_details?: { image_tokens?: number };
    };
    delta?: {
        type?: "text_delta" | "thinking_delta" | "signature_delta" | "input_json_delta";
        text?: string;
        thinking?: string;
        signature?: string;
        partial_json?: string;
        stop_reason?: string | null;
        stop_sequence?: string | null;
    };
    index?: number;
}


function firstPositiveOrDefined(...values: Array<number | null | undefined>): number | undefined {
    let zeroValue: number | undefined;
    for (const value of values) {
        if (value === null || value === undefined || !Number.isFinite(value)) continue;
        if (value > 0) return value;
        zeroValue = Math.max(0, value);
    }
    return zeroValue;
}


function mergeStreamToken(
    current: number | null | undefined,
    incoming: number | undefined,
    preservePositive: boolean,
): number | null {
    if (incoming === undefined) return current ?? null;
    if (preservePositive && incoming === 0 && current != null && current > 0) return current;
    return incoming;
}


export class AnthropicAccumulator extends AccumulatorBase {
    private response: AccumulatedResponse = {
        choices: [{ index: 0, message: { content: "", thinking: "", signature: "" }, finish_reason: null }],
    };

    /**
     * 普通输入基数（Anthropic input_tokens 语义：不含缓存读取和缓存创建）。
     * 口径统一为总量 = 该基数 + cache_read_input_tokens + cache_creation_input_tokens。
     * 上游未提供时为 null（区别于返回 0）。
     */
    private inputTokens: number | null = null;

    /**
     * 添加一条客户端 SSE 事件（原始 data 字符串）
     * 内部解析并检测完成/错误/首个输出。
     */
    addEvent(clientEvent: ProtocolStreamEvent): void {
        // Some Anthropic-compatible upstreams append OpenAI-style [DONE] after
        // the standard message_stop event. It is an SSE terminal marker, not JSON.
        if (clientEvent.data === "[DONE]") {
            if (!this.isErrored()) {
                this.markCompleted();
            }
            return;
        }

        let parsed: AnthropicChunk;
        try {
            parsed = JSON.parse(clientEvent.data);
        } catch (e) {
            console.log("Failed to parse SSE data:", clientEvent.data, e);
            return;
        }

        // 错误事件检测
        if (clientEvent.event === "error" || (parsed as any)?.type === "error" || (parsed as any)?.error !== undefined) {
            this.markError(parsed);
            return;
        }

        // Anthropic 流结束标记：message_stop 仍需累积 usage/stop_reason
        if (clientEvent.event === "message_stop") {
            this.handleAnthropicMessage(parsed, clientEvent.event);
            this.markCompleted();
            return;
        }

        // 其余非完成/非错误事件：标记首个输出已到达
        // （保留原 `!isCompleted` 的 TTFT 语义：含 message_start 等首事件）
        this.markOutputStarted();
        this.handleAnthropicMessage(parsed, clientEvent.event);
    }

    /**
     * 处理 Anthropic 格式的消息
     * @param msg - SSE 消息对象
     * @param eventType - SSE 事件类型（message_start, content_block_delta, message_delta, message_stop 等）
     *
     * 事件处理逻辑：
     * - message_start: 保存 id, model, role, 初始 usage
     * - content_block_delta: 根据 delta.type 处理
     *   - thinking_delta → message.thinking += delta.thinking
     *   - signature_delta → message.signature = delta.signature
     *   - text_delta → message.content += delta.text
     * - message_delta: 更新 stop_reason (在 delta 中) 和最终 usage
     * - message_stop: 响应结束（无需处理）
     */
    private handleAnthropicMessage(msg: AnthropicChunk, eventType?: string): void {
        // message_start 事件：保存基本信息
        if (eventType === 'message_start' && msg.message) {
            if (msg.message.id) this.response.id = msg.message.id;
            if (msg.message.model) this.response.model = msg.message.model;
            if (msg.message.role) this.response.choices[0].message.role = msg.message.role;

            // 初始化 usage（input_tokens 在这里提供）:统一交由 accumulateUsage 合并
            if (msg.message.usage) {
                this.accumulateUsage(msg.message.usage, false);
            }
            return;
        }

        if (eventType === "content_block_start" && msg.content_block?.type === "tool_use") {
            const toolUseList = this.response.choices[0].message.tool_use ?? [];
            const toolIndex = msg.index ?? 0;

            while (toolUseList.length <= toolIndex) {
                toolUseList.push({ input_json: "" });
            }

            toolUseList[toolIndex] = {
                ...toolUseList[toolIndex],
                id: msg.content_block.id ?? toolUseList[toolIndex].id,
                name: msg.content_block.name ?? toolUseList[toolIndex].name,
                input: msg.content_block.input ?? toolUseList[toolIndex].input,
                input_json: toolUseList[toolIndex].input_json ?? "",
            };

            this.response.choices[0].message.tool_use = toolUseList;
            return;
        }

        // content_block_delta 事件：累积内容增量
        if (eventType === 'content_block_delta' && msg.delta) {
            const deltaType = msg.delta.type;

            // 根据 delta.type 区分处理
            if (deltaType === 'thinking_delta' && msg.delta.thinking) {
                // 累积 thinking 内容到 choices[0].message.thinking
                if (this.response.choices[0].message.thinking === undefined) {
                    this.response.choices[0].message.thinking = "";
                }
                this.response.choices[0].message.thinking += msg.delta.thinking;
            } else if (deltaType === 'signature_delta' && msg.delta.signature) {
                // 保存 thinking 签名（必需，用于工具调用）
                this.response.choices[0].message.signature = msg.delta.signature;
            } else if (deltaType === 'text_delta' && msg.delta.text) {
                // 累积 text 内容到 choices[0].message.content
                this.response.choices[0].message.content += msg.delta.text;
            } else if (deltaType === "input_json_delta" && msg.delta.partial_json !== undefined) {
                const toolUseList = this.response.choices[0].message.tool_use ?? [];
                const toolIndex = msg.index ?? 0;

                while (toolUseList.length <= toolIndex) {
                    toolUseList.push({ input_json: "" });
                }

                toolUseList[toolIndex].input_json = (toolUseList[toolIndex].input_json ?? "") + msg.delta.partial_json;
                this.response.choices[0].message.tool_use = toolUseList;
            }
            return;
        }

        // message_delta/message_stop 事件：更新 stop_reason 和最终 usage
        if (eventType === 'message_delta' || eventType === 'message_stop') {
            // stop_reason 可能在 delta 对象中（message_delta）或直接在消息中
            const stopReason = msg.delta?.stop_reason ?? msg.message?.stop_reason;
            if (stopReason !== undefined) {
                this.response.choices[0].finish_reason = stopReason;
            }

            // 更新最终的 usage（output_tokens 在这里最终确定）:统一交由 accumulateUsage 合并
            if (msg.message?.usage || msg.usage) {
                const usage = msg.usage || msg.message?.usage;
                if (usage) {
                    this.accumulateUsage(usage, true);
                }
            }
            return;
        }
    }

    /**
     * 把一条 anthropic usage 合并进唯一的累积源 this.response.usage。
     * 合并规则:当前 usage 某字段为 null/undefined 时保留之前累积值,否则采用当前的
     * (注意 ?? 只回退 null/undefined——当前若为 0 也会被当作「已提供」而采用)。
     * 合并后,读取方(getUsage 等)统一从 this.response.usage 取值。
     */
    private accumulateUsage(usage: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_read_tokens?: number;
        cached_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_creation_tokens?: number;
        cache_write_input_tokens?: number;
        cache_write_tokens?: number;
        cache_creation?: {
            ephemeral_5m_input_tokens?: number;
            ephemeral_1h_input_tokens?: number;
        };
        input_tokens_details?: {
            cached_tokens?: number;
            cache_creation_tokens?: number;
            cache_write_tokens?: number;
            cache_creation_5m_tokens?: number;
            cache_creation_1h_tokens?: number;
            image_tokens?: number;
        };
        output_tokens_details?: { image_tokens?: number };
    }, preservePositive: boolean): void {
        const prev = this.response.usage;
        this.inputTokens = mergeStreamToken(this.inputTokens, usage.input_tokens, preservePositive);
        const inputDetails = usage.input_tokens_details;
        const cacheRead = mergeStreamToken(
            prev?.cache_read_tokens,
            firstPositiveOrDefined(
                usage.cache_read_input_tokens,
                usage.cache_read_tokens,
                usage.cached_tokens,
                inputDetails?.cached_tokens,
            ),
            preservePositive,
        );
        const cacheCreation5m = mergeStreamToken(
            prev?.cache_creation_5m_tokens,
            firstPositiveOrDefined(
                usage.cache_creation?.ephemeral_5m_input_tokens,
                inputDetails?.cache_creation_5m_tokens,
            ),
            preservePositive,
        );
        const cacheCreation1h = mergeStreamToken(
            prev?.cache_creation_1h_tokens,
            firstPositiveOrDefined(
                usage.cache_creation?.ephemeral_1h_input_tokens,
                inputDetails?.cache_creation_1h_tokens,
            ),
            preservePositive,
        );
        const detailedCacheCreation = cacheCreation5m !== null || cacheCreation1h !== null
            ? (cacheCreation5m ?? 0) + (cacheCreation1h ?? 0)
            : null;
        let cacheWrite = mergeStreamToken(
            prev?.cache_write_tokens,
            firstPositiveOrDefined(
                usage.cache_creation_input_tokens,
                usage.cache_creation_tokens,
                usage.cache_write_input_tokens,
                usage.cache_write_tokens,
                inputDetails?.cache_creation_tokens,
                inputDetails?.cache_write_tokens,
            ),
            preservePositive,
        );
        if ((cacheWrite === null || cacheWrite === 0) && (detailedCacheCreation ?? 0) > 0) {
            cacheWrite = detailedCacheCreation;
        }
        this.response.usage = {
            // 统一 OpenAI 口径：prompt_tokens 是普通输入、缓存读取和缓存创建的总量。
            prompt_tokens: this.inputTokens != null
                ? this.inputTokens + (cacheRead ?? 0) + (cacheWrite ?? 0)
                : null,
            completion_tokens: mergeStreamToken(prev?.completion_tokens, usage.output_tokens, preservePositive),
            cache_read_tokens: cacheRead,
            cache_write_tokens: cacheWrite,
            cache_creation_5m_tokens: cacheCreation5m,
            cache_creation_1h_tokens: cacheCreation1h,
            image_input_tokens: mergeStreamToken(
                prev?.image_input_tokens,
                inputDetails?.image_tokens,
                preservePositive,
            ),
            image_output_tokens: mergeStreamToken(
                prev?.image_output_tokens,
                usage.output_tokens_details?.image_tokens,
                preservePositive,
            ),
        };
    }

    /**
     * 获取累积的完整响应
     */
    getResponse(): AccumulatedResponse {
        const toolUseList = this.response.choices[0]?.message.tool_use;
        if (toolUseList) {
            for (const toolUse of toolUseList) {
                if (!toolUse) continue;
                if (toolUse.input_json) {
                    try {
                        toolUse.input = JSON.parse(toolUse.input_json);
                    } catch {
                        // Keep raw input_json when partial JSON is invalid or incomplete.
                    }
                }
            }
        }
        return this.response;
    }

    /**
     * 获取累积的文本内容
     */
    getText(): string {
        return this.response.choices[0]?.message.content ?? "";
    }

    /**
     * 获取累积的 usage（来自 message_start / message_delta / message_stop）
     */
    getUsage(): AccumulatedResponse["usage"] | null {
        return this.response.usage ?? null;
    }

    /**
     * 重置累加器
     */
    reset(): void {
        this.response = {
            choices: [
                { index: 0, message: { content: "", thinking: "", signature: "" }, finish_reason: null },
            ],
        };
        this.inputTokens = null;
        this.resetState();
    }
}

export default {
    AnthropicAccumulator,
};
