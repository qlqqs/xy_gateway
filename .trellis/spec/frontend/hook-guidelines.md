# 组合式函数规范

可复用的 Composition API 函数命名为 `useSomething`，放在 `frontend/src/composables/`。现有 composable 使用 named export（`useTable`、`useResourceTable`、`useAutoRefresh`），并返回 refs/computed 值和命令式 action。本目录遵循 named export，不要再引入另一套 default export 风格。

行为参数通过类型化 options interface 传入，并提供安全默认值；通用 composable 不应依赖某个具体页面。`useResourceTable<T, TSearch>` 接收类型化 `fetcher` 和 reset 函数，不直接了解 user 或 vendor。`useAutoRefresh` 接收 callback，并负责 timer 清理。

```ts
export function useResourceTable<T, TSearch extends object>(
    options: UseResourceTableOptions<T, TSearch>,
) {
    const { loading, data, pagination, searchForm, setPage, clearData } = useTable<T, TSearch>(
        options.defaultPageSize ?? 10,
        options.initialSearchForm,
    );
    // loadData、搜索、重置和表格变更 action 使用这些 refs。
    return { loading, data, pagination, searchForm, loadData, handleSearch, handleReset, handleTableChange, clearData };
}
```

按资源所有权使用生命周期：配置 immediate load 时使用 `onMounted`，使用 `onUnmounted` 清理 timer/listener。需要时防止异步操作重叠；`useAutoRefresh` 用 `isRefreshing` 跟踪状态，在一次刷新进行时拒绝第二次刷新。调用方需要等待时，异步 action 返回 `Promise<void>`。

使用 Vitest、fake timer 或 mock 测试纯 composable 行为，参照 `composables/useAutoRefresh.test.ts` 和 `composables/useTable.test.ts`。composable 不应直接操作 router 全局对象或重复 Axios 初始化；应注入 callback，或调用 Pinia/API 边界。
