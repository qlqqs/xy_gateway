# 单个用户 Key 管理 API 实施计划

## 执行前

- 父任务最终规划摘要和 P1 入口设计必须先获用户批准。
- 启动后读取 `trellis-before-dev`、后端目录、数据库、错误和测试规范。
- 记录 `git status --short`；不触碰 `frontend/src/views/User/KeyEdit.vue` 或其他无关改动。

## 实施顺序

1. 复查 `userKeyService.createForUser()`、`updateForUser()`、`listForUser()`、`toDto()` 和 `userKeyManager` 的现有语义。
2. 增加 `getForUser(userId, keyId, secret)`：按目标 ID 查询并校验归属，返回单个 DTO。
3. 增加 `deleteForUser(userId, keyId)`：按目标 ID 校验归属后物理删除，返回布尔结果。
4. 在 `userController` 增加 list/create/detail get/detail update/detail delete handler，复用现有 ID、body 和加密 helper。
5. 在 P1 的 `adminApiRouteMap` 增加 5 条无 `.json` 单 Key外部定义；保留集合 PUT 的整组映射。
6. 确认单项更新不调用 `replaceForUser()`，不修改兄弟 Key、`quota_used` 或 `last_used_at`。
7. 新增 API 测试：正常 CRUD、自动生成、跨用户 404、重复值 409、局部字段继承和兄弟 Key 保留。
8. 运行旧用户 API 回归，确认内部 `PUT /user/:id/keys.json` 和前端整组保存协议未改变。

## 聚焦验证

```bash
npm run backend:test -- --run tests/api/user/userKeySingle.node.test.ts
npm run backend:test -- --run tests/api/user/user.test.ts tests/api/user/user.negative.test.ts tests/api/user/rootToken.test.ts
npm run backend:test:type
git diff -- frontend/src/views/User/KeyEdit.vue frontend/src/repositories/apiUsers.ts
python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-08-admin-api-user-key
git diff --check
```

重点断言：

- 外部路径为 `/api/v1/admin/users/:id/api-keys...`，不接受 `.json` 外部别名。
- list/create/detail get/detail update/detail delete 只影响目标 Key。
- user ID/key ID 不匹配统一 404。
- 未提交字段、兄弟 Key 和运行字段保持不变。
- 删除后目标不可读，重复删除 404，兄弟 Key仍存在。
- 旧整组 PUT 的新增、更新、删除、临时 ID 和 Key交换用例继续通过。

## 风险与停止条件

- 若必须调用 `replaceForUser()` 才能完成单项操作，停止并修正设计。
- 若必须修改前端请求、Key DTO、数据库 schema 或加密格式，退回父任务重新评审。
- 不为旧页面/API并发场景临时增加锁、revision 或自动合并。

## 回滚点

- 移除单项 Service 方法、Controller handler 和 P1 路由表中的 5 条定义。
- 保留旧 `PUT /user/:id/keys.json`、旧页面和整组 Service。
- 不执行 commit，除非用户在验证后明确要求。
