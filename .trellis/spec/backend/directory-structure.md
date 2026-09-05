# 后端目录结构

后端源码位于 `src/`。项目采用轻量的 MVC 分层，并在 model 外围使用 manager 和 service：

| 位置 | 职责 | 现有示例 |
| --- | --- | --- |
| `src/routes.ts` | 注册 Hono 路由、中间件、404 和全局错误处理 | `src/routes.ts` |
| `src/controller/` | 解析请求参数、调用业务代码并返回 `c.json` 或流式响应 | `src/controller/userController.ts`、`src/controller/vendorController.ts` |
| `src/service/` | 业务流程、跨资源校验、协议和上游处理 | `src/service/userService.ts`、`src/service/responseHandlerService.ts`、`src/service/routingService/core.ts` |
| `src/manager/` | 面向数据库的资源操作和查询组合 | `src/manager/userManager.ts`、`src/manager/recordManager.ts` |
| `src/model/` | Sutando model、cast、表名，以及模型本地的序列化和计算 | `src/model/sgUser.ts`、`src/model/sgRecord.ts` |
| `src/middleware/` | 认证、CORS 和请求上下文设置 | `src/middleware/authMiddleware.ts`、`src/middleware/llmApiMiddleware.ts` |
| `src/util/` | 与具体资源业务流程无关的可复用代码 | `src/util/customErrorUtil.ts`、`src/util/loggerUtil.ts`、`src/util/protocol/` |
| `src/constants.ts` | 共享枚举、状态值和常量 | `src/constants.ts` |
| `src/config/` | 静态配置数据 | `src/config/vendorDefaultUrls.json` |
| `resource/migrate/` | 有序 SQL migration，每个 migration 使用一个 `migrate_NNNN` 目录 | `resource/migrate/migrate_0001/`、`resource/migrate/migrate_0030/` |
| `tests/api/`、`tests/integration/`、`tests/unit/` | API 契约、真实资源集成测试和隔离单元测试 | `tests/api/user/user.test.ts`、`tests/integration/userManager.node.test.ts` |

新增接口时在 `src/routes.ts` 注册，但不要把业务判断写进路由表。controller 使用包含 handler 函数的 default export 对象；manager、service 和 utility 模块也遵循 default-object 模式。`SgUser`、`SgRecord` 这类 model class 是 named export，因为调用方需要直接实例化或引用其类型。

```ts
// src/controller/vendorController.ts
async function getVendor(c: Context) {
    const vendorId = parseInt(c.req.param("id"), 10);
    if (isNaN(vendorId)) {
        throw new customError.AppError("Invalid ID format");
    }

    const vendor = await vendorManager.findById(vendorId);
    if (!vendor) {
        throw new customError.NotFoundError("Vendor not found");
    }
    return c.json(formatVendor(vendor));
}

export default { getVendor };
```

使用四个空格缩进，顶层函数之间空两行。后端 URL 通常以 `.json` 结尾（`/user/list.json`、`/model/create.json`）；兼容 OpenAI 的 `/llm/v1/*` 路由和少数资源 `GET`/`PUT` 路由是现有例外，扩展这些分组时保持附近代码的写法。

不要在 controller 中写 SQL、在 model 中反向引入 manager，也不要为已有 service 或 utility 的职责另建临时目录。协议转换和流式处理应留在现有的 service/util 子目录，不要塞进 API handler。
