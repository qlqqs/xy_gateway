-- migrate_0031 已将旧 user.token 导入 user_key；此迁移由
-- dbMigrationService 在执行 DDL 前调用应用层加密导入钩子。
-- 完成后删除旧认证和模型路由列，运行时不再保留兼容字段。
DROP INDEX token_index ON user;
ALTER TABLE user DROP COLUMN token;
ALTER TABLE model DROP COLUMN routing_mode, DROP COLUMN routing_config;
