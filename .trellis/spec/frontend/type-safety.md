# 前端 TypeScript 规范

前端使用严格 TypeScript、`noUnusedLocals`、`noUnusedParameters` 和 `vue-tsc` 构建（`frontend/tsconfig.app.json`）。在 `frontend/src/types/` 按资源定义业务契约，并复用 `types/index.ts` 的共享类型（`BaseEntity`、`PaginationParams`、`TableQuery`、列表响应类型）。

有限的后端值使用 string union（`UserType`、`RequestStatus`、`ModelRoutingMode`），请求/响应对象使用 interface。创建/更新请求的可选性与返回实体不同的时候分开定义，参照 `types/user.ts`。类型使用 type-only import，API 函数标注 `Promise<T>`。

```ts
// frontend/src/api/user.ts
export async function listUsers(params?: UserQuery): Promise<ListResult<User>> {
    return request.get('/user/list.json', { params });
}

export async function updateUser(id: number, data: UpdateUserRequest): Promise<User> {
    return request.put(`/user/${id}`, data);
}
```

为通用 composable 和 UI API 指定泛型（`useResourceTable<User, UserQuery>`、`TableColumnsType<User>`、类型化 `defineProps`/`defineEmits`）。服务端可空字段明确写为 `number | null`、`string | null`，并在 `utils/listResponse.ts` 这类边界处归一化响应，不要在 template 中到处强转。

当前 ESLint 对 `@typescript-eslint/no-explicit-any` 发出 warning，但编译器仍保持严格。不要新增 `any`；使用 `unknown` 加类型守卫或业务 interface。修改旧代码时可以顺便收窄已有 `any`，不要把它复制到新 API。不要用非空断言掩盖不确定的 API 响应，应在 UI 中处理缺失状态。
