# XY Gateway 外部接口文档

本文档描述 XY Gateway（星野网关）当前版本对外提供的 HTTP 接口。内容以运行时代码和实际路由为准，适用于本地 Node 和 Tauri 内置 Node 服务。当前文档对应的实现使用 Node 运行时；管理接口需要访问本机数据库和配置文件。

## 1. 文档信息

| 项目 | 内容 |
| --- | --- |
| 当前版本 | `1.0.0`（以 `package.json` 为准） |
| 默认 Node 地址 | `http://127.0.0.1:8720` |
| Docker 示例地址 | `http://127.0.0.1:8787` |
| LLM 标准入口 | `/v1/*` |
| LLM 兼容入口 | `/llm/v1/*` |
| 外部管理入口 | `/api/v1/admin/*`（Node-only） |
| 字符编码 | UTF-8 |
| 默认媒体类型 | `application/json` |

本文中的 `BASE_URL` 表示实际部署地址，例如：

```bash
BASE_URL=http://127.0.0.1:8720
```

生产环境应使用 HTTPS。除非特别说明，路径中的 `:id`、`:keyId`、`:modelId` 都是正整数 ID。

## 2. 快速索引

- [通用约定](#3-通用约定)
- [认证](#4-认证)
- [统一错误](#5-统一错误)
- [LLM API](#6-llm-api)
- [Node 管理 API](#7-node-管理-api)
- [管理 API 路由总表](#72-67-条管理路由总表)
- [数据与计费口径](#8-数据与计费口径)
- [兼容路径与不支持范围](#9-兼容路径与不支持范围)
- [安全与运维建议](#10-安全与运维建议)

## 3. 通用约定

### 3.1 请求与响应

- JSON 请求必须发送 `Content-Type: application/json`。
- LLM 和对象型管理接口的 JSON 请求体必须是对象；数组、纯字符串和空的非法 JSON 会被拒绝。批量接口仍使用对象包装数组字段。
- 成功响应通常直接返回 DTO 或 `{ "list": [], "total": 0 }`，不会额外包一层 `data`。
- 时间字段在接口序列化后通常为 ISO-8601 字符串，例如 `2026-09-09T12:00:00.000Z`。部分旧数据库值可能以数字或原始字符串保留，记录接口会尽量统一为 ISO 字符串。
- 布尔字段返回 JSON 布尔值；配置接口中的配置值例外，统一以字符串保存和返回。
- 未找到资源使用 404；参数校验通常使用 400；冲突（名称、Key、渠道码重复）使用 409。
- 列表排序默认按 ID 倒序；供应商模型列表按 `model_id` 升序；网关模型的上游顺序按提交数组顺序保存。

### 3.2 分页

适用列表接口支持以下查询参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `page` | 正整数 | `1` | 页码，仅在未提供 `offset` 时参与计算 |
| `pageSize` | 正整数 | `10` | 每页数量，最大 `100` |
| `limit` | 正整数 | `10` | `pageSize` 的兼容别名；同时提供时 `pageSize` 优先 |
| `offset` | 非负整数 | `(page - 1) * pageSize` | 显式提供时优先于页码计算 |

无效或非正的 `page/pageSize/limit` 会回退到默认值，而不是返回 400；`offset` 的负值会回退到计算值。充值记录和“最近记录”也遵循同一解析器，但默认数量仍为 10。

### 3.3 ID、名称和查询字符串

- URL ID 必须能解析为 JavaScript 安全范围内的正整数；例如 `0`、负数、小数和超大整数会被拒绝。
- 名称字段通常会 `trim()`；分组名称大小写不敏感且唯一，用户名大小写不敏感且唯一，供应商 `channel_code`（非空时）唯一。
- `user_ids`、`model_ids` 过滤器使用逗号分隔的正整数，例如 `user_ids=1,3,9`。
- 查询参数应进行 URL 编码；不要把凭证、供应商 Token 或请求正文放入 URL。

### 3.4 CORS

服务允许无 `Origin` 的服务端请求，以及以下来源：`tauri://`、`http://tauri.localhost`、`http://localhost...`、`http://127.0.0.1...`。允许 Header 为 `Content-Type`、`Authorization`、`x-api-key`、`x-goog-api-key`，允许方法为 `GET`、`POST`、`PUT`、`DELETE`、`OPTIONS`。预检请求成功时返回 204。其他浏览器来源不会被 CORS 中间件放行。

## 4. 认证

网关有两条相互独立的认证链：

1. LLM API 使用用户 API Key 或 `ROOT_TOKEN`。
2. 管理 API 使用全局 Admin Key，或 Root/管理员的 Bearer Token。

二者不能混用。特别是：LLM 请求中的 `x-api-key` 是用户 Key；Admin Key 和管理员 Bearer 同时适用于 `/api/v1/admin/*` 与旧根管理路径，不能直接调用 `/v1/*`。

### 4.1 LLM 认证

推理接口和模型目录接口支持：

```http
Authorization: Bearer <用户 API Key 或 ROOT_TOKEN>
```

```http
x-api-key: <用户 API Key>
```

```http
x-goog-api-key: <用户 API Key>
```

选择规则：

- 当 `Authorization` 有值时优先使用它，并要求严格匹配 `Bearer <非空 token>`（大小写不敏感，允许尾部空白）。非空但格式错误的 `Authorization` 直接返回 401，不会回退到其他 Header。
- 没有可用 `Authorization` 时依次尝试 `x-api-key`、`x-goog-api-key`。
- Root Token 由环境变量 `ROOT_TOKEN` 提供，映射为虚拟 Root 用户（ID `-1`），不受普通用户余额和 Key 配额限制。
- 用户 Key 必须处于 `active`、未过期，且其所属用户处于 `active`。Key 绑定的已删除分组会使认证失败，而不是自动扩大访问范围。

缺少认证或认证失败的推理请求返回协议对应的 401 错误。模型目录接口保留历史文案 `Invalid token`；推理接口通常使用 `Invalid API key`。

### 4.2 管理 API 认证

#### Admin Key

```http
x-api-key: <全局 Admin Key>
```

只要请求中存在 `x-api-key` Header（包括空值），管理中间件就只走 Admin Key 分支，不回退到 Bearer。生成的 Key 格式为：

```text
xg_admin_ + 64 位小写十六进制字符
```

Admin Key 在数据库配置中只保存一份，轮换后旧值立即失效。它绑定到 ID 最小、`type=admin` 且 `status=active` 的真实管理员；不会创建虚拟管理员。没有可绑定的管理员时返回 503。

#### Root/管理员 Bearer

不发送 `x-api-key` 时，可以发送：

```http
Authorization: Bearer <ROOT_TOKEN 或 active 管理员用户 Key>
```

管理 Bearer 的格式要求比 LLM 路径严格：必须以大小写敏感的 `Bearer ` 开头。Root 用户和 `type=admin` 用户允许访问；普通用户返回 403。disabled 用户优先返回 `User disabled`（403）。该认证方式和 Admin Key 认证同时适用于新外部路径与旧根管理路径。

### 4.3 认证示例

```bash
# LLM：用户 Key
curl "$BASE_URL/v1/models" \
  -H "Authorization: Bearer $USER_KEY"

# LLM：Anthropic 风格 Header
curl "$BASE_URL/v1/messages" \
  -H "x-api-key: $USER_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"gateway-claude","max_tokens":256,"messages":[{"role":"user","content":"你好"}]}'

# 管理 API：Admin Key
curl "$BASE_URL/api/v1/admin/status" \
  -H "x-api-key: $ADMIN_KEY"
```

## 5. 统一错误

### 5.1 管理 API 错误

管理接口通常返回：

```json
{
  "error": "资源不存在",
  "code": "not_found_error"
}
```

`code` 可能省略。不同 Controller 的历史错误也可能包含 `message`，例如充值接口的内部错误：

```json
{
  "error": "Failed to list recharge records",
  "message": "具体错误文本"
}
```

管理路由未知路径、误带 `.json` 的外部路径、未声明的方法和 `HEAD` 统一返回：

```json
{ "error": "Not found" }
```

未认证请求会先经过认证，因此同一个未知路径在未认证时可能返回 401。

### 5.2 LLM 错误

OpenAI Chat、OpenAI Responses 使用同一错误对象：

```json
{
  "error": {
    "message": "Invalid API key",
    "type": "authentication_error",
    "param": null,
    "code": "authentication_error"
  }
}
```

Anthropic Messages 使用：

```json
{
  "type": "error",
  "error": {
    "type": "authentication_error",
    "message": "Invalid API key"
  }
}
```

常见状态和代码：

| HTTP | `type/code` | 典型原因 |
| --- | --- | --- |
| 400 | `invalid_request_error` | JSON、`model` 或协议字段无效 |
| 400 | `insufficient_balance` | 余额不足（计费开启时） |
| 401 | `authentication_error` | Key 缺失、格式错误或无效 |
| 403 | `authentication_error` | 用户、Key、分组、IP、协议或模型白名单拒绝 |
| 404 | `not_found_error` | 请求的网关模型不存在 |
| 429 | `rate_limit_error` | Key 配额耗尽或其他限流 |
| 502 | `api_error` 或具体失败码 | 所有上游失败、协议转换/响应校验失败 |
| 503 | `billing_error` 或 `no_available_upstream` | 结算失败或没有可用上游 |

上游返回的合法 HTTP 错误正文通常按原协议透传（例如上游 400）；如果所有候选上游都失败，网关会合成 502。请求记录中的 `failed_code` 还可能是：

```text
model_not_found
client_disconnected
upstream_disconnected
stream_incomplete
upstream_error
no_available_upstream
insufficient_balance
billing_error
```

## 6. LLM API

### 6.1 端点总览

| 方法 | 标准路径 | 兼容路径 | 协议 | 认证 |
| --- | --- | --- | --- | --- |
| GET | `/v1/models` | `/llm/v1/models` | OpenAI Models | 用户 Key/Root |
| POST | `/v1/chat/completions` | `/llm/v1/chat/completions` | OpenAI Chat Completions | 用户 Key/Root |
| POST | `/v1/messages` | `/llm/v1/messages` | Anthropic Messages | 用户 Key/Root |
| POST | `/v1/responses` | `/llm/v1/responses` | OpenAI Responses | 用户 Key/Root |

标准路径和兼容路径调用同一套路由、鉴权、路由选择、协议转换、计费和记录逻辑。

### 6.2 共同请求要求

- 请求体必须为 JSON 对象。
- `model` 必须是非空字符串，并且是后台配置的**网关模型名**，不是供应商的真实模型名。
- 先执行身份、状态、IP、分组协议和模型白名单检查，再解析模型和余额；这样无权限 Key 不会通过错误差异探测模型存在性。
- `stream` 为 `true` 时返回 `text/event-stream`；不传或为 `false` 时返回 JSON。
- 上游供应商模型名由网关映射替换；客户端传入的 `Authorization`、`x-api-key`、`x-goog-api-key`、`anthropic-version` 以及代理层注入的认证 Header 不会原样转发。

### 6.3 GET 模型列表

```http
GET /v1/models
```

返回当前 Key 可见、已启用且至少有一个可用上游（不在健康冷却期）的网关模型。响应遵循 OpenAI Models 形状：

```json
{
  "object": "list",
  "data": [
    {
      "id": "gateway-model",
      "object": "model",
      "created": 1760000000,
      "owned_by": "gateway"
    }
  ]
}
```

模型白名单开启时只保留白名单中的模型；分组协议不包含 OpenAI Chat 时返回空列表。该接口使用 OpenAI 口径检查协议，因此即使客户端将它用于 Responses，也应确保分组允许 `openai_chat`。

### 6.4 POST Chat Completions

```http
POST /v1/chat/completions
```

#### 请求体

最小请求：

```json
{
  "model": "gateway-gpt",
  "messages": [
    { "role": "user", "content": "请用一句话介绍自己" }
  ],
  "stream": false
}
```

支持的常用字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 网关模型名 |
| `messages` | array | 是（协议语义） | `system/user/assistant/tool` 消息数组；`content` 可为字符串或 null |
| `max_tokens` | number | 否 | 最大输出 Token |
| `max_completion_tokens` | number | 否 | 新版最大输出 Token |
| `stream` | boolean | 否 | 是否流式 |
| `stream_options` | object | 否 | 支持 `include_usage`；OpenAI 上游流式请求会自动设为 true |
| `temperature` | number | 否 | 采样温度 |
| `top_p` | number | 否 | nucleus sampling |
| `stop` | string/string[] | 否 | 停止序列 |
| `tools` | array | 否 | `{type:"function",function:{name,description,parameters}}` |
| `tool_choice` | string/object | 否 | `auto`、`none`、`required` 或函数选择对象 |
| `reasoning_effort` | string | 否 | 推理强度，由上游/转换器支持情况决定 |
| `reasoning` | object | 否 | 可含 `effort`，与 `reasoning_effort` 兼容 |

#### 非流式响应

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1760000000,
  "model": "gateway-gpt",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "我是一个由网关转发的语言模型。"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 18,
    "completion_tokens": 12,
    "total_tokens": 30
  }
}
```

工具调用时，`message.tool_calls[]` 包含 `id`、`type:function` 和 `function.name/arguments`。`usage` 可能附带缓存、图片和推理明细（见[数据与计费口径](#8-数据与计费口径)）。

#### 流式响应

请求：

```bash
curl "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $USER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"gateway-gpt",
    "messages":[{"role":"user","content":"写一首四行诗"}],
    "stream":true
  }'
```

典型事件：

```text
data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1760000000,"model":"gateway-gpt","choices":[{"index":0,"delta":{"role":"assistant","content":"春"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1760000000,"model":"gateway-gpt","choices":[{"index":0,"delta":{"content":"风"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1760000000,"model":"gateway-gpt","choices":[],"usage":{"prompt_tokens":18,"completion_tokens":12,"total_tokens":30}}

data: [DONE]
```

客户端应按 SSE 事件边界读取，不要假设每次网络读取恰好对应一条事件。正常结束标记为 `data: [DONE]`。异常中断可能没有结束标记，并在请求记录中标记 `stream_incomplete` 或 `upstream_disconnected`。

### 6.5 POST Anthropic Messages

```http
POST /v1/messages
```

#### 请求体

```json
{
  "model": "gateway-claude",
  "max_tokens": 512,
  "messages": [
    { "role": "user", "content": "请解释什么是 SSE" }
  ],
  "system": "你是一个简洁的技术助手",
  "stream": false
}
```

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 网关模型名 |
| `max_tokens` | number | 是（Anthropic 语义） | 最大输出 Token |
| `messages` | array | 是 | `user/assistant` 消息；`content` 可为字符串或内容块数组 |
| `system` | string/array | 否 | 系统提示 |
| `stream` | boolean | 否 | 是否流式 |
| `temperature` | number | 否 | 采样温度 |
| `top_p` | number | 否 | nucleus sampling |
| `top_k` | number | 否 | top-k |
| `stop_sequences` | string[] | 否 | 停止序列 |
| `tools` | array | 否 | `{name,description,input_schema}` |
| `tool_choice` | object | 否 | `auto`、`any` 或指定 `tool` |
| `thinking` | object | 否 | `adaptive`、`enabled` 或 `disabled`，可含 `budget_tokens` |
| `output_config` | object | 否 | 可含 `effort` |
| `metadata` | object | 否 | 客户端元数据 |

建议发送 `anthropic-version: 2023-06-01`；网关向 Anthropic 上游始终使用该版本 Header，并根据供应商 `auth_mode` 生成 `x-api-key` 或 Bearer。

#### 非流式响应

```json
{
  "id": "msg_abc123",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "SSE 是一种服务器向客户端推送事件的文本协议。" }
  ],
  "model": "gateway-claude",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 20,
    "output_tokens": 16
  }
}
```

工具调用会返回 `tool_use` 内容块；输入图片/文件等内容块会在协议转换允许的范围内映射到上游。

#### 流式响应

典型事件顺序为 `message_start`、`content_block_start`、若干 `content_block_delta`、`content_block_stop`、`message_delta`、`message_stop`。示例：

```text
event: message_start
data: {"type":"message_start","message":{"id":"msg_abc123","type":"message","role":"assistant","content":[],"model":"gateway-claude","stop_reason":null,"usage":{"input_tokens":20,"output_tokens":0}}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"SSE"}}

event: message_stop
data: {"type":"message_stop"}
```

正常结束标记是 `message_stop`，不是 `[DONE]`。网关把 OpenAI 上游的 `[DONE]` 转换为 Anthropic 的收尾事件。

### 6.6 POST OpenAI Responses

```http
POST /v1/responses
```

#### 请求体

```json
{
  "model": "gateway-reasoning",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [{ "type": "input_text", "text": "什么是协议转换？" }]
    }
  ],
  "instructions": "用中文回答",
  "max_output_tokens": 512,
  "stream": false,
  "reasoning": { "effort": "medium" }
}
```

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 网关模型名 |
| `input` | string/array | 是（Responses 语义） | 消息、`function_call`、`function_call_output` 或 `reasoning` 项 |
| `instructions` | string | 否 | 系统级指令 |
| `max_output_tokens` | number | 否 | 最大输出 Token |
| `stream` | boolean | 否 | 是否流式 |
| `temperature` | number | 否 | 采样温度 |
| `top_p` | number | 否 | nucleus sampling |
| `tools` | array | 否 | Responses 函数工具定义 |
| `tool_choice` | string/object | 否 | `auto`、`none`、`required` 或函数选择 |
| `reasoning` | object | 否 | 可含 `effort` |
| `metadata` | object | 否 | 客户端元数据 |

#### 非流式响应

```json
{
  "id": "resp_abc123",
  "object": "response",
  "created_at": 1760000000,
  "status": "completed",
  "model": "gateway-reasoning",
  "output": [
    {
      "type": "message",
      "id": "msg_abc123",
      "role": "assistant",
      "status": "completed",
      "content": [
        { "type": "output_text", "text": "协议转换是在不同 API 消息格式之间进行映射。" }
      ]
    }
  ],
  "usage": {
    "input_tokens": 24,
    "output_tokens": 18,
    "total_tokens": 42
  }
}
```

#### 流式响应

Responses 流使用带 `type` 和 `sequence_number` 的 JSON SSE 事件，不接受 `[DONE]`：

```text
data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_abc123","object":"response","status":"in_progress","output":[]}}

data: {"type":"response.output_text.delta","sequence_number":1,"item_id":"msg_abc123","output_index":0,"content_index":0,"delta":"协议"}

data: {"type":"response.output_text.done","sequence_number":2,"item_id":"msg_abc123","output_index":0,"content_index":0,"text":"协议转换"}

data: {"type":"response.completed","sequence_number":3,"response":{"id":"resp_abc123","object":"response","status":"completed","output":[],"usage":{"input_tokens":24,"output_tokens":18,"total_tokens":42}}}
```

客户端应以 `response.completed` 作为完成条件；收到 `[DONE]` 会被视为 Responses 协议错误。

### 6.7 协议转换和上游选择

网关实现以下六个方向的请求、非流式响应和流式事件转换：

| 客户端 | 上游 | 转换器 |
| --- | --- | --- |
| OpenAI Chat | Anthropic | `OpenAIToAnthropicConverter` |
| Anthropic | OpenAI Chat | `AnthropicToOpenAIConverter` |
| OpenAI Chat | Responses | `OpenAIToResponsesConverter` |
| Responses | OpenAI Chat | `ResponsesToOpenAIConverter` |
| Anthropic | Responses | `AnthropicToResponsesConverter` |
| Responses | Anthropic | `ResponsesToAnthropicConverter` |

选择规则：

1. 如果供应商模型明确允许客户端格式，优先直连。
2. `allowed_formats=null` 时按供应商 URL/领域配置推断；`[]` 表示显式禁用所有格式。
3. 无法直连时按以下优先级回退：OpenAI Chat -> Responses -> Anthropic；Anthropic -> OpenAI Chat -> Responses；Responses -> OpenAI Chat -> Anthropic。
4. 候选上游失败会触发 failover；健康失败的上游会进入约 30 秒冷却期。
5. 没有可用上游时返回 503，并记录 `no_available_upstream`。

协议转换会尽量保留文本、工具调用、推理摘要、图片和缓存用量；某些供应商不支持的字段可能被忽略或按目标协议降级。后台请求记录的 `client_format` 是客户端协议，`upstream_format` 只有发生转换时才填最终上游协议。

### 6.8 访问策略、并发和计费

转发前按顺序检查：

- 用户和 Key 状态、Key 过期时间；
- Key IP 黑名单优先于白名单；启用 IP 限制时白名单为空等同拒绝；支持 IPv4/IPv6 单地址和 CIDR；
- Key 分组状态及分组允许的入站协议；
- Key 和分组模型白名单；
- Key `quota`/`quota_used`；
- 模型启用状态、映射和上游健康状态；
- 计费模块开启时的余额预检。

Key 的 `rateLimit` 是该 Key 的并发上限，供应商 `concurrency` 是上游并发上限；超出时请求不会发送到上游。请求成功后按模型价格、分组倍率和实际用量结算；流式请求在正常完成或可确定的异常收尾时结算。

### 6.9 LLM cURL 示例集合

```bash
# OpenAI Chat 非流式
curl "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $USER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gateway-gpt","messages":[{"role":"user","content":"你好"}]}'

# OpenAI Responses
curl "$BASE_URL/v1/responses" \
  -H "x-api-key: $USER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gateway-reasoning","input":"你好","max_output_tokens":256}'

# Anthropic Messages 流式
curl "$BASE_URL/v1/messages" \
  -H "x-api-key: $USER_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"gateway-claude","max_tokens":256,"messages":[{"role":"user","content":"你好"}],"stream":true}'
```

## 7. Node 管理 API

### 7.1 基本信息

外部管理 API 的统一前缀为：

```text
/api/v1/admin
```

例如完整地址为 `http://127.0.0.1:8720/api/v1/admin/users`。外部路径不带 `.json`；旧根路径仍保留并调用同一 Controller/Service，不经过二次 HTTP 转发。

该入口在 Node 模式下支持 SQLite 和 MySQL。Tauri 内置 Node 与独立 Node 服务使用相同的接口和认证规则。

### 7.2 67 条管理路由总表

下表的“兼容路径”是旧前端和旧脚本继续使用的根路径；外部路径均需在前面加 `/api/v1/admin`。同一个兼容路径可能对应多个方法，方法必须完全匹配。

#### Admin Key 生命周期（3 条）

| 方法 | 外部路径 | 兼容路径 |
| --- | --- | --- |
| GET | `/settings/admin-api-key` | `/admin-api-key/status.json` |
| POST | `/settings/admin-api-key/regenerate` | `/admin-api-key/regenerate.json` |
| DELETE | `/settings/admin-api-key` | `/admin-api-key.json` |

#### 系统与普通配置（5 条）

| 方法 | 外部路径 | 兼容路径 |
| --- | --- | --- |
| GET | `/status` | `/status.json` |
| GET | `/update` | `/update.json` |
| GET | `/settings` | `/config.json` |
| PUT | `/settings` | `/config.json` |
| GET | `/client-config/status` | `/client-config/status.json` |

#### 客户端配置（8 条）

| 方法 | 外部路径 | 兼容路径 |
| --- | --- | --- |
| GET | `/client-config/local` | `/client-config/local.json` |
| POST | `/client-config/create` | `/client-config/create.json` |
| POST | `/client-config/backup` | `/client-config/backup.json` |
| POST | `/client-config/backup/rename` | `/client-config/backup/rename.json` |
| POST | `/client-config/backup/delete` | `/client-config/backup/delete.json` |
| POST | `/client-config/backup/update` | `/client-config/backup/update.json` |
| POST | `/client-config/apply` | `/client-config/apply.json` |
| POST | `/client-config/sync-from-local` | `/client-config/sync-from-local.json` |

#### 分组（5 条）

| 方法 | 外部路径 | 兼容路径 |
| --- | --- | --- |
| GET | `/groups` | `/group/list.json` |
| POST | `/groups` | `/group/create.json` |
| GET | `/groups/:id` | `/group/:id` |
| PUT | `/groups/:id` | `/group/:id` |
| DELETE | `/groups/:id` | `/group/:id` |

#### 供应商与供应商模型（16 条）

| 方法 | 外部路径 | 兼容路径 |
| --- | --- | --- |
| GET | `/vendors/preset-urls` | `/vendor/preset-urls.json` |
| POST | `/vendors/models/fetch` | `/vendor/models/fetch.json` |
| GET | `/vendors` | `/vendor/list.json` |
| POST | `/vendors/batch` | `/vendor/batch.json` |
| POST | `/vendors` | `/vendor/create.json` |
| POST | `/vendor-models/batch` | `/vendor-model/batch.json` |
| GET | `/vendors/:id/models` | `/vendor/:id/model/list.json` |
| GET | `/vendors/:id/models/fetch` | `/vendor/:id/model/fetch.json` |
| POST | `/vendors/:id/models/sync` | `/vendor/:id/model/sync.json` |
| POST | `/vendors/:id/models` | `/vendor/:id/model/add.json` |
| PUT | `/vendors/:id/models/:modelId` | `/vendor/:id/model/:modelId` |
| DELETE | `/vendors/:id/models/:modelId` | `/vendor/:id/model/:modelId` |
| GET | `/vendors/:id` | `/vendor/:id` |
| POST | `/vendors/:id/test` | `/vendor/:id/test.json` |
| PUT | `/vendors/:id` | `/vendor/:id` |
| DELETE | `/vendors/:id` | `/vendor/:id` |

#### 网关模型（7 条）

| 方法 | 外部路径 | 兼容路径 |
| --- | --- | --- |
| POST | `/models` | `/model/create.json` |
| POST | `/models/route-test` | `/model/route-test.json` |
| GET | `/models` | `/model/list.json` |
| POST | `/models/batch` | `/model/batch.json` |
| GET | `/models/:id` | `/model/:id` |
| PUT | `/models/:id` | `/model/:id` |
| DELETE | `/models/:id` | `/model/:id` |

#### 用户、Key 与余额（14 条）

| 方法 | 外部路径 | 兼容路径 |
| --- | --- | --- |
| GET | `/users` | `/user/list.json` |
| POST | `/users/batch` | `/user/batch.json` |
| GET | `/users/:id` | `/user/:id` |
| POST | `/users` | `/user/create.json` |
| PUT | `/users/:id` | `/user/:id` |
| PUT | `/users/:id/api-keys` | `/user/:id/keys.json` |
| GET | `/users/:id/api-keys` | `/user/:id/keys.json` |
| POST | `/users/:id/api-keys` | `/user/:id/keys.json` |
| GET | `/users/:id/api-keys/:keyId` | `/user/:id/keys/:keyId/detail.json` |
| PUT | `/users/:id/api-keys/:keyId` | `/user/:id/keys/:keyId/detail.json` |
| DELETE | `/users/:id/api-keys/:keyId` | `/user/:id/keys/:keyId/detail.json` |
| POST | `/users/:id/balance` | `/user/:id/balance/adjust.json` |
| GET | `/balance/recharges` | `/balance/recharge/list.json` |
| GET | `/balance/recharges/:id` | `/balance/recharge/:id` |

#### 请求记录与活动（7 条）

| 方法 | 外部路径 | 兼容路径 |
| --- | --- | --- |
| GET | `/records/latest` | `/record/latest.json` |
| DELETE | `/records/payload` | `/record/clear-payload` |
| DELETE | `/records` | `/record/clear-all` |
| GET | `/records` | `/record/list.json` |
| GET | `/records/:id/activity` | `/record/:id/activity.json` |
| GET | `/records/:id` | `/record/:id` |
| DELETE | `/records/:id` | `/record/:id` |

#### 统计（2 条）

| 方法 | 外部路径 | 兼容路径 |
| --- | --- | --- |
| GET | `/stats/dashboard` | `/stats/dashboard.json` |
| GET | `/stats/recent` | `/stats/recent.json` |

合计：`3 + 5 + 8 + 5 + 16 + 7 + 14 + 7 + 2 = 67` 个方法/路径组合。

### 7.3 Admin Key 生命周期

#### GET `/settings/admin-api-key`

兼容：`GET /admin-api-key/status.json`

响应：

```json
{ "exists": true }
```

只返回是否存在，不返回明文或掩码。

#### POST `/settings/admin-api-key/regenerate`

兼容：`POST /admin-api-key/regenerate.json`

请求体可为空对象 `{}`。响应：

```json
{ "key": "xg_admin_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" }
```

明文只在这一次响应中返回；服务端不会提供恢复旧明文的接口。生成会覆盖旧 Key，旧 Key 立即失效。数据库写入失败返回 500 `admin_key_write_failed`。

#### DELETE `/settings/admin-api-key`

兼容：`DELETE /admin-api-key.json`

响应：

```json
{ "success": true }
```

删除后所有 Admin Key 请求立即返回 401；仍可用 Root/管理员 Bearer 重新生成。

### 7.4 系统与普通配置

#### GET `/status`

兼容：`GET /status.json`

响应字段：

```json
{
  "status": "ok",
  "user_type": "admin",
  "statistics": {
    "users": 12,
    "vendors": 4,
    "models": 8,
    "records": 1250
  },
  "system": {
    "environment": "Node",
    "version": "1.0.0",
    "apiAddress": "http://127.0.0.1:8720",
    "startTime": "2026-09-09T10:00:00.000Z",
    "uptime": "2小时 13分钟 4秒",
    "memory": "128.5 MB"
  },
  "modules": {
    "billing": true,
    "api_playground": true,
    "client_config": true
  },
  "timestamp": "2026-09-09T12:13:04.000Z"
}
```

`system.memory` 为 Node 进程 RSS，无法取得进程信息时为 `null`。`system.environment` 在普通 Node 服务中为 `Node`，以 `--desktop-mode` 启动的 Tauri 内置服务为 `Desktop App`。

#### GET `/update`

兼容：`GET /update.json`

可选查询参数 `force=1` 或 `force=true` 强制跳过 12 小时内存缓存。响应：

```json
{
  "success": true,
  "has_update": false,
  "current_version": "1.0.0",
  "latest_version": "1.0.0",
  "release_url": "https://github.com/qlqqs/xy_gateway/releases/latest",
  "release_notes": "..."
}
```

GitHub 查询失败时 `success=false`，并带 `error_message`；该接口通常仍返回 200，因为失败是更新检查结果而不是管理请求格式错误。

#### GET `/settings`

兼容：`GET /config.json`

返回配置键到字符串值的映射。默认键包括：

| 键 | 默认值 | 作用 |
| --- | --- | --- |
| `cch_rewrite_enabled` | `"true"` | CCH 重写 |
| `responses_prompt_cache_key_enabled` | `"true"` | Responses Prompt Cache Key |
| `claudecode_tracking_rewrite_enabled` | `"true"` | Claude Code tracking 重写 |
| `host_key` | `""` | 主机标识 |
| `stream_log_enabled` | `"false"` | Node 流式日志 |
| `auto_update_enabled` | `"true"` | 自动更新 |
| `record_payload_enabled` | `"true"` | 是否保存请求/响应正文 |
| `module_billing_enabled` | `"true"` | 全局计费开关 |
| `module_api_playground_enabled` | `"true"` | API Playground 模块 |
| `module_client_config_enabled` | `"true"` | 客户端配置模块 |

保留键 `admin_api_key` 永远不会出现在响应中。

#### PUT `/settings`

兼容：`PUT /config.json`

请求体是要写入的键值对象，值会转为字符串：

```json
{
  "module_billing_enabled": "false",
  "record_payload_enabled": "true"
}
```

成功返回合并后的完整配置映射。请求中包含 `admin_api_key` 会整体拒绝并返回 400：

```json
{
  "error": "admin_api_key must be managed through the Admin API",
  "code": "reserved_config"
}
```

### 7.5 客户端配置管理

这些接口读写运行服务账号的本机配置文件，仅 Node 可用。支持客户端：

| `client` | 协议 | 默认网关后缀 | 主要文件 |
| --- | --- | --- | --- |
| `claude-code` | Anthropic | `/llm` | `$HOME/.claude/settings.json` |
| `codex` | Responses | `/llm/v1` | `$CODEX_HOME/config.toml`、`$CODEX_HOME/auth.json` |

连接模式：

| `connectionMode` | 含义 | 必需关联 |
| --- | --- | --- |
| `gateway` | 通过本网关 | `gatewayUrl`、`userId` |
| `vendor` | 直连已配置供应商 | `gatewayUrl`、`vendorId` |
| `official` | 使用客户端官方服务 | 不要求 `gatewayUrl`/`userId`/`vendorId` |

共享配置字段：

```json
{
  "version": "v1",
  "connectionMode": "gateway",
  "gatewayUrl": "http://127.0.0.1:8720",
  "apiKey": "user-key",
  "model": "gateway-model",
  "effortLevel": "medium",
  "vendorId": 3,
  "userId": 7,
  "authJson": {}
}
```

`vendorId`、`userId` 用于服务端解析 Key，实际存入备份的 `apiKey` 会从供应商或用户的 active Key 自动解析；`official` 模式可直接使用传入 `apiKey`。`authJson` 主要供 Codex 保存完整 `auth.json`。

#### GET `/client-config/status`

兼容：`GET /client-config/status.json`

响应：

```json
{
  "available": true,
  "clients": [
    {
      "client": "claude-code",
      "displayName": "Claude Code",
      "protocol": "anthropic",
      "installed": true,
      "configured": true,
      "currentConfig": {
        "version": "v1",
        "connectionMode": "gateway",
        "gatewayUrl": "http://127.0.0.1:8720/llm",
        "apiKey": "user-key",
        "model": "gateway-claude",
        "configPaths": [],
        "gatewayUser": {
          "id": 7,
          "name": "alice",
          "type": "normal",
          "status": "active"
        }
      },
      "defaultGatewaySuffix": "/llm",
      "configPaths": ["/home/alice/.claude/settings.json"],
      "backupExists": true,
      "backupCount": 1,
      "backups": [],
      "activeBackupId": 10,
      "activeBackupInvalid": false,
      "activeConfigModified": false
    }
  ]
}
```

#### GET `/client-config/local`

兼容：`GET /client-config/local.json`

必需查询参数 `client=claude-code` 或 `client=codex`。返回从本地文件解析出的共享配置字段；无法解析时可能返回官方模式的空配置：

```json
{
  "version": "v1",
  "connectionMode": "official",
  "gatewayUrl": "",
  "apiKey": "",
  "model": ""
}
```

缺少 `client` 返回 400；未安装或不支持的客户端返回相应错误。

#### POST `/client-config/create`

兼容：`POST /client-config/create.json`

请求体使用共享配置字段，并额外支持 `vendorId`/`userId`：

```json
{
  "client": "claude-code",
  "connectionMode": "gateway",
  "gatewayUrl": "http://127.0.0.1:8720",
  "userId": 7,
  "model": "gateway-claude",
  "effortLevel": "medium"
}
```

该操作创建一个未启用的备份配置，不自动写本地文件；成功返回完整客户端状态（同 `status.clients[]`）。非 `official` 模式缺少网关 URL 或关联用户/供应商会失败。

#### POST `/client-config/backup`

兼容：`POST /client-config/backup.json`

请求体：

```json
{
  "client": "codex",
  "name": "团队网关",
  "enabled": false,
  "configContent": {
    "version": "v1",
    "connectionMode": "gateway",
    "gatewayUrl": "http://127.0.0.1:8720",
    "apiKey": "user-key",
    "model": "gateway-reasoning"
  }
}
```

`name` 可省略，服务端会生成同客户端内唯一名称。`configContent` 可省略，省略时从当前本地配置读取；`enabled=true` 只会选择该备份为 active，不保证立即写入本地文件，需调用 `apply` 明确应用。返回 `ClientConfigBackupInfo`（见下文）。同一客户端名称重复返回错误。

#### POST `/client-config/backup/rename`

兼容：`POST /client-config/backup/rename.json`

请求体：`{ "client": "codex", "backupId": 10, "name": "生产网关" }`。

返回：

```json
{
  "id": 10,
  "client": "codex",
  "name": "生产网关",
  "fileCount": 1,
  "createdAt": "2026-09-09T12:00:00.000Z",
  "enabled": false,
  "config": {},
  "matchedVendorId": null
}
```

#### POST `/client-config/backup/delete`

兼容：`POST /client-config/backup/delete.json`

请求体：`{ "client": "codex", "backupId": 10 }`。删除备份后返回该客户端的完整状态。不会自动恢复或删除其他本地配置文件。

#### POST `/client-config/backup/update`

兼容：`POST /client-config/backup/update.json`

请求体为 `backupId`、`client` 加共享配置字段：

```json
{
  "client": "codex",
  "backupId": 10,
  "connectionMode": "vendor",
  "gatewayUrl": "https://api.example.com/v1",
  "vendorId": 3,
  "model": "gpt-4o"
}
```

返回完整客户端状态。若目标备份当前为 active，会同步修改本地配置，同时保留配置文件中的其他手工字段（如 Codex 的额外配置）。

#### POST `/client-config/apply`

兼容：`POST /client-config/apply.json`

请求体：`{ "client": "claude-code", "backupId": 10 }`。解析备份、补丁写入本地文件，并将该备份设为 active；返回完整客户端状态。备份无法解析时返回错误。

#### POST `/client-config/sync-from-local`

兼容：`POST /client-config/sync-from-local.json`

请求体：`{ "client": "claude-code", "backupId": 10 }`。读取本地文件，覆盖指定备份的共享字段并返回完整客户端状态；不会改变本地文件。

### 7.6 分组 API

#### 分组 DTO

```json
{
  "id": 1,
  "name": "默认分组",
  "description": "系统默认访问范围",
  "inboundProtocols": ["openai_chat", "openai_responses", "anthropic"],
  "customModels": [],
  "whitelistEnabled": false,
  "rateMultiplier": 1,
  "status": "active",
  "updatedAt": "2026-09-09T12:00:00.000Z",
  "channelCount": 2
}
```

`inboundProtocols` 可选值：`openai_chat`、`openai_responses`、`anthropic`，至少一个。`rateMultiplier` 范围 `0..100`，保存两位小数。`customModels` 是字符串数组；开启 `whitelistEnabled` 后只允许其中列出的网关模型。`status` 为 `active` 或 `disabled`。名称会去首尾空格，大小写不敏感且唯一。

#### GET `/groups`

兼容：`GET /group/list.json`

查询：`keyword`、`status`、`page`、`pageSize`/`limit`、`offset`。响应：

```json
{
  "list": [],
  "total": 1
}
```

`list` 中的每一项都是 `GroupDto`；`channelCount` 是实时关联供应商数量。

#### POST `/groups`

兼容：`POST /group/create.json`

请求体：

```json
{
  "name": "团队分组",
  "description": "只允许 Chat",
  "inboundProtocols": ["openai_chat"],
  "customModels": ["gateway-gpt"],
  "whitelistEnabled": true,
  "rateMultiplier": 1.2,
  "status": "active"
}
```

`name` 和 `inboundProtocols` 必填，其余字段有默认值。成功返回 `GroupDto`。

#### GET `/groups/:id`

兼容：`GET /group/:id`。返回 `GroupDto`；ID 无效 400，不存在 404。

#### PUT `/groups/:id`

兼容：`PUT /group/:id`。请求体支持上述任意字段，按当前值合并后完整校验；成功返回更新后的 `GroupDto`。

#### DELETE `/groups/:id`

兼容：`DELETE /group/:id`。响应 `{ "success": true }`。删除会将关联用户 Key 的 `groupId` 置为 null，并从所有供应商的 `group_ids` 中移除该分组；不会删除用户或供应商。

### 7.7 供应商 API

#### 供应商 DTO

```json
{
  "id": 3,
  "type": "openai",
  "name": "OpenAI 主渠道",
  "token": "vendor-secret",
  "urls": {
    "openai": "https://api.example.com/v1/chat/completions",
    "responses": "https://api.example.com/v1/responses"
  },
  "config": {
    "auth_mode": "bearer_token",
    "skip_tls_verify": false,
    "api_type": "openai",
    "openai_protocol": "chat_completions",
    "status": "active",
    "available_models": ["gpt-4o"],
    "concurrency": 10,
    "load_factor": null,
    "priority": 1,
    "supplier_name": "示例供应商",
    "channel_code": "openai-main",
    "remark": "生产",
    "group_id": 1,
    "group_ids": [1]
  },
  "model_count": 1,
  "created_at": "2026-09-09T12:00:00.000Z",
  "updated_at": "2026-09-09T12:00:00.000Z"
}
```

`token` 会在管理响应中返回，属于敏感信息。`urls` 是按协议命名的对象，常见键为 `openai`、`responses`、`anthropic`；类型对应的预设 URL 会与自定义 URL 合并，自定义值优先。

供应商配置字段及约束：

| 字段 | 取值/约束 |
| --- | --- |
| `auth_mode` | `api_key` 或 `bearer_token`，默认 `bearer_token` |
| `skip_tls_verify` | boolean，默认 false；仅在确有需要时开启 |
| `proxy` | `null` 或 `{type:"http"\|"socks5",url:string}`；URL scheme 必须匹配类型 |
| `api_type` | `openai` 或 `anthropic` |
| `openai_protocol` | `chat_completions` 或 `responses`；仅 `api_type=openai` 有效 |
| `status` | `active` 或 `disabled` |
| `available_models` | 字符串数组，可为空；元素必须是非空字符串，自动 trim 去重 |
| `concurrency` | 正整数 |
| `priority` | 正整数，数值越小优先级越高（调度器使用） |
| `load_factor` | `null` 或大于等于 1 的数字；省略时可按并发计算权重 |
| `group_id` | null 或正整数，旧单分组兼容字段 |
| `group_ids` | 正整数数组；显式 `[]` 表示未分组，首项投影为 `group_id` |
| `channel_code` | 非空时大小写不敏感唯一；空字符串规范化为 null |

`api_type=anthropic` 时不能同时设置 `openai_protocol`；设置 `openai_protocol` 时必须明确 `api_type=openai`。引用不存在的分组返回 404。

#### GET `/vendors`

兼容：`GET /vendor/list.json`

查询：`type`、`keyword`、分页参数。响应 `{list: VendorDto[], total}`。

#### POST `/vendors`

兼容：`POST /vendor/create.json`

请求体：

```json
{
  "type": "openai",
  "name": "OpenAI 主渠道",
  "token": "sk-upstream",
  "urls": {
    "openai": "https://api.example.com/v1/chat/completions"
  },
  "config": {
    "auth_mode": "bearer_token",
    "api_type": "openai",
    "openai_protocol": "chat_completions",
    "available_models": ["gpt-4o"],
    "group_ids": [1]
  }
}
```

`type`、`name`、`token` 必填；`urls` 可为空。成功返回 `VendorDto`。创建时会同步 `available_models` 对应的供应商模型表。

#### PUT `/vendors/:id`

兼容：`PUT /vendor/:id`。请求体可包含 `type`、`name`、`token`、`urls`、`config` 任意子集。`config` 是部分合并，不传的配置保留原值；显式传 `available_models` 会同步增删供应商模型。成功返回完整 `VendorDto`。

#### GET `/vendors/:id`

兼容：`GET /vendor/:id`。返回 `VendorDto`；不存在 404。

#### DELETE `/vendors/:id`

兼容：`DELETE /vendor/:id`。响应 `{ "success": true }`。删除会清理该供应商的所有供应商模型和网关模型映射；失去全部启用上游的网关模型会被禁用。

#### GET `/vendors/preset-urls`

兼容：`GET /vendor/preset-urls.json`。返回按供应商类型分组的预设 URL 对象，结构由 `src/config/vendorDefaultUrls.json` 配置文件决定：

```json
{
  "openai": {
    "label": "OpenAI",
    "openai": "https://api.openai.com/v1/chat/completions"
  },
  "anthropic": {
    "label": "Anthropic",
    "anthropic": "https://api.anthropic.com"
  }
}
```

响应中可能还包含 `aliyun`、`deepseek`、`openrouter` 等供应商类型。`label` 仅用于展示；网关合并 URL 后会将其移除，不会作为上游请求地址。

#### POST `/vendors/models/fetch`

兼容：`POST /vendor/models/fetch.json`。不需要已有供应商 ID，使用临时配置向上游 `GET /models` 获取模型列表。请求体至少包含 `type`、`token`，可选 `urls`、`config`：

```json
{
  "type": "openai",
  "token": "sk-upstream",
  "urls": { "openai": "https://api.example.com/v1/chat/completions" },
  "config": { "api_type": "openai", "openai_protocol": "chat_completions" }
}
```

响应 `{ "models": ["gpt-4o", "gpt-4o-mini"] }`。只保留看起来属于 LLM 的模型 ID，并去重；上游失败通常返回 502。

#### POST `/vendors/batch`

兼容：`POST /vendor/batch.json`。请求体 `{ "ids": [1, 3, 5] }`，返回供应商 DTO 数组。缺少、空数组或无有效正整数时返回 `[]`，不会报错。

### 7.8 供应商模型 API

供应商模型 DTO：

```json
{
  "id": 20,
  "vendor_id": 3,
  "model_id": "gpt-4o",
  "allowed_formats": ["openai", "responses"],
  "created_at": "2026-09-09T12:00:00.000Z",
  "updated_at": "2026-09-09T12:00:00.000Z"
}
```

`allowed_formats` 的元素只能是 `openai`、`anthropic`、`responses`；`null` 表示按供应商能力推断，`[]` 表示显式禁用所有协议格式。

#### GET `/vendors/:id/models`

兼容：`GET /vendor/:id/model/list.json`。返回该供应商的模型 DTO 数组，按 `model_id` 升序。

#### GET `/vendors/:id/models/fetch`

兼容：`GET /vendor/:id/model/fetch.json`。使用已保存供应商配置向上游获取模型，返回 `{ "models": ["..."] }`，不修改数据库。

#### POST `/vendors/:id/models/sync`

兼容：`POST /vendor/:id/model/sync.json`。请求体 `{ "model_ids": ["gpt-4o", "claude-3-5-sonnet"] }`，规范化、去重并使数据库与数组完全一致；返回最新 DTO 数组。被移除的供应商模型若被网关模型引用，其 `vendor_model_id` 会置空，路由回退到网关模型名。

#### POST `/vendors/:id/models`

兼容：`POST /vendor/:id/model/add.json`。请求体 `{ "model_id": "gpt-4o" }`，新增一条模型；同供应商重复返回 409。成功返回 DTO。

#### PUT `/vendors/:id/models/:modelId`

兼容：`PUT /vendor/:id/model/:modelId`。请求体：

```json
{ "allowed_formats": ["openai", "responses"] }
```

也可传 `{ "allowed_formats": null }` 恢复自动推断。成功返回 DTO；记录不存在或不属于该供应商返回 404。

#### DELETE `/vendors/:id/models/:modelId`

兼容：`DELETE /vendor/:id/model/:modelId`。响应 `{ "success": true }`，并清理网关模型中的引用。

#### POST `/vendor-models/batch`

兼容：`POST /vendor-model/batch.json`。请求体 `{ "ids": [20, 21] }`，返回供应商模型 DTO 数组；无有效 ID 返回 `[]`。

### 7.9 供应商连通性测试

#### POST `/vendors/:id/test`

兼容：`POST /vendor/:id/test.json`

请求体可选：

```json
{
  "format": "openai",
  "model": "gpt-4o",
  "auto_convert": true
}
```

`format` 可为 `openai`、`anthropic`、`responses`，默认 `openai`；`model` 默认 `test-ping`；`auto_convert=true` 时若供应商不支持请求格式，会按兼容优先级选择其他格式。该接口把网络/上游失败封装在 JSON 中，连通性失败通常仍返回 HTTP 200，需检查 `success`：

```json
{
  "success": true,
  "status": 200,
  "duration": 184,
  "url": "https://api.example.com/v1/chat/completions",
  "converted_from": "responses",
  "converted_to": "openai",
  "proxy": null,
  "request_method": "POST",
  "request_headers": {
    "Authorization": "Bearer ****...abcd",
    "Content-Type": "application/json"
  },
  "request_body": {
    "model": "gpt-4o",
    "messages": [{ "role": "user", "content": "ping" }],
    "max_tokens": 5
  },
  "response": { "...": "上游响应" }
}
```

响应 Header 中的认证值已脱敏；不要把该接口响应写入公开日志。

### 7.10 网关模型 API

#### 网关模型 DTO

```json
{
  "id": 8,
  "name": "gateway-gpt",
  "mapping": {
    "upstreams": [
      { "vendor_id": 3, "vendor_model_id": 20, "enabled": true },
      { "vendor_id": 4, "enabled": true }
    ]
  },
  "enable": true,
  "prices": {
    "billing_mode": "token",
    "input": 0.15,
    "output": 0.60,
    "cache_read": 0.02
  },
  "created_at": "2026-09-09T12:00:00.000Z",
  "updated_at": "2026-09-09T12:00:00.000Z"
}
```

上游映射字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `vendor_id` | positive integer | 必填，供应商 ID |
| `vendor_model_id` | positive integer/null | 可选；指定供应商模型，省略时上游模型名使用网关模型名 |
| `enabled` | boolean | 默认 true；至少一个映射需启用才能启用模型 |

创建和更新都要求完整的 `name` 与 `mapping.upstreams`。当 `enable=false` 时允许 `mapping.upstreams` 为空；启用模型时至少需要一个上游，且至少一个映射的 `enabled` 不能为 `false`。不再接受旧字段 `routing_mode`、`routing_config`。同一模型中解析后的供应商/模型重复会被拒绝。

价格字段按“每百万 Token”计价：`input`、`output`、`cache_write`、`cache_write_5m`、`cache_write_1h`、`cache_read`、`image_input`、`image_output`、`per_request`。价格必须为 0（免费）或至少 `0.0001`；`billing_mode` 为 `token`、`per_request`、`image`。

#### GET `/models`

兼容：`GET /model/list.json`

查询：`vendor_id`、`keyword` 和分页参数。`vendor_id` 过滤包含指向该供应商的映射。响应 `{list: ModelDto[], total}`。

#### POST `/models`

兼容：`POST /model/create.json`

请求体：

```json
{
  "name": "gateway-gpt",
  "enable": true,
  "mapping": {
    "upstreams": [
      { "vendor_id": 3, "vendor_model_id": 20, "enabled": true }
    ]
  },
  "prices": { "billing_mode": "token", "input": 0.15, "output": 0.6 }
}
```

成功返回 `ModelDto`；模型名称重复返回 409。

#### GET `/models/:id`

兼容：`GET /model/:id`。返回 `ModelDto`；不存在 404。

#### PUT `/models/:id`

兼容：`PUT /model/:id`。请求体与创建相同，按完整聚合替换模型与所有上游映射；成功返回 `ModelDto`。重命名会同步更新分组和 Key 白名单中的模型引用。

#### DELETE `/models/:id`

兼容：`DELETE /model/:id`。响应 `{ "success": true }`，并删除映射、移除分组/Key 白名单引用。

#### POST `/models/batch`

兼容：`POST /model/batch.json`。请求体 `{ "ids": [8, 9] }`，返回模型 DTO 数组；空或无效 ID 返回 `[]`。

#### POST `/models/route-test`

兼容：`POST /model/route-test.json`

请求体：

```json
{ "model": "gateway-gpt", "format": "openai" }
```

`format` 可为 `openai`、`anthropic`、`responses`，默认 `openai`。接口使用真实模型路由和 failover，但跳过计费；成功和失败均尽量返回 HTTP 200，结果结构：

```json
{
  "success": true,
  "status": 200,
  "duration": 210,
  "url": "https://api.example.com/v1/chat/completions",
  "converted_from": null,
  "converted_to": null,
  "proxy": null,
  "request_method": "POST",
  "request_headers": { "Authorization": "Bearer ****...abcd" },
  "request_body": { "model": "gateway-gpt", "messages": [] },
  "response": { "...": "上游响应" }
}
```

模型不存在时返回 `success=false`、`error="model not found"`；发送失败时包含 `error` 和可能的 `status`。认证身份必须是管理请求解析出的管理员。

### 7.11 用户 API、Key 与余额

#### 用户 DTO

```json
{
  "id": 7,
  "name": "alice",
  "keys": [],
  "type": "normal",
  "balance": 100000000,
  "status": "active",
  "created_at": "2026-09-09T12:00:00.000Z",
  "updated_at": "2026-09-09T12:00:00.000Z"
}
```

`type` 可为 `normal` 或 `admin`；Root 是运行时虚拟身份，不能通过创建接口创建。`status` 为 `active` 或 `disabled`。`balance` 是数据库整数微元，不是元：`100000000` 表示 `100` 元。

#### GET `/users`

兼容：`GET /user/list.json`

查询：`type`、`keyword`、分页参数。响应 `{list: UserDto[], total}`。每个用户 DTO 会包含其全部 Key。服务会自动准备 Key 回显加密密钥；若显式配置了 `KEY_ENCRYPTION_SECRET` 则以环境变量为准。

#### POST `/users`

兼容：`POST /user/create.json`

请求体：

```json
{
  "name": "alice",
  "type": "normal",
  "keys": [
    {
      "value": "user-key-1",
      "name": "主 Key",
      "groupId": 1,
      "status": "active",
      "modelWhitelistEnabled": false,
      "modelWhitelist": [],
      "ipRestrictionEnabled": false,
      "ipWhitelist": [],
      "ipBlacklist": [],
      "quota": 0,
      "rateLimit": 0,
      "expiresAt": null
    }
  ]
}
```

`name` 必填且唯一；`keys` 可省略或为空数组。旧字段 `token` 已废弃，出现该字段会返回 400；请在 `keys` 中创建 Key。成功返回 `UserDto`。用户初始余额为 0、状态为 active。

#### GET `/users/:id`

兼容：`GET /user/:id`。返回 `UserDto`。

#### PUT `/users/:id`

兼容：`PUT /user/:id`。可更新 `name`、`status`，以及可选的完整 `keys` 数组：

```json
{ "name": "alice-new", "status": "active" }
```

包含 `keys` 时是整组替换；不包含时保留现有 Key。旧 `token` 字段会被拒绝。返回更新后的 `UserDto`。

#### POST `/users/batch`

兼容：`POST /user/batch.json`。请求体 `{ "ids": [7, 8] }`，返回用户 DTO 数组；缺少数组或无有效 ID 返回 `[]`。

> 当前没有删除用户的管理路由。需要停用用户时请更新 `status=disabled`。

#### Key DTO

```json
{
  "id": 31,
  "value": "user-key-1",
  "groupId": 1,
  "status": "active",
  "name": "主 Key",
  "modelWhitelistEnabled": false,
  "modelWhitelist": [],
  "ipRestrictionEnabled": false,
  "ipWhitelist": [],
  "ipBlacklist": [],
  "quota": 100,
  "rateLimit": 5,
  "expiresAt": "2030-01-02T03:04:05.000Z"
}
```

Key 字段约束：

- `value` 缺失、null 或空字符串时，创建接口自动生成；手动值长度 1 到 256。
- `groupId` 为 null 或正整数，必须引用存在的分组。
- `status` 为 `active`/`disabled`。
- 三个列表字段必须是字符串数组，服务端 trim、去空、去重。
- `quota` 为非负数字，单位元；`0` 表示不限制。内部 `quota_used` 不在 DTO 中返回。
- `rateLimit` 为非负整数，`0` 表示不限制并发。
- `expiresAt` 为可解析日期或 null；null 表示永不过期。
- API 响应会返回明文 Key，因此所有用户/Key 管理响应都应按敏感数据处理。Key 回显加密密钥默认保存在数据库保留配置中；若使用环境变量覆盖，丢失或更换后无法解密已有 Key。

#### GET `/users/:id/api-keys`

兼容：`GET /user/:id/keys.json`。返回该用户的 Key DTO 数组。

#### POST `/users/:id/api-keys`

兼容：`POST /user/:id/keys.json`。请求体为单个 Key 输入（字段同上，`value` 可省略以自动生成），返回新建 Key DTO。重复 Key 值返回 409。

#### PUT `/users/:id/api-keys/:keyId`

兼容：`PUT /user/:id/keys/:keyId/detail.json`。局部更新单个 Key；未提交的字段保留原值，运行时的 `quota_used`、`last_used_at` 等字段不会被覆盖。返回更新后的 Key DTO。

#### GET `/users/:id/api-keys/:keyId`

兼容：`GET /user/:id/keys/:keyId/detail.json`。返回单个 Key DTO；Key 不属于该用户或不存在时 404。

#### DELETE `/users/:id/api-keys/:keyId`

兼容：`DELETE /user/:id/keys/:keyId/detail.json`。响应 `{ "success": true }`。

#### PUT `/users/:id/api-keys`（兼容整组替换）

兼容：`PUT /user/:id/keys.json`。请求体必须是 `{ "keys": [/* 完整 Key 数组 */] }`，数组中带已有 `id` 的项更新对应 Key，不存在的正整数 ID 视为新 Key，未出现的旧 Key 会删除。该接口没有 revision 或冲突检测；与单 Key 接口并发使用可能覆盖彼此修改。自动化程序应优先使用单 Key CRUD。

#### POST `/users/:id/balance`

兼容：`POST /user/:id/balance/adjust.json`

请求体：

```json
{
  "amount": 100,
  "type": "recharge",
  "remark": "人工充值"
}
```

`amount` 是元，必须是有限数字，可正可负；`type` 为 `recharge` 或 `adjustment`；`remark` 可选字符串。余额按整数微元原子增量更新，允许变成负数；同时写入一条充值/调整记录。成功返回更新后的 `UserDto`。该操作没有幂等键，网络超时后请先查询余额和充值记录再重试。

### 7.12 充值记录 API

充值记录 DTO：

```json
{
  "id": 90,
  "user_id": 7,
  "amount": 100,
  "type": "recharge",
  "remark": "人工充值",
  "operator": null,
  "created_at": "2026-09-09T12:00:00.000Z",
  "updated_at": "2026-09-09T12:00:00.000Z"
}
```

`amount` 单位为元（与用户 `balance` 的微元单位不同）。

#### GET `/balance/recharges`

兼容：`GET /balance/recharge/list.json`

查询：`user_id`、`type`、`page`、`pageSize`/`limit`、`offset`。响应 `{list: RechargeRecord[], total}`。`type` 可筛选 `recharge`/`adjustment`。

#### GET `/balance/recharges/:id`

兼容：`GET /balance/recharge/:id`。返回单条记录；ID 格式错误 400，不存在 404。

### 7.13 请求记录与活动 API

#### 请求记录字段

记录 DTO 的核心字段如下：

| 字段 | 说明 |
| --- | --- |
| `id` | 记录 ID |
| `user_id` | 用户 ID；Root/诊断请求可能为 `-1` |
| `key_id` | 使用的用户 Key，可为 null |
| `group_id` | 使用的分组，可为 null |
| `model_id` | 网关模型 ID，可为 null |
| `requested_model` | 客户端请求的模型名 |
| `vendor_id` | 最终命中的供应商，可为 null |
| `vendor_model_name` | 实际发给上游的模型名 |
| `status` | `init`、`processing`、`success`、`failed` |
| `failed_code` | 失败原因或 null |
| `client_format` | `openai`、`anthropic`、`responses` |
| `upstream_format` | 发生转换时的上游格式，否则 null |
| `usage` | 规范化 Token/图片/缓存用量对象 |
| `first_token_latency` | 首 Token 延迟，毫秒；非流式为整体响应耗时 |
| `start_at`/`end_at` | 开始/结束时间 |
| `billing_mode` | `token`、`per_request`、`image` 或 null |
| `base_cost` | 分组倍率前费用，单位元 |
| `rate_multiplier` | 结算时的分组倍率快照 |
| `cost` | 最终实际费用，单位元 |
| `settlement_status` | `pending`、`settled`、`skipped` |
| `request_data`/`response_data` | 原始正文；列表摘要通常为 null |
| `created_at`/`updated_at` | 记录时间 |

`usage` 的常见结构：

```json
{
  "prompt_tokens": 150,
  "completion_tokens": 50,
  "cache_read_tokens": 600,
  "cache_creation_tokens": 250,
  "cache_creation_5m_tokens": 200,
  "cache_creation_1h_tokens": 50,
  "image_input_tokens": 30,
  "image_output_tokens": 10,
  "cost_breakdown": {
    "input_cost": 0.0012,
    "image_input_cost": 0.0009,
    "output_cost": 0.0008,
    "image_output_cost": 0.0004,
    "cache_creation_cost": 0,
    "cache_creation_5m_cost": 0,
    "cache_creation_1h_cost": 0,
    "cache_read_cost": 0.0012,
    "request_cost": 0,
    "total_cost": 0.0045
  }
}
```

缺失的 Token 字段通常为 null；`prompt_tokens` 是普通输入 Token，缓存读取/创建单独统计。

#### GET `/records`

兼容：`GET /record/list.json`

查询参数：

| 参数 | 说明 |
| --- | --- |
| `status` | `init`、`processing`、`success`、`failed` |
| `start_time` | 按 `created_at >=` 过滤，建议 ISO 或数据库时间格式 |
| `end_time` | 按 `created_at <=` 过滤 |
| `user_ids` | 逗号分隔用户 ID |
| `model_ids` | 逗号分隔模型 ID |
| `page`、`pageSize`、`limit`、`offset` | 分页 |

响应：

```json
{ "list": [], "total": 1250 }
```

`list` 中的每一项都是记录摘要。列表使用摘要查询，不读取正文存储；`request_data`、`response_data` 字段仍稳定存在但通常为 `null`。

#### GET `/records/latest`

兼容：`GET /record/latest.json`。支持 `limit`/`pageSize`，默认 10、最大 100；返回按 ID 倒序的记录数组，并附加对象存储中的请求/响应正文：

```json
[
  {
    "id": 1250,
    "status": "success",
    "request_data": "{...}",
    "response_data": "{...}"
  }
]
```

#### GET `/records/:id`

兼容：`GET /record/:id`。返回单条完整记录并读取对象存储正文；不存在 404，ID 格式错误 400。

#### GET `/records/:id/activity`

兼容：`GET /record/:id/activity.json`。响应：

```json
{
  "record_id": 1250,
  "activities": [
    {
      "stage": "routing",
      "level": "info",
      "message": "路由选择",
      "details": { "strategy": "priority_weight" },
      "ts": 1760000000000
    },
    {
      "stage": "result",
      "level": "info",
      "message": "请求成功",
      "details": { "status": "success", "cost": 0.0045 },
      "ts": 1760000000200
    }
  ]
}
```

`stage` 可为 `routing`、`upstream_attempt`、`failover`、`plugin`、`conversion`、`result`；`level` 可为 `info`、`warn`、`error`。没有活动时返回空数组。

#### DELETE `/records/payload`

兼容：`DELETE /record/clear-payload`。删除所有 `record/` 前缀的对象存储正文，保留记录元数据。响应：

```json
{ "success": true, "cleared": 1250 }
```

正文统一存储在 Node 数据库的 `storage_record` 表中；是否写入由 `record_payload_enabled` 配置控制。读取详情时如果正文不存在，接口返回不含正文的记录或相应的空值，不会切换到其他存储后端。

#### DELETE `/records`

兼容：`DELETE /record/clear-all`。删除 `record` 表中的全部记录，响应 `{ "success": true, "deleted": 1250 }`。该操作不等同于 `DELETE /records/payload`；如需清理正文对象，应单独调用 payload 接口。

#### DELETE `/records/:id`

兼容：`DELETE /record/:id`。删除单条记录，响应 `{ "success": true }`；记录不存在 404。该接口只删除记录行，正文对象的清理策略应由运维另行安排。

### 7.14 统计 API

#### GET `/stats/dashboard`

兼容：`GET /stats/dashboard.json`

响应：

```json
{
  "total_requests": 1250,
  "success_count": 1180,
  "failed_count": 70,
  "success_rate": 0.944,
  "active_users": 12,
  "active_models": 8,
  "today_requests": 86
}
```

`total_requests` 是全表累计请求数；其余成功/失败/成功率/活跃用户/活跃模型/今日请求均按当天（服务器本地午夜起）统计。没有当天请求时 `success_rate=null`。

#### GET `/stats/recent`

兼容：`GET /stats/recent.json`。支持 `limit`/`pageSize`，默认 10、最大 100；返回简化数组：

```json
[
  {
    "id": 1250,
    "user_id": 7,
    "model_id": 8,
    "status": "success",
    "created_at": "2026-09-09T12:13:04.000Z"
  }
]
```

## 8. 数据与计费口径

### 8.1 金额单位

| 字段/接口 | 单位 |
| --- | --- |
| 用户 `balance` | 数据库整数微元；`1 元 = 1,000,000` |
| Key `quota` | 元；`0` 不限制 |
| 充值记录 `amount` | 元 |
| 记录 `base_cost`/`cost` | 元 |
| 模型价格 | 每百万 Token 的元价 |
| 最小扣减粒度 | `0.000001` 元 |

余额调整示例：余额为 `0` 时充值 `100`，用户 DTO 的 `balance` 为 `100000000`。计费模块关闭（`module_billing_enabled="false"`）时不做余额预检、不扣费，但仍会记录请求和模型用量。

### 8.2 计费模型

- `token`：按普通输入、缓存读/写、输出及图片 Token 的价格分别计算。
- `per_request`：按每次请求的 `per_request` 价格计费。
- `image`：使用图片输入/输出价格；具体用量取决于上游返回的图片统计。

最终费用 = 模型原价（`base_cost`）乘以请求所属分组的 `rateMultiplier`，再量化到最小扣减粒度。Key 配额按元累计 `quota_used`；单次 Token 请求的实际费用要在用量完整后才能确定，因此可能在本次完成后才发现越过配额，下一次请求会被拦截。

### 8.3 正文与隐私

请求和响应正文不在 `record` 主表中保存，而是以 `record/{id}` 对象保存为：

```json
{ "request": "原始请求字符串", "response": "原始响应字符串" }
```

`record_payload_enabled="false"` 时不写入正文；管理接口的列表摘要因此可能始终为 `null`。正文保存在 Node 数据库 `storage_record` 表中，读取详情时找不到正文会返回空值。正文可能包含用户输入、个人数据和供应商响应，管理员应限制访问并按敏感数据保留策略清理。

## 9. 兼容路径与不支持范围

### 9.1 旧根路径

旧管理路径（例如 `/user/list.json`、`/vendor/list.json`、`/model/list.json`）继续可用，使用同一 Admin Key 或 Root/管理员 Bearer 认证和 Controller。新集成建议使用无 `.json` 的 `/api/v1/admin/*` 外部路径，以获得稳定的资源命名。

### 9.2 其他公开路径

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/welcome` | 无认证欢迎文本；Node 会标注 node mode |
| DELETE | `/test/cache/clear` | 仅 `TEST_MODE` 下存在的测试接口，生产环境不应调用 |

### 9.3 未知路径和方法

- `/v1/*`、`/api/v1/admin/*`、带 `.json` 的 API 路径未知时返回 JSON 404。
- 外部管理入口在认证前访问未知路径仍先返回认证错误；认证通过后才返回 `{ "error": "Not found" }`。
- `HEAD` 不属于管理 API 支持方法，即使对应 GET 存在也返回 JSON 404。
- 本文不承诺部署控制、审计导出、幂等键、集合更新冲突检测或用户删除接口。

## 10. 安全与运维建议

1. 使用 HTTPS，并把 `ROOT_TOKEN`、Admin Key、用户 Key、供应商 Token 存放在密钥管理系统；不要写入查询参数、前端持久化存储或普通日志。
2. Key 回显加密密钥由服务自动生成并写入数据库保留配置；可选的 `KEY_ENCRYPTION_SECRET` 环境变量会覆盖该值，且必须与 `ROOT_TOKEN` 不同。更换或丢失覆盖值后无法解密已有 Key。
3. 供应商 Token 会由管理 DTO 原样返回，调用方应对响应做访问控制和脱敏；连通性测试虽会脱敏 Header，仍可能返回上游正文。
4. 轮换 Admin Key 后旧值立即失效；轮换请求超时不要盲目重复，先用 Root/管理员 Bearer 查询 `exists` 或验证新值。
5. 生产环境谨慎启用 `skip_tls_verify`；代理 URL、上游 URL 和 `channel_code` 应经过配置审查。
6. 删除记录、清空正文、删除供应商和删除分组都会影响路由或审计数据，建议先导出/确认再调用；这些操作没有通用幂等键。
7. 对 LLM 流式响应使用真正的 SSE 客户端：OpenAI Chat 等待 `[DONE]`，Anthropic 等待 `message_stop`，Responses 等待 `response.completed`。连接中断时应通过记录接口确认最终状态和结算结果。
8. Admin API 仅在 Node/Tauri 内置 Node 模式开放；应将服务绑定到受控地址，并通过反向代理或网络策略限制管理端口的访问范围。

---

本文档覆盖的路由清单来自 `src/routes/adminApiRoutes.ts`，协议行为来自 `src/middleware/llmApiMiddleware.ts`、`src/service/accessPolicyService.ts`、`src/service/senderService.ts` 及协议转换器实现。外部客户端如需使用未在本文列出的供应商特有字段，应以目标供应商和对应官方协议文档为准，并在测试环境验证转换结果。
