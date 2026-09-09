# 外部管理链路现状与规划依据

## 调研状态

- 日期：2026-09-08。
- xy_gateway 基线：`25091c0`，当前工作区中的用户改动不回滚。
- 参考仓库：`../sub2api`，仅读取管理路由、Admin Key 和相关认证实现。
- 本文记录仓库事实；最终产品选择以父任务 `../prd.md` 和 `../design.md` 为准。

## 现有管理能力

| 领域 | 代码事实 | 规划影响 |
| --- | --- | --- |
| 系统 | `src/routes.ts:116-120` 有状态、更新检查、配置和客户端配置状态。 | 外部映射使用 `/status`、`/update`、`/settings` 等无扩展名路径。 |
| 客户端配置 | `src/routes.ts:121-128` 有本地读取、创建、备份、应用和同步。 | 继续使用现有主机路径白名单，不扩展为任意文件操作。 |
| 分组 | `src/routes.ts:131-135` 有列表、创建、详情、更新、删除。 | 外部映射为 `/groups` 和 `/groups/:id`。 |
| 供应商/模型 | `src/routes.ts:138-162` 有供应商、供应商模型和网关模型管理。 | 外部使用 `/vendors`、`/vendors/:id/models`、`/models`。 |
| 用户/Key | `src/routes.ts:165-171` 有用户、整组 Key 和余额操作。 | 增加单 Key外部接口，保留旧整组 PUT。 |
| 记录/统计 | `src/routes.ts:174-190` 有充值、请求记录、活动和统计。 | 外部映射为 `/balance/recharges`、`/records`、`/stats`。 |

当前共 59 条挂载 `authMiddleware.requireAdmin` 的管理路由。LLM 路由在 `src/routes.ts:193-197`，测试清缓存路由在 `src/routes.ts:199-208`，均不进入 Admin API 映射。

## 认证事实

### xy_gateway

- `src/middleware/authMiddleware.ts:5` 当前只解析 Bearer，并检查用户状态和管理员类型。
- `src/service/authContextService.ts:25` 同时处理 Root Token 和用户 Key，管理认证与 LLM 认证共用该服务。
- `src/middleware/llmApiMiddleware.ts:11` 也会读取 `x-api-key`，因此不能在共享解析器中加入 Admin Key。
- `src/controller/modelController.ts:162` 的路由诊断依赖 `authContext`，Admin Key 成功后必须写入真实管理员上下文。

### sub2api

- `../sub2api/backend/internal/server/middleware/admin_auth.go:28-121` 在管理中间件中读取 `x-api-key`，无效值不回退 JWT，并载入首个真实管理员。
- `../sub2api/backend/internal/server/routes/admin.go:486-503` 在 `/api/v1/admin/settings` 下注册 Admin Key 状态、重新生成和删除。
- `../sub2api/backend/internal/service/setting_features.go:419` 生成随机值、保存单值并返回新值。

本任务只借鉴独立管理前缀、Header 优先级、真实管理员绑定和生成即覆盖，不移植 JWT、TOTP、step-up、审计、订阅或部署能力。

## 关键兼容风险

| 编号 | 代码依据 | 最终处理 |
| --- | --- | --- |
| K1 | `src/controller/configController.ts:5` 返回配置集合。 | `admin_api_key` 从普通配置 GET/PUT 隔离。 |
| K2 | `src/service/configService.ts:48` 有永久缓存。 | Admin Key 鉴权直接读数据库，不走该缓存。 |
| K3 | `src/service/userKeyService.ts` 有整组替换逻辑。 | 单 Key API 直接定位目标；旧整组保存保持原语义。 |
| K4 | `frontend/src/views/User/KeyEdit.vue:305,412` 提交完整数组。 | 不改页面，不增加 revision 或冲突检测，文档说明后写覆盖。 |
| K5 | `src/local.ts:127` 有 SPA 回退，`src/routes.ts:211` 有旧 API 404判断。 | 新前缀必须在回退前返回 JSON 404。 |
| K6 | `src/routes.ts:68` 记录请求路径。 | Admin Key 只放 Header，不放 query/body；日志不得记录值。 |
| K7 | `frontend/vite.config.ts:49-61` 通用 `/api` 会 rewrite。 | 增加 `/api/v1/admin` 专用不 rewrite 代理。 |

## 当前范围结论

- 外部入口：`/api/v1/admin/*`，全部无 `.json`。
- 内部兼容：现有根路径和 `.json` 路由继续保留。
- 映射方式：显式静态 handler 表，直接复用 Controller/Service，不做内部 HTTP 或万能 RPC。
- 运行时：只实现 Node SQLite/MySQL；Worker/D1 只拒绝，不承诺支持。
- 并发：Admin Key 生成和用户 Key 编辑都采用简单最后写入语义；不增加 revision、锁、审计或持久幂等。
- 前端：Admin Key 只加到现有设置页；用户 Key 页面不改。

完整方法/路径映射见 `api-operation-matrix.md`，技术设计见 `../design.md`。
