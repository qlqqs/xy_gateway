# Admin API 映射验证、设置页与文档

## 目标

证明 `/api/v1/admin/*` 的无 `.json` 外部入口完整覆盖 xy_gateway 当前管理能力，同时保证内部旧 `.json` 路由、Root/Bearer、用户 Key 和 LLM 行为不退化，并交付可直接使用的简体中文文档。

## 范围内

### R1. 67 条映射验证

- 以 P1 的显式 `adminApiRouteMap` 为运行时事实来源，核对 59 条既有管理能力、3 条生命周期和 5 条单 Key 操作。
- 每条外部路径必须位于 `/api/v1/admin`、不以 `.json` 结尾、绑定固定 handler，并记录对应内部路径。
- 反向检查 `src/routes.ts` 中每个 `requireAdmin` 路由都出现在外部映射清单中。
- 未知路径、外部误带 `.json` 和不支持的方法返回 JSON 404，不落入 SPA。
- `/v1/*`、`/llm/v1/*`、`/welcome` 和 `/test/cache/clear` 不得进入清单。

### R2. 认证与领域回归

- 验证有效 Admin Key、无效 Admin Key、无效 Key + 有效 Bearer、仅 Bearer、普通用户 Key 和 disabled 用户矩阵。
- 每个管理领域至少一个不访问真实付费上游的代表性外部请求。
- 模型 route-test 使用现有 mock 上游，确认 Admin Key 绑定的是真实数据库管理员上下文。
- 验证 Admin Key 本身不能通过 LLM 认证，且不修改共享 LLM 解析器。
- 回归内部旧 `.json` 管理路由和旧整组用户 Key PUT。

### R3. 设置页与代理

- 只扩展现有 `frontend/src/views/AdvancedSettings.vue`，不创建新页面，不改 `KeyEdit.vue`。
- 状态请求使用 `GET /api/v1/admin/settings/admin-api-key`，只显示 `exists`。
- 生成/重新生成使用 POST，成功后当前页面内存一次性显示明文；关闭、刷新或重新进入后不能恢复。
- 撤销使用 DELETE，清空页面内存中的明文。
- 独立 API 模块和 Vite 代理使用无 `.json` 外部路径；通用 `/api` rewrite 不能破坏 `/api/v1/admin`。

### R4. 中文文档

新增 `doc/usage/AdminApiUsage.md`，包含：

- Node 范围和管理员绑定规则。
- `x-api-key`/Bearer 优先级。
- Admin Key 状态、生成、轮换、删除和失钥恢复。
- 59 条管理能力的完整外部路径与内部映射。
- 单 Key API、旧整组接口和并发覆盖限制。
- `/config.json` 保留字段隔离、LLM 边界和不支持的范围。

## 验收标准

- [ ] 67 个方法/路径组合与显式映射表双向一致。
- [ ] 外部所有路径无 `.json`，内部 `.json` 路径回归通过。
- [ ] 未知外部路径和外部 `.json` 误用得到 JSON 404。
- [ ] 认证矩阵、领域代表请求和 LLM 负向测试通过。
- [ ] 设置页只在当前页面一次性显示生成结果，明文不进入持久化状态。
- [ ] Vite 开发代理正确转发 `/api/v1/admin`。
- [ ] 中文文档与实际路径、状态码和响应字段一致。
- [ ] 聚焦 Node 测试、前端设置页测试、类型检查、前端构建和 Trellis 校验结果有记录。

## 明确不做

- 不增加新管理页面、OpenAPI/Zod、代码生成或第二套路由实现。
- 不改用户 Key 页面、旧整组保存协议或 LLM 认证。
- 不调用真实供应商，不执行在线升级、重启、回滚或整库恢复。
- 不实现 D1/Workers、审计、部署控制或未规划的并发保证。

## 依赖与实施门槛

- 父任务：`../09-08-external-admin-api`。
- 依赖 `../09-08-admin-api-foundation` 和 `../09-08-admin-api-user-key` 的实现与聚焦验证。
- 父任务最终规划摘要必须获用户明确批准后才能启动和修改业务代码。
