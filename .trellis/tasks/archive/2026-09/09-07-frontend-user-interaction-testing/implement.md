# 前端用户操作测试执行计划

## 执行前检查

- [x] 读取 `prd.md`、`design.md`、研究矩阵及前端规范，记录当前 `git status --short`。
- [x] 完成最终规划摘要并得到用户明确批准后，才运行 `task.py start` 和修改产品/测试代码。
- [x] 确认测试不依赖后端或真实供应商，保留现有未提交改动。

## 阶段 1：最小反馈与测试基础

- [x] 先运行现有前端测试，记录基线（12 文件/51 用例，1 个稳定失败已转入缺陷记录）。
- [x] 建立共享但局部可控的 stub 约定；优先复用已有测试写法，不依赖真实后端或供应商。
- [x] 按页面域新增交互测试，覆盖 Group、Vendor、User、Record 列表、Balance 表格及 Header、Sidebar、Layout。
- [x] 每新增一组测试立即运行对应测试文件；失败先区分测试替身问题和产品问题。

## 阶段 2：问题闭环

对每个确认缺陷按以下循环执行：

1. [x] 保存最短稳定复现命令和证据到任务 `findings.md`，并同步总缺陷记录中的 BUG-003。
2. [x] 修改最小生产代码范围，并保留/新增最短回归断言。
3. [x] 只运行原问题测试文件，再运行同域测试；修复循环中未用全量结果替代局部证据。
4. [x] 回归断言未通过放宽、跳过或无效 mock 掩盖；选择器替身改为原生 `<option>` 以保留真实事件语义。

## 阶段 3：分层质量门禁

全部发现的问题完成局部回归后，按顺序执行：

1. [x] `cd frontend && npm run test:run`（前端全量最终执行一次）。
2. [x] `cd frontend && npx vue-tsc -b --pretty false`。
3. [x] `cd frontend && npx eslint src`。
4. [x] `cd frontend && npm run build`。
5. [x] `git diff --check`，并核对状态中无本任务新增的生成物、数据库或日志。

若最终全量门禁失败，记录新的最短复现并回到阶段 2；修复后仍只跑对应测试，待所有问题关闭后再重新执行一次最终全量。

## 阶段 4：交付检查

- [x] 更新测试矩阵和 `findings.md`，逐项列出命令、通过数和延期项。
- [x] 运行 Trellis 任务校验，确认 PRD/设计/执行清单完整。
- [x] 不执行 commit/push；向用户报告改动、测试结果、警告和未覆盖范围。

## 实际执行结果（2026-09-07 UTC）

| 层级 | 命令 | 结果 |
| --- | --- | --- |
| 交互聚焦 | `cd frontend && npm run test:run -- src/views/Balance/components/BalanceTables.test.ts src/views/Vendor/Dialog.test.ts src/views/Record/List.test.ts` | 修复后 3 文件/13 用例通过，退出码 0 |
| 前端全量 | `cd frontend && npm run test:run` | 22 文件/96 用例通过，退出码 0 |
| 前端类型 | `cd frontend && npx vue-tsc -b --pretty false` | 通过，退出码 0 |
| 前端 lint | `cd frontend && npx eslint src` | 通过，退出码 0；18 条测试替身风格 warning，无 error |
| 官方构建 | `cd frontend && npm run build` | 通过，退出码 0；仅既有 bundle 体积、npm engine/audit warning |
| Trellis/格式 | `python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-07-frontend-user-interaction-testing && git diff --check` | 通过，退出码 0 |

## 覆盖矩阵与延期项

- 已覆盖：登录提交、Header 退出/主题/开发者入口、Sidebar 导航/折叠、用户列表搜索/重置/新建/编辑/Key、Key 增删改与确认、分组筛选/CRUD/删除确认、供应商筛选/CRUD/测试/删除确认/模型预览、记录列表筛选/重置/日期/分页/自动刷新、余额用户表与充值记录筛选/分页/调整入口。
- 已由同一前端套件覆盖：模型上游添加、API repository/store、余额调整对话框、Key 编辑。
- 延期：Dashboard、AdvancedSettings、Model 主列表/表单、Record 详情的逐按钮组件测试；这些页面需要更复杂的 Ant Design DOM 或 timer/外部平台替身，另开 UI 回归任务，不冒充本轮已覆盖。
- 发现并修复 BUG-003：充值记录表首次挂载时采用 `selectedUserId`，详见本目录 `findings.md` 及综合任务 `findings.md`。

## 风险与回滚点

- Ant Design 组件内部 DOM 变动：使用局部 stub 和语义事件，避免依赖深层 DOM。
- 模块级 Pinia 单例污染：每个文件清理 mock 和 store 状态，必要时 `vi.resetModules`。
- timer/异步竞态：使用 fake timers、`flushPromises` 和卸载断言。
- 若新增测试导致隔离问题，只回退对应新增测试文件，不覆盖用户原有改动。
