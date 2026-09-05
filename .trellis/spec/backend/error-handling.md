# 后端错误处理

Hono 全局 handler 在 `src/routes.ts` 注册。它记录请求和错误，然后返回以下三种 JSON 形状之一：

1. LLM 路由使用 `customError.buildLlmErrorResponse`，让 OpenAI、Responses 和 Anthropic 客户端收到各自协议的错误形状。
2. 带有 `statusCode` 的应用错误按该状态返回 `{ error, code? }`。
3. 未知错误记录为内部错误并返回 500 JSON 响应。

可预期的业务失败使用 `src/util/customErrorUtil.ts`。`AppError` 默认 HTTP 400，也可传入 status 和 code；`NotFoundError` 固定为 404 和 `not_found_error`。

```ts
const model = await modelManager.findById(modelId);
if (!model) {
    throw new customError.NotFoundError("Model not found");
}
```

service 和 manager 中的业务逻辑不要直接抛出原生 `Error`。抛出 `AppError`（或更具体的子类），这样全局 handler 才能保留 status 和 JSON 契约。400 用于输入或业务约束错误，401 用于缺少或无效凭证，403 用于禁用用户或权限不足，404 用于资源不存在，409 用于冲突，500 只用于真正的系统故障。

controller 边界上，一些旧 handler 仍会针对简单解析失败直接返回 `c.json({ error: ... }, status)`（`src/controller/userController.ts`）。修改这些旧 handler 附近代码时保留其返回形状；新增 service 业务错误，以及已经使用全局 handler 的 controller（`src/controller/modelController.ts`、`src/controller/vendorController.ts`）使用 `AppError`。不要使用 `findOrFail` 生成错误响应。

认证 middleware 会对缺少、无效、已禁用或无权限的 token 立即返回 JSON（`src/middleware/authMiddleware.ts`）。发送这些响应后不能再调用 controller。如果某个接口有明确的回退契约，可以像 `testModelRoute` 一样局部捕获请求解析或上游错误；修改时要保留该接口的响应约定。

错误消息不能泄露凭证或原始 token。现有未知错误回退会记录日志用于诊断，但普通用户可见的消息应稳定且可行动。LLM 错误必须保留上游协议要求的 `type`/`code` 字段。
