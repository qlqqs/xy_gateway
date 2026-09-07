# 后端数据库与 ORM 规范

应用 ORM 使用 Sutando。Node 模式默认使用 SQLite（`better-sqlite3`），也支持 MySQL；Worker 模式使用 Cloudflare D1。`src/service/ormService.ts` 选择 adapter，`src/util/db/` 提供底层 adapter 接口。如果 Sutando 查询或 `DatabaseAdapter` 已能表达需求，业务代码不要依赖某个具体驱动。

## Schema 与 migration

- 所有 schema 变更都在 `resource/migrate/` 下新增有序目录，例如 `resource/migrate/migrate_0030/`。
- 语法有差异时分别提供 `sqlite.sql` 和 `mysql.sql`；两种数据库都能执行时使用 `common.sql`。migration service 在 `_migrations` 记录目录名，Node migration 逐个在事务中执行。
- 表名和列名使用 snake_case（`user`、`created_at`、`vendor_model_name`）；应用层 model class 使用 `Sg` 前缀（`SgUser`、`SgRecord`）。时间戳和类似外键的 ID 也保持这一命名风格。
- SQLite/D1 与 MySQL 都必须支持。migration 或 manager 查询不能默认只有 SQLite。
- Node 的 MySQL 运行边界为 MySQL 8.0.13+（建议 8.0.34+/8.4）；现有迁移依赖
  `LONGTEXT` 表达式默认值、CTE、窗口函数和 `JSON_TABLE`，MySQL 5.7 与 MariaDB
  不在支持范围内。迁移、状态和清理命令应在执行前拒绝不兼容版本。

## MySQL 迁移边界与领域切换契约

### 1. 范围 / 触发条件

- 适用 `DB_DRIVER=mysql` 的 Node 启动、`db:migrate`、`db:status` 和
  `db:clear`，以及 `migrate_0031`/`migrate_0032` 的一次性领域切换。
- 目的：在严格模式和连接中断场景下，避免留下半迁移 schema 或丢失旧用户 Key。

### 2. 签名

- `ensureSupportedMySqlVersion(adapter: DBAdapter): Promise<void>`
- `migrate(adapter: DBAdapter, env: string, options?): Promise<void>`
- 连接配置使用 `DB_URL`，或 `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`。

### 3. 契约

- 版本必须是 MySQL `8.0.13+`；MariaDB 和 MySQL 5.7 不在支持范围内。
- 版本检查在创建 `_migrations` 表前执行；失败时不得执行任何迁移 DDL。
- `migrate_0032` 删除旧列前必须运行应用层 Key 导入；导入写入
  `model_whitelist`、`ip_whitelist`、`ip_blacklist` 的显式 `'[]'`，并写入额度/并发的零值。
- `migrate_0031/mysql.sql` 的 `JSON_TABLE` 兼容 MySQL 8.0.13：上游 ID 先按文本读取，
  再用 `NULLIF(..., 'null')` 和 `CAST` 归一化；`FOR ORDINALITY` 的 1 起始值必须减一，
  以便与 SQLite 的零起始 `sort_order` 保持一致。
- 成功切换后 `user.token`、`model.routing_mode`、`model.routing_config` 均不存在，且
  `_migrations` 含 `migrate_0031` 与 `migrate_0032`。
- `db:clear` 在 MySQL/Node SQLite 删除带外键的业务表时，必须在收尾窗口临时关闭
  外键检查并用 `finally` 恢复；`_migrations` 也要随应用 schema 一并清理，避免下次
  migrate 把空库误判成半迁移状态。

### 4. 校验与错误矩阵

| 条件 | 结果 |
|------|------|
| 版本低于 8.0.13、版本无法解析或 MariaDB | 抛出 `mysql_version_unsupported`（查询失败为 `mysql_version_check_failed`），不建迁移表 |
| `KEY_ENCRYPTION_SECRET` 缺失且存在旧 token | 抛出 `key_encryption_secret_required`，不删除旧列 |
| 领域表/列只有部分存在或 marker 与 schema 不一致 | 拒绝继续，要求从迁移前备份恢复 |
| 已导入相同用户/摘要的 Key | 跳过并保持幂等；同摘要属于不同用户时抛出 `legacy_key_conflict` |

### 5. 正确 / 基线 / 错误案例

- 正确：MySQL 8.4 严格模式从空库迁移，旧 token 先导入 `user_key`，再执行 0032。
- 基线：SQLite/D1 使用各自 SQL 方言；运行时不读取已删除旧列。
- 错误：在 MySQL 5.7 上直接执行历史迁移，或用只依赖列默认值的 INSERT 导入旧 Key。

### 6. 必要测试

- 版本边界单测：覆盖 `8.0.12`、`8.0.13`、`8.0.9`、`8.4.x` 和 MariaDB。
- SQLite 迁移集成：断言规范化 `model_upstream`、旧列删除和 marker。
- MySQL 8.0+ 冒烟：断言严格模式旧 Key 导入的三个 JSON 列为 `[]`，并确认旧列清理。
- 分组 API：断言 `{ list, total }`、数值 `id`、聚合 `channelCount` 和 JSON 404。
- MySQL `db:clear`：断言带外键的父子表全部删除、`_migrations` 不残留，且清理后
  不影响后续连接的外键检查状态。

### 7. 错误与正确对照

错误（依赖 MySQL 默认值，严格模式可能失败）：

```sql
INSERT INTO user_key (user_id, key_hash, encrypted_value) VALUES (?, ?, ?);
```

正确（迁移边界显式写入必需字段）：

```sql
INSERT INTO user_key
  (user_id, group_id, name, status, key_hash, key_prefix, encrypted_value,
   model_whitelist, ip_whitelist, ip_blacklist, quota, quota_used, concurrency_limit)
VALUES (?, ?, ?, 'active', ?, ?, ?, '[]', '[]', '[]', 0, 0, 0);
```

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
