# 前端重构技术设计

## 1. 设计边界

本设计只覆盖 `frontend/src` 的运行时逻辑和必要的前端测试。后端仍然是未来的数据提供者，但当前管理页面使用本地 mock repository 验证页面行为；记录、系统状态和连通性测试保留明确的 API 依赖。

## 2. 分层与数据流

```text
Vue View / Dialog
        ↓
Pinia Store 或页面 composable
        ↓
资源 Repository 接口
        ↓
本地 Mock Repository（本任务）
        ↘
      API Repository（后续替换实现）
```

- `types/`：只放领域实体、查询参数、表单输入和列表结果契约。
- `repositories/`：只负责资源读写和 mock 持久化，不包含 Vue 组件逻辑；当前不保留旧字段 DTO 适配器。
- `stores/`：负责跨页面资源状态、异步 action、错误和刷新，不直接操作 `localStorage` 细节。
- `views/`、`components/`：负责展示和局部表单状态，通过 store/repository action 完成业务操作。
- `api/`：保留仍被记录、系统设置和连通性测试使用的真实 API 边界；管理资源 CRUD 在本任务中由本地 repository 承担。

## 3. 规范化领域模型

### 用户与 Key

```ts
interface UserKey {
    id: number;
    value: string;
    groupId: number | null;
    status: 'active' | 'disabled';
}

interface User {
    id: number;
    name: string;
    keys: UserKey[];
    type: 'normal' | 'admin' | 'root';
    balance: number;
    status: 'active' | 'disabled';
    createdAt: string;
    updatedAt: string;
}
```

旧 `keyGroups` 形状不属于当前契约；删除旧字段后，页面和 repository 统一使用 `UserKey[]`，不增加兼容转换。

### 分组

分组内部统一使用 camelCase；`channelCount` 是从供应商关联计算出的展示字段，不作为用户编辑字段。协议、模型白名单、倍率和状态均为明确的 union/number 类型。

### 供应商与模型

供应商实体配置和表单草稿分离。供应商的调度字段保留在领域配置中，未知配置字段不再透传；模型价格使用带 `billing_mode` 的类型，保存和编辑时完整往返。

### 列表结果

所有管理资源 repository 返回统一的 `{ list, total }` 结构；页面不再判断数组、对象或旧 `ListResult` 联合形状。

## 4. Mock 数据源

- 使用带版本标识的本地存储键保存 mock 状态，初始化时只写入一次种子数据。
- 读写接口返回 Promise，模拟真实异步边界，但不引入随机延迟或不稳定行为。
- 每次写操作先校验引用和重复值，再原子更新内存与持久化状态；失败时保留原状态。
- mock 逻辑只模拟前端可观察的校验和交互，不模拟后端鉴权、供应商真实路由或计费结果。

## 5. 删除和兼容策略

- 先通过路由和 import 图确认不可达模块，再删除孤立的 client-config/API-test 前端代码。
- `api/` 中只保留当前仍有调用方的函数；管理资源的旧 CRUD、预览和同步函数已确认无引用后删除，不保留兼容别名。
- 不修改 `src/` 和任何数据库文件。

## 6. 质量策略

- 新增 repository、纯转换函数和 store action 使用 Vitest 测试。
- 运行 `vue-tsc`/构建验证类型和路由导入；将 ESLint 生成目录排除后检查 `frontend/src`。
- 保留现有 composable 测试，避免把页面测试改成依赖后端的集成测试。
