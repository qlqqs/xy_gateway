# 后端领域模型与运行链路执行计划

## 执行原则

- 不在现有 `frontend-rebuild` 任务中修改后端；本任务单独执行和验收。
- 每一阶段只使用新领域字段，禁止通过 adapter、fallback 或双写继续运行旧 DTO。
- 一次性迁移可以读取旧列；迁移完成后的运行时代码不能读取旧列。
- 先跑受影响的最小测试，再跑 Node 后端套件、类型检查和前端构建；Worker 全量留给 CI，但迁移/绑定改动需有聚焦验证。

## 阶段 1：契约和数据层

1. 新增 `SgUserKey`、`SgUserGroup`、`SgModelUpstream` model 及对应 manager。
2. 新增 SQLite/MySQL migration：创建新表、供应商调度列、record 关联/计费列和必要索引。
3. 重写用户、分组、供应商和模型 service/controller DTO；模型保存事务内替换上游映射。
4. 删除新代码对 `user.token`、`routing_mode/routing_config` 的依赖；更新 `EXPECTED_TABLES`。
5. 增加 manager/service/API 聚焦测试和新 fixture。

验收：管理 API 能完整往返当前前端字段，数据库无孤儿引用，列表统一 `{ list, total }`。

## 阶段 2：鉴权与策略

1. 新增 Key 生成、摘要、加解密和脱敏 utility；增加环境变量校验。
2. 建立 `LlmRequestContext` 和 auth context service，重写管理鉴权与 LLM 鉴权中间件。
3. 实现状态、过期、可信 IP/CIDR、入站协议、Key/分组模型白名单、余额和 Key 额度预检。
4. `/llm/v1/models` 复用同一模型可见策略。
5. 增加每个拒绝分支和 root/admin 角色的 API 测试。

验收：所有策略在路由前执行，错误格式与入站协议一致，日志不泄漏 Key。

## 阶段 3：供应商调度和并发

1. 将 `mapping.upstreams` 查询转换成候选对象；按分组/状态/协议/健康状态过滤。
2. 实现优先级分层和负载因子加权调度，保留请求级 tried set 和失败冷却。
3. 建立 Key/Vendor 并发租约接口和单进程实现；所有 stream/non-stream/异常/取消路径统一释放。
4. 在记录活动中保存每次候选选择、跳过理由和最终命中结果。
5. 增加调度分布、优先级、容量耗尽、failover 和租约泄漏测试。

验收：同一优先级按权重分配，低优先级只在高优先级不可用时使用，容量限制在单实例准确。

## 阶段 4：计费和记录

1. 将模型价格、分组倍率和 usage 统一为 `BillingQuote/Settlement`；所有金额在持久化边界转换为整数微元。
2. 增加 Key 额度消耗、用户余额扣减和 record 幂等结算；按次/图片/token 三种模式共用入口。
3. 把 `key_id/group_id/requested_model/base_cost/rate_multiplier/settlement_status` 写入 record。
4. 将 stream/non-stream 收尾改成统一 finalize，不再在 response handler 中直接扣余额。
5. 增加重复 finalize、断流、客户端取消、零倍率、额度临界值和缓存 token 计费测试。

验收：同一 record 最多扣一次，失败不扣费，用户余额与 Key 用量可审计。

## 阶段 5：前端 API repository 与切换

1. 为用户、Key、分组、供应商、模型实现 API repository，并让 store 只依赖 repository 接口。
2. 默认关闭 `VITE_FRONTEND_ONLY` 时使用 API；开发演示模式仍可显式选择 mock。
3. 移除用于适配旧后端字段的残留代码，不恢复 `keyGroups` 或 `routing_config`。
4. 对管理 CRUD、关联删除和错误反馈增加前后端集成测试。

验收：真实后端启动后，当前前端页面的全部管理流程和 LLM 调用可运行；mock 仅是显式开发模式。

## 阶段 6：迁移、文档和切换

1. 实现/验证一次性数据迁移和迁移前备份说明；增加一致性检查命令。
2. 删除旧列和旧运行代码，更新后端/Tauri/Docker/Cloudflare 文档与示例。
3. 运行聚焦测试、Node 后端套件、后端类型检查、前端测试和前端构建。
4. 检查 git diff、敏感信息、本地数据库和生成物；不自动 commit/push。

## 首次实现切片

为控制风险，第一次代码切片只做阶段 1 的基础表/model/manager/DTO 和聚焦测试，不同时改 sender/计费。它必须满足：

- 新表和新模型可独立读写。
- 新管理 DTO 能往返前端字段。
- 旧 LLM 运行路径暂时仍由当前代码运行，但阶段 1 合入前不得宣称前端新策略已生效。
- 阶段 2 切换鉴权时一次性移除旧 token 路径；不在阶段 1 增加长期双轨 adapter。

## 验证命令

```bash
npm run backend:test -- --run <受影响测试文件>
npm run backend:test:type
npm run backend:test
npm run frontend:build
git diff --check
```

Worker/D1 全量测试耗时较长，默认由 CI 运行；若 migration 或 Worker binding 的聚焦验证失败，则在本地扩大范围定位。
