-- 用户分组
CREATE TABLE user_group (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    inbound_protocols TEXT NOT NULL DEFAULT '[]',
    custom_models TEXT NOT NULL DEFAULT '[]',
    whitelist_enabled INTEGER NOT NULL DEFAULT 0,
    rate_multiplier REAL NOT NULL DEFAULT 1 CHECK (rate_multiplier >= 0 AND rate_multiplier <= 100),
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX user_group_name_unique ON user_group(name);

-- 首次安装提供一个可直接使用的默认分组；已有数据库若已存在同名分组则保持原数据。
INSERT INTO user_group (name, description, inbound_protocols, custom_models, whitelist_enabled, rate_multiplier, status)
SELECT '默认分组', '系统默认访问范围', '["openai_chat","openai_responses","anthropic"]', '[]', 0, 1, 'active'
WHERE NOT EXISTS (SELECT 1 FROM user_group WHERE name = '默认分组');

-- 用户 API Key。认证只使用 key_hash，encrypted_value 供获授权的管理响应解密。
CREATE TABLE user_key (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    group_id INTEGER NULL REFERENCES user_group(id) ON DELETE SET NULL,
    name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL DEFAULT '',
    encrypted_value TEXT NOT NULL,
    model_whitelist_enabled INTEGER NOT NULL DEFAULT 0,
    model_whitelist TEXT NOT NULL DEFAULT '[]',
    ip_restriction_enabled INTEGER NOT NULL DEFAULT 0,
    ip_whitelist TEXT NOT NULL DEFAULT '[]',
    ip_blacklist TEXT NOT NULL DEFAULT '[]',
    quota INTEGER NOT NULL DEFAULT 0,
    quota_used INTEGER NOT NULL DEFAULT 0,
    concurrency_limit INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMP NULL,
    last_used_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (quota >= 0),
    CHECK (quota_used >= 0),
    CHECK (concurrency_limit >= 0)
);
CREATE UNIQUE INDEX user_key_hash_unique ON user_key(key_hash);
CREATE INDEX user_key_user_id_index ON user_key(user_id);
CREATE INDEX user_key_group_id_index ON user_key(group_id);

-- 模型到供应商上游的规范化映射，数组顺序由 sort_order 保留。
CREATE TABLE model_upstream (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    model_id INTEGER NOT NULL REFERENCES model(id) ON DELETE CASCADE,
    vendor_id INTEGER NOT NULL REFERENCES vendor(id) ON DELETE CASCADE,
    vendor_model_id INTEGER NULL REFERENCES vendor_model(id) ON DELETE SET NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (sort_order >= 0),
    UNIQUE(model_id, vendor_id, vendor_model_id)
);
CREATE INDEX model_upstream_model_id_index ON model_upstream(model_id);
CREATE INDEX model_upstream_vendor_id_index ON model_upstream(vendor_id);

-- 一次性把旧 routing_config 中的上游展开到规范化映射表。运行时代码不再读取旧列。
-- 旧数据可能包含重复或已删除的 vendor_model；先归一化并按原数组顺序去重，
-- 避免 SQLite/MySQL 对 NULL 唯一键的特殊语义产生重复映射。
WITH source_rows AS (
    SELECT
        m.id AS model_id,
        CAST(json_extract(upstream.value, '$.vendor_id') AS INTEGER) AS vendor_id,
        vm.id AS vendor_model_id,
        CASE WHEN COALESCE(json_extract(upstream.value, '$.enabled'), 1) THEN 1 ELSE 0 END AS enabled,
        CAST(upstream.key AS INTEGER) AS sort_order
    FROM model AS m
    JOIN json_each(
        CASE WHEN json_valid(m.routing_config) THEN m.routing_config ELSE '{}' END,
        '$.upstreams'
    ) AS upstream
    LEFT JOIN vendor AS v
        ON v.id = CAST(json_extract(upstream.value, '$.vendor_id') AS INTEGER)
    LEFT JOIN vendor_model AS vm
        ON vm.id = CAST(json_extract(upstream.value, '$.vendor_model_id') AS INTEGER)
       AND vm.vendor_id = v.id
    WHERE json_extract(upstream.value, '$.vendor_id') IS NOT NULL
      AND v.id IS NOT NULL
), deduped AS (
    SELECT source_rows.*,
           ROW_NUMBER() OVER (
               PARTITION BY model_id, vendor_id, vendor_model_id
               ORDER BY sort_order
           ) AS row_num
    FROM source_rows
)
INSERT INTO model_upstream (model_id, vendor_id, vendor_model_id, enabled, sort_order)
SELECT model_id, vendor_id, vendor_model_id, enabled, sort_order
FROM deduped
WHERE row_num = 1;

-- 供应商调度及正式领域字段（旧 config 列保留至后续一次性数据导入完成）。
ALTER TABLE vendor ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'bearer_token';
ALTER TABLE vendor ADD COLUMN skip_tls_verify INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vendor ADD COLUMN proxy TEXT NULL;
ALTER TABLE vendor ADD COLUMN supplier_name TEXT NULL;
ALTER TABLE vendor ADD COLUMN channel_code TEXT NULL;
ALTER TABLE vendor ADD COLUMN api_type TEXT NULL;
ALTER TABLE vendor ADD COLUMN openai_protocol TEXT NULL;
ALTER TABLE vendor ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE vendor ADD COLUMN remark TEXT NULL;
ALTER TABLE vendor ADD COLUMN available_models TEXT NOT NULL DEFAULT '[]';
ALTER TABLE vendor ADD COLUMN concurrency INTEGER NOT NULL DEFAULT 10;
ALTER TABLE vendor ADD COLUMN load_factor REAL NULL;
ALTER TABLE vendor ADD COLUMN priority INTEGER NOT NULL DEFAULT 1;
ALTER TABLE vendor ADD COLUMN group_id INTEGER NULL REFERENCES user_group(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX vendor_channel_code_unique ON vendor(channel_code) WHERE channel_code IS NOT NULL;
CREATE INDEX vendor_group_id_index ON vendor(group_id);

-- 将旧 config 中已经存在的正式字段迁移到列，并把存量供应商归入默认分组。
UPDATE vendor SET
    auth_mode = COALESCE(CASE WHEN json_valid(config) THEN json_extract(config, '$.auth_mode') END, auth_mode),
    skip_tls_verify = COALESCE(CASE WHEN json_valid(config) THEN json_extract(config, '$.skip_tls_verify') END, skip_tls_verify),
    proxy = CASE WHEN json_valid(config) THEN COALESCE(json_extract(config, '$.proxy'), proxy) ELSE proxy END,
    supplier_name = COALESCE(CASE WHEN json_valid(config) THEN json_extract(config, '$.supplier_name') END, supplier_name),
    channel_code = NULLIF(COALESCE(CASE WHEN json_valid(config) THEN json_extract(config, '$.channel_code') END, channel_code), ''),
    api_type = COALESCE(CASE WHEN json_valid(config) THEN json_extract(config, '$.api_type') END, api_type),
    openai_protocol = COALESCE(CASE WHEN json_valid(config) THEN json_extract(config, '$.openai_protocol') END, openai_protocol),
    status = COALESCE(CASE WHEN json_valid(config) THEN json_extract(config, '$.status') END, status),
    remark = COALESCE(CASE WHEN json_valid(config) THEN json_extract(config, '$.remark') END, remark),
    available_models = COALESCE(CASE WHEN json_valid(config) THEN json_extract(config, '$.available_models') END, available_models),
    concurrency = COALESCE(CASE WHEN json_valid(config) THEN json_extract(config, '$.concurrency') END, concurrency),
    load_factor = COALESCE(CASE WHEN json_valid(config) THEN json_extract(config, '$.load_factor') END, load_factor),
    priority = COALESCE(CASE WHEN json_valid(config) THEN json_extract(config, '$.priority') END, priority),
    group_id = COALESCE(group_id, (SELECT id FROM user_group WHERE name = '默认分组' LIMIT 1))
WHERE config IS NOT NULL AND config <> '';

-- 即使旧 config 为空，存量供应商也必须进入默认分组；否则新建的
-- 分组 Key（或显式无分组 Key）会得到与迁移前不一致的路由池。
UPDATE vendor SET group_id = (SELECT id FROM user_group WHERE name = '默认分组' LIMIT 1)
WHERE group_id IS NULL;

-- 请求记录身份与统一结算快照（金额均为整数微元）。
ALTER TABLE record ADD COLUMN key_id INTEGER NULL REFERENCES user_key(id) ON DELETE SET NULL;
ALTER TABLE record ADD COLUMN group_id INTEGER NULL REFERENCES user_group(id) ON DELETE SET NULL;
ALTER TABLE record ADD COLUMN requested_model TEXT NULL;
ALTER TABLE record ADD COLUMN billing_mode TEXT NULL;
ALTER TABLE record ADD COLUMN base_cost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE record ADD COLUMN rate_multiplier REAL NOT NULL DEFAULT 1;
ALTER TABLE record ADD COLUMN settlement_status TEXT NOT NULL DEFAULT 'pending';
CREATE INDEX record_key_id_index ON record(key_id);
CREATE INDEX record_group_id_index ON record(group_id);
