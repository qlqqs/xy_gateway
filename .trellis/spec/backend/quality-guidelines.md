# 后端质量与验证

后端代码使用严格 TypeScript（`tsconfig.json`）、四个空格缩进，顶层方法/函数之间空两行。controller、manager、service 和 utility 模块使用 default export；model class/type 在所在模块已经采用 named export 时保持该写法。跨层修改要小而清晰，并遵循[目录结构](directory-structure.md)中的边界。

## 测试归类

- `tests/unit/` 隔离测试函数/模块，不能打开真实数据库、执行 migration 或启动服务器。依赖使用 mock/stub。
- `tests/integration/` 覆盖真实 ORM/数据库、migration、对象存储、文件持久化或多个 service 协作。只依赖 Node 的文件使用 `.node.test.ts`。
- `tests/api/` 通过 `tests/helpers/requestHelper.ts` 调用测试服务器，验证 HTTP 状态、JSON 结构、鉴权和端到端持久化。API 测试不能直接插入或检查业务行，统一隔离所需的 truncate helper 除外。

使用 `tests/globalSetup.ts` 和 `tests/helpers/dbHelper.ts` 的现有生命周期；测试不要自行创建或删除测试数据库。测试数据在 `beforeAll`/`beforeEach` 中自包含，并遵循 Vitest 配置的文件级顺序执行。`tests/integration/userManager.node.test.ts` 和 `tests/api/user/user.test.ts` 是代表性示例。

## 必须执行的检查

迭代时先运行聚焦测试，再运行 Node 模式后端套件：

```bash
npm run backend:test -- --run tests/api/user/user.test.ts
npm run backend:test
npm run backend:test:type
npm run frontend:build
```

仓库提交清单要求 Node 模式套件、后端类型检查和一次前端构建；Worker 模式较慢，通常交给 CI。如果修改影响 Worker binding、migration 或协议转换，还要补充对应 Worker/集成测试，或执行 `package.json` 中的聚焦命令。

检查资源为空/不存在时的处理、JSON 错误响应、敏感信息泄露、SQLite/MySQL 兼容性、并发行为以及 stream/timer 清理。不要提交本地数据库、日志、`.claude`/`.gemini`/IDE 文件、临时脚本或其他被忽略的产物。没有用户明确指示时不要创建 commit 或 push。
