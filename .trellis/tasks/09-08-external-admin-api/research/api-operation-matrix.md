# 外部 Admin API 操作映射清单

## 使用规则

本清单是外部路由、内部兼容路由、Controller 和测试覆盖的共同对照表。所有外部路径都挂在：

```text
/api/v1/admin
```

外部路径不带 `.json`；内部路径保留 xy_gateway 当前路由格式，旧页面继续使用内部路径。`handler` 是直接注册到外部子应用的现有 Controller 方法，不经过内部 HTTP 请求。

实现必须维护显式白名单，不能把客户端传入的任意路径、方法或 action 字符串拼接到内部路径。未知外部路径、外部误带 `.json` 和不支持的方法统一返回 JSON 404。

基线来源：`src/routes.ts:116-190` 当前 59 条 `authMiddleware.requireAdmin` 路由。总清单为：

- 59 条既有管理能力外部别名。
- 3 条 Admin Key 生命周期操作。
- 5 条单 Key 操作。
- 合计 67 个方法/路径组合；旧整组 Key PUT 已包含在 59 条基线中。

## Admin Key 生命周期（3 条）

| 方法 | 外部路径 | 内部路径 | Handler / 说明 |
| --- | --- | --- | --- |
| GET | `/settings/admin-api-key` | `/admin-api-key/status.json` | `adminKeyController.status`，只返回 `{ exists }` |
| POST | `/settings/admin-api-key/regenerate` | `/admin-api-key/regenerate.json` | `adminKeyController.regenerate`，生成即覆盖并返回一次明文 |
| DELETE | `/settings/admin-api-key` | `/admin-api-key.json` | `adminKeyController.remove`，删除固定配置项 |

三条接口均受 `requireAdmin` 保护。第一次生成或失钥恢复使用 Root/管理员 Bearer；外部 Admin Key 重新生成成功后，发起请求的旧值立即失效。

## 单个用户 Key（5 条新增 + 1 条兼容说明）

| 方法 | 外部路径 | 内部路径 | Handler / 说明 |
| --- | --- | --- | --- |
| GET | `/users/:id/api-keys` | `GET /user/:id/keys.json` | `userController.listKeys`，单用户列表 |
| POST | `/users/:id/api-keys` | `POST /user/:id/keys.json` | `userController.createKey`，创建一个 |
| GET | `/users/:id/api-keys/:keyId` | `GET /user/:id/keys/:keyId/detail.json` | `userController.getKey`，归属不符返回 404 |
| PUT | `/users/:id/api-keys/:keyId` | `PUT /user/:id/keys/:keyId/detail.json` | `userController.updateKey`，只更新提交字段 |
| DELETE | `/users/:id/api-keys/:keyId` | `DELETE /user/:id/keys/:keyId/detail.json` | `userController.deleteKey`，只删除目标行 |
外部自动化优先使用前五条单 Key 接口。集合 PUT 仍映射旧整组语义，不能被描述为并发合并或冲突检测接口。前端 `KeyEdit.vue` 继续使用内部 `PUT /user/:id/keys.json`。

## 既有管理能力（59 条）

### 系统与配置（5 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| GET | `/status` | `/status.json` | `systemController.status` |
| GET | `/update` | `/update.json` | `systemController.checkUpdate` |
| GET | `/settings` | `/config.json` | `configController.getConfig` |
| PUT | `/settings` | `/config.json` | `configController.updateConfig` |
| GET | `/client-config/status` | `/client-config/status.json` | `clientConfigController.status` |

### 客户端配置（8 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| GET | `/client-config/local` | `/client-config/local.json` | `clientConfigController.readLocal` |
| POST | `/client-config/create` | `/client-config/create.json` | `clientConfigController.create` |
| POST | `/client-config/backup` | `/client-config/backup.json` | `clientConfigController.backup` |
| POST | `/client-config/backup/rename` | `/client-config/backup/rename.json` | `clientConfigController.renameBackup` |
| POST | `/client-config/backup/delete` | `/client-config/backup/delete.json` | `clientConfigController.deleteBackup` |
| POST | `/client-config/backup/update` | `/client-config/backup/update.json` | `clientConfigController.updateBackup` |
| POST | `/client-config/apply` | `/client-config/apply.json` | `clientConfigController.apply` |
| POST | `/client-config/sync-from-local` | `/client-config/sync-from-local.json` | `clientConfigController.syncFromLocal` |

这些接口保留现有客户端配置路径白名单和主机语义，不扩展成任意文件操作。

### 分组（5 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| GET | `/groups` | `/group/list.json` | `groupController.listGroups` |
| POST | `/groups` | `/group/create.json` | `groupController.createGroup` |
| GET | `/groups/:id` | `/group/:id` | `groupController.getGroup` |
| PUT | `/groups/:id` | `/group/:id` | `groupController.updateGroup` |
| DELETE | `/groups/:id` | `/group/:id` | `groupController.deleteGroup` |

### 供应商与供应商模型（16 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| GET | `/vendors/preset-urls` | `/vendor/preset-urls.json` | `vendorController.getPresetUrls` |
| POST | `/vendors/models/fetch` | `/vendor/models/fetch.json` | `vendorController.fetchModelsPreview` |
| GET | `/vendors` | `/vendor/list.json` | `vendorController.listVendors` |
| POST | `/vendors/batch` | `/vendor/batch.json` | `vendorController.getVendorsByIds` |
| POST | `/vendors` | `/vendor/create.json` | `vendorController.createVendor` |
| POST | `/vendor-models/batch` | `/vendor-model/batch.json` | `vendorModelController.getVendorModelsByIds` |
| GET | `/vendors/:id/models` | `/vendor/:id/model/list.json` | `vendorModelController.listVendorModels` |
| GET | `/vendors/:id/models/fetch` | `/vendor/:id/model/fetch.json` | `vendorModelController.fetchVendorModels` |
| POST | `/vendors/:id/models/sync` | `/vendor/:id/model/sync.json` | `vendorModelController.syncVendorModels` |
| POST | `/vendors/:id/models` | `/vendor/:id/model/add.json` | `vendorModelController.addVendorModel` |
| PUT | `/vendors/:id/models/:modelId` | `/vendor/:id/model/:modelId` | `vendorModelController.updateVendorModel` |
| DELETE | `/vendors/:id/models/:modelId` | `/vendor/:id/model/:modelId` | `vendorModelController.deleteVendorModel` |
| GET | `/vendors/:id` | `/vendor/:id` | `vendorController.getVendor` |
| POST | `/vendors/:id/test` | `/vendor/:id/test.json` | `vendorController.testVendor` |
| PUT | `/vendors/:id` | `/vendor/:id` | `vendorController.updateVendor` |
| DELETE | `/vendors/:id` | `/vendor/:id` | `vendorController.deleteVendor` |

静态路径必须在 `/:id` 前注册，避免把 `preset-urls`、`models/fetch` 或 `test` 当作资源 ID。

### 网关模型（7 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| POST | `/models` | `/model/create.json` | `modelController.createModel` |
| POST | `/models/route-test` | `/model/route-test.json` | `modelController.testModelRoute` |
| GET | `/models` | `/model/list.json` | `modelController.listModels` |
| POST | `/models/batch` | `/model/batch.json` | `modelController.getModelsByIds` |
| GET | `/models/:id` | `/model/:id` | `modelController.getModel` |
| PUT | `/models/:id` | `/model/:id` | `modelController.updateModel` |
| DELETE | `/models/:id` | `/model/:id` | `modelController.deleteModel` |

### 用户与余额（7 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| GET | `/users` | `/user/list.json` | `userController.listUsers` |
| POST | `/users/batch` | `/user/batch.json` | `userController.getUsersByIds` |
| GET | `/users/:id` | `/user/:id` | `userController.getUser` |
| POST | `/users` | `/user/create.json` | `userController.createUser` |
| PUT | `/users/:id` | `/user/:id` | `userController.updateUser` |
| PUT | `/users/:id/api-keys` | `/user/:id/keys.json` | `userController.updateKeys` |
| POST | `/users/:id/balance` | `/user/:id/balance/adjust.json` | `userController.adjustBalance` |

这里的集合 PUT 是现有整组 Key 管理能力；新增单 Key GET/POST/detail 操作见上方单 Key表。

### 充值记录（2 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| GET | `/balance/recharges` | `/balance/recharge/list.json` | `balanceController.listRechargeRecords` |
| GET | `/balance/recharges/:id` | `/balance/recharge/:id` | `balanceController.getRechargeRecord` |

### 请求记录与活动（7 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| GET | `/records` | `/record/list.json` | `recordController.listRecords` |
| GET | `/records/latest` | `/record/latest.json` | `recordController.latestRecords` |
| GET | `/records/:id` | `/record/:id` | `recordController.getRecord` |
| DELETE | `/records/payload` | `/record/clear-payload` | `recordController.clearPayload` |
| DELETE | `/records` | `/record/clear-all` | `recordController.clearAll` |
| DELETE | `/records/:id` | `/record/:id` | `recordController.deleteRecord` |
| GET | `/records/:id/activity` | `/record/:id/activity.json` | `recordActivityController.getRecordActivity` |

静态的 `/records/payload` 和 `/records` DELETE 必须在动态 `/:id` DELETE 前注册。

### 统计（2 条）

| 方法 | 外部路径 | 内部路径 | Handler |
| --- | --- | --- | --- |
| GET | `/stats/dashboard` | `/stats/dashboard.json` | `statsController.dashboardStats` |
| GET | `/stats/recent` | `/stats/recent.json` | `statsController.recentRecords` |

## 不属于 Admin API 的路由

以下路径不进入 `/api/v1/admin` 映射，不接受 Admin Key 的管理身份：

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/messages`
- `POST /v1/responses`
- `GET /llm/v1/models`
- `POST /llm/v1/chat/completions`
- `POST /llm/v1/messages`
- `POST /llm/v1/responses`
- `GET /welcome`
- `DELETE /test/cache/clear`

## 覆盖要求

- 测试从同一份显式路由定义核对外部路径、内部路径和 handler，避免文档单独维护后漂移。
- 反向检查 `src/routes.ts` 中所有 `requireAdmin` 路由都有外部映射；新增生命周期和单 Key 路由也必须在清单中。
- 每个领域至少选择一个不访问真实付费上游的代表性外部请求。
- 覆盖有效 Admin Key、无效 Admin Key、无效 Key + 有效 Bearer、仅 Bearer、普通用户 Key、LLM 负向和未知外部路径。
- 对所有外部路径断言不以 `.json` 结尾；对内部旧路径执行旧 API 回归。
- 写操作沿用现有业务语义，不额外承诺幂等、审计、集合版本或并发合并。
