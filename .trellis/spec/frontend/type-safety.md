# 前端 TypeScript 规范

前端使用严格 TypeScript、`noUnusedLocals`、`noUnusedParameters` 和 `vue-tsc` 构建（`frontend/tsconfig.app.json`）。在 `frontend/src/types/` 按资源定义业务契约，并复用 `types/index.ts` 的共享类型（`BaseEntity`、`PaginationParams`、`TableQuery`、列表响应类型）。

有限的后端值使用 string union（`UserType`、`RequestStatus`、`ModelRoutingMode`），请求/响应对象使用 interface。创建/更新请求的可选性与返回实体不同的时候分开定义，参照 `types/user.ts`。类型使用 type-only import，API 函数标注 `Promise<T>`。

```ts
// frontend/src/repositories/mockUsers.ts
async function list(query: UserQuery = {}): Promise<ListResponse<User>> {
    // repository 只返回当前领域契约，不暴露旧 keyGroups 或多种列表形状。
}
```

为通用 composable 和 UI API 指定泛型（`useResourceTable<User, UserQuery>`、`TableColumnsType<User>`、类型化 `defineProps`/`defineEmits`）。服务端可空字段明确写为 `number | null`、`string | null`；管理资源统一使用 `{ list, total }`，不再维护 `ListResult` 联合或旧字段转换，不要在 template 中到处强转。

当前 ESLint 对 `@typescript-eslint/no-explicit-any` 发出 warning，但编译器仍保持严格。不要新增 `any`；使用 `unknown` 加类型守卫或业务 interface。修改旧代码时可以顺便收窄已有 `any`，不要把它复制到新 API。不要用非空断言掩盖不确定的 API 响应，应在 UI 中处理缺失状态。

## API repository 的跨层归一化与联合类型边界

### 1. 触发范围

后端管理接口使用 snake_case 字段，而前端 repository 对外提供 camelCase 领域对象；创建和更新请求又通常是不同的联合类型。凡是新增或修改 `frontend/src/repositories/` 的 DTO 映射，都必须同时检查字段归一化和严格编译。

### 2. 签名

- 列表 repository：`list(query?): Promise<{ list: Entity[]; total: number }>`。
- 资源写入：创建与更新分别接受各自的 request interface；若保留联合入口，必须先做类型收窄。
- 关系字段归一化：`group_id` / `groupId` → `number | null`，非法或缺失值统一为 `null`。

### 3. 契约

- repository 是唯一的传输边界；页面和 store 只消费 canonical DTO，不读取原始 snake_case 字段。
- 后端可能返回数字或数字字符串，也可能暂时返回 camelCase；归一化应覆盖两种命名并保留 `0`/`null` 的明确语义。
- 动态 URL 映射必须返回声明的 `VendorUrls`，不能把 `Object.fromEntries` 的 `unknown` 结果直接赋给领域类型。

### 4. 校验与错误矩阵

| 输入 | 归一化结果 |
| --- | --- |
| `group_id: "9"` 或 `groupId: 9` | `groupId: 9` |
| 字段缺失、`null`、非正整数 | `groupId: null` |
| 创建 request 读取更新专有的 `id` | 编译错误；先用 `"id" in request` 收窄 |
| 更新 request 读取创建专有的 `type/status` | 编译错误；拆分 request 或显式守卫 |
| URL 字段不是字符串 | 丢弃该字段；最终对象仍满足 `VendorUrls` |

### 5. 正确 / 基线 / 错误案例

- 正确：在 repository 内优先读取 `raw.groupId`，仅在字段为 `undefined` 时回退到 `raw.group_id`，通过 `toPositiveId` 归一化后返回 `number | null`；这样不会把显式 `null`（解绑）误当成字段缺失。
- 基线：列表始终返回 `{ list, total }`，404 按 repository 约定转换为 `null`/空列表，错误继续透传。
- 错误：只读取 `raw.groupId`，或在联合 request 上直接访问并非所有成员都有的字段；这会造成分组绑定丢失或 `vue-tsc` 阻塞构建。

### 6. 必要测试

- `frontend/src/repositories/apiRepositories.test.ts`：覆盖 snake_case/camelCase、数字字符串、空值、请求序列化、404 和错误透传。
- `frontend/src/stores/apiStores.test.ts`：覆盖 repository 归一化结果在加载、分页合并和 CRUD 后的缓存 round-trip。
- 每次 repository 改动都运行 `cd frontend && npx vue-tsc -b` 与 `npm run build`；失败必须保留完整错误位置，不以独立 Vite 打包通过替代类型门禁。

### 7. 错误与正确对照

错误（关系字段和联合类型均未收窄）：

```ts
payload.groupId = key.groupId;
payload.type = request.type;
```

正确（先归一化并按成员能力收窄）：

```ts
const rawGroupId = raw.groupId !== undefined ? raw.groupId : raw.group_id;
const groupId = apiUtils.toPositiveId(rawGroupId) || null;

if ("type" in request) {
    payload.type = request.type;
}
```
