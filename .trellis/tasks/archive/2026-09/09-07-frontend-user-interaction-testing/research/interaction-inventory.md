# 前端用户操作覆盖调查

## 调查时间

2026-09-07

## 当前测试基础

- `frontend/vitest.config.ts` 使用 `jsdom`，只收集 `src/**/*.test.ts`。
- `frontend/package.json` 已提供 `test:run`、`lint` 和 `build`；依赖中已有 `@vue/test-utils`，没有 Playwright 配置。
- 现有交互测试：
  - `views/Login.test.ts`：空 Token、登录跳转、失败恢复。
  - `views/User/KeyEdit.test.ts`：添加、确认删除、确认重生成、保存。
  - `views/Balance/components/BalanceAdjustDialog.test.ts`：充值、扣减、失败恢复。
  - `views/Model/UpstreamConfig.test.ts`：新增上游和表格布局。
- 其余测试主要覆盖 repository、store、composable 和格式化逻辑，不能替代页面按钮的事件链验证。

## 交互矩阵

| 页面/组件 | 用户动作 | 关键观察点 | 现有覆盖 |
| --- | --- | --- | --- |
| Login | 输入 Token、提交、空值、服务端拒绝 | auth action 参数、跳转、通知、loading | 已覆盖 |
| Header | 退出、主题切换、Logo 连击 | logout、路由、主题状态、开发者模式 | 缺失 |
| Sidebar | 导航、折叠、更新链接 | router key、sidebar 状态、条件菜单 | 缺失 |
| User/Key | 添加、删除、重生成、保存 | 确认回调、payload、失败恢复 | 已覆盖 |
| Group/List | 搜索、重置、新建、编辑、删除 | 过滤状态、表单 payload、确认及关联刷新 | 缺失 |
| Vendor/List | 搜索、重置、新建、编辑、测试、删除 | 子对话框 open 参数、store action、确认和刷新 | 缺失 |
| Vendor/Dialog | 类型/协议切换、自动获取模型、保存/取消 | URL、认证模式、请求 payload、错误提示 | 缺失 |
| Model/List/Dialog | 搜索、重置、新建、编辑、测试、删除 | 路由测试、CRUD、确认和关联刷新 | 缺失 |
| Model/Upstream | 添加、删除、供应商/模型/启用切换、测试 | update 事件参数、异步模型加载 | 部分覆盖 |
| Balance tables | 搜索、重置、分页、调整入口 | query、分页、adjust 事件 | 缺失 |
| Balance dialog | 充值、扣减、取消、失败 | 数值符号、API 参数、loading/通知 | 已覆盖 |
| Record/List | 日期/用户/模型筛选、搜索、重置、自动刷新 | query、timer start/stop | 缺失 |
| Record/Detail | 前后记录、返回、删除、展开、复制、下载 | 路由、确认、工具函数、状态 | 缺失 |
| AdvancedSettings | 开关、保存、取消、更新、清理 | config payload、dirty/loading、确认/反馈 | 缺失 |
| Dashboard | 刷新、自动刷新、卸载 | 并发加载、timer、异常状态 | 缺失 |

## 测试约束

1. Ant Design Vue 的表格、表单、弹窗和选择器使用局部 stub，避免依赖实现细节和全局 DOM。
2. API、store、router、message/requestFeedback 使用 `vi.mock`；每个测试在 `beforeEach` 清理调用和状态。
3. 异步动作使用 `await` 和 `nextTick`；timer 使用 fake timers，并验证卸载后清理。
4. 失败测试必须确认 loading 恢复、错误反馈出现且缓存/表单没有半更新状态。
5. 不在测试日志输出真实 token、cookie 或外部服务响应。
