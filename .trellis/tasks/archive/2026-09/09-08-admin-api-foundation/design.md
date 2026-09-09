# Admin API 入口与 Admin Key 技术设计

## 1. 请求链路

```text
外部 /api/v1/admin/*
  -> adminApiRoutes 子应用
  -> Node-only 门禁
  -> authMiddleware.requireAdmin
       -> 有 x-api-key：直接读 config.admin_api_key，绑定真实管理员
       -> 无 x-api-key：原 Bearer 解析
  -> 显式 route map
  -> 原 Controller / Service
```

旧根路径继续直接注册原 Controller；两条入口共享业务代码，不互相 HTTP 调用。

## 2. 外部路由子应用

新增 `src/routes/adminApiRoutes.ts`，使用与主 `app` 相同的 Env/Variables 类型。定义表至少包含：

```ts
type AdminApiRouteSpec = {
    method: "get" | "post" | "put" | "delete";
    externalPath: string;
    legacyPath: string;
    handler: MiddlewareHandler;
};
```

注册函数只接受源码中的 handler 引用。`legacyPath` 只用于清单、测试和审查，不做字符串重写目标。先静态、后集合、再动态注册，避免 `/vendors/preset-urls` 被 `/:id` 吞掉。

子应用挂载到 `/api/v1/admin`，并在末尾提供 JSON `notFound`。不注册任何外部 `.json` 别名；`/api/v1/admin/status.json` 等误用直接 404。

P1 建立 59 条基线定义。P2 完成单 Key handler 后，在同一显式表中追加 5 条单 Key 定义；P2 不另建路由分派器。

## 3. Admin Key 存储

- 数据源：`config` 表的 `name = admin_api_key`。
- `value` 保存明文；空值或不存在均为关闭。
- `adminKeyService` 直接调用 `configManager`，不经过 `configService` 缓存。
- 生成格式使用固定前缀和至少 32 字节密码学安全随机数据。
- 不新增表、列、migration、环境变量覆盖或第二个值。

## 4. 认证中间件

`authMiddleware.requireAdmin` 的新分支只在 Node 下启用，且放在现有 Bearer 分支前：

1. 通过 Header 是否存在判断分支；空 `x-api-key` 也算已提供。
2. 直接读取 `admin_api_key`，空值、异常长度、逗号合并值和常量时间比较失败均返回 401。
3. 查询 `type = admin`、`status = active`、`id ASC` 的第一个真实管理员。
4. 将该用户写入 `user_type` 和 `user`，设置 `authContext = { user, key: null, group: null }`。
5. 无 active admin 返回 503 `admin_identity_unavailable`。
6. 只有 Header 缺失时才进入当前 Bearer/Root/用户 Key分支。

不改 `authContextService.resolve()`、`llmApiMiddleware` 或用户 Key 使用记录。Admin Key 只构造管理上下文，不参与 LLM 认证、计费和分组策略。

## 5. 生命周期映射

| 外部方法/路径 | 内部方法/路径 | 行为 |
| --- | --- | --- |
| GET `/settings/admin-api-key` | GET `/admin-api-key/status.json` | 返回 `{ exists }` |
| POST `/settings/admin-api-key/regenerate` | POST `/admin-api-key/regenerate.json` | 生成、覆盖、返回 `{ key }` |
| DELETE `/settings/admin-api-key` | DELETE `/admin-api-key.json` | 删除配置并关闭 |

状态接口不返回掩码或明文。重新生成写入成功后旧值立即失效；并发请求不做版本协调，最后成功写入值有效。响应丢失使用 Bearer 重新生成。

生命周期 handler 可同时被外部别名和内部 `.json` 路由调用，但两者共享同一个 Service，不复制逻辑。

## 6. 配置隔离

- `configService.getAll()` 在数据库加载、缓存组合和返回结果三个位置都过滤 `admin_api_key`。
- `configService.updateAll()` 先遍历并校验完整输入，发现保留字段立即返回 400，再进行任何写入。
- 专用 `adminKeyService` 不使用通用配置缓存，因此生成/删除后下一次管理认证直接看到数据库值。

## 7. Node 与 SPA 边界

- `src/routes.ts` 在应用级挂载 Admin 子应用，并扩展 API 404 判断。
- `src/local.ts` 的 SPA fallback 在返回 `index.html` 前排除 `/api/v1/admin`。
- Worker/D1 运行时不进入 Admin Key 数据库分支；返回未支持 JSON 或 404。
- 未知方法、路径和外部 `.json` 均不返回 HTML。

## 8. 文件范围

- `src/routes/adminApiRoutes.ts`
- `src/routes.ts`、`src/local.ts`
- `src/middleware/authMiddleware.ts`
- `src/constants.ts`
- `src/manager/configManager.ts`、`src/manager/userManager.ts`
- `src/service/adminKeyService.ts`、`src/service/configService.ts`
- `src/controller/adminKeyController.ts`
- P1 对应 Node/API 测试

不修改 LLM 认证解析器、用户 Key 页面、数据库 schema/migration 或 Worker 专项实现。
