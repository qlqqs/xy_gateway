# 机器管理 API 的数据一致性与历史引用边界（历史调研）

> 本文是早期 brainstorming 的历史材料，不是当前实施契约。文中关于 `revision`、持久账务幂等、软删除、审计事务、复杂锁协调和导入导出的建议均已从本期范围移除。当前只按 `../prd.md`、`../design.md` 和 `data-consistency-contract.md` 实施；与它们冲突的段落不得作为实现依据。

- 调研问题：当前 Node / SQLite / MySQL 架构下，如何最小化补全用户 Key 单项 CRUD 与整组替换的并发协调、余额调整与充值记录及持久幂等、用户删除与角色变更的历史引用语义。
- 范围：以本仓库静态源码为主，只读参考本机 sub2api 和数据库官方文档；不研究新增 Admin Key 鉴权、路由或日志设计，不研究 D1 / Worker。
- 日期：2026-09-08
- 当前方案：本文保留独立调研时的选项与未解项；用户允许参考 sub2api 后，整体推荐见 `../design.md` 与 `sub2api-decisions.md`，不是已获实施许可，也不代表本期采用本文建议。
- 任务依据: `.trellis/tasks/09-08-external-admin-api/prd.md` 的 R2、R5、R6 与 A5、A6；本文只是规划输入，不代表用户已批准产品选择或实施。
- 标注约定: **已验证事实**指源码、迁移或官方文档证据，不代表已经运行测试或检查部署数据库；**建议**指可供设计采用的方案；**未解问题**需要实现阶段验证或用户选择。

## 调研发现

### 1. 结论摘要

1. **已验证事实**：Key 单项创建、更新、列表已有 service；删除仅有 manager。整组替换有 Node 事务，但集合读取、合并及查重发生在事务外，单项写入没有参与统一的用户级并发协调。不能直接用“读取整组，再调用 replace”实现单项 CRUD。证据：`src/service/userKeyService.ts:385`、`:390`、`:422`、`:439`、`:562`、`:603`；`src/manager/userKeyManager.ts:42`。
2. **整合优先项：旧 UI 并发**。旧页面从缓存复制全组并保存全组（`frontend/src/views/User/KeyEdit.vue:305`、`:412`、`:420`）；机器新增的 Key 会被旧 replace 的遗漏删除清掉（`src/service/userKeyService.ts:564`）。**建议**采用同一用户事务协调，并让整组保存携带读取时的集合版本；409 后重新读取、显式合并，不自动重发旧集合。仅加锁不够，旧 DTO 字段可以不变，但旧 UI 的版本传递流程必须适配，详见第 4 节。
3. **已验证事实 / 建议**：余额增量本身是原子的，但充值记录不在同一事务；建议使用一个短数据库事务完成“幂等唯一占位、余额增量、充值记录、结果快照”。不要用进程内 Map 或事务外的幂等成功标记实现账务去重。证据：`src/service/userService.ts:58`、`:74`、`:82`；`src/manager/userManager.ts:60`。
4. **整合优先项：幂等保留期**。**建议**成功操作先不自动删除，或仅让回放结果过期、保留唯一键与指纹的去重墓碑；用户 / 充值记录删除不能级联删除操作证据。若 TTL 后删除全部证据，就只能承诺窗口内防重，旧请求之后可能再次落账。具体期限待用户选择，不照搬 sub2api 的 24 小时，详见第 5.3 节。
5. **已验证事实**：直接删除 user 会级联删除充值记录和 Key；请求记录保留 user_id，但 Key 引用变成 NULL。结算仍依赖 user / user_key 的存在。删除语义、Key 删除的在途行为和角色变更时是否保留凭据必须明确选择，不能以外键的默认动作代替产品决策。证据见下表和第 6 节。

### 2. 文件索引与相关规范

| 文件 | 用途 |
| --- | --- |
| `.trellis/workflow.md` | 当前保持 planning，只产出调研，不激活任务。 |
| `.trellis/tasks/09-08-external-admin-api/prd.md` | 事务、重试保护、单 Key 不覆盖其他 Key、旧 DTO 兼容的任务依据。 |
| `.trellis/spec/backend/database-guidelines.md` | Sutando / manager 分层、两种 Node 数据库、迁移目录、整数微元、Node 结算事务规范。 |
| `.trellis/spec/backend/quality-guidelines.md` | 单元 / 集成 / API 测试归类、真实数据库测试生命周期。 |
| `.trellis/spec/backend/error-handling.md` | AppError、NotFoundError、409 冲突及稳定 JSON 错误。 |
| `src/service/userKeyService.ts` | Key 校验、DTO、加密、单项创建更新、事务整组替换及初始 Key 插入。 |
| `src/manager/userKeyManager.ts` | 当前非事务感知的查询、写入、删除、额度增量和模型引用清理。 |
| `src/controller/userController.ts` | 现有聚合创建 / 更新的事务边界、余额输入与既有 DTO；这里只核对数据调用关系。 |
| `src/service/userService.ts`、`src/manager/userManager.ts` | 用户余额调整、用户查询及底层增量和硬删除。 |
| `src/manager/rechargeRecordManager.ts`、`src/model/sgRechargeRecord.ts` | 充值记录写入、查询及金额 cast。 |
| `src/model/sgUser.ts`、`src/model/sgUserKey.ts`、`src/util/protocol/billingUtil.ts` | 用户余额与 Key / 充值金额的不同应用层单位。 |
| `src/service/billingService.ts`、`src/service/responseHandlerService.ts` | Node 结算事务、记录幂等、在途响应及提交结果未知的处理。 |
| `src/service/ormService.ts`、`src/util/db/mysqlDBAdapter.ts` | Sutando Knex 连接、独立 adapter 连接及迁移事务包装。 |
| `src/manager/modelUpstreamManager.ts`、`src/manager/vendorModelManager.ts` | 仓库已有显式传递事务连接的 manager 模式。 |
| `src/service/recordService.ts`、`src/manager/recordManager.ts` | 请求历史、Root 哨兵 ID、按 user_id 查询和载荷的逻辑引用。 |
| `src/service/groupService.ts`、`src/service/modelService.ts` | Key 归属分组、模型白名单的其他写入来源。 |
| `resource/migrate/migrate_0002/{sqlite,mysql}.sql` | record.user_id 的非空逻辑引用，无 user 外键。 |
| `resource/migrate/migrate_0007/{sqlite,mysql}.sql` | recharge_records.user_id 的级联删除外键。 |
| `resource/migrate/migrate_0028/common.sql`、`migrate_0029/{sqlite,mysql}.sql` | 用户余额、充值金额、请求费用迁移为整数微元。 |
| `resource/migrate/migrate_0031/{sqlite,mysql}.sql` | Key 哈希唯一、user / group 外键、记录 Key / group 引用和结算字段。 |
| `tests/integration/userManager.node.test.ts`、`rechargeRecordManager.node.test.ts`、`schemaConstraint.node.test.ts` | 可扩展的真实数据库与约束测试。 |
| `tests/unit/service/billingService.node.test.ts` | Node 事务句柄 mock 与 Key 不存在时的结算失败断言。 |
| `tests/api/user/user.test.ts`、`tests/api/balance/billing.test.ts` | 旧用户 / Key / 金额 DTO、负余额语义回归。 |
| `tests/helpers/ormTestHelper.ts`、`tests/helpers/dbHelper.ts`、`tests/globalSetup.ts`、`vitest.config.ts`、`doc/dev/TestManual.md` | 两种数据库的聚焦测试命令与统一生命周期。 |
| `frontend/src/views/User/KeyEdit.vue` | 旧页面缓存集合、临时 ID 与整组保存方式，仅用于评估兼容代价。 |
| `../sub2api/backend/internal/service/admin_user.go`、`service/idempotency.go`、`repository/idempotency_repo.go`、`migrations/057_add_idempotency_records.sql` | 参考请求指纹、唯一占位及生命周期；不照搬其余额落账流程。 |

规范使用边界：数据库规范包含跨环境要求和“余额非原子”的历史说明；本任务以用户明确的 Node-only 范围覆盖环境要求，不把历史非原子行为继续当作目标。质量规范中的全量提交检查不适用于本轮只读调研；本轮不运行测试或提交。

### 3. 事务、唯一约束、外键与金额证据

| 标记 | 已验证事实 | file:line 证据 |
| --- | --- | --- |
| T1 | Node 的业务事务可使用 `ormService.getKnex().transaction(callback)`；getKnex 返回 Sutando 连接的 connector。独立 SQLite / MySQL adapter 并不是该事务连接。 | `src/service/ormService.ts:35`、`:43`、`:68`、`:76`、`:206` |
| T2 | Node 创建 user 与初始 Key 在同一事务；整组 Key 与用户资料修改通过 beforeCommit 共用事务。 | `src/controller/userController.ts:138`、`:159`、`:203`；`src/service/userKeyService.ts:590`、`:603` |
| T3 | replaceForUser 的既有集合与哈希冲突查询都在事务外；options.transaction 也未绑定这些读取。最终 listForUser 同样不使用传入事务。 | `src/service/userKeyService.ts:439`、`:548`、`:598`、`:605` |
| T4 | manager 的 find / update / increment / create 直接调用模型 query，没有事务参数；仅在外面套 callback 不会自动绑定它们。 | `src/manager/userManager.ts:11`、`:54`、`:60`；`src/manager/rechargeRecordManager.ts:44`；`src/manager/userKeyManager.ts:5`、`:18`、`:38` |
| T5 | Node 结算在事务内重读 record，MySQL 使用 forUpdate；再更新 user.balance、Key quota_used 和 record 终态。进程 Map 只覆盖本进程重复收尾。 | `src/service/billingService.ts:72`、`:365`、`:367`、`:385`、`:394`、`:405`、`:423` |
| U1 | Key 原文摘要有全局唯一索引；仅 service 预查不能排除并发插入冲突。 | `resource/migrate/migrate_0031/sqlite.sql:47`；`resource/migrate/migrate_0031/mysql.sql:49`；`src/service/userKeyService.ts:257` |
| U2 | 当前充值表没有请求幂等唯一键，也未检索到管理余额幂等表；record.id 的结算幂等不能复用为管理余额请求标识。 | `resource/migrate/migrate_0007/sqlite.sql:11`、`mysql.sql:11`；`resource/migrate/migrate_0029/sqlite.sql:9`、`mysql.sql:9`；`src/service/billingService.ts:310` |
| F1 | user_key.user_id 引用 user，删除 user 时 CASCADE。 | `resource/migrate/migrate_0031/sqlite.sql:24`；`resource/migrate/migrate_0031/mysql.sql:47` |
| F2 | recharge_records.user_id 引用 user，删除 user 时 CASCADE，账务历史会删除。 | `resource/migrate/migrate_0007/sqlite.sql:23`；`resource/migrate/migrate_0007/mysql.sql:21` |
| F3 | record.user_id 非空且没有 user 外键；Root / 诊断请求使用 -1，不是缺失用户的 NULL。 | `resource/migrate/migrate_0002/sqlite.sql:5`、`mysql.sql:5`；`src/service/recordService.ts:77`；`src/constants.ts:98` |
| F4 | record.key_id、record.group_id、user_key.group_id 删除父行时 SET NULL，不保留被删 Key 的数据库身份链接。 | `resource/migrate/migrate_0031/sqlite.sql:25`、`:144`、`:145`；`resource/migrate/migrate_0031/mysql.sql:48`、`:163`、`:164` |
| F5 | request_activity.record_id 唯一但没有外键；Node 载荷通过 record/<id> 逻辑关联，不会随 user 外键级联处理。 | `resource/migrate/migrate_0027/sqlite.sql:2`、`:5`；`src/service/recordService.ts:22`、`:32`、`:53` |
| M1 | 余额以整数微元存取；旧用户 API 直接返回微元，充值 amount 与 Key quota 在 model / DTO 中为元。不能照 sgUser.balance 的旧注释误判用户 API 已换算。 | `src/model/sgUser.ts:11`；`src/controller/userController.ts:42`；`src/model/sgRechargeRecord.ts:8`；`src/model/sgUserKey.ts:38`；`tests/api/balance/billing.test.ts:179` |
| M2 | 底层用户余额迁移使用 common.sql 的 INTEGER；MySQL 该类型为有符号 32 位，最大 2,147,483,647 微元，即 2147.483647 元。充值 amount 则已用 BIGINT。 | `resource/migrate/migrate_0028/common.sql:3`、`:6`；`resource/migrate/migrate_0029/mysql.sql:9`、`:12`；官方参考 E2 |

补充边界：本机 `better-sqlite3` 源码的编译配置包含 `SQLITE_DEFAULT_FOREIGN_KEYS=1`（`node_modules/better-sqlite3/deps/defines.gypi:14`），因此不能声称本项目 SQLite 的外键默认必定关闭；但本轮未查询实际连接的 PRAGMA。外键行为仍需通过真实连接测试确认。ORM 初始化未显式统一设置 PRAGMA（`src/service/ormService.ts:68`）。

### 4. Key 单项 CRUD 与整组替换

#### 4.1 当前可复用能力与具体竞态

**已验证事实**：`parseInput` 支持“未传字段继承当前值”，已有 `value` / `groupId` / `quota` / `rateLimit` / 过期时间及列表校验（`src/service/userKeyService.ts:143`）。`serializePersistence` / `serializeUpdate` 负责 JSON、布尔值、微元与日期落库（`:357`、`:370`）。保留 ID 的整组更新不写 quota_used / last_used_at；哈希先换临时值再更新最终值，允许同一集合中的 Key 值交换（`:469`、`:571`）。

**源码推导的风险**：

- A 读取 `[K1]` 准备 replace，B 随后创建 K2 并提交，A 的 `whereNotIn(keepIds).delete()` 会删除 K2（`:564`）。仅把 persist 放进事务不会检测“客户端没有看到 K2”。
- 单项 PATCH 读取旧 K1，整组替换修改 K1 后，单项 PATCH 将旧对象合并成完整字段写回，可能覆盖未在 PATCH 中出现的配置（`:390`、`:395`、`:418`）。
- replace 在准备之后遇到并发删除保留 ID，更新计数目前未检查；可能返回成功却丢失目标 Key（`:575`、`:583`）。
- 前端把不存在的正整数 ID 视为草稿，这是当前明确兼容行为；过期客户端提交“曾存在、现已删除”的 ID 也可能被当作新 Key。不能通过全面拒绝未知 ID 修复而不评估旧页面（`:459`、`:496`；`frontend/src/views/User/KeyEdit.vue:284`）。
- manager 另有一个无事务、全删再建的 `replaceForUser`；本次检索未见业务调用它。不要误选该同名方法替代保留 ID 的 service 实现（`src/manager/userKeyManager.ts:49`）。

#### 4.2 建议的最小协调方案

**建议**：所有单项 Key 配置变更与整组替换使用同一用户级事务协调，并为整组替换引入读取版本。可用 `user.key_revision`（默认 0 的整数计数）作为最直接实现；不是复用 updated_at。

1. 事务前只做与数据库当前状态无关的格式校验、生成新 Key、加密 / 摘要计算。依赖当前 Key 的默认值合并、归属校验、集合版本和现有行读取必须在事务内，用同一个 trx。
2. 首个数据库操作执行 `UPDATE user SET key_revision = key_revision + 1 WHERE id = ? [AND key_revision = ?]`。单项可选 expectedRevision；整组必须有读取时的 expectedRevision。版本校验、占有用户写锁和版本推进合为一次条件更新；任何后续失败整体回滚版本。
3. 更新 0 行后在同事务确认 user 是否存在：不存在返回 404；存在但版本不符返回 409 `key_set_conflict`。归档语义如果被选择，还必须拒绝已归档用户的新 Key 操作。
4. 使用 trx 重读当前集合或目标 `(user_id, id)`；MySQL 对依赖的当前 Key 行使用锁定读，避免复用外部事务已有的旧读视图。单项只更新目标行；路径 ID 不得由 input.id 改写，不能单项更新 user_id，跨用户 ID 按统一的 404 或明确既有 403 契约拒绝。
5. 整组保留现有“保留 ID 更新、遗漏 ID 删除、同组哈希交换”的流程；每个预期存在的 UPDATE / DELETE 检查结果。最终唯一约束错误要转换为稳定 409，且只识别具体 Key 哈希唯一约束，不将任意数据库错误都视为查重。
6. 在事务内读取本次结果快照并完成必要转换，返回后由外层等待提交成功。避免传入 transaction 时又调用事务外 listForUser，也避免事务结束后才从另一个写入者那里读到结果。
7. 配额用量、最后使用时间、余额结算不推进 key_revision；否则每次推理都会让编辑页面无故冲突。配置变更才推进版本，保存绝不覆写 quota_used / last_used_at。

SQLite 本机 Knex 默认池上限为 1，事务开始使用普通 `BEGIN`（`node_modules/knex/lib/dialects/sqlite3/index.js:215`；`execution/sqlite-transaction.js:21`）。将条件 UPDATE 放在首次读取之前可直接进入写事务；仍需对 SQLITE_BUSY 做有界整事务重试。不得在已开始的 Knex callback 内再发送 BEGIN IMMEDIATE。MySQL 的并发结果必须由数据库行锁和条件写保证，不依赖 Node 单进程锁。参考 E1、E3。

若需要把外部已有 transaction 传给 service，应规定调用方已完成同样的用户协调，或者让 service 在该 trx 内取得协调；不能各拿一个默认连接。跨多用户操作按用户 ID 的稳定顺序取锁，但本轮不建议新增批量写能力。

#### 4.3 方法签名建议

以下为规划签名，不是已存在的接口。`NodeTransaction` 表示实际 Knex Transaction；应在 manager 边界显式传递，而不是暴露给外部调用者。

```ts
type KeyWriteOptions = { expectedRevision?: number };
type KeySnapshot<T> = { data: T; revision: number };

// userKeyService，复用既有解析、加密与 DTO；模块保持 default export
getForUser(userId: number, keyId: number, secret: string): Promise<UserKeyDto | null>;
listSnapshotForUser(userId: number, secret: string): Promise<KeySnapshot<UserKeyDto[]>>;
createForUser(userId: number, input: UserKeyInput, secret: string,
    options?: KeyWriteOptions): Promise<KeySnapshot<UserKeyDto>>;
updateForUser(userId: number, keyId: number, input: UserKeyInput, secret: string,
    options?: KeyWriteOptions): Promise<KeySnapshot<UserKeyDto> | null>;
deleteForUser(userId: number, keyId: number,
    options?: KeyWriteOptions): Promise<KeySnapshot<boolean>>;
replaceForUser(userId: number, inputs: UserKeyInput[], secret: string,
    options: { expectedRevision: number; transaction?: NodeTransaction;
        beforeCommit?: (trx: NodeTransaction) => Promise<void> }): Promise<KeySnapshot<UserKeyDto[]>>;

// userManager
claimKeyRevision(trx: NodeTransaction, userId: number, expected?: number): Promise<number>;

// userKeyManager，所有 InTransaction 方法仅使用传入句柄
findForUserInTransaction(trx: NodeTransaction, userId: number, keyId: number): Promise<SgUserKey | null>;
listByUserInTransaction(trx: NodeTransaction, userId: number): Promise<SgUserKey[]>;
findByHashInTransaction(trx: NodeTransaction, keyHash: string): Promise<SgUserKey | null>;
createInTransaction(trx: NodeTransaction, data: KeyPersistenceInput): Promise<SgUserKey>;
updateForUserInTransaction(trx: NodeTransaction, userId: number, keyId: number,
    data: KeyUpdatePersistenceInput): Promise<number>;
deleteForUserInTransaction(trx: NodeTransaction, userId: number, keyId: number): Promise<number>;
```

`claimKeyRevision` 返回新版本，并封装 404 / 冲突区分；禁用使用 updateForUser 的 status patch，不再增加一套业务规则。分组存在性校验同样需要接收 trx，不能原样调用事务外的 validateGroup / userGroupManager.findById。旧 service 调用方需要原 DTO 时可保留薄兼容 wrapper，从 KeySnapshot 提取 data；不存在调用方依赖时不必增加 wrapper。最终方法名与类型可按实现收敛。

事务查询得到的是数据库原始单位，不能简单断言为 SgUserKey 或 `new SgUserKey(rawRow)` 后再写回。Sutando 现有 hydrate 使用 `newFromBuilder` / `setRawAttributes`（`node_modules/sutando/src/builder.js:1065`；`node_modules/sutando/src/model.js:172`）；建议复用该原始属性装载路径，或定义显式 raw-row 转换。否则 quota 可能被二次乘以一百万。

#### 4.4 冲突策略与兼容代价

| 可选策略 | 保证与代价 |
| --- | --- |
| **建议：事务协调 + 整组强制条件写** | 可阻止旧集合覆盖机器增删与策略变化。版本与集合必须来自同一读快照，冲突后由调用者重新读取并合并，不能自动刷新版本后重发旧集合。旧页面必须传递版本，未升级脚本需要升级；这是语义兼容代价。 |
| 事务协调 + 旧入口无条件替换 | 保留旧客户端，单项不误动其他 Key，事务内不会半写；但旧页面后提交仍会删除新 Key，不能声称满足完整 A6。只有用户明确接受“最后一次整组写入覆盖”时才成立。 |
| 整组改为只合并、不删除遗漏项 | 避免误删，但破坏现有 replace / 空数组清空的含义，仍不能保护旧字段覆盖，不推荐作为隐式修复。 |

PRD 要求不改名现有 Key 字段和旧前端 DTO。建议把版本作为传输层条件元数据交给旧客户端，不增加或重命名其业务字段；此处不定义路由。即使业务 JSON 不变，旧页面仍需要调整读取 / 保存流程。当前页面从 store 缓存打开并提交全量数组（`frontend/src/views/User/KeyEdit.vue:305`、`:412`、`:420`）；保存前才读取版本再绑定旧表单是错误实现。

可以用规范化 Key 配置集合摘要代替 key_revision，从而避免新增版本列；摘要需按 ID 排序，覆盖可编辑字段和 key_hash，排除 quota_used、last_used_at、随机密文等非配置因素，且在用户锁内比较。代价是全量读取 / 规范化与等价状态的 ABA 语义，需要额外测试。本文不把两套版本机制同时推荐实施。

**未解边界**：除了这两个入口，还有模型改名 / 删除及分组删除会改 Key 配置（`src/service/modelService.ts:249`、`:261`；`src/manager/userKeyManager.ts:81`、`:95`；`src/service/groupService.ts:212`）。若采用计数版本，这些写入必须按受影响用户参与同一协调并推进版本；否则版本并不代表完整 Key 配置。摘要方案能发现已提交的配置变化，但不能消除这些路径自身“先读后写”的并发覆盖。实现范围至少应列出这些调用点并决定联动修正边界，不能宣称只改新入口即具备全局保证。

### 5. 余额调整、充值记录和持久幂等

#### 5.1 数据与 service 边界建议

**建议**：沿用“有符号增量”与允许负余额的既有语义，不从 sub2api 引入 set/add/subtract 三种金额操作。统一 core 负责落账，旧后台调用和机器调用都进入这个 core；只有机器调用必须提供幂等键，旧入口可先保留无幂等键的请求格式，但同样获得事务原子性。无幂等键的两个调用仍是两次操作，不能承诺旧客户端超时重试去重。

**最小 schema 建议**：新增专用 `balance_adjustment_operation` 表，而不是先建设全局通用幂等框架。

| 字段 / 约束 | 建议意义 |
| --- | --- |
| id 主键；scope、idempotency_key_hash；唯一 `(scope, idempotency_key_hash)` | 数据库唯一性决定谁有执行权。scope 为稳定业务名，如 `admin.balance.adjust.v1`，不能随 Admin Key 轮换改变；目标 userId 放入指纹，防止相同业务键意外给不同用户加钱。 |
| request_fingerprint | 固定字段规范化后的 SHA-256，识别同键异请求。幂等键摘要按原值计算，避免 MySQL 大小写不敏感排序规则把不同原键合并。 |
| status、user_id、recharge_record_id、amount_units、balance_before_units、balance_after_units、completed_at | 未提交事务内可以是 processing；只有完整成功快照才提交。金额列 SQLite INTEGER / MySQL BIGINT，ID 类型与现有表保持一致。 |
| response_version；可选 replay_until | 支持稳定重放和未来保留期契约。简单固定列结果足够时无需保存整个 HTTP / UserDto。 |
| user_id、recharge_record_id 为历史逻辑引用，不配置 CASCADE | 用户删除 / 记录清理不能抹掉去重证据；即使原资源不存在，也能重放已完成的业务结果。不要把成功重放建立在再次查询当前 user 或当前 recharge 行之上。 |

也可给 recharge_records 直接增加指纹 / 唯一键 / 结果快照字段，少一张表；但其现有 CASCADE 会随用户删除一起丢失幂等证据，且充值历史和重放保留期无法独立。因此在删除产品语义未确定时，独立窄表更可控。

本轮发现 MySQL balance 仍是 32 位 INTEGER，建议新增迁移把它扩成 BIGINT，并明确所有金额的应用层安全整数上限。不应改写已应用的 migrate_0028。当前迁移目录扫描至 migrate_0032，但不要在并行规划中预占下一个编号。

```ts
type AdjustmentInput = {
    amount: number;
    type: "recharge" | "adjustment";
    remark?: string | null;
    operator?: string | null;
};
type BalanceReceipt = {
    operationId: number;
    userId: number;
    rechargeRecordId: number;
    amountUnits: number;
    balanceBeforeUnits: number;
    balanceAfterUnits: number;
    completedAt: string;
};

// userService，保留旧 adjustBalance 签名与 SgUser 返回；其内部改调用同一事务 core
adjustBalanceIdempotent(userId: number, input: AdjustmentInput,
    idempotencyKey: string): Promise<{ receipt: BalanceReceipt; replayed: boolean }>;

// core 的作用域可为 userService 私有，不必新增通用事务 service
adjustBalanceInTransaction(trx: NodeTransaction, userId: number,
    input: AdjustmentPersistenceInput): Promise<AdjustmentReceiptData>;

// userManager，lockForMutation 返回原始微元余额，锁保持到提交
lockForMutation(trx: NodeTransaction, userId: number): Promise<SgUser | null>;
incrementBalanceInTransaction(trx: NodeTransaction, userId: number, deltaUnits: number): Promise<number>;

// rechargeRecordManager，Units 明确其绕过 model cast，不重复换算
createInTransaction(trx: NodeTransaction, input: RechargeRecordUnitsInput): Promise<number>;

// balanceAdjustmentOperationManager，新窄表的数据库操作
insertClaim(trx: NodeTransaction, input: OperationClaimInput): Promise<number>;
complete(trx: NodeTransaction, operationId: number, receipt: BalanceReceipt): Promise<void>;
findCommitted(scope: string, keyHash: string): Promise<BalanceOperationRow | null>;
```

旧 wrapper 返回 SgUser 是既有行为；机器返回窄账务凭证，避免每次重试重放含当前用户全部 Key 的过时快照。`replayed` 是传输结果元数据，receipt 内的业务结果保持与首次成功一致。

金额统一：入口金额仍为元；进入 core 前复用 `billingUtil.toUnits`，检查 finite 和 safe integer，将舍入后的 0 / -0 规范化；raw 余额、充值写入和操作表均用同一个 amountUnits。当前负余额允许、0 金额及微元舍入不得未经说明改变（`src/service/userService.ts:70`；`src/util/protocol/billingUtil.ts:17`）。建议指纹比较的是规范化后实际落账金额，因此 `1` 与 `1.000000` 等价；若外部 API 要拒绝超六位小数，而旧入口仍四舍五入，必须明确为产品契约差异。

持有用户锁后检查余额变化前后都处于约定的安全整数范围；可用 BigInt 做临时边界计算，再转回已验证安全的 number。不能只验证 delta 而不验证累计余额。增量 SQL 保持 `balance = balance + ?`，不要拿事务外旧余额去 set。

#### 5.2 幂等执行顺序

以下是**建议协议**，针对单库、无外部副作用的短余额事务：

1. **请求规范化**：校验 userId、type、金额及 remark 的类型 / 大小，校验非空且有长度上限的幂等键；构造固定顺序元组 `[版本, userId, amountUnits, type, remark或null]`。若 operator 是请求业务输入则纳入指纹；若是运行时派生显示名称则只保存快照，不因改名导致重试指纹变化。不要把每次不同的请求 ID、当前余额、当前时间或随机值放入指纹。
2. **开启数据库事务**：首先普通 INSERT 幂等占位。不要“先 SELECT 没找到就相信自己独占”；不要用 MySQL INSERT IGNORE 吞掉非唯一约束错误。成功插入后才允许进入余额 core；本行此时不可独立提交。
3. **锁定并读取目标用户**：MySQL 使用 trx 上的 SELECT FOR UPDATE；SQLite 此时已经通过 INSERT 获得写事务。为了旧无幂等键入口也安全，可在 lockForMutation 的 SQLite 分支先执行同事务 `UPDATE user SET balance = balance WHERE id = ?`，再读取；不要按这种 no-op UPDATE 的 affectedRows 判断是否存在。
4. **执行账务**：在同一 trx 中检查用户存在和选定的归档策略、计算范围、原子增加余额、插入 recharge_records。充值记录以 amountUnits 直接落库，不再走第二次 model cast。检查意外 0 行；对于合法 0 增量，区分 MySQL 的“值未改变”与“用户不存在”，以后者的锁定读取为准。
5. **存结果**：从同事务得到 balanceBefore / balanceAfter、充值记录 ID 和规范化时间，构造可序列化且大小有界的 receipt，再更新 operation 为 succeeded。所有可能失败的结果编码在提交前完成；不保存完整 UserDto。MySQL 不依赖 returning，使用现有插入 ID 归一化模式（`src/controller/userController.ts:145`；本机 Knex MySQL 编译器 `node_modules/knex/lib/dialects/mysql/query/mysql-querycompiler.js:21`）。
6. **提交之后响应**：只有 transaction Promise 确认提交才返回初次成功。正常数据库失败或业务失败必须抛出，由 callback 回滚；不能在 callback 中 catch 后返回成功。
7. **同键并发**：另一事务的同唯一键 INSERT 会等待、报重复或出现锁竞争。确认是 operation 唯一键冲突后，先结束 / 回滚本次事务，再通过新读事务或新查询读取已提交 operation，避免旧读视图看不到赢家。指纹相同则返回存储 receipt，不再次查用户存在性、不再次记账；不同则 409 `idempotency_conflict`。其他唯一键错误不能走重放分支。
8. **首个执行者失败**：若占位、余额、充值或结果写入任一步失败，全部回滚，不留孤立 processing；同键重试可以重新执行。因此绑定的是首次成功提交，而非首次无效尝试。并发不同载荷中，失败且回滚的尝试不永久占用该键；成功提交后的不同载荷必定冲突。
9. **进程崩溃 / 重启**：提交前崩溃由数据库恢复回滚；提交后、响应前崩溃时，重启后通过 operation 重放。不需要租约、抢占 processing 或进程内 Map。数据库恢复之前不应绕过幂等存储处理请求。
10. **提交结果未知**：网络断开或驱动 Promise 抛错不证明没有提交。使用原 scope / key / fingerprint 重新查询已提交 operation；匹配 succeeded 时返回成功，无法确认时返回可重试错误。后续仍走同一唯一占位流程，不做反向扣回、不改用新幂等键。现有响应结算已采用“先重新确认终态”的思路（`src/service/responseHandlerService.ts:584`），但本方案重读的是独立 operation。
11. **锁超时与死锁**：对可识别的 SQLITE_BUSY、MySQL 死锁 / 锁等待超时，先确保旧事务整体回滚，再带同一规范化请求有界重试，设置总期限和退避。耗尽后返回可重试错误，不返回成功，也不能假装一定是同键请求在处理中。幂等数据库不可用时关闭该写操作，不降级成无幂等执行。参考 E1、E3、E4。

锁顺序建议为 `operation -> user -> recharge_records`，余额调整不拿 Key 或 record 的锁。与 Node 正常结算并发时，双方在 user.balance 上串行增量，最终余额包含两个增量；返回 receipt 是该操作提交时的余额快照，不是保证此后账户不再变化。

#### 5.3 保留期与清理

**建议的最小安全初版**：成功 operation 暂不自动过期删除，且幂等键永不因凭据轮换或用户删除复用；每笔只保存小型指纹与账务结果。这样无需先增加清理调度，进程重启和很晚的重试仍可判重。保留期限属于未批准的产品 / 运维选择，而不是本文替用户设定的 24 小时默认值。

若用户需要有限保留期，有两个不同承诺，必须写清：

- 仅在固定窗口内防重：窗口结束并删除全部 operation 后，相同键可能再次落账；必须限制客户端重试窗口并明确这是更弱的契约。不能同时声称“持久幂等永不重复”。
- 回放结果有限期、去重证据长期保留：清理到期 receipt 的可选大字段，但保留唯一键、指纹及成功操作标识的墓碑；同键旧请求返回明确“结果已过期”的错误，或保留足够窄字段继续重放，绝不重新加钱。不同指纹仍冲突。清理与读取应原子化，不允许先删除唯一键再补墓碑。

充值记录保留期不等于去重保留期；用户清理、备份恢复或手工删除 operation 都可能破坏保证。整库恢复导致已提交去重证据回到旧版本时，本方案不能自行推导外部已完成操作，需独立恢复流程；本轮不扩大到该运维设计。

#### 5.4 sub2api 参考结论

**已验证事实**：本机 sub2api 版本文件为 `0.1.158`（`../sub2api/backend/cmd/server/VERSION:1`，未执行 Git 操作，不代表上游最新发布）。其幂等表有 `(scope, idempotency_key_hash)` 唯一索引（`backend/migrations/057_add_idempotency_records.sql:19`），service 区分同键异请求、processing、成功重放、重试退避（`backend/internal/service/idempotency.go:285`、`:332`）；默认 TTL 24 小时、processing 30 秒、ObserveOnly=true（`:70`）。这些是该项目的选择，不是本任务默认值。

不能照搬的原因：`UpdateUserBalance` 先读用户、修改对象、update，然后另建调整记录；记录失败只记录错误并继续返回用户（`../sub2api/backend/internal/service/admin_user.go:495`、`:516`、`:535`、`:553`）。它还禁止负余额（`:512`），与 xy_gateway 不同。幂等 coordinator 的执行回调与最终 MarkSucceeded 是分开的阶段，repository 使用独立 sql.DB（`backend/internal/service/idempotency.go:395`、`:420`、`:428`；`backend/internal/repository/idempotency_repo.go:17`、`:175`）。这不能作为“余额、记录、幂等一笔事务已保证”的证据；本任务应只借鉴唯一占位和指纹思想。

### 6. 用户删除、角色修改与历史引用

#### 6.1 已有边界

- **已验证事实**：userController 创建时接收 normal / admin，更新只处理 name、status、keys，没有 type 更新；没有该 controller 的用户删除方法。manager.deleteById 只是查存在后物理 DELETE（`src/controller/userController.ts:49`、`:174`、`:256`；`src/manager/userManager.ts:68`）。因此不能把角色修改 / 删除写成“现有能力已完整”。
- **已验证事实**：请求历史按持久化 user_id 查询，不依赖 join 当前 user 才能返回（`src/manager/recordManager.ts:87`、`:99`）。显示名称由前端当前用户补齐，缺失时回退“用户<id>”，不是历史身份快照（`frontend/src/stores/record.ts:79`、`:102`、`:154`）。当前 recharge.operator 是可空文本，也不是用户外键（`src/model/sgRechargeRecord.ts:19`）。
- **已验证事实**：现有用户凭据每次解析会从数据库读取所属 user，后台权限再看当前 type，用户 disabled 会拒绝后续请求。这里只说明角色数据修改的既有效果，不研究新的 Admin Key 机制（`src/service/authContextService.ts:37`、`:41`、`:66`；`src/middleware/authMiddleware.ts:23`、`:31`）。

#### 6.2 用户删除的两个合理产品选项，待用户选择

| 选项 | 用户可见语义 | 历史与实现代价 |
| --- | --- | --- |
| A. 归档式删除 | 用户从活动列表消失，不再接受新请求；通过显式历史视图仍可查询旧用户。是否可恢复另外约定。 | 保留 user 主键、余额、充值记录及 Key 行，设置 user.disabled，并将 Key 禁用；要区分普通停用与“已删除”，建议新增 deleted_at。列表、详情、创建同名用户、修改入口需要统一过滤 / 冲突规则。Key 原哈希仍占用全局唯一值，不能默默给新用户复用。优点是历史归属和在途结算可保留；代价是清理不等于物理删除，恢复也不能不经选择就重新启用全部旧 Key。 |
| B. 受限硬删除 | 只有无请求 / 充值历史、余额为 0、无在途请求的空账户可以永久删除；有历史或待结算者返回 409 并允许停用。 | 原有历史表和充值 CASCADE 不必改造；必须在统一用户事务边界检查条件，数据库删除即删除空账户及其 Key。优点是定义简单、不悄悄销毁历史；代价是“删除任意用户”不成立，且可靠的无在途判定需要请求准入协调，不能只查一次 pending。 |

这两个选项都不采用“直接 DELETE 并无提示地让充值记录级联消失”。若用户坚持“所有用户都可硬删且必须保留历史”，需要另行选择迁移：充值 user_id 改为可空 SET NULL 并增加原 user_id / 名称快照，或改变为有明确快照的逻辑引用；请求历史同样需定义匿名化 / 已删除展示。不应把此额外迁移当成已获同意。也不能直接给 record.user_id 加普通外键，否则 -1 Root 哨兵数据会冲突。

#### 6.3 角色修改的两个合理产品选项，待用户选择

| 选项 | 用户可见语义 | 取舍 |
| --- | --- | --- |
| A. 原位改角色，保留现有 Key | 同一 user.id、余额、Key、历史全部保留；之后的请求按新角色判断。 | 改动最小，不打断已有调用；但 normal 升为 admin 会让该用户已分发的所有有效 Key 一起获得后台管理资格。降级影响后续请求，已通过校验的在途操作不会被自动撤销。 |
| B. 原位改角色，同时禁用全部现有 Key | 用户身份和历史不变；角色变更提交后，旧 Key 不再接收新请求，需要显式创建新凭据。 | 降低原先分发的凭据意外继承新角色的风险，保留禁用行也利于在途结算；代价是所有现有客户端与后台会话使用的凭据同时失效，需要恢复 / 分发步骤。必须是角色和禁用的一笔事务，不能先改角色再异步撤销。 |

两种方案都只允许 normal / admin，不把 -1 Root 当作可修改数据库用户（`src/constants.ts:87`、`:98`）。不得回写历史 record 的身份 / cost 或按新角色重新计费；当前结算是否收费依赖用户 ID 与计费配置，不因 normal/admin 转换自动免单（`src/service/billingService.ts:341`）。

建议签名保持产品政策显式：

```ts
deleteUser(userId: number, options: {
    policy: "archive" | "empty_only";
}): Promise<{ userId: number; archived: boolean }>;

changeRole(userId: number, type: "normal" | "admin", options: {
    expectedType?: "normal" | "admin";
    credentialPolicy: "preserve" | "disable_all";
}): Promise<SgUser>;
```

这些 policy 是设计阶段的选项，不意味着首版必须向调用方暴露两种模式；用户选定后可固定为一项服务规则。底层复用 userManager.lockForMutation，再以 trx 修改 user / Key；禁用 Key 时推进集合版本。自我降级、自我删除和最后一个可用管理员是否允许，需要另行明确。若要求“不能失去最后一位管理员”，仅锁目标 user 不够，多个管理员并发降级需要共享的全局不变量锁 / 按序锁定检查，并定义是否把独立恢复入口算作保障。

#### 6.4 在途结算与硬删 Key 的重要风险

**已验证事实 / 源码推导**：Node 结算重新读取 record，并优先使用显式 input.key，否则使用记录当前 key_id（`src/service/billingService.ts:324`、`:332`）；常规响应收尾并未传入 key，只传 user 和 groupId（`src/service/responseHandlerService.ts:576`、`:1031`）。因此不能简单断言“删 Key 必定整笔回滚”，实际有两类时序：

- 删除 Key 后、结算首次读 record 前，SET NULL 已执行：常规收尾会得到 keyId=null，仍可扣用户余额，但不再累计该 Key 的 quota_used，也失去 Key 历史关联。
- 结算已经拿到原 keyId 后，Key 被删：后续 Key 更新可能为 0，触发 404 并回滚该次扣费；用户已收到响应时会出现未收费风险（`src/service/billingService.ts:394`）。删 user 后则 user 更新为 0，同样回滚（`:386`）。

MySQL 现有结算取锁次序为 `record -> user -> user_key`；管理事务若 `user -> user_key -> 外键更新record`，存在锁序反转和死锁可能，不能只靠增加用户锁宣称已解决。参考 E4；需有界回滚重试，必要时在设计中统一锁序。

**建议**：禁用 / 归档时保留用户与 Key 行，让已准入请求按原规则结算，未来请求由状态拒绝；若单 Key DELETE 和整组遗漏删除仍选择物理删除，两条路径必须采用相同的在途策略。可选择先禁用、待可靠排空再物理删除，或对有引用 / 在途的 Key 拒绝物理删除。仅 `SELECT pending=0` 不是充分证明：已有请求可能已通过校验、尚未建立 record。真正保证需请求准入与归档 / 删除共享数据库协调，或明确弱化为不保证在途请求完成；这可能超出“只增加管理方法”的改动量，必须列为设计待决边界。

### 7. 最小验证规划，不执行

**已验证事实**：测试脚本用 `TEST_MODE=node` 和 Vitest 的文件过滤（`package.json:12`、`:21`）；文件级顺序执行（`vitest.config.ts:9`、`:12`）。真实 ORM 测试复用 `ormTestHelper.connectNodeOrm()` 及 `dbHelper.truncate()`（`tests/integration/userManager.node.test.ts:8`）；globalSetup 负责初始化库及服务（`tests/globalSetup.ts:121`、`:146`）。即使是聚焦命令也会运行全局生命周期，不能描述成完全无副作用。

| 最小文件集合 | 应覆盖的断言 |
| --- | --- |
| **建议新增** `tests/integration/userKeyService.node.test.ts` | 单项创建 / 获取 / patch / 禁用 / 删除不动其他 Key；跨用户 ID 拒绝；并发创建与旧版本替换仅一方成功或替换冲突；双 replace、双 patch、删除后旧 ID 不能复活；保留 ID / 临时草稿 ID / 哈希交换；失败时 profile、Key、revision 一起回滚；不覆盖 quota_used / last_used_at；所选硬删 / 在途政策。 |
| **建议新增** `tests/integration/userBalanceAdjustment.node.test.ts` | 两库真实事务：同键并发仅一笔记录和一次增量；同键异金额 / user / type / remark 冲突；不同键并发正确累加；余额增量与正常结算交错；充值 INSERT、结果写入或编码失败完整回滚；微元单位、负余额、0 增量、安全整数、MySQL 2147.483647 元边界扩容。 |
| **建议新增** `tests/integration/userLifecycle.node.test.ts` | 产品选定的删除 / 角色政策、余额和历史不改写、Key 撤销与集合版本、Root 不可修改、用户删除与新 Key / 调账并发、在途结算边界及选定的最后管理员规则。 |
| **扩展已有** `tests/integration/schemaConstraint.node.test.ts` | operation 唯一键直接拦截重复；user / Key / record / recharge 外键行为；删除用户不会级联清除 operation；实际 SQLite 连接外键开关；MySQL 列类型 / 金额容量。 |
| **保留回归** `tests/api/user/user.test.ts`、`tests/api/balance/billing.test.ts` | 旧 DTO、Key 更新、负余额、充值金额不退化；采用条件写后同步旧测试的读取版本流程，保留无版本请求的选定错误契约。API 测试只能通过请求 helper 操作业务行。 |
| **保留回归** `tests/unit/service/billingService.node.test.ts` | token 实际费用超额度仍结算、Key 缺失错误，不引入新的结算额度条件。此文件为 mock 单测，不能替代真实事务回滚 / 多进程测试。 |

幂等的重启验证放在余额集成文件内：提交后关闭调用者连接，用新连接 / 新调用者模块加载重复请求，确认重放；再用受测试控制的工作进程覆盖“提交前终止”和“提交后响应丢失”。复用全局测试库，不自行创建 / 删除库，不启动额外 Trellis / AI 子代理；测试用进程与工作代理不是同一概念。SQLite 单连接池上的 Promise.all 只说明进程内排队，至少需要独立连接 / 受控工作进程共享同一个测试库才能覆盖跨进程竞争，并在结束时释放连接 / 进程。锁重试用确定的屏障协调，避免仅靠 sleep 的概率测试。

建议在上述新文件实际创建之后，按改动域分别运行；以下命令**本轮均未执行**：

```bash
npm run backend:test -- --run tests/integration/userKeyService.node.test.ts tests/api/user/user.test.ts
npm run backend:test -- --run tests/integration/userBalanceAdjustment.node.test.ts tests/api/balance/billing.test.ts tests/unit/service/billingService.node.test.ts
npm run backend:test -- --run tests/integration/userLifecycle.node.test.ts tests/integration/schemaConstraint.node.test.ts
npm run backend:test:node:mysql -- --run tests/integration/userKeyService.node.test.ts tests/integration/userBalanceAdjustment.node.test.ts tests/integration/userLifecycle.node.test.ts tests/integration/schemaConstraint.node.test.ts
npm run backend:test:type
```

MySQL 命令必须预先配置专用测试库的 DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME，确认 MySQL 8.0.13+；globalSetup 会清空并重建目标 schema（`doc/dev/TestManual.md:67`；`tests/helpers/dbHelper.ts:345`）。不要指向现用数据。若条件写改动旧前端传输流程，补相应 Key 编辑交互测试和 frontend:build；本轮不运行全量测试、构建、迁移或数据库探针，因为用户明确要求只读规划与列出命令。

### 8. 外部参考与版本

本轮 `web.run` 未返回可用正文；随后通过只读 `curl -fsSL --max-time 20` 从下列官方页面核对相关段落，未写入下载文件。链接以代码形式保留，便于后续查证。

| 编号 | 文档 / 本机版本 | 与本报告的关系 |
| --- | --- | --- |
| E1 | SQLite Transaction：`https://www.sqlite.org/lang_transaction.html`，2026-09-08 查阅 | 默认 DEFERRED；首语句为写时启动写事务；读升级写可失败 SQLITE_BUSY；已有事务中不能再 BEGIN。用于第 4、5 节事务建议。 |
| E2 | MySQL 8.4 Integer Types：`https://dev.mysql.com/doc/refman/8.4/en/integer-types.html`，2026-09-08 查阅 | INT / INTEGER 为 32 位有符号范围，BIGINT 为 64 位。用于 M2 与余额扩容建议；不是对部署 schema 的实测。 |
| E3 | MySQL 8.4 Locking Reads：`https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html`，2026-09-08 查阅 | FOR UPDATE 在事务内锁定并读取当前数据。用于父用户串行化和余额前后快照。 |
| E4 | MySQL 8.4 Locks Set by Different SQL Statements：`https://dev.mysql.com/doc/refman/8.4/en/innodb-locks-set.html`，2026-09-08 查阅 | INSERT 的唯一索引竞争、重复键共享锁及可能死锁，说明占位不是无需重试的内存布尔值。 |
| E5 | MySQL 8.4 Implicit Commit：`https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html`，2026-09-08 查阅 | DDL 的隐式提交不能由业务事务回滚；新增 migration 的恢复边界不能依据 adapter 的 begin/rollback 包装推断。 |
| E6 | 本机 `sutando 1.7.3`、`knex 3.1.0`、`better-sqlite3 12.6.2`、`mysql2 3.23.4` | 分别来自 `node_modules/<包>/package.json:3`；package.json 声明范围与本机实际版本不同，例 Sutando 声明 `^1.7.2`（`package.json:58`）。Knex 是 Sutando 的依赖（`node_modules/sutando/package.json:92`），不是项目直接依赖。 |

新增 migration 可复用既有有序目录和两种 SQL 方言；但 `src/util/db/mysqlDBAdapter.ts:58` 的 execTransaction 包装不保证 MySQL 多条 DDL 可整体回滚（E5）。建议将版本列、operation 表和 balance 扩容设计为小型、可检查状态的迁移步骤，并规划部分 DDL 已成功但 marker 未写入的恢复；不在本轮改迁移框架。

## 限制与未验证项

- **未运行验证**：本轮只读源码 / 规范 / 官方页面，没有运行任何测试、构建、数据库查询、迁移、task.py 或 Git 命令；没有创建其他代理。以上测试文件中的三个新文件尚不存在，只是建议位置。仅创建本调研文件。
- **Key 兼容决策未解**：无条件整组覆盖、旧客户端完全不变、绝不覆盖并发单项修改，三者无法同时满足；需要用户接受条件写升级，或明确接受较弱的最后写入语义。旧 UserDto 不改字段仍不能免除客户端适配。
- **删除与角色产品语义未解**：归档或空账户硬删、是否强制换 Key、最后管理员限制、余额及历史保留、在途请求如何处理，均未获用户选择。不能把独立恢复凭据存在当作已同意允许最后管理员降级。
- **金额风险已静态确认**：MySQL 历史迁移定义的 balance 容量明显小于其他微元列；部署可能被手工修复，本轮未实测。实现前需要迁移 / 范围策略，不能只补事务后宣称两库一致。
- **事务连接风险已确认**：事务内部所有 manager 读取、写入、模型 hydrate 和结果编码必须使用传入句柄；现有 replace 的 transaction 参数不是完整事务感知的证明。NodeTransaction 的强类型若直接引用 Knex，应确认声明依赖策略，不能假设传递依赖永远可用。
- **真实锁行为待验证**：独立连接 SQLite BUSY、MySQL 重复键 / 死锁错误识别、受影响行返回值、Key 删除与结算锁序反转、实际 PRAGMA、提交结果未知的恢复都需要双库最小集成覆盖；mock 单测无法给出这些保证。
- **保留期未解**：operation 与用户删除解耦可防止清理导致重放重复，但长期保存或保留去重墓碑的运维期限仍需选择。有限 TTL 删除唯一证据就会削弱保证，不能只模仿 sub2api 的默认时长。
- **范围控制**：未设计新增 Admin Key 认证、管理路由、日志或 D1 / Worker。涉及普通 user.type / status 和 record 引用的现有行为，仅为解释本次角色、删除和结算边界。
