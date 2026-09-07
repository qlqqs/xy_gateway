# 后端领域模型与运行链路技术设计

## 1. 结论与边界

本次选择在现有 TypeScript/Hono 后端内做硬切重构，不建立旧 DTO、旧字段或旧路由策略的兼容分支。原因是本项目已经积累了可用的三协议转换、流式响应聚合、插件、记录/object storage、Node/Worker/Tauri 启动和完整测试框架；整体替换成 sub2api 的 Go 服务会把本次领域重构扩大成一次产品迁移。

`sub2api` 的价值在于成熟的运行模式，而不是可直接复制的表结构：

- 借鉴：API Key 鉴权分阶段、状态/IP/额度校验、请求上下文、并发租约、调度候选过滤、优先级和权重、失败排除、计费幂等。
- 不照搬：PostgreSQL/Redis 强依赖、美元字段、订阅/支付、多平台账号和 account-group 多对多关系。
- 许可证边界：本项目是带署名要求的 MIT 文本，sub2api 是 LGPL-3.0；实现采用重新设计和适配，不复制大段源码。

## 2. 领域模型

### 2.1 用户与 Key

`user` 只保存用户身份和余额：

```text
user
  id, name, type, status, balance, created_at, updated_at
```

删除 `user.token`。新增 `user_key`：

```text
user_key
  id, user_id, group_id, name, status
  key_hash, key_prefix, encrypted_value
  model_whitelist_enabled, model_whitelist
  ip_restriction_enabled, ip_whitelist, ip_blacklist
  quota, quota_used, concurrency_limit
  expires_at, last_used_at, created_at, updated_at
```

- 金额列 `quota/quota_used` 与 `user.balance` 一样保存整数微元。
- `rateLimit` 只存在于前端 DTO；数据库和业务代码使用 `concurrency_limit`，避免与 RPM/时间窗口限流混淆。
- 认证热路径以 `key_hash` 唯一索引查询，不用明文比较。`key_prefix` 用于管理列表和审计定位。
- 当前前端需要在 Key 管理弹窗中回显 `value`。后端使用独立环境密钥加密保存可回显值；认证仍只使用摘要。创建/重新生成时缺少加密密钥则拒绝写入，不能退化为日志或普通列明文。
- `user_key.user_id` 删除级联；`group_id` 删除时置空，与当前前端删除分组行为一致。

### 2.2 分组

```text
user_group
  id, name, description
  inbound_protocols, custom_models, whitelist_enabled
  rate_multiplier, status, created_at, updated_at
```

- `inbound_protocols`、`custom_models` 使用 JSON 文本存储，model cast 统一转换，业务查询不依赖数据库 JSON 函数。
- 名称全局唯一；至少一个入站协议；倍率范围为 `0..100`。
- `channelCount` 由供应商关联查询聚合，不落库。

### 2.3 供应商

保留 `vendor`、`vendor_model`，但把运行时需要筛选和排序的字段提升为正式列：

```text
vendor
  id, type, name, token, urls
  auth_mode, skip_tls_verify, proxy
  supplier_name, channel_code, api_type, openai_protocol
  status, remark, available_models
  concurrency, load_factor, priority, group_id
  created_at, updated_at
```

- `urls`、`proxy`、`available_models` 仍可使用 JSON cast。
- `channel_code` 全局唯一；`concurrency >= 1`、`priority >= 1`、`load_factor` 可空且非空时 `>= 1`。
- `load_factor == null` 时有效权重使用 `concurrency`；否则使用显式 `load_factor`。
- `group_id` 是单分组关系，保持当前前端语义，不引入 sub2api 的多对多账号分组。
- 上游 token 属于可回显管理员凭证，沿用现有字段；日志和测试快照必须持续脱敏。独立凭证加密可作为后续安全任务，不与本次 Key 摘要设计混淆。

### 2.4 模型与上游映射

`model` 删除 `routing_mode` 和 `routing_config`，保留 `name/enable/prices`。新增规范化表：

```text
model_upstream
  id, model_id, vendor_id, vendor_model_id
  enabled, sort_order, created_at, updated_at
```

- API 的 `mapping.upstreams[]` 由 service 在事务内整体替换 `model_upstream` 行。
- `(model_id, vendor_id, vendor_model_id)` 唯一；`vendor_model_id` 必须属于对应 vendor。
- `sort_order` 保存前端数组顺序，用作同优先级、同权重时的稳定回退顺序。
- 删除 vendor 时级联移除映射；没有启用上游的模型自动停用。删除 vendor model 时映射退回自动模型名，符合当前前端行为。

### 2.5 请求记录与结算

`record` 增加：

```text
key_id, group_id, requested_model
billing_mode, base_cost, rate_multiplier, cost
settlement_status
```

其中所有金额存整数微元；API serializer 再转换成现有展示单位。价格快照继续保存在记录/活动详情中，避免模型价格修改后历史金额无法解释。

首期使用 `record.id` 作为结算幂等键，不另外复制一套 usage log。若后续需要充值、退款和审计总账，再新增 append-only ledger。

## 3. API 契约

### 3.1 管理资源

保持项目现有 `.json` 规则并替换为唯一新 DTO：

```text
GET    /group/list.json
POST   /group/create.json
GET    /group/:id
PUT    /group/:id
DELETE /group/:id

GET    /user/list.json
POST   /user/create.json
GET    /user/:id
PUT    /user/:id
PUT    /user/:id/keys.json

GET/POST/PUT/DELETE 现有 vendor 路径（请求/响应换成新字段）
GET/POST/PUT/DELETE 现有 model 路径（只接受 mapping，不接受 routing_*）
```

- 列表统一 `{ list, total }`。
- 用户响应聚合 `keys`；Key DTO 完全使用当前前端的 `groupId/modelWhitelistEnabled/.../expiresAt`。
- 分组 DTO 完全使用当前前端 camelCase 字段。
- 供应商和模型按当前前端类型保留 snake_case 字段。
- 不返回 `key_hash`、`encrypted_value`、内部并发租约或旧字段。

### 3.2 删除语义

- 删除分组：同一事务内将 `user_key.group_id`、`vendor.group_id` 置空后删除。
- 删除供应商：移除模型映射；映射清空的模型自动停用；删除 vendor_model。
- 删除模型：从 `user_group.custom_models` 和 Key 模型白名单中清除名称。
- 这些动作由 service 协调，controller 不直接拼接多表操作。

## 4. LLM 请求数据流

```text
HTTP 请求
  → 识别入站协议、提取 Key 和可信客户端 IP
  → AuthContextService：Key → User → Group
  → PolicyService：状态/过期/IP/协议/模型/额度/余额
  → ConcurrencyService：获取 Key 租约
  → RoutingService：加载模型映射并筛选候选
  → SchedulerService：优先级层 → 权重选择 → 获取 Vendor 租约
  → SenderService：插件、协议转换、发送、failover
  → BillingService：按 usage + 分组倍率幂等结算
  → RecordService：保存身份、路由、usage、费用快照
  → finally：释放 Vendor/Key 租约
```

请求上下文使用明确对象，不再只在 Hono context 中零散放置 `user/modelConfig/requestBody`：

```ts
interface LlmRequestContext {
    user: SgUser;
    key: SgUserKey | null;       // root 调用为 null
    group: SgUserGroup | null;
    clientFormat: ApiFormat;
    modelName: string;
    requestBody: string;
    clientIp: string | null;
}
```

Root token 保留为环境级管理/诊断凭证；普通和管理员数据库用户均通过 `user_key` 认证。管理接口只执行身份/角色校验，不套用 LLM 的模型、分组和计费限制。

## 5. 策略语义

### 5.1 模型可见与可调用

- Key 白名单关闭：Key 不增加模型限制；开启：请求模型必须在 Key 列表中。
- 分组白名单关闭：分组不增加模型限制；开启：请求模型必须在分组 `customModels` 中。
- 两个白名单同时开启时取交集，不做覆盖。
- `/llm/v1/models` 返回经过同一模型策略过滤的启用模型，避免“列表可见但不可调用”。
- 分组协议以入口路径映射：`openai_chat`、`openai_responses`、`anthropic`。

### 5.2 分组与供应商池

- 有分组的 Key 只使用相同 `group_id` 的供应商。
- 无分组的 Key 只使用 `group_id IS NULL` 的供应商。
- 不允许显式模型映射绕过分组隔离；不匹配候选直接过滤。

### 5.3 调度

候选先排除禁用、协议不兼容、冷却、已尝试、分组不符和无容量项。剩余候选：

1. 取最小 `priority` 的非空候选集合。
2. 按 `effectiveWeight = load_factor ?? concurrency` 加权选择。
3. 同一次请求失败后将 `(vendor_id, vendor_model_name, upstream_format)` 放入 tried 集，重新筛选；当前优先级耗尽后才进入下一优先级。
4. 成功后更新最近成功/延迟指标；可重试的上游错误进入冷却，客户端 4xx 不惩罚供应商。

### 5.4 并发租约

接口按租约抽象：`acquire(scope, id, limit)` 返回可幂等释放的 handle。首期实现：

- 单 Node/Tauri：进程内计数 + `try/finally`，语义精确。
- 多 Node/MySQL：预留 Redis/数据库实现接口，本任务不伪装为跨实例强一致。
- Worker/D1：进程内状态无法跨 isolate 保证全局并发；文档明确为 best-effort。若产品要求 Worker 强一致，后续实现 Durable Object；不能把不可靠计数宣传为硬上限。

这比把 sub2api 的 Redis 实现强塞进 Worker 更符合当前部署形态。

## 6. 计费一致性

- `BillingService.quote()` 根据模型价格和分组倍率生成价格快照。
- 请求前检查用户余额、Key 剩余额度和已预留金额。按次/图片可预留确定金额；token 模式只做最低余额资格检查，首期不猜测最大 token 费用。
- `settle(recordId, actualCost)` 使用条件更新确保 `settlement_status != settled` 才扣费；同一 record 重试结算返回已结算结果。
- 用户余额与 Key `quota_used` 在同一个数据库事务/原子 service 中更新。Worker/D1 无可靠多语句事务时，使用幂等 record 状态 + 可重放修复流程，并在文档暴露该限制。
- 成功完成的响应才结算；失败/未完成流不扣费。并发租约不依赖结算成功，始终在 finally 释放。

## 7. 一次性迁移与回滚

迁移顺序：

1. 创建新表/列和唯一索引，不切换代码。
2. 创建“默认分组”，支持三种入站协议、全部模型、倍率 1。
3. 把每个旧 `user.token` 迁成一个 Key；把旧供应商绑定默认分组；把 `routing_config.upstreams` 展开到 `model_upstream`。
4. 校验数量、唯一性、孤儿引用和模型至少一个上游。
5. 切换新代码并执行 smoke test。
6. 删除 `user.token`、`model.routing_mode`、`model.routing_config` 与旧 config 运行字段。

升级前必须复制 SQLite 文件/导出 MySQL 或 D1；回滚只允许恢复迁移前备份与旧程序，不实现新旧 schema 双向写入。

## 8. 关键风险

- 当前前端把完整 Key 值当作可回显字段；生产实现必须配置 Key 加密密钥，否则硬切会造成安全倒退。
- D1 缺少本项目可依赖的多语句事务和跨 isolate 并发状态，强一致并发/计费不能与单 Node/PostgreSQL 等同。
- 模型映射和供应商分组同时过滤后，配置错误可能造成零候选；管理 API 保存时要尽早校验，并保留运行时 503 防线。
- 旧测试 fixture 大量写入 `token/routing_config`，需要按新领域重新建 fixture，不能通过兼容 helper 继续喂旧格式。
