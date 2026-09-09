# sub2api 对照与最终取舍

## 状态

- 日期：2026-09-08。
- 本机参考提交：`bc2244c8`，版本文件为 `0.1.158`。
- 本文只记录已确认的借鉴点和 xy_gateway 的取舍，当前仍为 planning，不代表已批准实施。

## 关键对照

| 项目 | sub2api | xy_gateway 最终选择 |
| --- | --- | --- |
| 管理入口 | `/api/v1/admin` 独立管理组 | 相同：外部统一 `/api/v1/admin/*` |
| 外部路径 | 资源路径不带 `.json` | 相同：外部不带 `.json`；内部旧 `.json` 路由保留 |
| 管理 Header | `x-api-key` | 相同：存在时优先验证，错误不回退 Bearer |
| 管理身份 | Key 成功后载入真实管理员 | 相同：绑定 `id ASC` 的第一个 active admin |
| Key 存储 | settings 单值明文 | 相同方向：`config.admin_api_key` 单值明文 |
| 生成 | 生成、保存、返回新值 | 相同：生成即覆盖，明文只在成功响应显示一次 |
| 轮换 | 无复杂双值协议 | 相同：最后成功写入有效，不做版本/双 Key |
| 状态 | 返回存在和掩码 | 简化：只返回 `{ exists }`，不返回掩码 |
| 删除 | 删除配置，关闭机器入口 | 相同 |
| 用户管理路径 | `/users/:id/api-keys` 等资源风格 | 相同风格；内部映射到现有 `/user/:id/keys.json` |
| 业务复用 | 管理 handler/service 分层 | xy 直接复用现有 Controller/Service，不复制业务 |
| 敏感操作 | 部分接口 step-up 拒绝机器 Key | 不移植：用户要求 Admin Key 拥有现有管理员完整管理权限 |
| 审计、幂等、部署 | sub2api 有较多平台设施 | 本期不移植，避免复杂度和新数据表 |
| 认证协议 | JWT 等后台会话 | 保留 xy 现有 Bearer/Root，不引入 JWT |

## 最终外部路径

```text
GET    /api/v1/admin/settings/admin-api-key
POST   /api/v1/admin/settings/admin-api-key/regenerate
DELETE /api/v1/admin/settings/admin-api-key

GET    /api/v1/admin/users/:id/api-keys
POST   /api/v1/admin/users/:id/api-keys
GET    /api/v1/admin/users/:id/api-keys/:keyId
PUT    /api/v1/admin/users/:id/api-keys/:keyId
DELETE /api/v1/admin/users/:id/api-keys/:keyId
```

其余现有管理能力也挂在同一前缀下，完整映射见 `api-operation-matrix.md`。外部路径不提供 `.json` 别名；内部旧路由仍可使用 `.json`。

## 为什么采用统一前缀而不是万能端点

统一前缀让客户端看到稳定的资源路径，且每个方法都能在代码中静态审查、测试和限制。它仍然只增加路由别名，不复制 Controller/Service。

不采用：

```text
POST /api/v1/admin/dispatch
{ "method": "...", "path": "...", "action": "..." }
```

万能端点会重新引入参数、错误、请求体和权限映射，形成一套更难测试的 RPC 协议；不符合“简单、好测试、bug 少”。

## xy_gateway 的有意差异

1. Admin Key 只在设置页管理，不能在用户页面管理。
2. 只有一个有效值；重新生成立即覆盖旧值。
3. 状态接口不返回掩码，完整明文只返回一次。
4. Admin Key 绑定真实数据库管理员，不构造虚拟管理用户。
5. 不把 Admin Key 加入共享 LLM 认证解析器。
6. 旧 `KeyEdit.vue` 继续整组保存；外部自动化使用单 Key CRUD，不增加 revision 或冲突检测。
7. 不移植 sub2api 的 JWT、TOTP、step-up、审计、订阅、备份和部署控制。

## 主动接受的限制

1. 两个并发重新生成请求都可能返回成功，只有最后成功写入的值有效。
2. 生成响应丢失后，旧值可能已失效；使用 Root/管理员 Bearer 重新生成。
3. 首个 active admin 变化后，后续 Admin Key 请求绑定的真实用户可能变化。
4. 旧前端整组保存陈旧数据时，可能覆盖外部单 Key API 的新增或修改。
5. 普通写操作没有持久幂等；结果未知时不能盲目重试有副作用的请求。

这些限制必须在中文使用文档和测试名称中明确，不包装成 sub2api 的完整平台能力。
