# 前端目录结构

所有 UI 代码位于 `frontend/src/`：

| 位置 | 职责 | 现有示例 |
| --- | --- | --- |
| `api/` | 按资源组织的类型化 Axios 接口封装 | `api/user.ts`、`api/record.ts`、`api/system.ts` |
| `components/` | 可复用 UI，按 `common/`、`layout/` 或业务域分组 | `components/common/RecordTable.vue`、`components/clientConfig/ClientConfigCard.vue` |
| `views/` | 路由级页面；业务域对话框和子组件可放在页面旁边 | `views/User/List.vue`、`views/User/DialogCreate.vue`、`views/Model/` |
| `composables/` | 可复用的 Composition API 状态和生命周期行为 | `composables/useResourceTable.ts`、`composables/useAutoRefresh.ts` |
| `stores/` | 跨页面共享的 Pinia 状态或业务流程状态 | `stores/auth.ts`、`stores/record.ts` |
| `types/` | 业务域 interface、union 以及请求/响应契约 | `types/user.ts`、`types/record.ts` |
| `utils/` | API 传输、格式化、错误反馈和浏览器/平台辅助函数 | `utils/request.ts`、`utils/format.ts` |
| `config/` 和 `constants/` | 构建/运行时配置和固定 UI/业务值 | `config/index.ts`、`constants/record.ts` |
| `router/` | 静态路由树和鉴权守卫 | `router/index.ts` |

Vue 组件和页面文件使用 PascalCase（`StatusCard.vue`、`User/List.vue`），TypeScript 模块使用 camelCase（`useResourceTable.ts`、`request.ts`），测试放在被测模块旁边（`useAutoRefresh.test.ts`、`utils/format.test.ts`）。`views/*/Index.vue` 通常承载嵌套 `<router-view />`；路由仍在 `router/index.ts` 注册。

正常数据流是 view/component → `api` 函数或 Pinia action → `utils/request` → 后端。需要可复用表格的页面应像 `views/User/List.vue` 一样，将 `useResourceTable` 与类型化 API fetcher 组合，而不是重复实现分页逻辑。

不要把 API URL 直接写在 template 中，不要把跨页面状态放进随意的组件，也不要创建绕过 `utils/request.ts` 鉴权和错误拦截器的第二个 HTTP client。
