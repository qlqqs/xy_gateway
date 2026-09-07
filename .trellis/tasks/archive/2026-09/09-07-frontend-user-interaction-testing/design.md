# 前端用户操作测试技术设计

## 1. 目标与边界

测试从用户可见动作出发，沿着“控件事件 → 页面 handler → store/API → 反馈或路由”的完整链路断言。首选 jsdom 组件测试和轻量 stub，不启动浏览器或真实后端。产品修复仅针对测试稳定证明的前端缺陷，保持 API 路径、领域 DTO 和现有 UI 契约不变。

## 2. 测试分层

### 2.1 页面/对话框组件层

使用 `mount` 挂载目标 SFC；以语义文本、`aria-label`、稳定 class 和组件事件作为定位依据。Ant Design 的表格、表单、弹窗、选择器、开关和图标替换为最小 stub，保留 `v-model`、`click`、`change`、`ok`、`cancel` 和 slot 语义。

计划新增或扩展：

- `views/layoutInteractions.test.ts`：Header、Sidebar 的退出、主题、导航、折叠和开发者模式。
- `views/Group/List.test.ts`：筛选、重置、CRUD、删除确认和关联刷新。
- `views/Vendor/List.test.ts`、`Vendor/Dialog.test.ts`：列表动作、类型/协议切换、模型获取、保存/取消/失败。
- `views/Model/List.test.ts`、`Model/DialogForm.test.ts`、扩展 `UpstreamConfig.test.ts`：CRUD、测试、上游事件。
- `views/Balance/components/BalanceTables.test.ts`：筛选、重置、分页和调整事件。
- `views/Record/List.test.ts`、`Record/Detail.test.ts`：筛选、自动刷新、导航、删除、复制/下载/展开。
- `views/AdvancedSettings.test.ts`：开关、dirty 状态、保存/取消、更新检查和记录清理。
- `views/Dashboard.test.ts`：初始加载、手动刷新、自动刷新、异常反馈和卸载清理。

若某页面的真实 Ant Design 行为无法在轻量 stub 中可靠表示，只测试页面发出的事件/props 和 handler 的可观察结果，不为实现细节写脆弱快照。

### 2.2 边界 mock

- Pinia store：以 `vi.mock` 提供可控 action、响应式资源和失败 Promise。
- `vue-router`：mock `push`、`currentRoute`，验证目标路径和参数。
- `ant-design-vue/es`：mock `Modal.confirm`、`message`；确认型动作必须显式调用保存的 `onOk` 才产生副作用。
- `requestFeedback`、`api/*`：mock 成功、拒绝、空结果和异常，检查错误文本与 loading 恢复。
- `URL.createObjectURL`、`navigator.clipboard`、`window.open`、平台 `openUrl`：在记录/设置测试中注入 spy，测试调用参数而不写文件或打开外部页面。
- timer：对 Dashboard/Record 自动刷新使用 `vi.useFakeTimers()`，在 `afterEach` 恢复并确认卸载清理。

## 3. 行为契约

每个异步按钮至少包含以下断言：

1. 成功时只调用一次，参数等于当前表单/筛选快照，并显示成功反馈或发出成功事件。
2. 失败时显示统一错误反馈，`loading` 恢复为 false，列表/缓存不保留半更新状态。
3. 缺少必要输入或未确认时不调用写入 API。
4. 删除、退出、跳转和清理等破坏性副作用只在确认/有效前置条件满足后发生。
5. 组件卸载后不再触发自动刷新或遗留 timer。

## 4. 缺陷修复策略

测试失败先归类为测试替身/断言问题、环境问题、预期变更或产品缺陷。只有合法输入、契约明确且至少两次稳定复现的产品缺陷才修改源码。修复范围尽可能限于触发链路；修复后先执行原失败测试和同文件回归，不执行全量。所有已发现问题关闭后，才执行一次前端全量及最终项目门禁。

## 5. 兼容与回滚

新增测试文件可独立移除；产品修复保留最短回归用例。不得回滚工作区既有改动。测试产生的 `dist`、coverage、数据库和日志均不纳入任务成果。
