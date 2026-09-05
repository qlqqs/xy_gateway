# 后端日志规范

项目目前同时使用 console 和文件 logger。`src/util/loggerUtil.ts` 提供 `Logger.info`、`warn`、`error` 和 `debug`；启用后写入 `log/app-YYYY-MM-DD.log`，格式为 `[YYYY-MM-DD HH:MM:SS.mmm] [LEVEL] ...`，同时调用原始 console 方法。单文件达到 100 MB 时轮转，最多保留五个 `app-*.log` 文件。对应测试在 `tests/unit/util/loggerUtil.test.ts`。

按以下方式使用级别：

- `info`/`console.log`：正常生命周期和请求进度，例如 `src/routes.ts` 中的 `↑`/`↓` 请求日志。
- `warn`：可恢复的降级或回退，例如日志轮转失败或上游 failover。
- `error`/`console.error`：请求失败、上游读写失败或需要诊断的异常。
- `debug`：本地排查时有用的高频诊断细节。

日志消息应包含操作和有用的标识符。controller 使用 `[userController]` 这类前缀；流式代码包含请求上下文。Record activity 是由 `requestActivityService` 写入的独立结构化时间线，不能替代错误日志。

绝不能记录 bearer token、供应商密钥、请求 Authorization header 或完整敏感 payload。`src/controller/userController.ts` 在日志中先用 `maskUtil.maskToken` 掩码 token。新增认证和供应商代码也要这样处理。排查请求/响应 payload 时，使用现有的对象存储记录流程或显式开启的 stream log，不要默认打印 body。

`LOG_DIR` 环境变量控制应用日志目录。`RECORD_LOG_ENABLED` 开启 record 创建/更新诊断日志，Node 模式下 `stream_log_enabled` 控制 `log/stream/<record.id>.log` 原始 SSE 文件。这些是诊断开关，不能作为在热路径中无条件增加大量日志的理由。
