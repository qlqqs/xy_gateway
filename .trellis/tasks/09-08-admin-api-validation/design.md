# Admin API 映射验证、设置页与文档技术设计

## 1. 验证分层

```text
route map 双向检查
  -> 外部路径无 `.json`
  -> 内部路径和固定 handler 一致
  -> 59 + 3 + 5 全覆盖

认证矩阵
  -> Admin Key / Bearer / 用户 Key / LLM 隔离

领域代表请求
  -> 外部别名真正进入原 Controller
  -> 不访问真实付费上游

兼容回归
  -> 原根路径、旧 `.json` 路由、旧 KeyEdit 整组保存
```

不为每个业务写一套重复 CRUD；路由表负责结构完整性，代表性 API 负责真实链路，原领域测试负责业务细节。

## 2. 路由表双向检查

测试消费 P1 的 `adminApiRouteMap`：

1. 对每个定义断言外部路径以 `/api/v1/admin` 挂载且不包含 `.json`。
2. 断言 method、externalPath、legacyPath 和 handler 引用存在。
3. 从 `src/routes.ts` 收集全部 `requireAdmin` 路由，与基线内部路径做双向比对。
4. 断言 59 条基线、3 条生命周期和 5 条单 Key 定义数量正确。
5. 断言 LLM、welcome、test 路由不在外部 map 中。
6. 通过未知路径和误带 `.json` 请求确认返回 JSON 404，而非 SPA HTML。

如果 Hono 运行时不公开稳定的 handler 身份，使用显式路由定义表做静态/注册期检查，不引入 AST、OpenAPI 或新的路由框架。

## 3. 代表性 API 矩阵

| 领域 | 外部代表请求 | 说明 |
| --- | --- | --- |
| 系统 | `GET /api/v1/admin/status` | 只读状态 |
| 配置 | `GET /api/v1/admin/settings` | 同时验证保留字段隔离 |
| 客户端配置 | `GET /api/v1/admin/client-config/status` | 不写主机文件 |
| 分组 | `GET /api/v1/admin/groups` | 本地列表 |
| 供应商 | `GET /api/v1/admin/vendors` | 不访问上游 |
| 供应商模型 | `GET /api/v1/admin/vendors/:id/models` | 本地模型池 |
| 网关模型 | `GET /api/v1/admin/models` | 本地列表 |
| 用户 | `GET /api/v1/admin/users` | 本地列表 |
| 单 Key | `GET/POST /api/v1/admin/users/:id/api-keys` | 测试用户夹具 |
| 余额记录 | `GET /api/v1/admin/balance/recharges` | 只读列表 |
| 请求记录 | `GET /api/v1/admin/records` | 只读列表 |
| 活动 | `GET /api/v1/admin/records/:id/activity` | 测试记录夹具 |
| 统计 | `GET /api/v1/admin/stats/dashboard` | 只读聚合 |

`POST /api/v1/admin/models/route-test` 单独使用已有 mock 上游，断言 `authContext.user` 是数据库管理员。

## 4. 认证矩阵

| 凭证 | Admin API | LLM |
| --- | --- | --- |
| 有效 Admin Key | 允许并绑定 active admin | Admin Key 本身不作为用户 Key |
| 无效 Admin Key + 有效 Bearer | 401，不回退 | 按 LLM 自身规则 |
| 无 `x-api-key` + 有效 Root/管理员 Bearer | 保持允许 | 保持现有行为 |
| 普通用户 Key | 403 | 按现有用户策略 |
| disabled 管理员用户 Key | 403 | 按现有状态策略 |

Admin Key 的 LLM 负向测试使用一个未登记为用户 Key 的生成值；测试不声称操作员无法主动把同一原文另存为普通用户 Key。

## 5. 设置页实现验证

- `AdvancedSettings.vue` 加载只保存 `{ exists }`。
- 生成成功后只把 `{ key }` 放入组件局部状态，关闭/刷新时清空。
- API 模块只调用 `/api/v1/admin/settings/admin-api-key` 和 `/regenerate`，不调用内部 `.json`。
- Vite 为 `/api/v1/admin` 配置不 rewrite 的专用代理，通用 `/api` 规则仍服务其他前端接口。
- 测试检查 localStorage、持久化 store 和普通配置请求中没有完整 Admin Key。

## 6. 中文文档内容

`doc/usage/AdminApiUsage.md` 按以下顺序组织：

1. 范围、Node 前提和安全提醒。
2. `x-api-key` 与 Bearer 的选择规则。
3. Admin Key 状态、生成、轮换、删除和 Bearer 恢复。
4. 59 条既有管理能力的外部路径/内部路径映射表。
5. 单 Key API 与旧整组保存的差异。
6. 旧页面覆盖限制、并发生成限制和未知结果处理。
7. LLM、D1/Workers、部署控制等不支持范围。

示例只使用占位凭证，不出现真实数据库或明文 Key。

## 7. 文件范围与回滚

预计修改：

- `tests/api/admin/` 及必要的认证/模型回归测试。
- `frontend/src/views/AdvancedSettings.vue`、`frontend/src/api/adminKey.ts`。
- `frontend/vite.config.ts`、`src/local.ts` 的代理/SPA边界。
- `doc/usage/AdminApiUsage.md`。

不修改 `frontend/src/views/User/KeyEdit.vue`、LLM 解析器或业务 Service。验证层回滚不会影响 Admin Key 核心实现或旧路由。
