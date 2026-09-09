# Admin API 入口与 Admin Key 实施计划

## 执行前

- 父任务最终规划摘要必须先获用户明确批准。
- 执行 `task.py start` 后先读取 `trellis-before-dev` 及后端、数据库、错误、日志和测试规范。
- 记录 `git status --short`，保留用户已有业务改动。

## 实施顺序

1. 确认主路由的 Env/Variables 类型可供子应用复用；只做必要的类型抽取。
2. 新建 `src/routes/adminApiRoutes.ts`，建立显式 `{ method, externalPath, legacyPath, handler }` 定义表。
3. 注册 59 条基线外部别名，外部路径统一位于 `/api/v1/admin` 且不带 `.json`；静态路径先于动态路径。
4. 注册三条 Admin Key 外部生命周期别名，并保留内部 `.json` 生命周期路由。
5. 在 `src/routes.ts` 挂载子应用，在 `src/local.ts` 和应用 404 逻辑中隔离 SPA。
6. 在 constants、configManager、userManager 中加入保留配置名、删除能力和首个 active admin 查询。
7. 新建 `adminKeyService` 与 `adminKeyController`，实现状态、生成覆盖、删除和常量时间比较。
8. 扩展 `authMiddleware.requireAdmin`：Node 下先处理存在的 `x-api-key`，成功后设置真实管理上下文；Header 缺失才进入原 Bearer 分支。
9. 扩展 `configService` 的保留项过滤和整批预检；不让 `/config.json` 读写 Admin Key。
10. 确认 `authContextService.resolve()`、`llmApiMiddleware` 无 Admin Key 专用分支。
11. 新增聚焦 Node 测试，验证生命周期、真实管理员绑定、Header 优先级、缓存失效、配置隔离、LLM 负向和外部路径格式。

## 聚焦验证

计划命令（文件名按实现时现有目录惯例调整）：

```bash
npm run backend:test -- --run tests/api/admin/adminKey.node.test.ts tests/api/admin/adminRouteMap.node.test.ts
npm run backend:test -- --run tests/api/config/config.test.ts tests/api/user/rootToken.test.ts
npm run backend:test -- --run tests/api/ai/models.negative.test.ts tests/api/model/model-route-test.test.ts
npm run backend:test:type
python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-08-admin-api-foundation
git diff --check
```

重点断言：

- `/api/v1/admin/settings/admin-api-key` 三条外部路径无扩展名且返回预期 JSON。
- 外部 `.json` 路径和未知路径为 JSON 404。
- 59 条基线映射都使用固定 Controller handler，不存在动态 dispatch。
- 首次生成、立即替换、删除、重复删除、并发最后写入和 Bearer 恢复。
- 最小 ID active admin 绑定、无管理员 503、无效 `x-api-key` 不回退 Bearer。
- 普通配置不返回或接受 `admin_api_key`，日志和错误不包含完整值。
- Admin Key 不通过 LLM 用户 Key 解析。

## 风险与停止条件

- 若必须通过内部 HTTP 或客户端传入 path/action 才能完成映射，停止并回到父任务评审。
- 若必须修改共享 LLM 解析器、数据库 schema、Worker binding 或旧前端协议，停止编码。
- 若旧 Hono 路由无法保证静态/动态顺序，先用最小内存探针确认，不引入新路由框架。
- 不为了并发轮换临时增加锁、版本、双 Key 或持久幂等。

## 回滚点

1. 通过 Bearer 删除 Admin Key。
2. 回滚 Admin API 子应用和认证分支。
3. 保留旧根路径及数据库表；回滚到旧配置代码前先清空 `admin_api_key`。

不执行 commit，除非用户明确要求。
