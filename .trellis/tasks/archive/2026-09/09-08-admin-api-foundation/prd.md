# Admin API 入口与 Admin Key 鉴权

## 目标

建立 Node 专用的 `/api/v1/admin/*` 外部管理入口，并让其使用一个全局明文 Admin Key 调用 xy_gateway 现有管理能力。外部路径不带 `.json`；内部旧路由和 `.json` 约定继续保留。

## 范围内

### R1. 外部入口骨架

- 新建独立 Admin API 子应用，显式注册 59 条现有 `requireAdmin` 管理能力的外部别名。
- 外部路径使用复数资源和 sub2api 风格，例如 `/users`、`/vendors`、`/settings`。
- 每条定义包含外部路径、内部兼容路径和固定 Controller handler；不使用内部 HTTP、动态路径代理或万能 RPC。
- 子应用挂载到 `/api/v1/admin`，未知路径和外部误带 `.json` 返回 JSON 404。
- 静态路径先于动态 ID 路径注册；不使用 `/:id.json`。
- 只在 Node 运行时提供，Worker/D1 不进入数据库实现。

### R2. 唯一配置与生命周期

- 使用 `config.name = admin_api_key` 保存唯一明文值；不存在/空值表示关闭。
- 外部生命周期接口为：
  - `GET /api/v1/admin/settings/admin-api-key`，返回 `{ exists }`。
  - `POST /api/v1/admin/settings/admin-api-key/regenerate`，生成、覆盖并返回 `{ key }`。
  - `DELETE /api/v1/admin/settings/admin-api-key`，删除并关闭。
- 内部可保留 `GET /admin-api-key/status.json`、`POST /admin-api-key/regenerate.json`、`DELETE /admin-api-key.json` 作为实现映射，不作为外部文档路径。
- 明文只在生成成功响应中显示一次，不提供当前完整值读取或掩码状态接口。
- 并发生成采用最后成功写入有效，不增加版本、锁、双 Key 或持久幂等。

### R3. 认证与配置隔离

- `x-api-key` Header 存在时优先验证 Admin Key；无效值不回退 Bearer，返回 401。
- Admin Key 验证成功后绑定 `id ASC` 的第一个 `type=admin`、`status=active` 真实用户，并设置现有管理上下文。
- 没有 active admin 返回 503；不得构造虚拟管理员。
- Header 缺失时保留原 Bearer、Root、用户 Key、状态和权限行为。
- Admin Key 不进入 `authContextService.resolve()` 或 LLM 中间件。
- 普通 `config.json` GET/PUT 排除 `admin_api_key`，并在批量写入前整体拒绝保留字段。

## 验收标准

- [ ] 外部 59 条管理映射均无 `.json`，直接执行原 Controller；旧内部路由仍可用。
- [ ] 外部 `.json` 误用和未知路径均为 JSON 404，不返回 SPA HTML。
- [ ] Bearer 可首次生成、重新生成和删除；生成即替换，旧值立即失败。
- [ ] 有效 Admin Key 绑定最小 ID 的 active admin；无管理员返回 503。
- [ ] 无效 `x-api-key` + 有效 Bearer 返回 401；无 Header 时 Bearer 回归。
- [ ] `/config.json` 不泄露或接受保留字段，日志不含 Key 原文。
- [ ] LLM 认证未新增 Admin Key 分支。
- [ ] Node SQLite/MySQL 聚焦测试和后端类型检查通过。

## 明确不做

- 不提供外部 `.json` 别名。
- 不新增多 Admin Key、候选状态、版本轮换、环境变量覆盖或独立数据库表。
- 不改 LLM 认证、用户 Key 计费或旧前端。
- 不实现 D1/Workers、OpenAPI/Zod、审计、部署控制或通用 RPC。

## 依赖与实施门槛

- 父任务：`../09-08-external-admin-api`。
- 父任务最终规划摘要必须获用户明确批准后，才能执行 `task.py start` 和修改业务代码。
- 共享 `adminApiRoutes` 路由表由本子任务建立；用户 Key 子任务随后只补自己的 handler 和定义条目。
