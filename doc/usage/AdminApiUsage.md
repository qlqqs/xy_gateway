# 外部 Admin API 使用说明

本文说明 xy_gateway 的 Node 外部管理 API。所有外部路径统一挂载在：

```text
/api/v1/admin
```

外部路径不带 `.json`。项目原有根路径和 `.json` 路径继续保留，供现有前端和兼容调用使用；外部别名直接调用同一套 Controller、Service 和数据库逻辑，不会经过二次 HTTP 转发。

## 适用范围与安全提醒

- 当前只支持 Node 模式下的 SQLite 和 MySQL。Worker/D1 不提供这组外部管理入口，收到请求时返回 JSON 404。
- Admin Key 是全局唯一配置值，保存在配置数据库中。它绑定 `id` 最小的、`type=admin` 且 `status=active` 的真实管理员，不会创建虚拟用户。
- Admin Key 拥有现有管理员路由的权限。请将它当作高权限机器凭证保存，不要写入前端持久化状态、日志、查询参数或错误报告。
- 生成、轮换和删除属于有副作用的操作；网络超时后先确认结果，再决定是否使用管理员 Bearer 恢复，不要盲目重复执行。

## 认证规则

### Admin Key

在管理请求中发送 `x-api-key` Header：

```bash
curl -H "x-api-key: ${ADMIN_KEY}" \
  http://127.0.0.1:8720/api/v1/admin/status
```

Header 只要存在就优先走 Admin Key 校验，包括空值。值无效时直接返回 `401`，不会回退到同时提供的 Bearer；值有效时请求以绑定的真实管理员身份执行。若没有可绑定的 active 管理员，返回 `503`，错误码为 `admin_identity_unavailable`。

### Bearer

不发送 `x-api-key` 时，继续使用原来的 Root Token 或管理员用户 Key：

```bash
curl -H "Authorization: Bearer ${ROOT_TOKEN}" \
  http://127.0.0.1:8720/api/v1/admin/status
```

首次生成、Admin Key 响应丢失、旧 Key 在轮换后失效等情况，都可以用 Root/管理员 Bearer 重新执行生命周期操作。普通用户 Key 和 disabled 用户仍按原有规则返回 `403`。

## Admin Key 生命周期

| 方法 | 外部路径 | 内部兼容路径 | 成功响应 |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/settings/admin-api-key` | `GET /admin-api-key/status.json` | `{ "exists": boolean }` |
| POST | `/api/v1/admin/settings/admin-api-key/regenerate` | `POST /admin-api-key/regenerate.json` | `{ "key": "..." }`，仅本次响应返回明文 |
| DELETE | `/api/v1/admin/settings/admin-api-key` | `DELETE /admin-api-key.json` | `{ "success": true }` |

生成会覆盖旧值，写入成功后旧值立即失效。没有读取当前明文或掩码的接口；设置页也只在生成/重新生成成功后的当前页面内存中显示一次，关闭、离开或刷新后不能恢复。

## 67 个方法/路径映射

下面各表列出完整映射。`内部路径` 是现有兼容路由，方法由表格第一列确定；外部路径均不带 `.json`。

### 1. 系统与配置（5 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/status` | `/status.json` | `systemController.status` |
| GET | `/api/v1/admin/update` | `/update.json` | `systemController.checkUpdate` |
| GET | `/api/v1/admin/settings` | `/config.json` | `configController.getConfig` |
| PUT | `/api/v1/admin/settings` | `/config.json` | `configController.updateConfig` |
| GET | `/api/v1/admin/client-config/status` | `/client-config/status.json` | `clientConfigController.status` |

### 2. 客户端配置（8 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/client-config/local` | `/client-config/local.json` | `clientConfigController.readLocal` |
| POST | `/api/v1/admin/client-config/create` | `/client-config/create.json` | `clientConfigController.create` |
| POST | `/api/v1/admin/client-config/backup` | `/client-config/backup.json` | `clientConfigController.backup` |
| POST | `/api/v1/admin/client-config/backup/rename` | `/client-config/backup/rename.json` | `clientConfigController.renameBackup` |
| POST | `/api/v1/admin/client-config/backup/delete` | `/client-config/backup/delete.json` | `clientConfigController.deleteBackup` |
| POST | `/api/v1/admin/client-config/backup/update` | `/client-config/backup/update.json` | `clientConfigController.updateBackup` |
| POST | `/api/v1/admin/client-config/apply` | `/client-config/apply.json` | `clientConfigController.apply` |
| POST | `/api/v1/admin/client-config/sync-from-local` | `/client-config/sync-from-local.json` | `clientConfigController.syncFromLocal` |

这些接口继续使用现有的客户端配置白名单和本地主机文件语义，不扩展为任意文件读写。

### 3. 分组（5 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/groups` | `/group/list.json` | `groupController.listGroups` |
| POST | `/api/v1/admin/groups` | `/group/create.json` | `groupController.createGroup` |
| GET | `/api/v1/admin/groups/:id` | `/group/:id` | `groupController.getGroup` |
| PUT | `/api/v1/admin/groups/:id` | `/group/:id` | `groupController.updateGroup` |
| DELETE | `/api/v1/admin/groups/:id` | `/group/:id` | `groupController.deleteGroup` |

### 4. 供应商与供应商模型（16 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/vendors/preset-urls` | `/vendor/preset-urls.json` | `vendorController.getPresetUrls` |
| POST | `/api/v1/admin/vendors/models/fetch` | `/vendor/models/fetch.json` | `vendorController.fetchModelsPreview` |
| GET | `/api/v1/admin/vendors` | `/vendor/list.json` | `vendorController.listVendors` |
| POST | `/api/v1/admin/vendors/batch` | `/vendor/batch.json` | `vendorController.getVendorsByIds` |
| POST | `/api/v1/admin/vendors` | `/vendor/create.json` | `vendorController.createVendor` |
| POST | `/api/v1/admin/vendor-models/batch` | `/vendor-model/batch.json` | `vendorModelController.getVendorModelsByIds` |
| GET | `/api/v1/admin/vendors/:id/models` | `/vendor/:id/model/list.json` | `vendorModelController.listVendorModels` |
| GET | `/api/v1/admin/vendors/:id/models/fetch` | `/vendor/:id/model/fetch.json` | `vendorModelController.fetchVendorModels` |
| POST | `/api/v1/admin/vendors/:id/models/sync` | `/vendor/:id/model/sync.json` | `vendorModelController.syncVendorModels` |
| POST | `/api/v1/admin/vendors/:id/models` | `/vendor/:id/model/add.json` | `vendorModelController.addVendorModel` |
| PUT | `/api/v1/admin/vendors/:id/models/:modelId` | `/vendor/:id/model/:modelId` | `vendorModelController.updateVendorModel` |
| DELETE | `/api/v1/admin/vendors/:id/models/:modelId` | `/vendor/:id/model/:modelId` | `vendorModelController.deleteVendorModel` |
| GET | `/api/v1/admin/vendors/:id` | `/vendor/:id` | `vendorController.getVendor` |
| POST | `/api/v1/admin/vendors/:id/test` | `/vendor/:id/test.json` | `vendorController.testVendor` |
| PUT | `/api/v1/admin/vendors/:id` | `/vendor/:id` | `vendorController.updateVendor` |
| DELETE | `/api/v1/admin/vendors/:id` | `/vendor/:id` | `vendorController.deleteVendor` |

静态路径在动态 `:id` 之前注册，因此 `preset-urls`、`models/fetch` 和 `test` 不会被当成供应商 ID。

### 5. 网关模型（7 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| POST | `/api/v1/admin/models` | `/model/create.json` | `modelController.createModel` |
| POST | `/api/v1/admin/models/route-test` | `/model/route-test.json` | `modelController.testModelRoute` |
| GET | `/api/v1/admin/models` | `/model/list.json` | `modelController.listModels` |
| POST | `/api/v1/admin/models/batch` | `/model/batch.json` | `modelController.getModelsByIds` |
| GET | `/api/v1/admin/models/:id` | `/model/:id` | `modelController.getModel` |
| PUT | `/api/v1/admin/models/:id` | `/model/:id` | `modelController.updateModel` |
| DELETE | `/api/v1/admin/models/:id` | `/model/:id` | `modelController.deleteModel` |

`route-test` 沿用现有 mock/上游路由测试逻辑，不会为文档示例调用真实付费供应商。

### 6. 用户与余额（7 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/users` | `/user/list.json` | `userController.listUsers` |
| POST | `/api/v1/admin/users/batch` | `/user/batch.json` | `userController.getUsersByIds` |
| GET | `/api/v1/admin/users/:id` | `/user/:id` | `userController.getUser` |
| POST | `/api/v1/admin/users` | `/user/create.json` | `userController.createUser` |
| PUT | `/api/v1/admin/users/:id` | `/user/:id` | `userController.updateUser` |
| PUT | `/api/v1/admin/users/:id/api-keys` | `/user/:id/keys.json` | `userController.updateKeys` |
| POST | `/api/v1/admin/users/:id/balance` | `/user/:id/balance/adjust.json` | `userController.adjustBalance` |

### 7. 充值记录（2 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/balance/recharges` | `/balance/recharge/list.json` | `balanceController.listRechargeRecords` |
| GET | `/api/v1/admin/balance/recharges/:id` | `/balance/recharge/:id` | `balanceController.getRechargeRecord` |

### 8. 请求记录与活动（7 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/records` | `/record/list.json` | `recordController.listRecords` |
| GET | `/api/v1/admin/records/latest` | `/record/latest.json` | `recordController.latestRecords` |
| GET | `/api/v1/admin/records/:id` | `/record/:id` | `recordController.getRecord` |
| DELETE | `/api/v1/admin/records/payload` | `/record/clear-payload` | `recordController.clearPayload` |
| DELETE | `/api/v1/admin/records` | `/record/clear-all` | `recordController.clearAll` |
| DELETE | `/api/v1/admin/records/:id` | `/record/:id` | `recordController.deleteRecord` |
| GET | `/api/v1/admin/records/:id/activity` | `/record/:id/activity.json` | `recordActivityController.getRecordActivity` |

静态的 `DELETE /records/payload` 和 `DELETE /records` 在动态 `DELETE /records/:id` 之前注册。

### 9. 统计（2 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/stats/dashboard` | `/stats/dashboard.json` | `statsController.dashboardStats` |
| GET | `/api/v1/admin/stats/recent` | `/stats/recent.json` | `statsController.recentRecords` |

以上 59 条既有管理能力，加上前面的 3 条生命周期操作和下面的 5 条单 Key 操作，共 67 个方法/路径组合。

## 单个用户 Key 与旧整组接口

外部自动化应优先使用单 Key 接口。它们只定位目标用户和目标 Key，不读取全部 Key 后再整组写回：

| 方法 | 外部路径 | 内部路径 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/users/:id/api-keys` | `GET /user/:id/keys.json` | 列出该用户的 Key |
| POST | `/api/v1/admin/users/:id/api-keys` | `POST /user/:id/keys.json` | 创建一个 Key |
| GET | `/api/v1/admin/users/:id/api-keys/:keyId` | `GET /user/:id/keys/:keyId/detail.json` | 查看指定 Key |
| PUT | `/api/v1/admin/users/:id/api-keys/:keyId` | `PUT /user/:id/keys/:keyId/detail.json` | 只更新提交的配置字段 |
| DELETE | `/api/v1/admin/users/:id/api-keys/:keyId` | `DELETE /user/:id/keys/:keyId/detail.json` | 删除指定 Key |

同一用户的旧集合接口 `PUT /api/v1/admin/users/:id/api-keys`（内部 `PUT /user/:id/keys.json`）仍保留兼容现有 `KeyEdit.vue`，语义是完整数组替换。它不提供 revision、冲突检测或并发合并：旧页面保存陈旧数组时，可能覆盖单 Key API 在页面读取后产生的新增或修改。请不要同时用两种入口编辑同一用户。

单 Key 局部更新会保留 `quota_used`、`last_used_at` 等运行字段；这些字段不属于管理 DTO 的可编辑配置。Key 过期时间、白名单、分组和额度等可见字段按请求体校验，并通过 API 返回值确认最终结果。

## 配置隔离、错误与不支持范围

- `/api/v1/admin/settings` 仍映射普通配置接口，但保留字段 `admin_api_key` 不会出现在普通配置响应中；尝试通过普通配置批量写入该字段会得到 `400`（`reserved_config`），不会先写入其他字段。
- 认证失败返回 JSON `401`；普通用户或 disabled 用户按现有语义返回 `403`；没有 active 管理员可绑定时返回 JSON `503`。
- 已认证请求访问未知路径、外部误带 `.json` 的路径或不支持的方法，统一返回 JSON `404`，不会返回 SPA HTML。未认证请求仍先经过认证并返回 JSON `401`。
- Admin Key 只在 `requireAdmin` 管理分支生效。`/v1/*` 和 `/llm/v1/*` 的 LLM 认证链路不读取 `x-api-key`，Admin Key 本身不能直接调用 LLM；项目没有为此修改共享 LLM 解析器。
- `GET /welcome`、`DELETE /test/cache/clear` 以及其他非管理路径不属于本清单。D1/Workers、部署控制、审计、幂等保证和集合冲突检测也不在本期范围内。

## 前端设置页

“设置 → 管理 API”只调用无 `.json` 的三个外部路径：

1. 页面加载读取 `GET /api/v1/admin/settings/admin-api-key`，只保留 `exists`。
2. 生成/重新生成成功后，明文只放在当前组件内存，提供复制和关闭按钮。
3. 撤销成功后清空状态和明文；刷新或重新进入页面不会再次得到旧明文。

开发服务器为 `/api/v1/admin` 使用不改写路径的专用代理，通用 `/api` 代理仍负责旧前端接口。生产部署时请确保反向代理同样保留完整 `/api/v1/admin` 前缀。
