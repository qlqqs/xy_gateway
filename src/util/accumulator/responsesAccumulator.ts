/**
 * OpenAI Responses API SSE 消息累加器
 * 用于累积流式 Responses API 响应，生成完整的响应对象
 *
 * 事件处理逻辑：
 * - response.created       → 保存 id, model, created_at, object
 * - response.output_item.added  → 初始化 output 数组中对应位置的 item
 * - response.content_part.added → 初始化 content 数组中对应位置的 part
 * - response.output_text.delta  → 累积文本增量
 * - response.output_text.done   → 用完整文本覆盖（更可靠）
 * - response.output_item.done   → 更新 item status 和最终 content
 * - response.completed     → 用完整 response 对象覆盖（包含 usage）
 */

import type { ProtocolStreamEvent } from "../protocolConverter/protocolTypes";
import type { ResponsesStreamEvent } from "../protocolConverter/responsesTypes";
import { AccumulatorBase } from "./accumulatorBase";
import type { AccumulatedUsage } from "./accumulatorTypes";

interface ResponsesContentPart {
    type?: string;
    text?: string;
    annotations?: any[];
}

interface ResponsesOutputItem {
    id?: string;
    type?: string;
    role?: string;
    status?: string;
    content: ResponsesContentPart[];
}

/**
 * 归一化后的 usage（统一 OpenAI 口径键：prompt_tokens 为含缓存的输入总量，cache_read_tokens 为其子集）。
 * 上游 Responses 原生键（input_tokens / input_tokens_details.cached_tokens）在落地时转换。
 * 缺失字段为 null，明确返回 0 则为 0（与 SgRecordUsage 同口径）。
 */
type ResponsesUsage = AccumulatedUsage;

interface ResponsesAccumulatedResponse {
    id?: string;
    object?: string;
    created_at?: number;
    model?: string;
    status?: string;
    output: ResponsesOutputItem[];
    usage?: ResponsesUsage;
    completed_at?: number;
}

export class ResponsesAccumulator extends AccumulatorBase {
    // 标记“模型已开始产出内容”的事件类型。
    // 这些事件出现即表示首个输出 token 已到达（区别于 response.created/in_progress 等前置控制事件）。
    private static OUTPUT_STARTED_EVENTS = new Set([
        "response.output_item.added",
        "response.content_part.added",
        "response.output_text.delta",
        "response.function_call_arguments.delta",
        "response.reasoning_summary_text.delta",
        "response.reasoning_summary_part.added",
    ]);

    private response: ResponsesAccumulatedResponse = {
        output: [],
    };


    /**
     * 添加一条 Responses API 客户端 SSE 事件（原始 data 字符串）
     * 内部解析为 ResponsesStreamEvent 并检测完成/错误/首个输出，与 OpenAIChatAccumulator.addEvent 同构。
     */
    addEvent(clientEvent: ProtocolStreamEvent): void {
        let event: Record<string, any>;
        try {
            event = JSON.parse(clientEvent.data) as ResponsesStreamEvent as Record<string, any>;
        } catch {
            return;
        }
        const eventName = clientEvent.event;
        const type: string = event.type ?? "";

        if (ResponsesAccumulator.OUTPUT_STARTED_EVENTS.has(type)) {
            this.markOutputStarted();
        }

        if (this.isErrorEvent(event, eventName)) {
            this.markError(event);
            return;
        }

        if (type === "response.created" || type === "response.in_progress") {
            this.handleResponseCreated(event.response);
            return;
        }

        if (type === "response.output_item.added") {
            this.handleOutputItemAdded(event.output_index ?? 0, event.item);
            return;
        }

        if (type === "response.content_part.added") {
            this.handleContentPartAdded(event.output_index ?? 0, event.content_index ?? 0, event.part);
            return;
        }

        if (type === "response.output_text.delta") {
            this.handleOutputTextDelta(event.output_index ?? 0, event.content_index ?? 0, event.delta ?? "");
            return;
        }

        if (type === "response.output_text.done") {
            this.handleOutputTextDone(event.output_index ?? 0, event.content_index ?? 0, event.text ?? "");
            return;
        }

        if (type === "response.output_item.done") {
            this.handleOutputItemDone(event.output_index ?? 0, event.item);
            return;
        }

        if (type === "response.completed") {
            this.markCompleted();
            this.handleResponseCompleted(event.response);
            return;
        }
    }


    private isErrorEvent(event: Record<string, any>, eventName?: string): boolean {
        return eventName === "error"
            || event.type === "error"
            || event.type === "response.failed"
            || event.error !== undefined;
    }


    private handleResponseCreated(responseObj: Record<string, any> | undefined): void {
        if (!responseObj) return;
        if (responseObj.id) this.response.id = responseObj.id;
        if (responseObj.object) this.response.object = responseObj.object;
        if (responseObj.created_at) this.response.created_at = responseObj.created_at;
        if (responseObj.model) this.response.model = responseObj.model;
        if (responseObj.status) this.response.status = responseObj.status;
    }


    private ensureOutputItem(outputIndex: number): void {
        while (this.response.output.length <= outputIndex) {
            this.response.output.push({ content: [] });
        }
    }


    private handleOutputItemAdded(outputIndex: number, item: Record<string, any> | undefined): void {
        this.ensureOutputItem(outputIndex);
        if (!item) return;
        const existing = this.response.output[outputIndex];
        this.response.output[outputIndex] = {
            id: item.id ?? existing.id,
            type: item.type ?? existing.type,
            role: item.role ?? existing.role,
            status: item.status ?? existing.status,
            content: existing.content,
        };
    }


    private handleContentPartAdded(
        outputIndex: number,
        contentIndex: number,
        part: Record<string, any> | undefined,
    ): void {
        this.ensureOutputItem(outputIndex);
        const item = this.response.output[outputIndex];

        while (item.content.length <= contentIndex) {
            item.content.push({});
        }

        if (part) {
            item.content[contentIndex] = {
                type: part.type ?? item.content[contentIndex].type,
                text: part.text ?? item.content[contentIndex].text ?? "",
                annotations: part.annotations ?? item.content[contentIndex].annotations ?? [],
            };
        }
    }


    private handleOutputTextDelta(outputIndex: number, contentIndex: number, delta: string): void {
        this.ensureOutputItem(outputIndex);
        const item = this.response.output[outputIndex];

        while (item.content.length <= contentIndex) {
            item.content.push({ text: "" });
        }

        item.content[contentIndex].text = (item.content[contentIndex].text ?? "") + delta;
    }


    private handleOutputTextDone(outputIndex: number, contentIndex: number, text: string): void {
        this.ensureOutputItem(outputIndex);
        const item = this.response.output[outputIndex];

        while (item.content.length <= contentIndex) {
            item.content.push({});
        }

        // 用完整文本覆盖增量累积的结果，确保准确
        item.content[contentIndex].text = text;
    }


    private handleOutputItemDone(outputIndex: number, item: Record<string, any> | undefined): void {
        if (!item) return;
        this.ensureOutputItem(outputIndex);
        const existing = this.response.output[outputIndex];

        this.response.output[outputIndex] = {
            id: item.id ?? existing.id,
            type: item.type ?? existing.type,
            role: item.role ?? existing.role,
            status: item.status ?? existing.status,
            // done 事件携带最终 content，直接覆盖
            content: item.content ?? existing.content,
        };
    }


    /**
     * Responses 原生 usage → 归一化口径（prompt_tokens 总量含缓存 / completion_tokens / cache_read_tokens）
     */
    private toCanonicalUsage(usage: Record<string, any> | undefined): ResponsesUsage | undefined {
        if (!usage) return undefined;
        const inputDetails = usage.input_tokens_details as Record<string, any> | undefined;
        const promptDetails = usage.prompt_tokens_details as Record<string, any> | undefined;
        const outputDetails = usage.output_tokens_details as Record<string, any> | undefined;
        const completionDetails = usage.completion_tokens_details as Record<string, any> | undefined;
        const cacheCreation = usage.cache_creation as Record<string, any> | undefined;
        const cacheCreation5m = cacheCreation?.ephemeral_5m_input_tokens
            ?? inputDetails?.cache_creation_5m_tokens
            ?? promptDetails?.cache_creation_5m_tokens
            ?? usage.cache_creation_5m_tokens
            ?? null;
        const cacheCreation1h = cacheCreation?.ephemeral_1h_input_tokens
            ?? inputDetails?.cache_creation_1h_tokens
            ?? promptDetails?.cache_creation_1h_tokens
            ?? usage.cache_creation_1h_tokens
            ?? null;
        let cacheWrite = inputDetails?.cache_write_tokens
            ?? promptDetails?.cache_write_tokens
            ?? inputDetails?.cache_creation_tokens
            ?? promptDetails?.cache_creation_tokens
            ?? usage.cache_creation_input_tokens
            ?? usage.cache_write_input_tokens
            ?? usage.cache_write_tokens
            ?? usage.cache_creation_tokens
            ?? (cacheCreation5m !== null || cacheCreation1h !== null
                ? (cacheCreation5m ?? 0) + (cacheCreation1h ?? 0)
                : null);
        const detailedCacheCreation = (cacheCreation5m ?? 0) + (cacheCreation1h ?? 0);
        if ((cacheWrite === null || cacheWrite === 0) && detailedCacheCreation > 0) {
            cacheWrite = detailedCacheCreation;
        }
        const canonicalOutputDetails = outputDetails ?? completionDetails;
        return {
            prompt_tokens: usage.input_tokens ?? usage.prompt_tokens ?? null,
            completion_tokens: usage.output_tokens ?? usage.completion_tokens ?? null,
            cache_read_tokens: inputDetails?.cached_tokens
                ?? promptDetails?.cached_tokens
                ?? usage.cache_read_input_tokens
                ?? usage.cache_read_tokens
                ?? usage.cached_tokens
                ?? null,
            cache_write_tokens: cacheWrite,
            cache_creation_5m_tokens: cacheCreation5m,
            cache_creation_1h_tokens: cacheCreation1h,
            image_input_tokens: inputDetails?.image_tokens
                ?? promptDetails?.image_tokens
                ?? usage.image_input_tokens
                ?? null,
            image_output_tokens: outputDetails?.image_tokens
                ?? completionDetails?.image_tokens
                ?? usage.image_output_tokens
                ?? null,
            completion_tokens_details: canonicalOutputDetails ? {
                reasoning_tokens: canonicalOutputDetails.reasoning_tokens,
                image_tokens: canonicalOutputDetails.image_tokens,
            } : undefined,
        };
    }


    private handleResponseCompleted(responseObj: Record<string, any> | undefined): void {
        if (!responseObj) return;
        // response.completed 包含最终完整的 response 对象，直接覆盖
        if (responseObj.id) this.response.id = responseObj.id;
        if (responseObj.object) this.response.object = responseObj.object;
        if (responseObj.created_at) this.response.created_at = responseObj.created_at;
        if (responseObj.model) this.response.model = responseObj.model;
        if (responseObj.status) this.response.status = responseObj.status;
        if (responseObj.output) this.response.output = responseObj.output;
        if (responseObj.usage) this.response.usage = this.toCanonicalUsage(responseObj.usage);
        if (responseObj.completed_at) this.response.completed_at = responseObj.completed_at;
    }


    /**
     * 获取当前累积的完整响应对象
     */
    getResponse(): ResponsesAccumulatedResponse {
        return this.response;
    }


    /**
     * 获取最终 usage
     */
    getUsage(): ResponsesUsage | null {
        return this.response.usage ?? null;
    }


    /**
     * 获取第一个 output item 的纯文本内容
     */
    getText(): string {
        const firstItem = this.response.output[0];
        if (!firstItem) return "";
        return firstItem.content
            .filter((p) => p.type === "output_text" || p.text !== undefined)
            .map((p) => p.text ?? "")
            .join("");
    }


    /**
     * 重置累加器
     */
    reset(): void {
        this.response = { output: [] };
        this.resetState();
    }
}

export default {
    ResponsesAccumulator,
};
