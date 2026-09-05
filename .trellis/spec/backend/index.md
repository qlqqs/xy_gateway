# 后端规范

后端是基于 Hono 和 TypeScript 的应用，可运行在 Node.js 或 Cloudflare Workers。新增接口或修改持久化逻辑时，应一起参考以下主题：

- [目录结构](directory-structure.md)
- [数据库与 ORM](database-guidelines.md)
- [错误处理](error-handling.md)
- [日志](logging-guidelines.md)
- [质量与测试](quality-guidelines.md)

主要请求链路是 `src/routes.ts` → middleware → controller → service/manager → model 或 adapter。新增代码应放在真正拥有该职责的层中。
