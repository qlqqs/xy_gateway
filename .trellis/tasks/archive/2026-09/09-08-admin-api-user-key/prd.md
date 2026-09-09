# 单个用户 Key 管理 API

## 目标

在统一外部 Admin API 下提供单 Key CRUD，避免外部程序为了修改一个 Key 而读取并提交整组数组。外部路径采用 `/api/v1/admin/users/:id/api-keys`，不带 `.json`；旧页面和内部旧路由继续整组保存。

## 范围内

### R1. 外部与内部路径

- 外部新增：
  - `GET /api/v1/admin/users/:id/api-keys`：列出该用户 Key。
  - `POST /api/v1/admin/users/:id/api-keys`：创建一个 Key。
  - `GET /api/v1/admin/users/:id/api-keys/:keyId`：读取一个 Key。
  - `PUT /api/v1/admin/users/:id/api-keys/:keyId`：局部修改一个 Key。
  - `DELETE /api/v1/admin/users/:id/api-keys/:keyId`：删除一个 Key。
- 外部 `PUT /api/v1/admin/users/:id/api-keys` 映射内部整组保存，仅作为兼容能力，不作为自动化首选。
- 内部新增 handler 可使用：
  - `GET/POST /user/:id/keys.json`。
  - `GET/PUT/DELETE /user/:id/keys/:keyId/detail.json`。
- 内部旧 `PUT /user/:id/keys.json` 保持现有请求体和行为。

### R2. 归属和错误

- 所有单项操作同时校验 user ID 与 key ID。
- 用户不存在、Key 不存在或 Key 属于其他用户都返回 404，不暴露跨用户资源。
- ID 必须为正安全整数；非法格式沿用现有 JSON 400。
- 重复 Key 值、分组不存在、字段非法和加密配置缺失沿用现有 Service 错误语义。

### R3. 单项写入

- 创建只新增一个 Key，不重写兄弟 Key。
- 修改只定位目标行，未提交字段保持当前值，不通过整组读取/替换模拟。
- 修改原文时复用现有摘要、加密和唯一约束，不重置 `quota_used`、`last_used_at`。
- 删除只物理删除目标 Key，沿用当前数据库语义。
- 不增加 revision、锁、合并、软删除、恢复或跨入口冲突检测；同一行采用最后写入。

### R4. 旧前端兼容

- 不修改 `frontend/src/views/User/KeyEdit.vue`、`apiUsers.updateKeys()` 或旧 PUT body。
- 不修改用户 Key DTO、表结构、加密格式和现有整组保存语义。
- 明确记录：旧页面基于陈旧数组保存时，可能覆盖或删除单 Key API 在此期间的修改；同一用户不应同时由两种入口编辑。

## 验收标准

- [ ] 外部五条单 Key 路径全部无 `.json`，并映射到固定内部 handler。
- [ ] list/create/detail get/detail update/detail delete 各只影响预期 Key。
- [ ] 跨用户 key ID 与不存在 key ID 均为 404。
- [ ] 局部更新保留未提交字段、兄弟 Key、`quota_used` 和 `last_used_at`。
- [ ] 重复值 409、非法 ID/字段 400、缺少加密配置沿用现有 JSON 错误。
- [ ] 外部集合 PUT 明确是整组替换；内部旧整组 PUT 和前端测试继续通过。
- [ ] `frontend/src/views/User/KeyEdit.vue` 无本子任务改动。
- [ ] 中文文档说明单 Key 与旧整组同时编辑的覆盖限制。

## 明确不做

- 不让前端改成逐 Key 请求，不新增前端页面。
- 不增加集合版本、冲突提示、锁、自动合并或新并发协议。
- 不改变 Key 表结构、删除方式、加密方式、唯一约束、额度字段或 LLM 认证。
- 不实现 Worker/D1 专项保证。

## 依赖与实施门槛

- 父任务：`../09-08-external-admin-api`。
- 依赖 P1 的 Admin API 子应用和管理认证；单 Key 业务也可先用原 Bearer测试。
- 父任务最终规划摘要必须获用户明确批准后才能启动和修改业务代码。
