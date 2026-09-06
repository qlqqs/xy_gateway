# 前端重构现状调查

- **Query**: 以最新前端表达的业务语义和交互流程为锚点，评估仅重构前端、清理冗余代码所需的边界。
- **Scope**: internal
- **Date**: 2026-09-06

## Findings

### 当前提交和目录

- 当前分支基线为 `6e7c5da Add group management and multi-key user support`。
- 该提交只包含 `frontend/` 文件；后端 `src/` 没有同步实现。
- 前端使用 Vue 3、TypeScript、Vite、Ant Design Vue、Pinia、Vue Router 和 Axios。

### 状态与页面

| File Path | Description |
|---|---|
| `frontend/src/stores/users.ts` | 通过 `repositories/mockUsers.ts` 读取本地持久化用户实体，提供列表和 CRUD action |
| `frontend/src/stores/groups.ts` | 通过 `repositories/mockGroups.ts` 读取本地持久化分组实体，提供 CRUD 和引用清理 |
| `frontend/src/views/User/List.vue` | 通过本地 user store 展示用户列表 |
| `frontend/src/views/User/DialogCreate.vue` | 添加/生成 Key、选择分组，但写入本地 store |
| `frontend/src/views/User/DialogEdit.vue` | 编辑 Key、重新生成、分组和状态，但写入本地 store |
| `frontend/src/views/Group/List.vue` | 分组筛选、CRUD、协议/模型/倍率/状态表单；模型选项来自模型 store，通道数由供应商引用派生 |
| `frontend/src/views/Vendor/DialogCreate.vue` | 供应商表单包含分组、模型、并发、负载因子、优先级等字段 |
| `frontend/src/views/Model/DialogForm.vue` | 模型计费和路由表单；价格提交保留 `billing_mode`，状态由模型 repository 持久化 |

### 已落地边界

- `frontend/src/api/` 已有类型化 API 封装和 `frontend/src/utils/request.ts` 请求边界。
- `frontend/src/composables/useResourceTable.ts`、`useTable.ts` 可复用分页/筛选机制。
- `frontend/src/utils/requestFeedback.ts` 已提供成功和失败反馈。
- `frontend/src/types/index.ts` 只保留 `{ list, total }` 列表结果；管理资源通过 repository/store 统一读取。

### 冗余与不可达候选

- `frontend/src/views/User/Detail.vue` 存在，但当前路由没有用户详情子路由。
- 删除 API 测试页面后，`frontend/src/stores/apiTest.ts`、`frontend/src/api/gateway.ts` 仍有残留引用链，需要按 import 图确认。
- client-config 组件和 API 仍存在，当前主路由未发现入口；不能仅按文件名直接删除。
- `frontend/public/data_viewer` 是独立构建输入，不能作为普通前端源码批量重写。

### 当前验证基线

- `cd frontend && npm run test:run`：7 个测试文件、26 个用例通过。
- `cd frontend && npm run build`：通过。
- `cd frontend && npx eslint src`：6 个错误、52 个警告；完整 `npm run lint` 还会扫描嵌入 viewer 内容，问题数量被生成内容放大。

## Caveats / Not Found

- 本任务不依据后端当前实现决定前端业务语义；后端 API 仅保留记录、系统和连通性测试边界。
- 已新增用户、分组、供应商和模型 mock repository，并以版本化 localStorage 保存状态。
- Key 的真实持久化安全策略无法由当前前端单独确定，本任务保持现有遮罩/展示交互，不扩展安全承诺。
