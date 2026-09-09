# 网关外部管理 API 与全局 Admin Key

## 规划状态

- 日期：2026-09-08。
- 当前阶段：Trellis brainstorm；父任务和三个子任务保持 `planning`。
- 本阶段只维护规划文档，不修改业务代码，不执行 `task.py start`，不提交 Git。
- 最新路径决策已经收敛：外部统一使用 `/api/v1/admin/*`，外部路径不带 `.json`；内部旧路由继续保留项目现有的 `.json` 约定。

## 目标

让外部程序通过一个全局明文 Admin Key 完整操作 xy_gateway 的现有管理能力并读取管理信息，同时保留原 Root/管理员 Bearer 链路和旧前端页面。

外部 API 只增加传输层入口和明确映射，不复制业务实现：

```text
外部请求 /api/v1/admin/*
  -> Node Admin API 子应用
  -> Admin Key 或原 Bearer 管理认证
  -> 显式外部路径映射
  -> 现有 Controller
  -> 现有 Service / Manager / 数据库
```

## 用户明确约束

| 编号 | 约束 |
| --- | --- |
| C1 | 参考本机 `~/workspace/sub2api` 的 Admin 路由、`x-api-key` 和生命周期风格。 |
| C2 | 全局只有一个 Admin Key，明文保存在配置数据库。 |
| C3 | 只实现 Node，覆盖 SQLite / MySQL；不实现 D1 / Workers。 |
| C4 | Admin Key 绑定一个真实、有效的数据库管理员，不使用独立虚拟管理用户。 |
| C5 | 生成新 Admin Key 后立即覆盖旧值，不增加候选激活、版本或双 Key 过渡。 |
| C6 | 并发生成采用普通覆盖语义，最后成功写入数据库的值有效。 |
| C7 | 外部用户 Key 提供单 Key 查询、创建、修改和删除；旧整组保存只为兼容保留。 |
| C8 | 现有前端 Key 页面和整组保存方式保持不变，不增加集合版本冲突检测。 |
| C9 | 外部统一入口为 `/api/v1/admin/*`，外部不带 `.json`；内部旧 `.json` 路由继续保留。映射必须是显式白名单，不接受通用任意方法 RPC。 |
| C10 | 管理业务复用现有 Controller、Service、DTO 和错误语义；实现尽量简单、易测试、低 bug。 |
| C11 | 新增项目文档使用简体中文；优先运行与改动直接相关的最小测试集；未经允许不提交。 |
| C12 | Admin Key 只在现有“设置”页面管理；全局最多一个有效值，完整明文只在生成/重新生成成功响应中显示一次。 |

## 仓库事实

| 编号 | 事实与影响 | 证据 |
| --- | --- | --- |
| F1 | 当前已有 59 条挂载 `authMiddleware.requireAdmin` 的管理路由，覆盖系统、配置、资源、用户、记录和统计。 | `src/routes.ts:116-190` |
| F2 | 管理和 LLM 共用认证上下文解析器，不能把 Admin Key 加入共享 `authContextService.resolve()`。 | `src/service/authContextService.ts:25`、`src/middleware/llmApiMiddleware.ts:71` |
| F3 | 现有管理中间件只接受 Bearer，并设置真实 `user` 与 `authContext`；模型路由诊断依赖这些上下文。 | `src/middleware/authMiddleware.ts:5`、`src/controller/modelController.ts:162` |
| F4 | 通用配置接口返回配置集合，配置服务带永久进程缓存；Admin Key 必须使用专用直读并从通用配置隔离。 | `src/controller/configController.ts:5`、`src/service/configService.ts:48` |
| F5 | 用户 Key Service 已有单项创建、修改和列表能力，但 HTTP 入口主要是整组替换。 | `src/service/userKeyService.ts:385`、`:390`、`:422`、`src/routes.ts:170` |
| F6 | 旧前端 `KeyEdit.vue` 缓存并提交完整 Key 数组，不能在本任务中改成单项保存。 | `frontend/src/views/User/KeyEdit.vue:305`、`:412` |
| F7 | sub2api 的 Admin 路由使用 `/api/v1/admin`、`x-api-key`、配置表单值、真实管理员身份和生成即替换。 | `../sub2api/backend/internal/server/routes/admin.go:486-503`、`../sub2api/backend/internal/server/middleware/admin_auth.go:28-121`、`../sub2api/backend/internal/service/setting_features.go:419` |
| F8 | 当前 Hono 对 `/:id.json` 的动态参数解析不可靠，动态参数应使用独立路径段。 | `research/http-contracts-and-probes.md:11-22` |
| F9 | Node 静态服务存在 SPA 回退；未知 Admin API 必须在回退前返回 JSON 404。 | `src/local.ts:127`、`src/routes.ts:211` |
| F10 | Vite 当前会把通用 `/api` 去掉后转发；外部 Admin 前缀需要更具体的代理规则。 | `frontend/vite.config.ts:49-61` |

## 需求

### R1. Admin Key 认证与生命周期

- 使用 `config.name = admin_api_key` 保存唯一明文值；记录不存在或为空表示未启用。
- Node 管理请求包含 `x-api-key` 时优先按 Admin Key 验证。Header 存在但无效时直接返回 401，不回退 Bearer；未提供 Header 时保持原 Bearer 行为。
- Admin Key 每次鉴权直接读取配置数据库，不经过 `configService` 的永久缓存。
- 验证成功后按 `id ASC` 选择第一个 `type=admin`、`status=active` 的真实管理员，设置现有 `user_type`、`user` 和 `authContext`；没有可绑定管理员时返回 503，不构造虚拟用户。
- Admin Key 只在 `requireAdmin` 分支生效；不修改 `authContextService.resolve()` 或 LLM 中间件。只有操作员把同一原文另行保存为普通用户 Key 时，LLM 才会按普通用户 Key 规则处理。
- 外部生命周期路径采用 sub2api 风格：
  - `GET /api/v1/admin/settings/admin-api-key`：只返回 `{ exists }`。
  - `POST /api/v1/admin/settings/admin-api-key/regenerate`：生成安全随机值、立即覆盖并在本次响应返回 `{ key }`。
  - `DELETE /api/v1/admin/settings/admin-api-key`：删除并关闭 Admin Key。
- 第一次生成、Key 丢失或生成响应丢失时，使用 Root/管理员 Bearer 重新生成；不提供当前完整值读取接口。
- 不增加轮换中间状态、客户端版本条件、锁或持久幂等。并发生成时最后成功提交的值有效，任何较早响应中的值可能立即失效。
- `/config.json` 的读写必须排除 `admin_api_key`；含保留字段的批量写入在写入其他配置前整体拒绝。

### R2. 统一外部 Admin API 入口与映射

- 新增独立 Node Admin API 子应用，挂载到 `/api/v1/admin`；外部所有路径不带 `.json`。
- 维护显式路由表，每项至少记录 `method`、外部路径、内部兼容路径和原 Controller handler。外部路径只注册在白名单中，不把前缀字符串直接改写成任意内部路径。
- 外部请求直接调用现有 Controller；不通过本机 HTTP、`app.fetch`、动态 `action`/`path`/`method` 请求体或通用 RPC 转发。
- 59 条现有 `requireAdmin` 管理能力均提供无 `.json` 的外部别名；3 条生命周期和 5 条单 Key 操作另计，计划总计 67 个外部方法/路径组合。
- 外部资源命名按 sub2api 风格使用复数资源，例如 `/users`、`/groups`、`/vendors`、`/models`、`/records`、`/settings`；遗留动作名只在确有对应旧业务时保留，如 `/client-config/backup/rename`。
- 内部旧路由和请求结构不删除、不改名；旧后台和旧前端继续访问原路径。
- Admin API 未知路径、外部误带 `.json` 的路径和不支持的方法返回 JSON 404，不落入 SPA HTML 回退。
- `/v1/*`、`/llm/v1/*`、`/welcome`、`/test/cache/clear` 不进入 Admin 映射。
- Admin API 在 Worker/D1 运行时不提供；Node 运行时门禁拒绝非 Node 执行，避免误宣称跨运行时支持。

### R3. 单个用户 Key API

- 外部提供：
  - `GET /api/v1/admin/users/:id/api-keys`：列表。
  - `POST /api/v1/admin/users/:id/api-keys`：创建一个 Key。
  - `GET /api/v1/admin/users/:id/api-keys/:keyId`：详情。
  - `PUT /api/v1/admin/users/:id/api-keys/:keyId`：只更新提交字段。
  - `DELETE /api/v1/admin/users/:id/api-keys/:keyId`：删除一个 Key。
- 外部 `PUT /api/v1/admin/users/:id/api-keys` 只作为旧整组能力的兼容映射，语义仍是完整数组替换；自动化调用方优先使用单 Key 接口。
- 内部继续保留 `PUT /user/:id/keys.json` 及其前端请求结构。
- 单项操作同时校验 user ID 与 key ID 归属；跨用户或不存在 Key 统一返回 404，不泄露资源归属。
- 复用现有 Key 校验、加密、摘要、唯一约束、DTO 和物理删除语义；单项请求不主动改动兄弟 Key、`quota_used` 或 `last_used_at`。
- 不引入集合 revision、冲突检测、锁、合并、软删除或恢复。旧页面保存陈旧整组数据时可能覆盖外部单 Key 修改，文档明确同一用户不应同时由两种入口编辑。

### R4. 信息、前端入口与文档

- Admin Key 可访问现有 59 条管理能力，包括系统状态、更新检查、配置、客户端配置、分组、供应商/模型、用户、余额、记录、活动和统计。
- 在现有 `AdvancedSettings.vue` 的“设置”页增加 Admin Key 管理区，不创建新页面，也不放入用户 Key 页面。
- 设置页只读取 `{ exists }` 状态；生成/重新生成成功后在当前页面内存中一次性显示明文，关闭、刷新或重新进入后不可再次读取。不得写入 localStorage、持久化 store 或普通配置缓存。
- 新增中文使用文档，说明外部路径、认证、生命周期、完整映射、单 Key API、旧页面兼容和已接受限制。
- 不引入 OpenAPI/Zod、审计表、通用任务系统、部署控制或新的管理后台。

### R5. 安全、稳定与兼容

- Admin Key 比较使用常量时间方式；日志、错误、状态响应和普通配置响应不得包含完整 Key。
- 不从 query、cookie、body 或 WebSocket 子协议读取 Admin Key；只接受 `x-api-key`。
- 绑定管理员必须是真实 active admin；Admin Key 不调用用户 Key 的计费、额度、分组、过期或 `markUsed` 逻辑。
- 旧 Bearer 管理链路、普通用户 Key、LLM 路由、旧用户 Key 页面和整组保存协议保持原行为。
- 只实现 Node 的 SQLite/MySQL；不新增 migration、D1/Workers 分支或部署级主机操作。

## 验收标准

| 编号 | 可观察结果 | 关联需求 |
| --- | --- | --- |
| A1 | Root/管理员 Bearer 可生成、重新生成和删除 Admin Key；新值立即有效，旧值立即失败。 | R1 |
| A2 | 并发生成不产生双值状态；数据库最终只有一个值，只有最终提交值有效。 | R1 |
| A3 | 有效 Admin Key 绑定 ID 最小的 active admin，并能完成依赖 `authContext` 的模型路由；无 active admin 时返回 503。 | R1、R5 |
| A4 | 无效 `x-api-key` 即使同时带有效 Bearer 也返回 401；不带 `x-api-key` 时原 Bearer 行为不变。 | R1、R5 |
| A5 | 未另行登记为普通用户 Key 的 Admin Key 调用 LLM 返回 401；Admin Key 身份不会进入 LLM 认证上下文。 | R1、R5 |
| A6 | 59 条现有管理能力均存在无 `.json` 的 `/api/v1/admin/*` 外部映射，并继续调用原 Controller；未知外部路径返回 JSON 404。 | R2、R4 |
| A7 | 外部生命周期路径与 sub2api 风格一致，外部所有管理路径不带 `.json`；内部旧 `.json` 路径和旧页面仍可用。 | R2、R4、R5 |
| A8 | 单 Key 创建、读取、修改和删除不会主动改动同用户其他 Key；跨用户 key ID 返回 404。 | R3 |
| A9 | `/config.json` 不返回或接受 `admin_api_key`，日志和错误不出现 Key 原文。 | R1、R5 |
| A10 | 设置页位于现有“设置”页面，明文只在生成成功后的当前页面显示一次，刷新后不能读取。 | R1、R4 |
| A11 | 旧 `PUT /user/:id/keys.json`、前端整组保存和普通 LLM 行为回归通过；并发覆盖限制写入文档。 | R3、R5 |
| A12 | 聚焦 Node 测试、后端类型检查、设置页检查和前端构建门槛按项目要求执行，未运行项有记录。 | R5 |

## 明确不纳入

- D1 / Cloudflare Workers 的 Admin Key 和 Admin API 实现与测试。
- 外部 Admin API 的 `.json` 兼容别名；`.json` 只保留内部旧路由。
- 通用 `dispatch`/RPC、任意路径代理、内部 HTTP 转发、动态 Controller 调用和 OpenAPI/Zod 依赖。
- Admin Key 多值、双 Key 过渡、轮换版本、客户端条件写、持久幂等和审计系统。
- 用户 Key 集合版本控制、前端单 Key 提交改造、并发合并和冲突提示。
- 用户/Key 软删除、账务重构、日志浏览、配置导入导出、健康控制和后台任务。
- 任意 Shell、SQL、环境变量或任意文件路径操作。
- 进程重启、在线升级/回滚、整库备份恢复及其他部署级运维控制。
- sub2api 的订阅、支付、JWT、TOTP、step-up 和平台业务；仅借鉴其 Admin API 路径与生命周期风格。

## 最终架构决定

采用“统一前缀 + 显式映射”的单一外部入口：

```text
/api/v1/admin/users
        -> adminApiRouteMap 中的明确条目
        -> userController.listUsers / userKeyService
        -> 现有数据库和响应语义
```

不采用单一万能端点：

```text
POST /api/v1/admin/dispatch
{ "method": "...", "path": "...", "action": "..." }
```

后者会把路由白名单、参数校验、错误转换和请求体转发重新做一遍，不能满足“简单、好测试、bug 少”的目标。

## 任务拆分

- `../09-08-admin-api-foundation`：Node Admin API 外部入口骨架、显式映射基础、Admin Key 存储、生命周期、真实管理员绑定、认证和配置隔离。
- `../09-08-admin-api-user-key`：单 Key Service/Controller 方法和 `/users/:id/api-keys` 外部映射，保留旧整组入口。
- `../09-08-admin-api-validation`：67 条映射清单、认证矩阵、代表性领域测试、设置页一次性展示和中文文档。

三个子任务仍为 `planning`。只有用户在本最终规划摘要后明确批准，才能执行 `task.py start` 并修改产品代码。
