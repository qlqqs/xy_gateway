# 前端交互测试缺陷记录

本任务只记录合法输入下稳定复现、且期望行为明确的问题。综合缺陷编号沿用
`.trellis/tasks/09-07-comprehensive-automated-testing/findings.md`。

## BUG-003：充值记录表忽略初始 selectedUserId

- 严重度：`P2`
- 组件：`frontend/src/views/Balance/components/RechargeRecordsTable.vue`
- 状态：`fixed`
- 复现命令：`cd frontend && npm run test:run -- src/views/Balance/components/BalanceTables.test.ts`
- 前置数据：以 `selectedUserId: 7` 挂载充值记录表。
- 修复前实际结果：首次 `listRechargeRecords` 请求的 `user_id` 为 `undefined`，因为监听器只处理后续 prop 变化。
- 期望结果：首次请求也应带 `user_id: 7`，与当前选中用户一致。
- 修复：将 `props.selectedUserId` 注入 `useResourceTable` 的初始搜索表单，同时保留 prop 变化监听。
- 回归证据：修复后该文件 5/5 用例通过；前端全量 22 文件/96 用例通过。
- 影响：已有选中用户时记录页首屏可能查询全部用户的充值记录。

## 测试替身问题（不计为产品缺陷）

- Vendor、Balance 选择器替身最初没有渲染原生 `<option>`，导致 `setValue` 无法发出有效协议/类型值；已在测试中补齐选项事件语义。
- Record 列表测试最初未 stub 本地导入的 `RecordTable`，已通过 `global.stubs` 替换；未修改生产组件行为。

