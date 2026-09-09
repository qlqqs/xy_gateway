# Admin API 映射验证、设置页与文档实施计划

## 执行前

- P1、P2 已完成各自聚焦验证，且父任务最终规划摘要已获用户批准。
- 启动后读取 `trellis-before-dev`、前端组件/状态/质量/类型规范和后端测试规范。
- 记录 `git status --short`，不回滚或覆盖无关工作区改动。

## 实施顺序

1. 从 `adminApiRouteMap` 和 `src/routes.ts` 建立 67 条映射的双向检查。
2. 增加外部路径格式检查：统一 `/api/v1/admin`、无 `.json`、静态路径优先、未知路径 JSON 404。
3. 增加认证矩阵：有效/无效 Admin Key、无效 Key + Bearer、仅 Bearer、普通用户 Key、disabled 用户和 LLM 负向。
4. 按领域补非付费代表性外部请求；模型 route-test 使用现有 mock 上游检查真实管理员上下文。
5. 确认内部旧根路径、旧 `.json` 路由和旧整组用户 Key PUT 回归。
6. 更新 Vite `/api/v1/admin` 专用代理和 Node SPA 回退隔离。
7. 在 `AdvancedSettings.vue` 增加 Admin Key 状态、生成/重新生成、一次性明文、复制、关闭和撤销；明文只留组件内存。
8. 新建 `frontend/src/api/adminKey.ts`，只使用无 `.json` 外部路径和严格响应类型。
9. 编写 `doc/usage/AdminApiUsage.md`，从矩阵复制完整路径和内部映射，说明恢复及并发限制。
10. 运行聚焦测试、类型检查、前端构建、Trellis 校验和格式检查。

## 聚焦验证

```bash
npm run backend:test -- --run tests/api/admin/adminRouteMap.node.test.ts tests/api/admin/adminAuth.node.test.ts
npm run backend:test -- --run tests/api/user/userKeySingle.node.test.ts tests/api/user/user.test.ts tests/api/user/rootToken.test.ts
npm run backend:test -- --run tests/api/model/model-route-test.test.ts tests/api/ai/models.negative.test.ts
npm run backend:test:type
cd frontend && npm run test:run -- src/views/AdvancedSettings.test.ts
cd frontend && npx vue-tsc -b --pretty false
python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-08-admin-api-validation
git diff --check
```

提交前按项目要求执行：

```bash
npm run backend:test
npm run backend:test:type
npm run frontend:build
```

Worker/D1 和真实供应商测试不在本任务范围；MySQL 只使用专用测试库。

## 检查重点

- 外部 `/api/v1/admin/...` 全部无扩展名，外部 `.json` 误用不会被兼容性路由意外接受。
- 外部 alias 直接绑定原 Controller，不存在第二套路由选择器或 `dispatch`。
- 59 条基线、3 条生命周期和 5 条单 Key 操作数量及内部映射完全一致。
- Admin Key 不进入 LLM，真实管理员上下文可用于模型 route-test。
- 设置页无新路由、无持久化明文、刷新后不能恢复生成值。
- 文档不宣称 D1/Workers、部署控制、集合冲突检测或额外并发保证。

## 停止条件与回滚

- 若路由表与现有管理路由不一致，先回到 P1 修正，不删除断言掩盖遗漏。
- 若必须修改 `KeyEdit.vue`、LLM 解析器、数据库 schema 或引入 OpenAPI/Zod，停止并退回父任务评审。
- 验证、设置页和文档可独立回滚；不影响旧管理入口。
- 不执行 commit，除非用户明确要求。
