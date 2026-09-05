# 后端数据库与 ORM 规范

应用 ORM 使用 Sutando。Node 模式默认使用 SQLite（`better-sqlite3`），也支持 MySQL；Worker 模式使用 Cloudflare D1。`src/service/ormService.ts` 选择 adapter，`src/util/db/` 提供底层 adapter 接口。如果 Sutando 查询或 `DatabaseAdapter` 已能表达需求，业务代码不要依赖某个具体驱动。

## Schema 与 migration

- 所有 schema 变更都在 `resource/migrate/` 下新增有序目录，例如 `resource/migrate/migrate_0030/`。
- 语法有差异时分别提供 `sqlite.sql` 和 `mysql.sql`；两种数据库都能执行时使用 `common.sql`。migration service 在 `_migrations` 记录目录名，Node migration 逐个在事务中执行。
- 表名和列名使用 snake_case（`user`、`created_at`、`vendor_model_name`）；应用层 model class 使用 `Sg` 前缀（`SgUser`、`SgRecord`）。时间戳和类似外键的 ID 也保持这一命名风格。
- SQLite/D1 与 MySQL 都必须支持。migration 或 manager 查询不能默认只有 SQLite。

示例：`resource/migrate/migrate_0001/sqlite.sql` 创建基础表，`resource/migrate/migrate_0014/common.sql` 包含与方言无关的变更，`src/service/dbMigrationService.ts` 是 migration 入口。

## Model 与 manager

Model 声明 `table`、TypeScript 字段和 Sutando `casts`。模型自身的转换逻辑放在 model 中：`src/model/sgRecord.ts` 定义 `SgRecordUsage` 以及 `cost`/`usage` cast。资源查询的组合放在 manager，不要放在 controller。

```ts
// src/manager/userManager.ts
async function list(options: UserListOptions) {
    const dbQuery = SgUser.query().orderBy("id", "desc");
    if (options.type) dbQuery.where("type", options.type);
    if (options.keyword) dbQuery.where("name", "like", `%${options.keyword}%`);

    const total = Number(await dbQuery.clone().count() || 0);
    const users = await dbQuery.limit(options.pageSize).offset(options.offset).get();
    return { list: users.all(), total };
}
```

使用 `find` 并显式处理查不到的情况。禁止 `findOrFail`，因为它会把业务错误变成与 API JSON 契约不一致的 HTML/404 路径。典型写法是 `await SgUser.query().find(userId)`，然后在 controller 或 service 中判断 `if (!user)`。

列表接口应 clone 已过滤的 query 用于 `count()`，再在结果 query 上添加排序、limit 和 offset。Sutando 的 `get()` 结果按 `userManager.ts`、`recordManager.ts` 的方式调用 `.all()`。query-builder 更新后，如果调用方需要更新后的对象，应重新读取；`userManager.update` 和 `recordManager.update` 展示了这种写法。

业务流程放在 service。例如 `src/service/userService.ts` 将金额换算成整数微元，并协调 `userManager` 与 `rechargeRecordManager`；原子性的 `increment("balance", delta)` 查询由 manager 负责。新增计费或其他跨资源操作时保持这种分工。

## 原始存储与安全

原始 SQL 和驱动特有操作放在 migration 或 adapter 层（`src/util/db/`）。不要在 controller 中临时拼 SQL。请求/响应 payload 通过 `src/service/objectStorageService.ts` 保存：Node 模式回退到 `storage_record` 表，Worker 模式使用 R2；`record` 表只保存元数据。

注意 Worker D1 与 Node 的事务和连接池行为不同。`src/service/ormService.ts` 会刷新每个请求的 D1 binding，`src/service/userService.ts` 记录了余额更新与充值记录写入有意保持非原子这一现状。不要无提示地引入只能在 SQLite 工作的事务假设。
