# 前端规范

前端是使用 Vue 3、TypeScript、Vite、Ant Design Vue、Pinia、Vue Router 和 Axios 的应用。修改 `frontend/src` 时参考以下主题：

- [目录结构](directory-structure.md)
- [组件](component-guidelines.md)
- [Composables](hook-guidelines.md)
- [状态管理](state-management.md)
- [类型安全](type-safety.md)
- [质量与无障碍](quality-guidelines.md)

导入 `frontend/src` 内容时使用 `@/` 别名。API 调用统一经过 `src/api/`，认证 header 和响应归一化经过 `src/utils/request.ts`，跨页面复用的状态放入对应的 Pinia store。
