# 外部管理 API 统一入口技术设计

## 1. 设计结论

外部 API 采用 sub2api 风格的独立管理命名空间：

```text
/api/v1/admin/*
```

外部路径全部不带 `.json`。xy_gateway 原有根路径和 `.json` 路由继续保留，供旧前端和内部兼容使用。新入口不是另一套业务实现，而是显式注册的外部别名，直接调用相同的 Controller、Service、Manager 和数据库逻辑。

```text
外部 HTTP
  -> adminApiRoutes（Node-only）
  -> requireAdmin
  -> 显式 route map
  -> 现有 Controller
  -> 现有 Service / Manager
  -> SQLite 或 MySQL

旧前端
  -> 原根路径和 `.json` 路由
  -> 同一套 Controller / Service

LLM 客户端
  -> `/v1/*` 或 `/llm/v1/*`
  -> 原 LLM 认证链路
```

不采用一个带 `action`、`method` 或 `path` 字段的万能端点，也不通过本机 HTTP 再转发到旧路由。

## 2. 外部路由注册与映射

### 2.1 模块边界

新增 `src/routes/adminApiRoutes.ts`（具体文件名按项目实际导入规则落地）作为外部入口的唯一注册模块。该模块负责：

- 创建并导出挂载在 `/api/v1/admin` 下的 Hono 子应用。
- 注册显式外部路径和 HTTP 方法。
- 在子应用入口执行 Node 运行时门禁和 `authMiddleware.requireAdmin`。
- 对未知路径返回 JSON 404，不让请求落入 SPA。
- 将外部别名直接绑定到现有 Controller handler；新生命周期和单 Key handler 也通过同一表注册。

建议使用不可变的路由定义表表达映射：

```ts
interface AdminApiRouteSpec {
    method: "get" | "post" | "put" | "delete";
    externalPath: string;
    legacyPath: string;
    handler: MiddlewareHandler;
}
```

`legacyPath` 用于审查、测试和文档对照；运行时不把它当作字符串拼接目标，也不通过 `fetch` 或 `app.fetch` 转发。注册函数只接受代码中定义的 `handler` 引用，因此客户端无法指定 Controller、方法或内部路径。

### 2.2 注册顺序

1. 先注册静态路径，例如 `/settings/admin-api-key`、`/vendors/preset-urls`、`/models/route-test`。
2. 再注册集合路径，例如 `/users`、`/vendors`、`/models`、`/records`。
3. 最后注册动态路径，例如 `/users/:id`、`/vendors/:id/models/:modelId`。
4. 在子应用末尾注册终止式 `notFound`，统一返回 JSON 404。
5. 在 `src/routes.ts` 的静态/SPA 处理之前挂载子应用；`src/local.ts` 也把 `/api/v1/admin` 判定为 API 路径。

外部动态参数使用独立路径段，不使用 `/:id.json`。例如：

```text
/api/v1/admin/vendors/:id/models/:modelId
/api/v1/admin/users/:id/api-keys/:keyId
```

这样既符合 sub2api 风格，也避开当前 Hono 对扩展名动态参数的解析问题。

### 2.3 外部路径规则

- 资源集合采用复数：`users`、`groups`、`vendors`、`models`、`records`、`recharges`。
- 对已有动作型 Controller，只去掉外部扩展名并置于资源命名空间下，例如 `/client-config/backup/rename`、`/vendors/:id/test`。
- 新 Admin Key 路径严格采用 sub2api 参考形式：`/settings/admin-api-key`、`/settings/admin-api-key/regenerate`。
- 外部不注册同一路径的 `.json` 别名。误用 `/api/v1/admin/users.json` 等路径必须得到 JSON 404。
- 查询字符串、请求体、状态码和响应 DTO 原则上原样交给既有 Controller；只有单 Key 入口增加必要的 user/key 归属参数处理。

完整 67 个方法/路径组合见 `research/api-operation-matrix.md`：59 条既有管理能力、3 条生命周期操作和 5 条单 Key 操作。

## 3. 认证链路

### 3.1 外部入口中间件

Admin 子应用所有路由共享 `authMiddleware.requireAdmin`。中间件顺序如下：

1. 若存在 `x-api-key` Header，即使值为空，也只进入 Admin Key 分支。
2. 直接从 `config` 表读取 `name = admin_api_key`，不走 `configService` 缓存。
3. 空值、长度异常、合并值或常量时间比较失败统一返回 401。
4. 比较成功后查询 `type = admin`、`status = active`、`id ASC` 的第一名真实用户。
5. 设置现有 `user_type`、`user` 和 `authContext = { user, key: null, group: null }`，再执行 Controller。
6. 没有可绑定的 active admin 时返回 503 `admin_identity_unavailable`，不制造虚拟用户。
7. 只有没有 `x-api-key` Header 时，才执行现有 Bearer、Root、用户 Key 和角色检查。

无效 Admin Key 与有效 Bearer 同时出现时必须 401。该优先级与 sub2api 的管理中间件一致，也避免调用方误以为 Bearer 能覆盖一个错误的机器凭证。

### 3.2 LLM 隔离

只改 `authMiddleware.requireAdmin`，不改 `authContextService.resolve()` 和 `llmApiMiddleware`。因此：

- Admin Key 在管理路由中可以建立完整真实管理员上下文。
- Admin Key 本身不会成为 LLM 用户 Key。
- 若操作员主动把同一原文另存为普通用户 Key，LLM 只按普通用户 Key 的正常规则处理；这不是 Admin Key 自动穿透。
- 不调用用户 Key 的 `markUsed`、额度、分组、过期和模型白名单逻辑。

## 4. Admin Key 存储与生命周期

### 4.1 存储

- 唯一数据源是现有 `config` 表的 `admin_api_key` 行。
- value 保存明文；不存在或空值都表示关闭。
- `configManager` 增加按名称删除或清空能力，`adminKeyService` 直接读写它。
- `configService.getAll()` 过滤该保留项；`updateAll()` 先完整检查输入，发现保留项时在写入其他字段前返回 400。
- 不新增表、字段、migration、环境变量覆盖或第二个配置项。

### 4.2 外部生命周期契约

| 方法 | 外部路径 | 内部兼容实现 | 成功结果 |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/settings/admin-api-key` | `GET /admin-api-key/status.json` | `{ "exists": boolean }` |
| POST | `/api/v1/admin/settings/admin-api-key/regenerate` | `POST /admin-api-key/regenerate.json` | `{ "key": "..." }` |
| DELETE | `/api/v1/admin/settings/admin-api-key` | `DELETE /admin-api-key.json` | `{ "success": true }` |

外部响应中的 `key` 只在生成成功的这一次响应中出现。没有“读取当前明文”接口，也不返回掩码值，减少误复制和泄露面。

### 4.3 轮换语义

生成流程为：生成安全随机值 -> 写入同一配置项 -> 写入成功后返回明文。旧值在新值提交后立即失效。

不加版本、双 Key、候选状态、应用锁或持久幂等。并发生成请求都可以成功，数据库最后成功提交的值是唯一有效值；较早响应中的值可能在响应到达调用方前已经失效。响应丢失时用 Bearer 重新生成，不尝试重放旧机器 Key。

## 5. 单个用户 Key

### 5.1 外部契约

| 方法 | 外部路径 | 内部兼容实现 | 语义 |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/users/:id/api-keys` | `GET /user/:id/keys.json` | 列表 |
| POST | `/api/v1/admin/users/:id/api-keys` | `POST /user/:id/keys.json` | 创建一个 |
| PUT | `/api/v1/admin/users/:id/api-keys` | `PUT /user/:id/keys.json` | 旧整组替换，仅兼容 |
| GET | `/api/v1/admin/users/:id/api-keys/:keyId` | `GET /user/:id/keys/:keyId/detail.json` | 详情 |
| PUT | `/api/v1/admin/users/:id/api-keys/:keyId` | `PUT /user/:id/keys/:keyId/detail.json` | 局部修改 |
| DELETE | `/api/v1/admin/users/:id/api-keys/:keyId` | `DELETE /user/:id/keys/:keyId/detail.json` | 删除一个 |

外部自动化只使用单项 GET/POST/detail PUT/detail DELETE；集合 PUT 仅保留以完整覆盖既有管理能力。内部旧页面仍只调用原 `.json` 集合 PUT，前端文件和请求体不改。

### 5.2 Service 边界

- 复用 `userKeyService.createForUser()`、`updateForUser()`、`listForUser()` 和 `toDto()`。
- 增加按 `(userId, keyId)` 定位的 `getForUser()` 与 `deleteForUser()`，不读取全部 Key 后再写回。
- 单项修改只更新提交字段，保留 `quota_used`、`last_used_at` 等运行字段。
- 不匹配用户的 Key 和不存在 Key 都返回 404。
- 唯一摘要、加密、分组和字段校验继续由现有 Service/Manager 负责。

### 5.3 并发和旧页面限制

单项 API 采用最后写入语义。同一用户的旧页面整组保存是完整数组替换，可能删除或覆盖外部单项 API 在页面读取之后产生的变化。为保持简单，不增加 revision、锁、自动合并或冲突提示；文档要求同一用户不要同时用两种入口编辑。

## 6. Node、SPA 与开发代理

- 外部 Admin API 的数据访问只实现 Node SQLite/MySQL。
- 由于 `src/routes.ts` 同时供 Worker 使用，Node-only 门禁必须在运行时执行；Worker/D1 请求不得进入数据库逻辑，返回明确的未支持 JSON 结果或 404。
- `src/routes.ts` 的 API 404 判断加入 `/api/v1/admin` 前缀。
- `src/local.ts` 的 SPA 回退在返回 `index.html` 前排除 `/api/v1/admin`。
- `frontend/vite.config.ts` 增加更具体的 `/api/v1/admin` 代理规则，保持该前缀转发到后端时不被通用 `/api` rewrite 去掉。
- 设置页 API 模块调用 `/api/v1/admin/settings/admin-api-key`，不调用内部 `.json` 路径。

## 7. 设置页面

只扩展 `frontend/src/views/AdvancedSettings.vue`：

1. 页面加载调用状态接口，只保留 `exists`。
2. “生成/重新生成”调用 POST，成功后把返回值放入组件内存，展示一次性明文和复制/关闭操作。
3. “撤销”调用 DELETE，成功后状态变为未配置并清空组件内明文。
4. 刷新、离开页面或关闭一次性区域后，不能通过状态接口恢复明文。
5. 不写入 localStorage、Pinia 持久状态、普通配置表单或用户 Key 页面。

## 8. 错误、安全与日志

- 认证失败使用 JSON 401；无真实管理员使用 JSON 503；未知 Admin 路由使用 JSON 404。
- 不从 query、cookie、body 或 WebSocket 子协议接收 Admin Key。
- 比较使用常量时间方式；Key 不出现在日志、错误、状态响应、配置全量响应和测试失败消息中。
- 外部路由不改变原 Controller 的业务错误、状态码和响应结构，除非单 Key handler 需要把归属失败转换为 404。
- Admin Key 具备现有管理员的全部管理权限，包括现有可能返回敏感字段的接口；本期不额外引入 step-up、审计或字段重构。

## 9. 文件边界

预计修改文件：

- `src/routes/adminApiRoutes.ts`：外部显式映射和子应用。
- `src/routes.ts`、`src/local.ts`：挂载顺序和 JSON 404/SPA 隔离。
- `src/middleware/authMiddleware.ts`：Admin Key 分支。
- `src/constants.ts`、`src/manager/configManager.ts`、`src/manager/userManager.ts`、`src/service/adminKeyService.ts`、`src/controller/adminKeyController.ts`：生命周期基础。
- `src/service/configService.ts`：普通配置保留项隔离。
- `src/service/userKeyService.ts`、`src/controller/userController.ts`：单 Key 方法。
- `frontend/src/views/AdvancedSettings.vue`、`frontend/src/api/adminKey.ts`：设置页。
- `frontend/vite.config.ts`：开发代理。
- `tests/api/admin/`、`tests/api/user/`、必要的 Node 集成测试和 `doc/usage/AdminApiUsage.md`。

不修改用户 Key 页面 `KeyEdit.vue`、数据库 schema/migration、LLM 认证解析器或 Worker 专项代码。

## 10. 回滚

1. 先用 Root/管理员 Bearer 删除 Admin Key，停止新的机器调用。
2. 回滚外部路由映射和生命周期中间件分支。
3. 保留旧根路径、旧前端和既有数据库数据。
4. 若回滚到无法过滤 `admin_api_key` 的旧版本，必须先清空该配置，避免普通 `/config.json` 重新暴露保留项。

关闭或回滚 Admin API 不会撤销已经提交的业务变更，也不清理用户 Key、余额或记录。
