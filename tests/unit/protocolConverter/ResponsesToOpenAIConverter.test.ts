import { describe, it, expect } from "vitest";
import { ResponsesToOpenAIConverter } from "../../../src/util/protocolConverter/ResponsesToOpenAIConverter";
import { ConverterFactory } from "../../../src/util/protocolConverter/ConverterFactory";
import { ApiFormat } from "../../../src/constants";
import type {
    ResponsesRequest,
    ResponsesNonStreamResponse,
} from "../../../src/util/protocolConverter/responsesTypes";
import type {
    OpenAIResponse,
    OpenAIChunk,
} from "../../../src/util/protocolConverter/protocolTypes";

describe("ResponsesToOpenAIConverter", () => {
    const converter = new ResponsesToOpenAIConverter("gpt-4");

    // ─── convertRequest 测试 ───

    describe("convertRequest", () => {
        it("should convert simple text request", () => {
            const req: ResponsesRequest = {
                model: "gpt-4",
                input: "Hello, world!",
            };
            const result = converter.convertRequest(req);
            expect(result.model).toBe("gpt-4");
            expect(result.messages).toEqual([
                { role: "user", content: "Hello, world!" },
            ]);
        });

        it("should convert string input to user message", () => {
            const req: ResponsesRequest = {
                model: "gpt-4",
                input: "What is 2+2?",
            };
            const result = converter.convertRequest(req);
            expect(result.messages).toHaveLength(1);
            expect(result.messages[0].role).toBe("user");
            expect(result.messages[0].content).toBe("What is 2+2?");
        });

        it("should convert instructions to system message", () => {
            const req: ResponsesRequest = {
                model: "gpt-4",
                instructions: "You are a helpful assistant.",
                input: "Hi",
            };
            const result = converter.convertRequest(req);
            expect(result.messages).toHaveLength(2);
            expect(result.messages[0]).toEqual({
                role: "system",
                content: "You are a helpful assistant.",
            });
            expect(result.messages[1]).toEqual({
                role: "user",
                content: "Hi",
            });
        });

        it("should convert message array input", () => {
            const req: ResponsesRequest = {
                model: "gpt-4",
                input: [
                    {
                        type: "message",
                        role: "user",
                        content: [
                            { type: "input_text", text: "Hello" },
                        ],
                    },
                    {
                        type: "message",
                        role: "assistant",
                        content: [
                            { type: "output_text", text: "Hi there!" },
                        ],
                    },
                    {
                        type: "message",
                        role: "user",
                        content: [
                            { type: "input_text", text: "How are you?" },
                        ],
                    },
                ],
            };
            const result = converter.convertRequest(req);
            expect(result.messages).toHaveLength(3);
            expect(result.messages[0]).toEqual({ role: "user", content: "Hello" });
            expect(result.messages[1]).toEqual({ role: "assistant", content: "Hi there!" });
            expect(result.messages[2]).toEqual({ role: "user", content: "How are you?" });
        });

        it("should convert system/developer messages", () => {
            const req: ResponsesRequest = {
                model: "gpt-4",
                input: [
                    {
                        type: "message",
                        role: "system",
                        content: [
                            { type: "input_text", text: "Be helpful." },
                        ],
                    },
                    {
                        type: "message",
                        role: "user",
                        content: [
                            { type: "input_text", text: "Hi" },
                        ],
                    },
                ],
            };
            const result = converter.convertRequest(req);
            expect(result.messages).toHaveLength(2);
            expect(result.messages[0]).toEqual({ role: "system", content: "Be helpful." });
            expect(result.messages[1]).toEqual({ role: "user", content: "Hi" });
        });

        it("should convert function_call to assistant with tool_calls", () => {
            const req: ResponsesRequest = {
                model: "gpt-4",
                input: [
                    {
                        type: "function_call",
                        call_id: "call_123",
                        name: "get_weather",
                        arguments: '{"city":"Beijing"}',
                    },
                ],
            };
            const result = converter.convertRequest(req);
            expect(result.messages).toHaveLength(1);
            expect(result.messages[0]).toEqual({
                role: "assistant",
                content: null,
                tool_calls: [{
                    id: "call_123",
                    type: "function",
                    function: {
                        name: "get_weather",
                        arguments: '{"city":"Beijing"}',
                    },
                }],
            });
        });

        it("should convert function_call_output to tool message", () => {
            const req: ResponsesRequest = {
                model: "gpt-4",
                input: [
                    {
                        type: "function_call_output",
                        call_id: "call_123",
                        output: '{"temp":25}',
                    },
                ],
            };
            const result = converter.convertRequest(req);
            expect(result.messages).toHaveLength(1);
            expect(result.messages[0]).toEqual({
                role: "tool",
                tool_call_id: "call_123",
                content: '{"temp":25}',
            });
        });

        it("should merge consecutive function_calls into one assistant message", () => {
            const req: ResponsesRequest = {
                model: "gpt-4",
                input: [
                    {
                        type: "function_call",
                        call_id: "call_00",
                        name: "exec_command",
                        arguments: '{"cmd":"ls"}',
                    },
                    {
                        type: "function_call",
                        call_id: "call_01",
                        name: "exec_command",
                        arguments: '{"cmd":"pwd"}',
                    },
                    {
                        type: "function_call_output",
                        call_id: "call_00",
                        output: "file1.txt\nfile2.txt",
                    },
                    {
                        type: "function_call_output",
                        call_id: "call_01",
                        output: "/home/user",
                    },
                ],
            };
            const result = converter.convertRequest(req);
            // 应该是 3 个消息：assistant(合并的tool_calls), tool(call_00), tool(call_01)
            expect(result.messages).toHaveLength(3);
            expect(result.messages[0]).toEqual({
                role: "assistant",
                content: null,
                tool_calls: [
                    {
                        id: "call_00",
                        type: "function",
                        function: { name: "exec_command", arguments: '{"cmd":"ls"}' },
                    },
                    {
                        id: "call_01",
                        type: "function",
                        function: { name: "exec_command", arguments: '{"cmd":"pwd"}' },
                    },
                ],
            });
            expect(result.messages[1]).toEqual({
                role: "tool",
                tool_call_id: "call_00",
                content: "file1.txt\nfile2.txt",
            });
            expect(result.messages[2]).toEqual({
                role: "tool",
                tool_call_id: "call_01",
                content: "/home/user",
            });
        });

        it("should merge assistant content with subsequent tool_calls", () => {
            // 模拟真实场景：assistant 先回复文本，然后调用工具
            const req: ResponsesRequest = {
                model: "gpt-4",
                input: [
                    { type: "message", role: "user", content: [{ type: "input_text", text: "Run command" }] },
                    { type: "message", role: "assistant", content: [{ type: "output_text", text: "I'll run the command." }] },
                    { type: "function_call", call_id: "call_00", name: "exec_command", arguments: '{"cmd":"ls"}' },
                    { type: "function_call_output", call_id: "call_00", output: "file1.txt" },
                ],
            };
            const result = converter.convertRequest(req);
            // 应该是 3 个消息：user, assistant(合并content+tool_calls), tool
            expect(result.messages).toHaveLength(3);
            expect(result.messages[0]).toEqual({
                role: "user",
                content: "Run command",
            });
            // assistant 消息应该包含 content 和 tool_calls
            expect(result.messages[1].role).toBe("assistant");
            expect(result.messages[1].content).toBe("I'll run the command.");
            expect(result.messages[1].tool_calls).toHaveLength(1);
            expect(result.messages[1].tool_calls?.[0].id).toBe("call_00");
            expect(result.messages[2]).toEqual({
                role: "tool",
                tool_call_id: "call_00",
                content: "file1.txt",
            });
        });

        it("should merge function_call with subsequent message assistant", () => {
            // 模拟真实场景：function_call 后面紧跟 message assistant
            const req: ResponsesRequest = {
                model: "gpt-4",
                input: [
                    { type: "message", role: "user", content: [{ type: "input_text", text: "Run command" }] },
                    { type: "function_call", call_id: "call_00", name: "exec_command", arguments: '{"cmd":"ls"}' },
                    { type: "message", role: "assistant", content: [{ type: "output_text", text: "I ran the command." }] },
                    { type: "function_call_output", call_id: "call_00", output: "file1.txt" },
                ],
            };
            const result = converter.convertRequest(req);
            // 应该是 3 个消息：user, assistant(合并tool_calls+content), tool
            expect(result.messages).toHaveLength(3);
            expect(result.messages[0]).toEqual({
                role: "user",
                content: "Run command",
            });
            // assistant 消息应该包含 tool_calls 和 content
            expect(result.messages[1].role).toBe("assistant");
            expect(result.messages[1].tool_calls).toHaveLength(1);
            expect(result.messages[1].tool_calls?.[0].id).toBe("call_00");
            expect(result.messages[1].content).toBe("I ran the command.");
            expect(result.messages[2]).toEqual({
                role: "tool",
                tool_call_id: "call_00",
                content: "file1.txt",
            });
        });

        it("should skip reasoning items", () => {
            const req: ResponsesRequest = {
                model: "gpt-4",
                input: [
                    {
                        type: "reasoning",
                        summary: [{ type: "summary_text", text: "thinking..." }],
                    },
                    {
                        type: "message",
                        role: "user",
                        content: [
                            { type: "input_text", text: "Hi" },
                        ],
                    },
                ],
            };
            const result = converter.convertRequest(req);
            expect(result.messages).toHaveLength(1);
            expect(result.messages[0]).toEqual({ role: "user", content: "Hi" });
        });

        it("should convert tools", () => {
            const req: ResponsesRequest = {
                model: "gpt-4",
                input: "Hi",
                tools: [
                    {
                        type: "function",
                        name: "get_weather",
                        description: "Get weather info",
                        parameters: {
                            type: "object",
                            properties: {
                                city: { type: "string" },
                            },
                        },
                    },
                ],
            };
            const result = converter.convertRequest(req);
            expect(result.tools).toHaveLength(1);
            expect(result.tools![0]).toEqual({
                type: "function",
                function: {
                    name: "get_weather",
                    description: "Get weather info",
                    parameters: {
                        type: "object",
                        properties: {
                            city: { type: "string" },
                        },
                    },
                },
            });
        });

        it("should convert tool_choice", () => {
            const req: ResponsesRequest = {
                model: "gpt-4",
                input: "Hi",
                tool_choice: "auto",
            };
            const result = converter.convertRequest(req);
            expect(result.tool_choice).toBe("auto");

            const req2: ResponsesRequest = {
                model: "gpt-4",
                input: "Hi",
                tool_choice: "required",
            };
            const result2 = converter.convertRequest(req2);
            expect(result2.tool_choice).toBe("required");

            const req3: ResponsesRequest = {
                model: "gpt-4",
                input: "Hi",
                tool_choice: { type: "function", name: "get_weather" },
            };
            const result3 = converter.convertRequest(req3);
            expect(result3.tool_choice).toEqual({
                type: "function",
                function: { name: "get_weather" },
            });
        });

        it("should convert max_output_tokens to max_tokens", () => {
            const req: ResponsesRequest = {
                model: "gpt-4",
                input: "Hi",
                max_output_tokens: 1000,
            };
            const result = converter.convertRequest(req);
            expect(result.max_tokens).toBe(1000);
        });

        it("should pass through temperature and top_p", () => {
            const req: ResponsesRequest = {
                model: "gpt-4",
                input: "Hi",
                temperature: 0.7,
                top_p: 0.9,
            };
            const result = converter.convertRequest(req);
            expect(result.temperature).toBe(0.7);
            expect(result.top_p).toBe(0.9);
        });
    });

    // ─── convertResponse 测试 ───

    describe("convertResponse", () => {
        it("should convert simple text response", () => {
            const res: OpenAIResponse = {
                id: "chatcmpl-123",
                object: "chat.completion",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    message: {
                        role: "assistant",
                        content: "Hello!",
                    },
                    finish_reason: "stop",
                }],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15,
                },
            };
            const result = converter.convertResponse(res);
            expect(result.status).toBe("completed");
            expect(result.model).toBe("gpt-4");
            expect(result.output).toHaveLength(1);
            expect(result.output[0]).toEqual({
                type: "message",
                id: "msg_chatcmpl-123_0",
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: "Hello!" }],
            });
        });

        it("should convert tool_calls response", () => {
            const res: OpenAIResponse = {
                id: "chatcmpl-123",
                object: "chat.completion",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    message: {
                        role: "assistant",
                        content: null,
                        tool_calls: [{
                            id: "call_123",
                            type: "function",
                            function: {
                                name: "get_weather",
                                arguments: '{"city":"Beijing"}',
                            },
                        }],
                    },
                    finish_reason: "tool_calls",
                }],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15,
                },
            };
            const result = converter.convertResponse(res);
            expect(result.output).toHaveLength(1);
            expect(result.output[0]).toEqual({
                type: "function_call",
                id: "fc_call_123",
                call_id: "call_123",
                name: "get_weather",
                arguments: '{"city":"Beijing"}',
                status: "completed",
            });
        });

        it("should convert reasoning_content response", () => {
            const res: OpenAIResponse = {
                id: "chatcmpl-123",
                object: "chat.completion",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    message: {
                        role: "assistant",
                        content: "Answer",
                        reasoning_content: "Let me think...",
                    },
                    finish_reason: "stop",
                }],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 20,
                    total_tokens: 30,
                },
            };
            const result = converter.convertResponse(res);
            expect(result.output).toHaveLength(2);
            expect(result.output[0]).toEqual({
                type: "message",
                id: "msg_chatcmpl-123_0",
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: "Answer" }],
            });
            expect(result.output[1]).toEqual({
                type: "reasoning",
                id: "rs_chatcmpl-123_0",
                summary: [{ type: "summary_text", text: "Let me think..." }],
            });
        });

        it("should map usage correctly", () => {
            const res: OpenAIResponse = {
                id: "chatcmpl-123",
                object: "chat.completion",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    message: {
                        role: "assistant",
                        content: "Hi",
                    },
                    finish_reason: "stop",
                }],
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 50,
                    total_tokens: 150,
                    prompt_tokens_details: {
                        cached_tokens: 20,
                    },
                    completion_tokens_details: {
                        reasoning_tokens: 10,
                    },
                },
            };
            const result = converter.convertResponse(res);
            expect(result.usage).toEqual({
                input_tokens: 100,
                output_tokens: 50,
                total_tokens: 150,
                input_tokens_details: { cached_tokens: 20 },
                output_tokens_details: { reasoning_tokens: 10 },
            });
        });

        it("should use requestId when provided", () => {
            const res: OpenAIResponse = {
                id: "chatcmpl-123",
                object: "chat.completion",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    message: {
                        role: "assistant",
                        content: "Hi",
                    },
                    finish_reason: "stop",
                }],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15,
                },
            };
            const result = converter.convertResponse(res, "resp_custom");
            expect(result.id).toBe("resp_custom");
        });
    });

    // ─── 流式事件转换测试 ───

    describe("convertStreamEvent", () => {
        it("should convert simple text stream", () => {
            const streamConverter = new ResponsesToOpenAIConverter("gpt-4");
            const events: any[] = [];

            // 首帧
            const chunk1: OpenAIChunk = {
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    delta: { role: "assistant", content: "Hello" },
                    finish_reason: null,
                }],
            };
            events.push(...streamConverter.convertStreamEvent(JSON.stringify(chunk1)));

            // 中间帧
            const chunk2: OpenAIChunk = {
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    delta: { content: " world!" },
                    finish_reason: null,
                }],
            };
            events.push(...streamConverter.convertStreamEvent(JSON.stringify(chunk2)));

            // 结束帧
            const chunk3: OpenAIChunk = {
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: "stop",
                }],
            };
            events.push(...streamConverter.convertStreamEvent(JSON.stringify(chunk3)));

            // usage 帧
            const chunk4: OpenAIChunk = {
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                created: 1234567890,
                model: "gpt-4",
                choices: [],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15,
                },
            };
            events.push(...streamConverter.convertStreamEvent(JSON.stringify(chunk4)));
            events.push(...streamConverter.convertStreamEvent("[DONE]"));

            // 验证事件
            const eventTypes = events.map((e) => JSON.parse(e.data).type);
            expect(eventTypes).toContain("response.created");
            expect(eventTypes).toContain("response.in_progress");
            expect(eventTypes).toContain("response.output_item.added");
            expect(eventTypes).toContain("response.content_part.added");
            expect(eventTypes).toContain("response.output_text.delta");
            expect(eventTypes).toContain("response.output_text.done");
            expect(eventTypes).toContain("response.content_part.done");
            expect(eventTypes).toContain("response.output_item.done");
            expect(eventTypes).toContain("response.completed");

            // 验证 response.completed 的内容
            const completedEvent = events.find((e) => JSON.parse(e.data).type === "response.completed");
            const completedData = JSON.parse(completedEvent.data);
            expect(completedData.response.output).toHaveLength(1);
            expect(completedData.response.output[0].type).toBe("message");
            expect(completedData.response.output[0].content[0].text).toBe("Hello world!");
        });

        it("should convert tool_call stream", () => {
            const streamConverter = new ResponsesToOpenAIConverter("gpt-4");
            const events: any[] = [];

            // 首帧
            const chunk1: OpenAIChunk = {
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    delta: {
                        role: "assistant",
                        tool_calls: [{
                            index: 0,
                            id: "call_123",
                            function: { name: "get_weather", arguments: "" },
                        }],
                    },
                    finish_reason: null,
                }],
            };
            events.push(...streamConverter.convertStreamEvent(JSON.stringify(chunk1)));

            // 参数帧
            const chunk2: OpenAIChunk = {
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    delta: {
                        tool_calls: [{
                            index: 0,
                            function: { arguments: '{"city":"Bei' },
                        }],
                    },
                    finish_reason: null,
                }],
            };
            events.push(...streamConverter.convertStreamEvent(JSON.stringify(chunk2)));

            const chunk3: OpenAIChunk = {
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    delta: {
                        tool_calls: [{
                            index: 0,
                            function: { arguments: 'jing"}' },
                        }],
                    },
                    finish_reason: null,
                }],
            };
            events.push(...streamConverter.convertStreamEvent(JSON.stringify(chunk3)));

            // 结束帧
            const chunk4: OpenAIChunk = {
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: "tool_calls",
                }],
            };
            events.push(...streamConverter.convertStreamEvent(JSON.stringify(chunk4)));

            // usage 帧
            const chunk5: OpenAIChunk = {
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                created: 1234567890,
                model: "gpt-4",
                choices: [],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15,
                },
            };
            events.push(...streamConverter.convertStreamEvent(JSON.stringify(chunk5)));
            events.push(...streamConverter.convertStreamEvent("[DONE]"));

            // 验证 response.completed 的内容
            const parsedEvents = events.map((event) => JSON.parse(event.data));
            const completedData = parsedEvents.find((event) => event.type === "response.completed");
            expect(completedData.response.output).toHaveLength(1);
            expect(completedData.response.output[0].type).toBe("function_call");
            expect(completedData.response.output[0].name).toBe("get_weather");
            expect(completedData.response.output[0].arguments).toBe('{"city":"Beijing"}');
            expect(parsedEvents.filter((event) => event.type === "response.function_call_arguments.done"))
                .toHaveLength(1);
            expect(parsedEvents.filter((event) => event.type === "response.output_item.done"
                && event.item?.type === "function_call"))
                .toHaveLength(1);
        });

        it("should convert reasoning stream", () => {
            const streamConverter = new ResponsesToOpenAIConverter("gpt-4");
            const events: any[] = [];

            // 首帧
            const chunk1: OpenAIChunk = {
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    delta: { role: "assistant", reasoning_content: "Let me think..." },
                    finish_reason: null,
                }],
            };
            events.push(...streamConverter.convertStreamEvent(JSON.stringify(chunk1)));

            // 内容帧
            const chunk2: OpenAIChunk = {
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    delta: { content: "The answer is 42." },
                    finish_reason: null,
                }],
            };
            events.push(...streamConverter.convertStreamEvent(JSON.stringify(chunk2)));

            // 结束帧
            const chunk3: OpenAIChunk = {
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: "stop",
                }],
            };
            events.push(...streamConverter.convertStreamEvent(JSON.stringify(chunk3)));

            // usage 帧
            const chunk4: OpenAIChunk = {
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                created: 1234567890,
                model: "gpt-4",
                choices: [],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 20,
                    total_tokens: 30,
                },
            };
            events.push(...streamConverter.convertStreamEvent(JSON.stringify(chunk4)));
            events.push(...streamConverter.convertStreamEvent("[DONE]"));

            // 验证 response.completed 的内容
            const completedEvent = events.find((e) => JSON.parse(e.data).type === "response.completed");
            const completedData = JSON.parse(completedEvent.data);
            expect(completedData.response.output).toHaveLength(2);
            expect(completedData.response.output[0].type).toBe("message");
            expect(completedData.response.output[0].content[0].text).toBe("The answer is 42.");
            expect(completedData.response.output[1].type).toBe("reasoning");
            expect(completedData.response.output[1].summary[0].text).toBe("Let me think...");
        });

        it("should generate response.completed on [DONE] when no usage frame received", () => {
            const streamConverter = new ResponsesToOpenAIConverter("gpt-4");
            const events: any[] = [];

            // 首帧
            const chunk1: OpenAIChunk = {
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    delta: { role: "assistant", content: "Hi" },
                    finish_reason: null,
                }],
            };
            events.push(...streamConverter.convertStreamEvent(JSON.stringify(chunk1)));

            // 结束帧（无 usage）
            const chunk2: OpenAIChunk = {
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: "stop",
                }],
            };
            events.push(...streamConverter.convertStreamEvent(JSON.stringify(chunk2)));

            // 此时不应该有 response.completed
            let eventTypes = events.map((e) => JSON.parse(e.data).type);
            expect(eventTypes).not.toContain("response.completed");

            // [DONE] 事件
            events.push(...streamConverter.convertStreamEvent("[DONE]"));

            // 现在应该有 response.completed
            eventTypes = events.map((e) => {
                try {
                    return JSON.parse(e.data).type;
                } catch {
                    return null;
                }
            });
            expect(eventTypes).toContain("response.completed");

            // 验证 response.completed 的内容
            const completedEvent = events.find((e) => {
                try {
                    return JSON.parse(e.data).type === "response.completed";
                } catch {
                    return false;
                }
            });
            const completedData = JSON.parse(completedEvent.data);
            expect(completedData.response.output).toHaveLength(1);
            expect(completedData.response.output[0].type).toBe("message");
            expect(completedData.response.output[0].content[0].text).toBe("Hi");
        });

        it("should wait for [DONE] when usage is combined with finish_reason frame", () => {
            const streamConverter = new ResponsesToOpenAIConverter("gpt-4");
            const events: any[] = [];

            // 首帧
            const chunk1: OpenAIChunk = {
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    delta: { role: "assistant", content: "Hello!" },
                    finish_reason: null,
                }],
            };
            events.push(...streamConverter.convertStreamEvent(JSON.stringify(chunk1)));

            // 结束帧 + usage 合并（DeepSeek 风格）
            const chunk2: OpenAIChunk = {
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                created: 1234567890,
                model: "gpt-4",
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: "stop",
                }],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15,
                },
            };
            events.push(...streamConverter.convertStreamEvent(JSON.stringify(chunk2)));

            const preDoneEventTypes = events.map((e) => {
                try {
                    return JSON.parse(e.data).type;
                } catch {
                    return null;
                }
            });
            expect(preDoneEventTypes).not.toContain("response.completed");

            events.push(...streamConverter.convertStreamEvent("[DONE]"));

            const eventTypes = events.map((e) => {
                try {
                    return JSON.parse(e.data).type;
                } catch {
                    return null;
                }
            });
            expect(eventTypes.filter(type => type === "response.completed")).toHaveLength(1);

            // 验证 response.completed 的内容
            const completedEvent = events.find((e) => {
                try {
                    return JSON.parse(e.data).type === "response.completed";
                } catch {
                    return false;
                }
            });
            const completedData = JSON.parse(completedEvent.data);
            expect(completedData.response.output).toHaveLength(1);
            expect(completedData.response.output[0].type).toBe("message");
            expect(completedData.response.output[0].content[0].text).toBe("Hello!");
            expect(completedData.response.usage.input_tokens).toBe(10);
            expect(completedData.response.usage.output_tokens).toBe(5);
        });
    });

    it("finish_reason 后继续累计最终 usage，直到 DONE 才完成一次", () => {
        const streamConverter = new ResponsesToOpenAIConverter("gpt-4");
        const events: any[] = [];

        events.push(...streamConverter.convertStreamEvent(JSON.stringify({
            id: "chatcmpl-usage",
            choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
            usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
        })));

        events.push(...streamConverter.convertStreamEvent(JSON.stringify({
            choices: [{ index: 0, delta: { content: " world" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        })));

        events.push(...streamConverter.convertStreamEvent(JSON.stringify({
            choices: [],
            usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
        })));

        const preDoneEvents = events.map(event => JSON.parse(event.data));
        expect(preDoneEvents.some(event => event.type === "response.completed")).toBe(false);

        const doneEvents = streamConverter.convertStreamEvent("[DONE]")
            .map(event => JSON.parse(event.data));
        const completed = doneEvents.filter(event => event.type === "response.completed");
        expect(completed).toHaveLength(1);
        expect(completed[0].response.output[0].content[0].text).toBe("Hello world");
        expect(completed[0].response.usage.output_tokens).toBe(8);
        expect(completed[0].response.usage.total_tokens).toBe(18);

        expect(streamConverter.convertStreamEvent("[DONE]"))
            .toHaveLength(0);
    });


    it("只有中途 usage 时等到 DONE 才完成，且保留已累计用量", () => {
        const streamConverter = new ResponsesToOpenAIConverter("gpt-4");
        streamConverter.convertStreamEvent(JSON.stringify({
            choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
            usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
        }));
        const finishing = streamConverter.convertStreamEvent(JSON.stringify({
            choices: [{ index: 0, delta: { content: " world" }, finish_reason: "stop" }],
        }));
        expect(finishing.some(event => event.data.includes('"response.completed"'))).toBe(false);
        const completed = streamConverter.convertStreamEvent("[DONE]")
            .map(event => JSON.parse(event.data))
            .find(event => event.type === "response.completed");
        expect(completed.response.output[0].content[0].text).toBe("Hello world");
        expect(completed.response.usage.input_tokens).toBe(10);
    });


    it.each([
        { error: { message: "upstream busy", code: "server_error", param: "model" } },
        { type: "error", message: "upstream busy", code: "server_error", param: "model" },
    ])("将中途上游错误转换为 Responses 错误终态：%j", errorPayload => {
        const streamConverter = new ResponsesToOpenAIConverter("gpt-4");
        const started = streamConverter.convertStreamEvent(JSON.stringify({
            choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }],
        })).map(event => JSON.parse(event.data));
        const events = streamConverter.convertStreamEvent(JSON.stringify(errorPayload));

        expect(events).toHaveLength(1);
        expect(events[0].event).toBe("error");
        const error = JSON.parse(events[0].data);
        expect(error).toEqual({
            type: "error", code: "server_error", message: "upstream busy", param: "model",
            sequence_number: started[started.length - 1].sequence_number + 1,
        });
        expect(streamConverter.convertStreamEvent("[DONE]")).toHaveLength(0);
    });


    it("首帧错误只生成错误事件，并为缺失的错误字段提供默认值", () => {
        const streamConverter = new ResponsesToOpenAIConverter("gpt-4");
        const events = streamConverter.convertStreamEvent(JSON.stringify({ error: { message: "upstream busy" } }));

        expect(events).toHaveLength(1);
        expect(events[0].event).toBe("error");
        expect(JSON.parse(events[0].data)).toEqual({
            type: "error", code: "upstream_error", message: "upstream busy", param: null,
            sequence_number: 1,
        });
        expect(streamConverter.convertStreamEvent("[DONE]")).toHaveLength(0);
    });


    it.each(["tool_calls", null])("工具仅收尾一次，finish_reason=%s 时均等待 DONE 完成", (finishReason) => {
        const streamConverter = new ResponsesToOpenAIConverter("gpt-4");

        // 复用转换器并复用工具索引，验证上一条流的收尾状态不会泄漏。
        for (let request = 0; request < 2; request++) {
            const toolCalls = [0, 1].map(index => ({
                index,
                id: `call_${request}_${index}`,
                type: "function",
                function: { name: `lookup_${index}`, arguments: JSON.stringify({ index }) },
            }));
            const events = streamConverter.convertStreamEvent(JSON.stringify({
                choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }],
            })).map(event => JSON.parse(event.data));

            if (finishReason) {
                events.push(...streamConverter.convertStreamEvent(JSON.stringify({
                    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
                    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
                })).map(event => JSON.parse(event.data)));
            }
            events.push(...streamConverter.convertStreamEvent(JSON.stringify({
                choices: [],
                usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
            })).map(event => JSON.parse(event.data)));

            expect(events.filter(event => event.type === "response.completed")).toHaveLength(0);
            for (const tool of toolCalls) {
                expect(events.filter(event => event.type === "response.function_call_arguments.done"
                    && event.item_id === `fc_${tool.id}`)).toHaveLength(finishReason ? 1 : 0);
            }

            events.push(...streamConverter.convertStreamEvent("[DONE]")
                .map(event => JSON.parse(event.data)));

            for (const tool of toolCalls) {
                const argumentsDone = events.filter(event => event.type === "response.function_call_arguments.done"
                    && event.item_id === `fc_${tool.id}`);
                expect(argumentsDone).toHaveLength(1);
                expect(argumentsDone[0].arguments).toBe(tool.function.arguments);
                expect(events.filter(event => event.type === "response.output_item.done"
                    && event.item.id === `fc_${tool.id}`)).toHaveLength(1);
            }
            const completed = events.filter(event => event.type === "response.completed");
            expect(completed).toHaveLength(1);
            expect(events[events.length - 1]).toBe(completed[0]);
            expect(completed[0].response.usage.output_tokens).toBe(8);
            expect(completed[0].response.output).toEqual(toolCalls.map(tool => ({
                id: `fc_${tool.id}`,
                type: "function_call",
                status: "completed",
                arguments: tool.function.arguments,
                call_id: tool.id,
                name: tool.function.name,
            })));
            expect(streamConverter.convertStreamEvent("[DONE]")).toHaveLength(0);
        }
    });


    // ─── ConverterFactory 测试 ───

    describe("ConverterFactory", () => {
        it("should create ResponsesToOpenAIConverter for RESPONSES → OPENAI", () => {
            const converter = ConverterFactory.create(ApiFormat.RESPONSES, ApiFormat.OPENAI, "gpt-4");
            expect(converter).toBeInstanceOf(ResponsesToOpenAIConverter);
        });

        it("should create OpenAIToResponsesConverter for OPENAI → RESPONSES", () => {
            const converter = ConverterFactory.create(ApiFormat.OPENAI, ApiFormat.RESPONSES, "gpt-4");
            expect(converter).not.toBeNull();
        });
    });
});
