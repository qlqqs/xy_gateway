# 前端状态管理

跨路由状态优先使用 Pinia。资源 store（用户、分组、供应商、模型）是模块级单例，内部只保存 repository 的响应式快照并暴露明确 action；复杂应用状态仍采用 setup 写法的 Pinia store。`stores/auth.ts` 负责 token、用户类型、鉴权校验和 login/logout；`stores/record.ts` 负责记录列表、详情、loading 状态，以及关联 user/model/vendor 的补全。

状态放在足够小且明确的作用域：

- 组件内表单、弹窗显示、loading 标志和临时选择放在组件内，用 `ref`/`reactive`（`views/User/DialogCreate.vue`）。
- 可复用的表格机制放在 `useTable`/`useResourceTable`，不要放进全局 store。
- 多个路由使用的鉴权/session 或数据放进 Pinia（`auth`、`record`、`app`、`theme`、`stats`）。
- HTTP endpoint 定义留在 `api/`；store 调用这些函数，不要自己构造 Axios 请求。
- 管理资源 store 调用 `repositories/`，repository 负责校验、克隆和持久化；组件不得直接读写 `localStorage`。

Store action 应提供稳定的 loading/error 行为，失败后状态仍应可用。`useRecordStore.fetchRecords` 设置 `loading`、补全关联数据、失败时清理旧状态，并为调用方返回简洁结果。次要请求如果是 best-effort，应隔离并写明，例如 `fetchRecordDetail` 中的 record activity 补全。

鉴权持久化集中在 `utils/authSession.ts`；页面不要各自写 `localStorage` token key。`utils/request.ts` 在 interceptor 中读取当前 token，`router/index.ts` 在进入受保护路由前让 `useAuthStore` 校验 token。

避免在多个 store 中重复保存同一资源、把页面专属表单放进全局 store，或从 template 直接修改 repository 状态。删除分组、供应商或模型时，关联清理必须通过对应 action 完成，不能由页面分别改写数组。
