-- 删除已移除的用户体验改进计划配置，避免旧设置继续出现在配置接口中。
DELETE FROM config WHERE name = 'telemetry_disabled';
