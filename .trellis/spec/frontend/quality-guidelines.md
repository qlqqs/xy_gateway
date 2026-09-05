# 前端质量、测试与无障碍

使用 `frontend/package.json` 定义的检查：

```bash
cd frontend && npm run lint
cd frontend && npm run test:run
npm run frontend:build
```

仓库提交清单还会运行 `npm run frontend:build`；该构建会执行 `build:viewer`、`vue-tsc -b` 和 Vite，因此能同时发现内嵌 viewer 问题和类型错误。迭代时先运行聚焦测试，再运行相关前端测试/构建命令。

测试使用 Vitest，并与被测代码放在一起。现有示例覆盖 composable（`composables/useAutoRefresh.test.ts`、`composables/useTable.test.ts`）、utility（`utils/format.test.ts`、`utils/requestError.test.ts`）和页面专属纯逻辑（`views/Model/UpstreamConfig.test.ts`）。timer 使用 fake timer，网络/API 边界使用 mock；单元测试不能依赖运行中的后端。

新增 UI 时保持现有无障碍细节：使用带 label 的 Ant Design 表单控件，图标按钮提供 `aria-label`，可点击的自定义控件使用真实 `<button>`，并展示 loading/disabled 状态。`views/User/List.vue` 和 `components/clientConfig/ClientConfigCard.vue` 展示了这些做法。替换组件时要保留键盘焦点和可见错误反馈。

用户可见的请求结果使用 `utils/requestFeedback.ts` 的 `notifySuccess`/`notifyRequestError`。`utils/request.ts` 的 Axios interceptor 已经负责添加鉴权 header、拆出成功响应 data、归一化错误并处理常见状态反馈；页面代码不要再创建平行的通知或传输路径。

检查响应式布局、API null/空状态、失败后残留 loading、路由守卫行为以及日志中的 secret/token 泄露。不要提交生成的 `dist/`、`node_modules/`、本地 env 文件、日志或 IDE 配置。
