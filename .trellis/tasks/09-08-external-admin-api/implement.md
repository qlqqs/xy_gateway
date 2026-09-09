# 外部管理 API 统一入口实施计划

## 1. 当前状态与实施门槛

- 父任务和三个子任务均为 `planning`。
- 本轮已完成外部路径决策：`/api/v1/admin/*`，外部无 `.json`，内部旧 `.json` 路由保留。
- 用户尚未批准本最终规划摘要，因此不得执行 `task.py start`、修改产品代码或新增运行时依赖。
- 实施开始后仍需先执行 `trellis-before-dev`，读取适用的后端、前端和测试规范。

## 2. 子任务与文件所有权

| 顺序 | 子任务 | 主要交付 | 主要写入范围 | 依赖 |
| --- | --- | --- | --- | --- |
| P1 | `../09-08-admin-api-foundation` | Node Admin API 子应用、基础映射、Admin Key 生命周期、认证和配置隔离 | `src/routes/adminApiRoutes.ts`、认证/配置相关后端文件 | 最终规划批准 |
| P2 | `../09-08-admin-api-user-key` | 单 Key Service/Controller 与 `/users/:id/api-keys` 映射 | 用户 Key Service/Controller 及 P1 路由表的单 Key条目 | P1 |
| P3 | `../09-08-admin-api-validation` | 67 条清单验证、设置页、认证回归和中文文档 | 测试、`AdvancedSettings.vue`、Admin Key API 模块、文档、Vite/SPA边界 | P1、P2 |

`adminApiRoutes.ts` 的共同路由表由 P1 负责维护；P2 只补单 Key handler 和对应定义；P3 不复制路由注册逻辑，只消费同一份清单做双向验证。

## 3. 实施顺序

### P1：外部入口与 Admin Key 基础

1. 读取 Trellis 后端规范，记录实现前的 `git status --short`，保留用户已有改动。
2. 抽出可复用的 Hono Env/Variables 类型（若现有类型不便跨子应用复用），不改变现有请求上下文命名。
3. 新建 Node-only `adminApiRoutes` 子应用，使用显式 `{ method, externalPath, legacyPath, handler }` 定义表。
4. 注册 59 条既有管理能力的无 `.json` 外部别名，静态路径先于动态路径，并直接绑定现有 Controller handler。
5. 注册 `/settings/admin-api-key` 的 status/regenerate/delete 外部别名，同时保留内部 `.json` 生命周期路由供设置页和恢复链路调用。
6. 在子应用级执行 Node 门禁、`requireAdmin` 和 JSON 404；挂载位置早于 `src/local.ts` 的 SPA 回退。
7. 增加 `adminKeyService`、Controller、配置表直接读写、首个 active admin 查询和常量时间比较。
8. 在 `authMiddleware.requireAdmin` 中实现 `x-api-key` 优先规则，设置真实 `authContext`，不修改 LLM 解析器。
9. 在 `configService` 中排除 `admin_api_key` 的读取和批量写入。
10. 更新 `src/routes.ts`、`src/local.ts` 和外部 API 404 判定，确保未知 Admin 路径不返回 HTML。
11. 补 P1 聚焦测试：生命周期、轮换、真实管理员绑定、Bearer 优先级、配置隔离、LLM 隔离和外部路径不带 `.json`。

### P2：单个用户 Key

1. 读取父矩阵和用户 Key 规范，确认不触碰 `KeyEdit.vue` 及旧整组 PUT body。
2. 在 `userKeyService` 增加按 `(userId, keyId)` 定位的 `getForUser()`、`deleteForUser()`；复用既有创建、修改、列表、加密和 DTO 逻辑。
3. 在 `userController` 增加 list/create/detail get/detail update/detail delete 薄 handler，非法或跨用户 ID 返回 404/400 的现有 JSON 语义。
4. 在 P1 的显式路由表补充 5 条单 Key 外部别名；集合 PUT 只保留整组兼容语义。
5. 验证单项操作不读取整组后回写，不修改兄弟 Key、`quota_used`、`last_used_at`。
6. 运行单 Key 聚焦测试和既有整组用户 API 回归。

### P3：验证、设置页与文档

1. 从 `src/routes.ts` 与 `adminApiRouteMap` 建立双向清单校验，确认 59 + 3 + 5 = 67 个组合无遗漏。
2. 验证每个领域至少一个非付费代表性外部请求能进入原 Controller；模型 route-test 使用 mock 上游检查真实管理员上下文。
3. 验证有效/无效 Admin Key、无效 Key + Bearer、仅 Bearer、普通用户 Key、LLM 负向和未知外部路径。
4. 在 `frontend/vite.config.ts` 增加 `/api/v1/admin` 专用代理；不让通用 `/api` rewrite 删除该前缀。
5. 更新 `src/local.ts` 的 SPA 隔离，并补前端开发代理/外部路径探针。
6. 在现有 `AdvancedSettings.vue` 增加 Admin Key 状态、生成/重新生成、一次性明文显示、复制、关闭和撤销；不创建新页面、不改用户 Key 页面。
7. 新建独立 `frontend/src/api/adminKey.ts`，只调用无 `.json` 的外部路径，严格声明 `{ exists }` 和 `{ key }` 响应类型。
8. 编写 `doc/usage/AdminApiUsage.md`，列出完整外部路径、内部映射、认证、生命周期、恢复和整组覆盖限制。
9. 运行聚焦后端、前端设置页测试、类型检查、Trellis 校验和 `git diff --check`。

## 4. 验证命令

以下文件名是实施计划，当前尚未创建或运行；落地时按现有测试目录惯例调整：

```bash
npm run backend:test -- --run tests/api/admin/adminKey.node.test.ts tests/api/admin/adminRouteMap.node.test.ts
npm run backend:test -- --run tests/api/user/userKeySingle.node.test.ts tests/api/user/user.test.ts tests/api/user/rootToken.test.ts
npm run backend:test -- --run tests/api/model/model-route-test.test.ts tests/api/ai/models.negative.test.ts
npm run backend:test:type
cd frontend && npm run test:run -- src/views/AdvancedSettings.test.ts
cd frontend && npx vue-tsc -b --pretty false
python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-08-external-admin-api
python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-08-admin-api-foundation
python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-08-admin-api-user-key
python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-08-admin-api-validation
git diff --check
```

测试重点：

- 外部无 `.json` 路径都能命中，外部 `.json` 误用得到 JSON 404。
- 外部请求直接到原 Controller，query/body/status/response 不被内部 HTTP 转发改变。
- 静态路径不会被动态 ID 路由吞掉。
- 59 条基线、3 条生命周期、5 条单 Key 都有显式定义和鉴权覆盖。
- 旧根路径与旧整组用户 Key 保存回归通过。
- 设置页刷新或关闭后不能重新获得明文。

按项目提交规范，只有用户明确要求提交时才执行提交门槛：

```bash
npm run backend:test
npm run backend:test:type
npm run frontend:build
```

本任务不运行 Worker/D1 测试；MySQL 可用时可在专用测试库补跑同一组 Node 聚焦用例。

## 5. 风险与停止条件

| 风险 | 检查方式 | 停止条件 |
| --- | --- | --- |
| 外部映射误变成任意代理 | 检查路由定义只有代码内 handler 引用 | 出现客户端可控制的 path/action/method 分派 |
| Admin Key 进入 LLM | 认证隔离测试与代码审查 | 必须修改 `authContextService.resolve()` 才能通过 |
| 旧 `.json` 页面受影响 | 原路径回归和 `git diff -- frontend/src/views/User/KeyEdit.vue` | 必须改变旧 body/页面协议 |
| 未知路由返回 SPA | Node 404/本地静态服务探针 | `/api/v1/admin/*` 返回 HTML |
| 配置泄露明文 | config GET/PUT、日志和错误断言 | 普通配置或日志包含 `admin_api_key` 值 |
| Hono 路由冲突 | 静态/动态顺序探针 | 静态资源被当成 ID 或参数解析错误 |
| 运行时扩大到 D1 | Node-only 门禁和 Worker 负向 | 需要新增 D1 schema/分支才能工作 |

若触发停止条件，不在实现阶段自行增加 revision、审计、幂等、OpenAPI、迁移或新页面；回到父任务重新规划。

## 6. 回滚点

1. 用 Root/管理员 Bearer 删除 Admin Key。
2. 回滚 `adminApiRoutes`、认证分支、生命周期和设置页改动。
3. 保留原根路径、旧前端和现有数据库表。
4. 若回退到旧配置代码，确认先清空 `admin_api_key`，避免旧 `/config.json` 泄露该保留项。

不执行 `git commit`，除非用户在全部验证后明确要求。
