# 缺陷记录

本文件只登记经最短用例稳定复现、且与当前契约不符的产品问题。测试断言错误、环境阻塞和预期变更分别标记，不冒充产品缺陷。状态取值：`confirmed`、`unconfirmed`、`blocked`、`fixed-pending-retest`、`fixed`、`deferred`。

## 汇总

| ID | 严重度 | 组件 | 状态 | 首次发现 | 回归用例 |
| --- | --- | --- | --- | --- | --- |
| BUG-001 | P2 | 前端 apiUsers Key 归一化 | fixed | 2026-09-07 | `apiRepositories.test.ts` |
| BUG-002 | P1 | 前端 API repository 类型契约 | fixed | 2026-09-07 | `vue-tsc -b`、`npm run build` |
| BUG-003 | P2 | 前端 RechargeRecordsTable 初始用户筛选 | fixed | 2026-09-07 | `BalanceTables.test.ts` |

## 条目模板

### BUG-001：apiUsers 忽略 Key 响应的 snake_case 分组字段

- 严重度：`P2`
- 组件：前端 `repositories/apiUsers`
- 状态：`fixed`
- 前置数据：用户列表响应中的 Key 使用后端字段 `group_id: "9"`。
- 命令与测试：`cd frontend && npm run test:run -- src/repositories/apiRepositories.test.ts`
- 复现步骤：
  1. mock `GET /user/list.json` 返回带 `keys[0].group_id` 的列表响应。
  2. 调用 `apiUsers.list()` 并读取归一化后的 `keys[0].groupId`。
- 期望结果：`group_id` 被转换为数值 `groupId: 9`，以符合 `UserKey` 类型及管理页面分组绑定契约。
- 实际结果（修复前）：`groupId` 为 `null`；实现仅读取 `raw.groupId`。
- 修复结果：`apiUsers` 在 `frontend/src/repositories/apiUsers.ts:17-26` 按 camelCase 优先、字段缺失时回退 snake_case，并通过 `toPositiveId` 归一化；显式 `null` 保持为 `null`。回归用例同时覆盖 snake_case、camelCase 和显式 null。
- 证据：`frontend/src/repositories/apiRepositories.test.ts:20-48`，修复后 6/6 用例通过（退出码 0）；响应不含明文凭证（仅使用占位值）。
- 影响：已有 Key 的分组绑定在列表/编辑 UI 中丢失，可能导致错误显示或覆盖绑定关系。
- 临时规避/后续建议：无；保留该回归用例防止字段兼容性回归。
- 首次发现与最近复现时间：2026-09-07 03:42 UTC；修复回归：2026-09-07 05:15 UTC；主线程最终复核：2026-09-07 05:27 UTC。

### BUG-002：前端 API repository 严格类型检查失败，阻塞官方构建

- 严重度：`P1`
- 组件：前端 `repositories/apiUsers`、`repositories/apiVendors`
- 状态：`fixed`
- 前置数据：使用当前 TypeScript 严格配置编译前端源码；不需要网络或后端服务。
- 修复前复现命令：`cd frontend && npx vue-tsc -b`（退出码 2）；`cd frontend && npm run build`（退出码 2）。
- 复现步骤：
  1. 在仓库根目录进入 `frontend`。
  2. 执行 `npx vue-tsc -b`。
  3. 观察 `apiUsers.ts:56,75-76` 和 `apiVendors.ts:38` 的类型错误。
- 期望结果：API repository 通过严格类型检查，`npm run build` 进入并完成 Vite 打包。
- 实际结果（修复前）：`apiUsers` 对 `UserKeyInput | UpdateUserKeyRequest` 直接读取并集不存在的 `id`，对 `CreateUserRequest | UpdateUserRequest` 直接读取并集不存在的 `type/status`；`apiVendors` 的 `Object.fromEntries` 结果为 `{ [k: string]: unknown }`，不能赋给 `VendorUrls`。官方构建在类型阶段退出。
- 修复结果：`apiUsers` 在 `frontend/src/repositories/apiUsers.ts:57-80` 使用 `'id'/'type'/'status' in` 类型守卫；`apiVendors` 在 `frontend/src/repositories/apiVendors.ts:28-34` 使用字符串 entry 类型谓词，将动态 URL 显式收窄为 `VendorUrls`，保留非字符串过滤。
- 证据：修复后 `cd frontend && npx vue-tsc -b --pretty false` 退出码 0；`cd frontend && npm run build` 退出码 0；`cd frontend && npm run test:run` 12 文件/52 用例通过。回归测试位于 `frontend/src/repositories/apiRepositories.test.ts:50-69,99-112`。
- 影响：修复前前端 CI/发布构建无法通过；修复后严格类型与官方构建恢复通过。
- 临时规避/后续建议：无；保留请求成员类型和 URL 非字符串过滤回归断言。
- 首次发现与最近复现时间：2026-09-07 04:16 UTC；修复回归：2026-09-07 05:17 UTC；主线程最终复核：2026-09-07 05:28–05:31 UTC。

### BUG-003：充值记录表忽略初始 selectedUserId

- 严重度：`P2`
- 组件：前端 `views/Balance/components/RechargeRecordsTable`
- 状态：`fixed`
- 前置数据：组件以 `selectedUserId: 7` 挂载，记录列表请求由 `useResourceTable` 自动触发。
- 修复前命令与测试：`cd frontend && npm run test:run -- src/views/Balance/components/BalanceTables.test.ts`
- 复现步骤：
  1. 挂载 `<RechargeRecordsTable :selected-user-id="7" />`。
  2. 等待首次请求完成并检查 `listRechargeRecords` 参数。
- 期望结果：首次请求包含 `user_id: 7`，只显示当前选中用户的记录。
- 实际结果（修复前）：首次请求发送 `user_id: undefined`；组件的 `watch` 只监听后续变化，初始 prop 未写入搜索表单。
- 修复结果：`RechargeRecordsTable` 将 `props.selectedUserId` 注入 `useResourceTable` 的初始搜索表单，同时保留后续 prop 变化的 watch 行为。
- 证据：`frontend/src/views/Balance/components/BalanceTables.test.ts:191-234`；修复前首个断言稳定失败，修复后该文件 5/5 用例通过，退出码 0；最终前端全量 22 文件/96 用例通过。
- 影响：在选中用户已存在再打开记录页的场景中，首屏可能短暂加载全部用户的充值记录，造成数据范围错误。
- 临时规避/后续建议：无；保留初始 prop 与后续变更两条回归路径。
- 首次发现与最近复现时间：2026-09-07 07:18 UTC；修复回归：2026-09-07 07:35 UTC；主线程最终复核：2026-09-07 07:37 UTC。

## 缺陷闭环分析

### 1. 根因分类

- **BUG-001：B/D — 跨层契约 + 测试覆盖缺口。** 后端 Key DTO 的历史 `group_id` 与前端 canonical `groupId` 没有在 repository 边界形成明确的兼容规则，原有测试也只覆盖了 camelCase。
- **BUG-002：C — 变更传播失败。** 创建/更新 request 是不同 interface，却由同一序列化函数直接读取各自专有字段；动态 URL 的 `unknown` 结果也没有在严格构建前完成收窄。
- **BUG-003：B — 生命周期初始化缺口。** 记录表只在 `selectedUserId` 后续变化时同步搜索条件，未把已有 prop 纳入首次 `useResourceTable` 初始化。

### 2. 为什么基线会漏过

没有经历多次错误修复；综合任务基线阶段按“只登记产品缺陷、不改产品实现”的授权执行，因此 BUG-001/BUG-002 先被稳定复现并记录，交互子任务随后补充发现 BUG-003。此前质量检查覆盖了独立 Vite 打包和部分测试，但没有把 `vue-tsc`/官方构建作为 repository 变更的必经门禁。

### 3. 预防机制

| 优先级 | 机制 | 具体动作 | 状态 |
| --- | --- | --- | --- |
| P0 | 文档契约 | 在前端 type-safety 与跨层指南中规定命名别名、显式 `null` 和联合 request 收窄规则 | DONE |
| P0 | 编译门禁 | repository 变更后运行 `vue-tsc -b` 和官方 `npm run build` | DONE |
| P1 | 回归测试 | 固定覆盖 snake/camel、数字字符串、非法/null、请求字段和动态 URL 过滤 | DONE |
| P1 | 代码审查 | 检查同层 repository 是否新增局部 payload cast 或 `any` 绕过 | TODO |
| P1 | Prop 初始化 | 带筛选 prop 的资源表同时覆盖首次挂载和后续变化，避免首屏请求使用空筛选 | DONE |

### 4. 系统性扩展

- **相似风险**：后续新增管理 DTO、配置字段或 create/update 联合入口时，优先审查 `frontend/src/repositories/` 全部归一化函数；当前 `apiGroups`、`apiModels` 已有别名处理，但仍需随字段演进复测。
- **设计改进**：继续让 repository 作为唯一传输边界，页面和 store 不直接解析 snake_case；必要时提取共享的字段/ID 归一化 helper。
- **流程改进**：把最短 repository 回归和严格类型/官方构建放入每次前端 API 变更的检查清单，避免只看独立 bundler。

### 5. 知识沉淀

- [x] 更新 `.trellis/spec/frontend/type-safety.md`。
- [x] 更新 `.trellis/spec/guides/cross-layer-thinking-guide.md`。
- [x] 检查 `src/templates/markdown/spec/`：当前仓库不存在该模板目录，因此没有可同步的副本。
- [ ] 本轮不创建额外 issue；剩余 UI 按钮覆盖缺口沿用 PRD 中的延期项。

### BUG-XXX：简短标题

- 严重度：`P0` / `P1` / `P2` / `P3`
- 组件：后端/前端及模块
- 状态：`confirmed` / `unconfirmed` / `blocked` / `fixed-pending-retest` / `fixed` / `deferred`
- 前置数据：
- 命令与测试：
- 复现步骤：
  1.
- 期望结果：
- 实际结果：
- 证据：测试文件:行号、响应摘要、退出码或日志路径（不得包含明文 Key）
- 影响：
- 临时规避/后续建议：
- 首次发现与最近复现时间：
