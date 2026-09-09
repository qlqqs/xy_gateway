# Admin API HTTP 契约与技术探针

## 范围与状态

- 日期：2026-09-08。
- 本文记录对本机 Hono、SPA 回退和 Vite 代理的验证结果。
- 最终外部契约是 `/api/v1/admin/*` 且不带 `.json`；内部 `.json` 只保留为旧路由和映射目标。
- 本文不引入 OpenAPI、Zod 或新的路由框架。

## 一、Hono 动态路径探针

本机环境：Node `v24.16.0`、Hono `4.12.3`、`@hono/node-server` `1.19.9`。

在独立内存 Hono 实例中验证得到：

| 注册形式 | 请求 | 结果 |
| --- | --- | --- |
| `/vendors/:id.json` | `/vendors/12.json` | 参数名会混入 `.json`，不能得到可靠的 `id` |
| `/vendors/:id.json` | `/vendors/12x.json` | 也不会严格校验数字 |
| `/vendors/:id{[0-9]+}.json` | `/vendors/12.json` | 当前版本构建时抛出 `TypeError` |
| `/vendors/:id/detail.json` | `/vendors/12/detail.json` | `id` 参数正常为 `12` |

最终外部路径没有扩展名，因此动态参数直接使用独立段：

```text
/api/v1/admin/vendors/:id
/api/v1/admin/users/:id/api-keys/:keyId
```

内部新增详情路由若需要 `.json`，使用 `/user/:id/keys/:keyId/detail.json` 这类固定后缀，不使用 `/:keyId.json`。

## 二、前缀、鉴权和 JSON 404 探针

已验证的最小模型：父应用挂载 `/api/v1/admin`，子应用有统一认证和终止式 JSON 404：

```text
外部已知路径：/api/v1/admin/vendors/12
外部未知路径：/api/v1/admin/missing
外部误用扩展名：/api/v1/admin/vendors.json
```

预期行为：

- 无凭证先得到 401 JSON。
- 有效凭证访问未知路径得到 404 JSON。
- 有效凭证访问已知路径进入固定 handler。
- `/dashboard` 等普通前端路径仍可返回 SPA。

正式实现需要补充：

- Admin 前缀根路径和末尾 `/`。
- HEAD、OPTIONS 和已知路径上的错误方法。
- 未知外部 `.json` 路径不能命中内部别名。
- `src/routes.ts` 与 `src/local.ts` 的真实挂载顺序。

## 三、最终外部路径契约

所有路径省略固定前缀 `/api/v1/admin`，且不带 `.json`。完整方法、内部路径和 handler 见 `api-operation-matrix.md`。

### 生命周期

```text
GET    /settings/admin-api-key
POST   /settings/admin-api-key/regenerate
DELETE /settings/admin-api-key
```

### 用户 Key

```text
GET    /users/:id/api-keys
POST   /users/:id/api-keys
GET    /users/:id/api-keys/:keyId
PUT    /users/:id/api-keys/:keyId
DELETE /users/:id/api-keys/:keyId
```

### 资源示例

```text
GET    /settings                 -> GET  /config.json
GET    /users                    -> GET  /user/list.json
GET    /vendors                  -> GET  /vendor/list.json
GET    /models                   -> GET  /model/list.json
GET    /records                  -> GET  /record/list.json
```

外部客户端不需要知道右侧内部路径；右侧只用于实现、回归和文档审查。

## 四、映射实现选择

采用显式静态表：

```ts
{
    method: "get",
    externalPath: "/users",
    legacyPath: "/user/list.json",
    handler: userController.listUsers,
}
```

注册器直接把 `handler` 绑定到外部路径。这样能保留 query、body、状态码和响应，不增加内部 HTTP 请求，也不产生第二套 Controller。

不采用以下方式：

- 把 `/api/v1/admin` 后面的字符串直接删掉前缀再转发。
- 使用 `app.fetch()` 模拟内部客户端。
- 让请求体传 `method`、`path`、`action` 再动态分派。
- 用 OpenAPI/Zod 生成第二套路由。

## 五、参数与响应边界

- 外部 ID 由现有 Controller/Service 的安全整数校验负责；不依赖 URL 扩展名做校验。
- 外部路径映射原则上不转换请求体字段、响应字段或状态码。
- 单 Key handler 只增加 user/key 双重归属校验；不把单项操作转成整组替换。
- 认证错误、业务错误和未知路径保持项目已有 JSON 形状。
- Admin Key 不从 query、cookie、body 或 WebSocket 子协议读取。

## 六、Vite 与 SPA 边界

当前 Vite 通用规则会把 `/api` 去掉后转发到后端。外部 Admin API 需要更具体的规则：

```text
/api/v1/admin/* -> 后端同名 /api/v1/admin/*（不 rewrite）
/api/*          -> 继续使用现有 /api rewrite
```

生产 Node 静态服务在 `src/local.ts` 返回 SPA 前，应把 `/api/v1/admin` 视为 API 前缀；应用 `notFound` 也应识别该前缀。未知 Admin 路径必须是 JSON 404，不能返回 `index.html`。

## 七、验证边界

本探针只证明 Hono 路径和回退形态，不证明业务 Controller、数据库认证或错误映射。实施后必须增加：

- 67 条 route map 双向覆盖测试。
- 外部无 `.json` / 内部有 `.json` 的成对回归。
- Admin Key 优先级和真实管理员上下文测试。
- LLM 负向测试。
- Vite 代理和设置页 API 模块测试。
