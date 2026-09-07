# 自动化测试现状调查

## 调查时间

2026-09-07

## 运行与数据证据

- 根脚本：`npm run backend:test` 使用 `TEST_MODE=node vitest --run --config vitest.config.ts`；`backend:test:type` 执行严格 TypeScript 检查；前端脚本提供 `test:run`、`lint` 和 `build`。
- 根 Vitest 包含 `tests/**/*.test.ts`，启用 `globalSetup`、fork pool 和 `fileParallelism: false`；因此后端文件不能并行启动多套数据库/端口。
- 任务开始时文件扫描结果：`tests/` 93 个测试文件、981 个用例；`frontend/src` 7 个测试文件、32 个用例。
- 修复前基线为 Node 98 个测试文件/1014 个用例，前端 12 个测试文件/51 个用例（其中 1 个稳定失败，已登记 BUG-001）；修复后本任务主线程复核为前端 12 个测试文件/52 个用例全部通过。随后前端交互子任务新增 10 个页面/布局测试文件，使工作区最终前端总量达到 22 个文件/96 个用例。
- 测试 helper 已提供 API 请求、SQLite 生命周期、mock OpenAI/Anthropic、HTTP/SOCKS 代理和流日志资源，应优先复用而不是另建 server/fake DB。

## 本次改动面

后端改动涉及 `src/middleware/llmApiMiddleware.ts`、`src/service/accessPolicyService.ts`、`authContextService.ts`、`concurrencyService.ts`、`billingService.ts`、`routingService/`、`senderService.ts`、`responseHandlerService.ts`、`dbMigrationService.ts` 及 user/group/model/vendor/record manager/controller。前端改动涉及 `frontend/src/repositories/api*.ts`、`stores/{users,groups,models,vendors}.ts` 和对应管理页面。

## 前端按键动作盘点

当前模板中可观察的高风险动作包括：登录提交；Header 退出/主题切换和 Sidebar 折叠/导航；Dashboard 刷新/自动刷新；用户列表搜索/重置/新建/编辑/编辑 Key，Key 添加/删除/重新生成/保存/取消及限制开关；分组搜索/重置/新建/编辑/删除/保存；供应商搜索/重置/新建/编辑/删除/测试、自动获取模型和表单保存；模型搜索/重置/新建/编辑/删除/测试、上游添加/删除/测试；余额搜索/重置/调整/保存/取消；记录列表筛选/重置/自动刷新，详情前后切换/返回/删除/展开/复制/下载；高级设置保存/取消/检查更新/清理记录。测试优先覆盖会写数据、删除、鉴权、导航或发请求的动作，搜索/刷新至少每类列表覆盖一组。

## 本轮新增测试落点

- 后端纯规则与迁移边界：`tests/unit/service/accessPolicyService.test.ts`、`authContextService.test.ts`、`concurrencyService.test.ts`、`billingService.test.ts`、`dbMigrationService.test.ts`、`userKeyMigration.test.ts`。
- 前端 API/store：`frontend/src/repositories/apiRepositories.test.ts`、`frontend/src/stores/apiStores.test.ts`。
- 前端按键：`frontend/src/views/Login.test.ts`、`frontend/src/views/User/KeyEdit.test.ts`、`frontend/src/views/Balance/components/BalanceAdjustDialog.test.ts`，并复用 `Model/UpstreamConfig.test.ts`。
- 按键用例覆盖登录提交/跳转、Key 添加/删除/重生成/保存、充值/扣减/失败恢复、模型上游添加；每个异步操作均断言参数、确认回调或失败反馈。

## 交互子任务最终覆盖

- 新增 `AppHeader`、`AppLayout`、`AppSidebar`、`Group/List`、`Vendor/List`、`Vendor/Dialog`、`User/List`、`User/DialogActions`、`Record/List` 和 `BalanceTables` 组件测试，共 10 个文件/44 个用例。
- 与本任务原有 repository、store、Login、Key、BalanceAdjustDialog、UpstreamConfig 测试合并后，前端最终为 22 个文件/96 个用例，全部通过。
- `Dashboard`、`AdvancedSettings`、`Model/List`、模型表单、`Record/Detail` 等低频或强依赖复杂 Ant Design DOM 的逐按钮测试仍延期，后续单独补充；不把它们计入已覆盖矩阵。

## 覆盖缺口（已明确延期）

1. 新策略服务的 IPv4/CIDR、黑白名单优先级、协议/模型交集和边界状态已由 `accessPolicyService.test.ts` 覆盖，并由 Node API 套件复核。
2. 并发租约容量耗尽、重复 release、跨 scope 隔离已由 `concurrencyService.test.ts` 覆盖；sender 的异常/取消 finally 路径由既有 AI/record 套件覆盖。
3. `billingService.quote/quoteUsage` 的倍率、缓存 token 和微元边界已单测覆盖；`settle` 的真实 record/user/key 事务、重复结算和配额路径由 Node integration/API 套件覆盖。
4. 已为新 API repository 增加字段归一化、404 语义和 stores 的并发加载/分页合并断言；修复前 `group_id` 兼容归一化断言稳定暴露 BUG-001，修复后回归已通过。
5. 迁移和 MySQL 方言是跨环境风险；本任务只做 Node/SQLite，D1/Worker 明确排除，MySQL 不连接。

6. 交互子任务已覆盖 Group、Vendor、User、Record 列表、Balance 表格和布局组件；Dashboard、AdvancedSettings、Model 主列表/表单以及 Record 详情的逐按钮组件测试仍延期，避免在本轮引入脆弱的 Ant Design 全量 mock。

以上是测试选择依据，不是已确认缺陷；只有出现稳定、可复现且期望行为明确的失败才写入 `findings.md` 的 confirmed 条目。
