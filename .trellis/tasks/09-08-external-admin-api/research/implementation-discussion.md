# 外部管理 API 实现方案讨论与收敛记录

## 讨论状态

- 日期：2026-09-08。
- 本文记录 brainstorm 经过代码和 sub2api 对照后的最终方案，不再保留未决定的候选实现。
- 业务代码尚未修改，任务仍为 `planning`。

## 1. 问题的最小表述

外部程序需要一个稳定、可认证、可测试的 HTTP 管理入口，能够操作 xy_gateway 已有管理能力；旧后台、旧用户 Key 页面和 LLM API 不能被破坏。

因此真正需要增加的是：

1. 一个全局机器凭证及其生命周期。
2. 一个明确的外部路由命名空间。
3. 外部路径到现有 handler 的静态映射。
4. 单 Key 用户 Key 操作，避免外部调用者整组回写。

不需要增加第二套业务服务、通用任务框架、审计系统或部署控制器。

## 2. 最终请求链路

```text
外部客户端
  -> /api/v1/admin/*（无 `.json`）
  -> Node-only Admin API 子应用
  -> x-api-key 或原 Bearer 的 requireAdmin
  -> adminApiRouteMap 的固定 handler 引用
  -> 现有 Controller
  -> 现有 Service / Manager
  -> SQLite / MySQL
```

旧页面仍走：

```text
旧页面 -> /status.json、/user/:id/keys.json 等内部路径 -> 同一套 Controller / Service
```

LLM 仍走 `/v1/*` 或 `/llm/v1/*` 的原认证链路。Admin Key 不进入共享 `authContextService.resolve()`。

## 3. 为什么是统一前缀

`/api/v1/admin` 是一个独立的外部管理命名空间，和 sub2api 的使用方式一致：

- 客户端使用稳定、无扩展名的资源 URL。
- 旧内部 URL 可以继续带 `.json`，不需要迁移旧前端。
- 管理入口的 404、Node 门禁和认证边界可以单独测试。
- 将来新增管理操作只需增加一条显式定义和对应测试。

这不是把整个 Hono app 再挂载一遍，而是只注册 `requireAdmin` 管理能力。LLM、welcome、测试路由不在白名单内。

## 4. 为什么不用万能 dispatch

不采用：

```text
POST /api/v1/admin/dispatch
{ "method": "PUT", "path": "/user/1/keys.json", "action": "..." }
```

这种设计表面端点少，实际会新增：

- 客户端可控路径的安全过滤。
- 方法和 action 的重复路由选择器。
- body、参数、错误和状态码的二次转换。
- 难以做静态覆盖检查的隐式能力清单。
- 内部 `.json` 路径泄露到外部协议的耦合。

显式映射的代码量稍多，但每条操作可审查、可测试、可直接复用原 handler，整体风险更低。

## 5. 显式映射如何实现

建议定义一份代码内路由表：

```ts
{
    method: "get",
    externalPath: "/users",
    legacyPath: "/user/list.json",
    handler: userController.listUsers,
}
```

注册器只读取 `method` 和 `externalPath` 注册 `handler`。`legacyPath` 用于测试、文档和审查，不用于字符串改写，也不通过内部 HTTP 调用。

映射原则：

- 外部集合用复数资源：`users`、`groups`、`vendors`、`models`、`records`。
- 旧动作型业务保留清晰动作名：`/client-config/backup/rename`、`/vendors/:id/test`。
- 外部资源详情使用独立 ID 段：`/vendors/:id`、`/users/:id/api-keys/:keyId`。
- 静态路径先于动态路径，避免 `preset-urls`、`route-test` 等被当作 ID。
- 不注册外部 `.json` 别名；内部路径只作为映射目标和旧页面入口。

完整映射见 `api-operation-matrix.md`。

## 6. Admin Key 细节

### 存储

- `config.name = admin_api_key` 是唯一事实来源。
- value 保存明文；不存在或为空表示关闭。
- 直读数据库，不使用配置永久缓存。
- 不新增表、migration、环境变量覆盖或第二个 Key。

### 认证

- `x-api-key` Header 存在时优先走 Admin Key 分支，空值也视为已提供。
- 无效 Admin Key 直接 401，即使 Authorization Bearer 有效也不回退。
- 成功后查询 `type=admin`、`status=active`、`id ASC` 的第一个真实管理员。
- 设置既有 `user_type`、`user` 和 `authContext`；没有管理员返回 503。
- Header 缺失才走旧 Bearer/Root/用户 Key 逻辑。

### 生成和删除

```text
GET    /api/v1/admin/settings/admin-api-key
POST   /api/v1/admin/settings/admin-api-key/regenerate
DELETE /api/v1/admin/settings/admin-api-key
```

生成成功后立即覆盖旧值，只在响应中返回一次完整明文；状态只返回 `{ exists }`。并发生成不加版本和锁，最后成功写入值有效。失钥或响应丢失时由 Root/管理员 Bearer 重新生成。

## 7. 用户 Key 细节

外部单 Key API：

```text
GET    /api/v1/admin/users/:id/api-keys
POST   /api/v1/admin/users/:id/api-keys
GET    /api/v1/admin/users/:id/api-keys/:keyId
PUT    /api/v1/admin/users/:id/api-keys/:keyId
DELETE /api/v1/admin/users/:id/api-keys/:keyId
```

内部旧页面继续：

```text
PUT /user/:id/keys.json
```

单项方法按 `(userId, keyId)` 定位，复用现有 Key Service 的校验、加密、摘要和 DTO；不通过“读取全部数组再替换”模拟单项操作。旧整组保存可能覆盖外部变更，不增加 revision 或合并。

## 8. 前端、SPA 和运行时边界

- Admin Key 设置只放在现有 `AdvancedSettings.vue`，不创建新页面。
- 页面加载只取状态；生成结果放组件内存，关闭/刷新即丢失。
- API 模块使用无 `.json` 外部路径。
- Vite 为 `/api/v1/admin` 配置不 rewrite 的专用代理，避免通用 `/api` 规则把路径改成 `/v1/admin`。
- `src/local.ts` 和应用 404 逻辑将 `/api/v1/admin` 视为 API，未知路径返回 JSON 而不是 SPA HTML。
- Worker/D1 只做明确拒绝，不宣称支持；不新增 Worker 数据访问分支。

## 9. 验证策略

验证分为四层：

1. 路由表和 `src/routes.ts` 的双向覆盖检查。
2. Admin Key/Bearer/用户 Key/LLM 认证矩阵。
3. 每个领域一个非付费代表性外部请求。
4. 旧 `.json` 路由、旧 KeyEdit 整组保存和 LLM 正常行为回归。

必须验证外部 `.json` 不被接受、未知路径不落入 SPA、静态路径不被动态参数吞掉，以及模型 route-test 能读到真实管理员上下文。

## 10. 已明确拒绝的复杂度

- OpenAPI/Zod 和代码生成。
- 任意 dispatch、内部 HTTP 代理和动态 handler 调用。
- 用户 Key revision、冲突检测、锁和自动合并。
- Admin Key 双值轮换、版本条件和持久幂等。
- 审计、后台任务、日志浏览、配置导入导出和部署运维控制。

这些不是实现遗漏，而是为满足简单、易测和低缺陷目标而明确排除。
