# 自动化测试与缺陷发现执行计划

## 执行前门槛

- [x] 读取并保留当前 `git status --short`，确认不覆盖用户已有修改。
- [x] 复核 `prd.md`、`design.md` 和本文件；在用户批准本次规划后运行 `task.py start`。
- [x] 测试环境使用 mock 上游和专用 `test.db`；未设置 `TEST_REAL_API=true`，未触碰未知 MySQL 数据库。

## 有序清单

### 1. 建立基线和矩阵

- [x] 运行受影响后端 API/unit 的最小集合：6 个新增 service 文件共 25 个用例通过（退出码 0）。
- [x] 同时运行前端 `npm run test:run`；51 个用例中 50 个通过，唯一失败稳定复现为 BUG-001。
- [x] 将矩阵中的已有测试文件与待补测试文件逐项核对；未用“全量通过”替代场景覆盖，延期页面已在研究记录中列明。

### 2. 后端纯规则与资源测试

- [x] 补充 `accessPolicyService`、`authContextService`、`concurrencyService`、`billingService.quote/quoteUsage` 的单元边界：空值、非法值、临界值、幂等和 secret 脱敏。
- [x] 用户/Key/分组 API 的负向和原子替换场景由既有 Node 套件覆盖；新增 repository 测试验证 JSON/列表/404 契约。
- [x] 模型/供应商路由的优先级、权重、分组/协议/健康/容量过滤和 failover 由既有 routing/API 套件覆盖。

### 3. 后端集成与跨层收尾

- [x] 用真实 SQLite migration/ORM 验证 `settle` 相关余额、Key quota、record marker 和重复调用幂等（Node 回归通过）。
- [x] 流式、非流式、上游失败、客户端取消/异常的租约释放和失败不扣费由既有 AI/record 套件覆盖。
- [x] Node/SQLite 迁移可重复、schema constraint 和孤儿引用通过；未启动 Worker/D1，未连接 MySQL。

### 4. 前端 repository/store 与按键测试

- [x] 对 `apiGroups/apiModels/apiUsers/apiVendors/apiRepositoryUtils` mock `request`，断言请求路径、序列化字段、响应归一化、404/null、错误透传和批量空输入（修复前的 BUG-001 失败已保留在 findings 中）。
- [x] 对 users/groups/models/vendors store 验证 `ensureLoaded` 共享 promise、分页合并、refresh、CRUD 后缓存同步和失败不残留半状态。
- [x] 为高风险页面按钮补充组件测试：登录提交/跳转；Key 添加、删除、重新生成、保存；余额充值/扣减/失败恢复；模型上游添加。现有 `UpstreamConfig` 测试继续覆盖上游新增；其余页面按钮延期并已记录。
- [x] 新增异步按钮均断言一次性调用、参数、确认回调或失败反馈及状态恢复；装饰按钮未扩大范围。

### 5. 分层自动执行

- [x] 快速层：运行 6 个 service 测试文件的 `TEST_MODE=node npx vitest --run --config vitest.config.ts` 聚焦命令通过；`cd frontend && npm run test:run` 记录 BUG-001。脚本已存在 `--run`，未重复传入导致 Vitest 参数冲突。
- [x] 回归层（后端串行）：`TEST_MODE=node npx vitest --run --config vitest.config.ts` 通过（98 文件/1014 用例）。
- [x] 质量层基线已执行：`npm run backend:test:type`、`cd frontend && npx eslint src`、`npx vite build`、`git diff --check` 通过；修复前 `npx vue-tsc -b` 与 `npm run build` 因 BUG-002 失败，修复后结果见最终复核表。
- [x] 运行边界：仅 Node/SQLite；未执行 `backend:test:worker`，未启动 D1/Worker，未连接 MySQL。

### 6. 失败归因和记录

- [x] 每次基线失败均重跑最短用例：BUG-001 的 repository 文件独立运行 1/5 失败；BUG-002 的 `vue-tsc -b` 独立运行退出码 2；两项均已在授权修复后回归通过。
- [x] 将 confirmed 产品问题按 `findings.md` 模板登记；测试夹具修正和质量门禁阻塞分开归因。
- [x] 每个条目保存测试文件/源码行号、命令、期望/实际和稳定复现证据；日志与断言未使用真实凭证。

### 7. 最终检查

- [x] 重新运行受影响最小集和必要的全量门禁，已更新矩阵与 findings 状态。
- [x] `git status --short` 复核未出现 `test.db`、coverage 或日志；忽略的既有/构建目录未加入版本控制。
- [x] 未执行 `git commit` 或 `git push`；延期项和已修复问题均已在最终记录中列出。

## 实际执行结果（2026-09-07 UTC）

> 本节保留修复前的基线结果，用于对应 `findings.md` 中的最短复现；不代表当前工作区状态。

| 层级 | 命令 | 结果 |
| --- | --- | --- |
| 后端聚焦 | `TEST_MODE=node npx vitest --run --config vitest.config.ts tests/unit/service/accessPolicyService.test.ts tests/unit/service/authContextService.test.ts tests/unit/service/concurrencyService.test.ts tests/unit/service/billingService.test.ts tests/unit/service/dbMigrationService.test.ts tests/unit/service/userKeyMigration.test.ts` | 6 文件 / 25 用例通过，退出码 0 |
| 后端 Node 全量 | `TEST_MODE=node npx vitest --run --config vitest.config.ts` | 98 文件 / 1014 用例通过，退出码 0，约 71 秒 |
| 后端类型 | `npm run backend:test:type` | 通过，退出码 0 |
| 前端全量 | `cd frontend && npm run test:run` | 12 文件 / 51 用例，50 通过、1 失败（BUG-001），退出码 1 |
| 前端缺陷最短复现 | `cd frontend && npm run test:run -- src/repositories/apiRepositories.test.ts` | 5 用例，4 通过、1 失败（BUG-001），退出码 1 |
| 前端源 lint | `cd frontend && npx eslint src` | 通过，退出码 0 |
| 前端类型 | `cd frontend && npx vue-tsc -b` | 退出码 2（BUG-002） |
| 官方前端构建 | `cd frontend && npm run build` | 退出码 2（在 `vue-tsc` 阶段触发 BUG-002） |
| Vite 独立打包 | `cd frontend && npx vite build` | 通过，退出码 0（有 chunk 体积警告） |
| 工作区格式 | `git diff --check` | 通过，退出码 0 |

## 质量复核结果（修复前基线，2026-09-07 UTC）

- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-07-comprehensive-automated-testing`：`implement.jsonl` 6 项、`check.jsonl` 8 项均通过。
- 聚焦后端 6 文件 / 25 用例、后端 Node 全量 98 文件 / 1014 用例均通过；未发现测试隔离或 fixture 回归。
- `cd frontend && npx eslint src`、`cd frontend && npx vite build`、`npm run backend:test:type` 和 `git diff --check` 通过。
- 前端 12 文件 / 51 用例为 50 通过、1 失败（BUG-001）；`cd frontend && npx vue-tsc -b` 与 `cd frontend && npm run build` 为 BUG-002 的 7 条类型错误（当时尚未获得产品修复授权）。
- 复核未发现新的测试缺陷或生成物；D1/Worker、MySQL 均未运行或连接。
- 已完成 Phase 3.3：在 `.trellis/spec/frontend/type-safety.md` 增加 repository 跨层字段归一化、联合 request 类型收窄、动态 URL 类型和对应回归门禁的可执行约束。

## 缺陷修复迭代（用户授权，2026-09-07）

- [x] 修复 BUG-001：`apiUsers` 兼容读取 `group_id` 并保持 `groupId: number | null`。
- [x] 修复 BUG-002：收窄 `apiUsers` 的创建/更新联合 request，并将 `apiVendors` 的动态 URL 映射显式收窄为 `VendorUrls`。
- [x] 重跑 `apiRepositories.test.ts`、前端全量测试、`vue-tsc -b` 和官方 `npm run build`。
- [x] 回写 `findings.md` 状态为 `fixed`，回归证据充分。

> 页面级交互测试由 `09-07-frontend-user-interaction-testing` 独立执行；该子任务新增 10 个测试文件并闭环 BUG-003，最终前端总量为 22 文件/96 用例。

## 缺陷修复回归结果（2026-09-07 UTC）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| repository 最小集 | `cd frontend && npm run test:run -- src/repositories/apiRepositories.test.ts` | 6 用例通过，退出码 0 |
| 前端类型检查 | `cd frontend && npx vue-tsc -b --pretty false` | 通过，退出码 0 |
| 前端全量测试 | `cd frontend && npm run test:run` | 12 文件 / 52 用例通过，退出码 0 |
| 官方前端构建 | `cd frontend && npm run build` | 通过，退出码 0（仅保留既有 bundle 体积警告） |
| 目标文件 lint | `cd frontend && npx eslint src/repositories/apiUsers.ts src/repositories/apiVendors.ts src/repositories/apiRepositories.test.ts` | 通过，退出码 0 |

## 主线程最终复核（2026-09-07 05:27–05:31 UTC）

| 层级 | 命令 | 结果 |
| --- | --- | --- |
| repository 最小集 | `cd frontend && npm run test:run -- src/repositories/apiRepositories.test.ts` | 1 文件 / 6 用例通过，退出码 0 |
| 前端全量 | `cd frontend && npm run test:run` | 12 文件 / 52 用例通过，退出码 0 |
| 前端类型 | `cd frontend && npx vue-tsc -b --pretty false` | 通过，退出码 0 |
| 前端源 lint | `cd frontend && npx eslint src` | 通过，退出码 0 |
| 官方前端构建 | `cd frontend && npm run build` | 通过，退出码 0（仅已有 bundle 体积、npm engine/audit 提示） |
| 后端类型 | `npm run backend:test:type` | 通过，退出码 0 |
| 后端聚焦 | `TEST_MODE=node npx vitest --run --config vitest.config.ts tests/unit/service/accessPolicyService.test.ts tests/unit/service/authContextService.test.ts tests/unit/service/concurrencyService.test.ts tests/unit/service/billingService.test.ts tests/unit/service/dbMigrationService.test.ts tests/unit/service/userKeyMigration.test.ts` | 6 文件 / 25 用例通过，退出码 0 |
| 后端 Node 全量 | `TEST_MODE=node npx vitest --run --config vitest.config.ts` | 98 文件 / 1014 用例通过，退出码 0 |
| 任务与格式校验 | `python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-07-comprehensive-automated-testing && git diff --check` | 全部通过，退出码 0 |

## 回滚点

- 基线记录前：不修改任何代码。
- 每个测试层按独立文件提交工作区改动；若新测试破坏隔离，先恢复该测试文件的新增段并保留 findings 证据。
- 本任务范围内的产品实现失败只登记或按明确授权修复，不用测试任务临时修补；页面交互缺陷遵循独立子任务的回归记录，避免把问题隐藏在 fixture 或 helper 中。
