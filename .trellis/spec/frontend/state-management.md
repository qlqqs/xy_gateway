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

## 资源缓存强制刷新契约

### 1. 范围 / 触发条件

- 适用于 `users`、`groups`、`models`、`vendors` 等使用模块级 `loaded` 与
  `loadingPromise` 的资源 store。
- 当一个资源写操作会改变其他资源的派生字段或关联关系时（例如删除分组后 Key
  解绑、删除供应商后模型映射变化），调用方必须使用目标 store 的 `refresh()`。

### 2. 签名

- `ensureLoaded(): Promise<void>`：允许并发调用共享同一次加载。
- `refresh(): Promise<void>`：保证返回前至少发起一次晚于调用时已有在途加载的新快照请求。

### 3. 契约

- `refresh()` 发现旧 `loadingPromise` 时先等待它结束；旧请求成功或失败都不能直接作为
  强制刷新的结果。
- 旧请求结束后设置 `loaded = false`，再调用 `ensureLoaded()` 发起新请求。
- 新请求失败时 `refresh()` 必须拒绝，让页面显示“写入成功但关联刷新失败”的提示；不能
  因旧请求成功而静默返回。
- 多个同时到达的 `refresh()` 可以共享同一个新请求，但不能继续共享写操作之前启动的旧请求。

### 4. 校验与错误矩阵

| 状态 | 预期行为 |
| --- | --- |
| 没有在途加载 | 立即发起一次新快照请求 |
| 旧加载成功 | 等待旧加载，再发起第二次请求 |
| 旧加载失败 | 吞掉旧失败并发起第二次请求；最终结果由第二次请求决定 |
| 强制刷新请求失败 | `refresh()` 拒绝，调用方保留可见警告 |

### 5. 正确 / 基线 / 错误案例

- 正确：供应商删除与模型列表初次加载并发；`models.refresh()` 等初次加载结束后再次读取，
  最终缓存不包含已删除映射。
- 基线：没有在途请求时，`refresh()` 只产生一次 API 列表请求。
- 错误：`refresh()` 先写 `loaded = false`，随后直接复用旧 `loadingPromise`；旧响应可能把
  删除前快照重新写回缓存。

### 6. 必要测试

- 在 `frontend/src/stores/apiStores.test.ts` 使用可控 Promise 模拟旧在途请求。
- 调用 `ensureLoaded()` 后立即调用 `refresh()`，释放旧 Promise，并断言 repository 的
  `list()` 共调用两次。
- 增加旧请求拒绝场景时，断言第二次请求仍执行，且 `refresh()` 的成功/失败只取决于第二次请求。

### 7. 错误与正确对照

错误：

```ts
async function refresh(): Promise<void> {
    loaded = false;
    await ensureLoaded(); // 可能直接返回写操作之前创建的 loadingPromise
}
```

正确：

```ts
async function refresh(): Promise<void> {
    if (loadingPromise) {
        try {
            await loadingPromise;
        } catch {
            // 旧请求不决定强制刷新的终态。
        }
    }
    loaded = false;
    await ensureLoaded();
}
```
