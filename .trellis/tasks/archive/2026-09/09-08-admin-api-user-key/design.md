# 单个用户 Key 管理 API 技术设计

## 1. 请求链路

```text
/api/v1/admin/users/:id/api-keys...
  -> adminApiRoutes 的固定映射
  -> requireAdmin（Admin Key 或 Bearer）
  -> userController 单项 handler
  -> userKeyService
  -> userKeyManager / user_key
```

外部路径不带 `.json`；内部 `.json` 路径只是兼容实现和旧页面入口。单项 handler 不调用整组替换。

## 2. 路由与响应

| 方法 | 外部路径 | 内部实现路径 | Service |
| --- | --- | --- | --- |
| GET | `/users/:id/api-keys` | `GET /user/:id/keys.json` | `listForUser` |
| POST | `/users/:id/api-keys` | `POST /user/:id/keys.json` | `createForUser` |
| PUT | `/users/:id/api-keys` | `PUT /user/:id/keys.json` | 原 `replaceForUser`，整组兼容 |
| GET | `/users/:id/api-keys/:keyId` | `GET /user/:id/keys/:keyId/detail.json` | 新 `getForUser` |
| PUT | `/users/:id/api-keys/:keyId` | `PUT /user/:id/keys/:keyId/detail.json` | `updateForUser` |
| DELETE | `/users/:id/api-keys/:keyId` | `DELETE /user/:id/keys/:keyId/detail.json` | 新 `deleteForUser` |

外部集合 PUT 与 GET/POST 共用资源路径但语义不同，文档必须标明它是完整数组替换；外部自动化不使用它来修改单个 Key。

## 3. Controller 边界

在现有 `userController` 增加薄 handler：

- 复用现有 `parseId()` 和 JSON body 解析；user ID、key ID 均要求正安全整数。
- 先通过 `userManager.findById()` 确认用户存在。
- 对详情/删除操作，把 user ID 和 key ID 一起交给 Service；Service 返回 `null`/`false` 时统一返回 404。
- 创建和详情返回继续使用现有 `UserKeyDto`；需要明文解密时复用 `encryptionSecret(c)`。
- Controller 不复制分组、状态、额度、过期、加密或重复值校验。

## 4. Service 变更

### `getForUser(userId, keyId, secret)`

1. `userKeyManager.findById(keyId)`。
2. 记录不存在或 `user_id !== userId` 返回 `null`。
3. 调用现有 `toDto()` 解密并返回目标 DTO。

### `deleteForUser(userId, keyId)`

1. 按 ID 查询并校验归属。
2. 不匹配返回 `false`。
3. 调用 `userKeyManager.remove(keyId)` 物理删除目标行。

### 既有方法

- `createForUser()` 负责自动生成、摘要查重、加密和持久化。
- `updateForUser()` 负责局部字段继承、重复值检查和加密字段更新。
- `listForUser()` 负责列表 DTO。
- `replaceForUser()` 保持旧整组页面语义，不改其协议。

## 5. 并发与兼容

- 单项 API 不加额外锁或条件写；同一行后写覆盖前写。
- 单项 API 不会主动重写兄弟 Key。
- 旧整组 PUT 仍可按提交数组删除缺失 Key，因此可能覆盖单 Key API 在页面读取后的修改。
- 不引入 revision、冲突检测、自动合并或前端版本头；文档承担调用边界说明。
- `quota_used`、`last_used_at` 等运行字段不因单项配置修改而重置。

## 6. 错误与安全

- 跨用户和不存在 Key 统一 404，避免枚举其他用户资源。
- 重复值沿用数据库唯一约束和 Service 的 409 转换。
- Key DTO 的明文回显继续受 `requireAdmin` 保护；不新增日志输出。
- 不改 LLM 用户 Key 认证、计费、额度、分组和过期逻辑。

## 7. 文件范围与回滚

预计修改：

- `src/service/userKeyService.ts`
- `src/controller/userController.ts`
- P1 所有权范围内的 `src/routes/adminApiRoutes.ts` 单 Key定义条目
- `tests/api/user/` 和必要的 Service 测试

不修改 `frontend/src/views/User/KeyEdit.vue`、数据库 schema/migration、用户 Key 加密格式或旧集合 PUT。回滚时移除单项 Service、handler 和外部映射即可。
