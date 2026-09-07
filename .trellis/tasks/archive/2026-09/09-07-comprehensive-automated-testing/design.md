# 自动化测试与缺陷发现技术设计

## 1. 边界与原则

本任务通常只新增/调整测试、fixture、测试 helper 和 Trellis 任务文档，不改变产品实现；本轮追加授权的 BUG-001/BUG-002 修复例外限定在 `frontend/src/repositories/apiUsers.ts`、`apiVendors.ts` 及其直接回归断言。页面级交互及其 BUG-003 修复由独立的 `09-07-frontend-user-interaction-testing` 子任务管理。所有 API 测试通过 `tests/helpers/requestHelper.ts` 进入服务；需要真实 ORM、migration、事务或对象存储的场景放到 `tests/integration/`，纯函数/规则放到 `tests/unit/`。前端测试在 `frontend/src` 使用 Vitest/jsdom，网络边界 mock `@/utils/request`，不启动后端。

### 缺陷修复边界

- BUG-001：在 repository 边界同时读取 `groupId` 与后端 `group_id`，经统一 ID 归一化后返回 `number | null`，并保留现有 camelCase 优先级。
- BUG-002：对创建/更新联合 request 做类型收窄或拆分序列化函数；将动态 URL 结果显式收窄为 `VendorUrls`，不使用 `any` 或非空断言掩盖错误。
- 修复不得改变 API 路径、请求字段或其他资源行为；必须补/保留最短回归断言，并通过严格类型检查。跨任务的页面交互修复必须在其子任务中记录，不在本任务隐式扩大范围。

现有 dirty worktree 是输入而不是本任务可清理的对象。每次修改前记录 `git status --short`，只触碰任务声明的新增文件或现有测试文件；不使用 reset/checkout 覆盖用户改动。

## 2. 测试数据流

```text
fixture/工厂
  → API 测试：root token 创建用户/Key/分组/供应商/模型
  → LLM 请求：Key → 用户/分组策略 → 候选上游 → 租约 → mock 上游
  → 记录/结算：usage → quote → settle → record + user/key 快照
  → 管理查询：验证 DTO、引用清理和脱敏
```

单元测试只注入最小 stub，不读取数据库；集成测试复用全局 DB 和 `dbHelper.truncate()`。测试名称区分正向、负向和 Node-only，敏感 Key 只在必要的断言中使用，日志断言不得打印明文。

## 3. 覆盖矩阵

| 领域 | 必测场景 | 自动化落点 |
| --- | --- | --- |
| 认证与策略 | root/admin/普通 Key；用户、Key、分组停用；过期；IPv4/CIDR、黑名单优先级；协议白名单；Key 与分组模型白名单交集；额度/余额门禁；`/models` 与调用一致 | `tests/unit/service/accessPolicyService.test.ts`、`tests/unit/service/authContextService.test.ts`、`tests/api/auth/`、`tests/api/ai/` |
| 用户/Key/分组 | 多 Key 创建、重复摘要、原子全量替换、Key 脱敏/回显、分组 CRUD、删除分组置空引用、无效 ID/字段/未授权 | `tests/api/user/`、`tests/api/group/`、必要的 `tests/integration/userKey*.node.test.ts` |
| 供应商/模型 | canonical DTO、映射合法性/唯一性、供应商模型引用、状态/协议/分组过滤、删除级联和列表 `{list,total}` | `tests/api/vendor/`、`tests/api/model/`、`tests/integration/schemaConstraint.node.test.ts` |
| 路由与并发 | 最小 priority 层、权重分布/稳定回退、健康冷却、tried set、不重复 failover、Key/Vendor 容量、重复 release、成功/失败/异常/取消释放 | `tests/unit/service/concurrencyService.test.ts`、`tests/unit/service/routingContext.test.ts`、`tests/api/model/model-routing.test.ts`、sender/AI 集成用例 |
| 协议与收尾 | Chat/Responses/Anthropic 非流式和流式；转换、上游错误、客户端取消、断流、对象存储 payload、活动记录 | 现有 `tests/api/ai/`、`tests/api/gateway/`、`tests/integration/recordService.node.test.ts`，按缺口补测 |
| 计费与记录 | token/per-request/image、cache read/write、倍率/微元、Key quota 与用户余额临界值、失败不收费、settle 幂等/竞态、身份和价格快照 | `tests/unit/service/billingService.test.ts`、`tests/integration/billingService.node.test.ts`、`tests/api/balance/`、`tests/api/record/` |
| 迁移与数据库 | migration 可重复/半迁移拒绝、约束和孤儿引用，仅 Node SQLite | `tests/integration/*Migration*.node.test.ts`、`tests/integration/schemaConstraint.node.test.ts` |
| 前端 repository/store | 序列化/归一化、日期/状态/空列表、404/null、错误传播、批量空输入；并发 `ensureLoaded`、分页合并、refresh、CRUD 缓存、引用变更和失败恢复 | `frontend/src/repositories/apiRepositories.test.ts`、`frontend/src/stores/apiStores.test.ts`（或按模块拆分）、现有页面/组合式测试 |
| 前端按键/交互 | 数据写入和删除确认、Key 生命周期、列表搜索/重置/刷新、路由跳转、请求测试/模型获取、余额调整、记录复制/下载/删除、设置保存/取消/清理、loading/disabled/错误反馈 | `frontend/src/views/*/*.test.ts` 按组件拆分：`User/KeyEdit`、`Group/List`、`Vendor/{List,DialogCreate,DialogEdit,DialogTest}`、`Model/{List,DialogForm,UpstreamConfig}`、`Login`、`Dashboard`、`Balance/*`、`Record/Detail`、`AdvancedSettings` |

已有覆盖优先复用；只有矩阵中缺少可观察断言时才新增用例，避免重复堆数量。

### 按键测试分层

组件测试使用 `@vue/test-utils` 挂载目标组件，并用轻量 stub 替换 Ant Design modal/table/form 和子对话框。对确认型按钮捕获 `Modal.confirm` 的 `onOk` 后再断言删除/重新生成，避免绕过真实确认流程；对 `@click`、`@confirm`、`@change` 和 `@success` 分别验证事件参数。所有异步按钮必须断言：

1. 成功时调用一次且参数为当前表单快照；
2. 失败时显示统一错误反馈并恢复 `loading`，不留下半更新缓存；
3. 不满足前置条件时保持 disabled/不发请求；
4. 删除、退出和跳转等副作用只在确认后发生。

搜索、重置、分页和自动刷新采用每个列表至少一组代表性测试；数据写入、删除、权限和路由按钮逐个覆盖。主题切换等低风险按钮只验证状态变化和可访问标签，不扩展视觉快照。

## 4. 执行分层

1. **快速反馈**：后端受影响 unit/API 文件和前端测试可在两个进程中并行；后端内部仍遵守串行文件配置。
2. **回归门禁**：`npm run backend:test`、`npm run backend:test:type`、`cd frontend && npm run test:run`、`npx eslint src`、`npm run frontend:build`。
3. **范围边界**：只执行 Node/SQLite；D1、Worker 和 MySQL 实例均不启动、不连接、不作兼容性结论。

每一层输出命令、退出码、通过/失败数和耗时到任务记录；不把 `log/test`、coverage、`test.db` 或 build 产物加入版本控制。

## 5. 失败分类与缺陷判定

- **产品缺陷**：测试输入合法、期望来自 PRD/现有契约，实际稳定违背且可重复。
- **测试缺陷**：fixture、断言或隔离错误；先修测试，不登记产品 bug。
- **环境阻塞**：端口、依赖或 Node/SQLite 初始化问题；记录命令和原始错误，状态为 `blocked`。
- **预期变更**：旧字段/旧行为与当前 canonical 契约不符；更新测试，不登记 bug。

确认后将条目写入 `findings.md`，并保留最短复现命令。未获产品修复授权时，测试失败不自动修改产品代码或状态；本任务已按追加授权完成 BUG-001/BUG-002 修复并回归，页面交互子任务另行闭环 BUG-003。

## 6. 兼容与回滚

测试改动可按文件独立回退；若新用例暴露旧 fixture 与 canonical DTO 冲突，只迁移 fixture 到当前契约，不增加兼容 adapter。任何临时调试输出在完成后删除，数据库由全局 setup/teardown 管理。
