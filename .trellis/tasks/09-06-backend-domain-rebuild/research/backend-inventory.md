# 后端现状与 sub2api 对照

## 当前前后端断点

| 领域 | 当前前端契约 | 当前后端实现 | 结论 |
| --- | --- | --- | --- |
| 用户认证 | `User.keys[]`，每个 Key 独立分组/状态/限制 | `user.token` 单字段，`findByToken()` 直接查用户 | 必须拆出 `user_key` 并重写 auth context |
| 分组 | 协议、模型范围、倍率、状态 | 无表、无 route、无 service | 新建完整领域，不适合塞进 vendor config |
| 供应商 | `concurrency/load_factor/priority/config.group_ids[]/status` | config cast 原先未声明/未序列化完整多分组关系，路由也未使用 | `group_ids[]` 需作为规范关系进入候选过滤，`group_id` 仅作首项投影 |
| 模型 | `mapping.upstreams[]` | controller 强制 `routing_mode/routing_config` | 新 DTO 与旧接口直接不兼容，应硬切 |
| 路由 | 分组池 + 优先级 + 权重 + 并发 | single/load_balance/first_available，主要按用户/请求随机 | 重写候选和 scheduler，保留 failover/健康冷却思想 |
| 计费 | Key 额度 + 分组倍率 + 三种计费模式 | 仅成功后扣用户余额，无 Key/倍率/幂等结算 | 统一 BillingService 和 settlement |
| 记录 | 应能定位 Key/分组/调度/价格快照 | 仅 user/model/vendor/usage/cost | 增加身份与价格快照字段 |

## 关键代码位置

- 路由注册与 Hono context：`src/routes.ts`
- 管理/LLM 鉴权：`src/middleware/authMiddleware.ts`、`src/middleware/llmApiMiddleware.ts`
- 旧用户 token：`src/model/sgUser.ts`、`src/manager/userManager.ts`、`src/service/userService.ts`
- 旧模型路由：`src/model/sgModel.ts`、`src/controller/modelController.ts`、`src/service/routingService/`
- 请求循环：`src/service/senderService.ts`
- usage/费用与扣款：`src/util/protocol/usageUtil.ts`、`src/service/responseHandlerService.ts`
- 数据库运行模式：`src/service/ormService.ts`、`src/service/dbMigrationService.ts`
- 迁移：`resource/migrate/migrate_0001` 至 `migrate_0030`

## sub2api 可参考实现

路径：`/home/qlqq/workspace/sub2api/backend`

- `ent/schema/api_key.go`：Key 状态、分组、IP、额度、过期的字段拆分。
- `internal/server/middleware/api_key_auth.go`：Key → 用户 → 分组 → IP/额度/余额的阶段化鉴权和上下文注入。
- `internal/service/api_key_service.go`：Key 生成、唯一校验、缓存失效、用量更新。
- `internal/service/concurrency_service.go`：并发槽位 acquire/release、等待与清理的租约思想。
- `ent/schema/account.go`、`internal/service/gateway*`：并发、load factor、priority、健康状态参与调度。
- `internal/service/billing_service.go`、`internal/service/usage_billing.go`：统一价格入口、倍率、幂等用量结算。

## 不能直接照搬的语义

- 前端 `rateLimit` 是最大并发；sub2api 的 API Key rate limit 是 5h/1d/7d 美元用量窗口。
- 本项目每个 Key 绑定至多一个分组，供应商可通过 `config.group_ids[]` 分配至多个分组；这与 sub2api 的 account/group 多对多领域结构不同。
- 本项目模型显式 `mapping.upstreams`；sub2api 按平台账号池和模型映射调度。
- 本项目以人民币、整数微元和每百万 token 定价；sub2api 主要以美元/每 token 浮点字段计算。
- 本项目需要继续支持 Worker/D1/Tauri；sub2api 的强一致实现依赖 PostgreSQL/Redis。
- sub2api 是 LGPL-3.0，本项目许可证不同；只移植设计，不复制大段代码。

## 数据迁移影响

- 旧 `user.token` 可一对一迁成用户的首个 Key。
- 旧模型 `routing_config.upstreams` 可展开成 `model_upstream` 行，数组顺序写入 `sort_order`。
- 存量供应商和 Key 默认放入倍率为 1、允许三协议、允许全部模型的默认分组，保持升级后可用。
- `tests/fixtures/userFixtures.ts`、`modelFixtures.ts` 和大量 API/集成测试仍构造旧字段，必须按阶段重写；测试 helper 不应成为旧格式兼容层。

## 部署约束

- 单 Node/Tauri 可用进程内并发租约实现精确限制。
- Cloudflare Worker isolate 之间不共享内存，D1 也不是 Redis；若要求全局硬并发，需要 Durable Object 或放弃 Worker 路径。
- 当前任务默认不更换运行时，因此首期对 Worker 并发明确标记 best-effort，不能隐含承诺强一致。
