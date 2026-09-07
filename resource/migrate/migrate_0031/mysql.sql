-- 用户分组
CREATE TABLE user_group (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    inbound_protocols LONGTEXT NOT NULL,
    custom_models LONGTEXT NOT NULL,
    whitelist_enabled TINYINT(1) NOT NULL DEFAULT 0,
    rate_multiplier DOUBLE NOT NULL DEFAULT 1,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_group_rate_multiplier_check CHECK (rate_multiplier >= 0 AND rate_multiplier <= 100),
    UNIQUE KEY user_group_name_unique (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 首次安装提供一个可直接使用的默认分组；已有数据库若已存在同名分组则保持原数据。
INSERT INTO user_group (name, description, inbound_protocols, custom_models, whitelist_enabled, rate_multiplier, status)
SELECT '默认分组', '系统默认访问范围', '["openai_chat","openai_responses","anthropic"]', '[]', 0, 1, 'active'
WHERE NOT EXISTS (SELECT 1 FROM user_group WHERE name = '默认分组');

-- 用户 API Key。认证只使用 key_hash，encrypted_value 供获授权的管理响应解密。
CREATE TABLE user_key (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    group_id BIGINT NULL,
    name VARCHAR(255) NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    key_hash VARCHAR(255) NOT NULL,
    key_prefix VARCHAR(64) NOT NULL DEFAULT '',
    encrypted_value LONGTEXT NOT NULL,
    model_whitelist_enabled TINYINT(1) NOT NULL DEFAULT 0,
    model_whitelist LONGTEXT NOT NULL DEFAULT ('[]'),
    ip_restriction_enabled TINYINT(1) NOT NULL DEFAULT 0,
    ip_whitelist LONGTEXT NOT NULL DEFAULT ('[]'),
    ip_blacklist LONGTEXT NOT NULL DEFAULT ('[]'),
    quota BIGINT NOT NULL DEFAULT 0,
    quota_used BIGINT NOT NULL DEFAULT 0,
    concurrency_limit INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMP NULL,
    last_used_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_key_quota_check CHECK (quota >= 0),
    CONSTRAINT user_key_quota_used_check CHECK (quota_used >= 0),
    CONSTRAINT user_key_concurrency_check CHECK (concurrency_limit >= 0),
    CONSTRAINT user_key_user_fk FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
    CONSTRAINT user_key_group_fk FOREIGN KEY (group_id) REFERENCES user_group(id) ON DELETE SET NULL,
    UNIQUE KEY user_key_hash_unique (key_hash),
    KEY user_key_user_id_index (user_id),
    KEY user_key_group_id_index (group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 模型到供应商上游的规范化映射，数组顺序由 sort_order 保留。
CREATE TABLE model_upstream (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    model_id BIGINT NOT NULL,
    vendor_id BIGINT NOT NULL,
    vendor_model_id BIGINT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT model_upstream_sort_check CHECK (sort_order >= 0),
    CONSTRAINT model_upstream_model_fk FOREIGN KEY (model_id) REFERENCES model(id) ON DELETE CASCADE,
    CONSTRAINT model_upstream_vendor_fk FOREIGN KEY (vendor_id) REFERENCES vendor(id) ON DELETE CASCADE,
    CONSTRAINT model_upstream_vendor_model_fk FOREIGN KEY (vendor_model_id) REFERENCES vendor_model(id) ON DELETE SET NULL,
    UNIQUE KEY model_upstream_unique (model_id, vendor_id, vendor_model_id),
    KEY model_upstream_model_id_index (model_id),
    KEY model_upstream_vendor_id_index (vendor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 一次性把旧 routing_config 中的上游展开到规范化映射表。运行时代码不再读取旧列。
-- 旧数据可能包含重复或已删除的 vendor_model；先归一化并按原数组顺序去重，
-- 避免 SQLite/MySQL 对 NULL 唯一键的特殊语义产生重复映射。
INSERT INTO model_upstream (model_id, vendor_id, vendor_model_id, enabled, sort_order)
WITH source_rows AS (
    SELECT m.id AS model_id,
           CAST(NULLIF(jt.vendor_id, 'null') AS UNSIGNED) AS vendor_id,
           vm.id AS vendor_model_id,
           COALESCE(jt.enabled, 1) AS enabled,
           jt.sort_order - 1 AS sort_order
    FROM model AS m
    CROSS JOIN JSON_TABLE(
        CASE WHEN JSON_VALID(m.routing_config) THEN m.routing_config ELSE JSON_OBJECT() END,
        '$.upstreams[*]' COLUMNS (
            sort_order FOR ORDINALITY,
            -- 先按文本读取 ID。MySQL 8.0.13 可能把 JSON null 标记保留在
            -- JSON_TABLE 数值列中，写入可空外键时会失败，因此在下方显式归一化。
            vendor_id VARCHAR(64) PATH '$.vendor_id' NULL ON EMPTY NULL ON ERROR,
            vendor_model_id VARCHAR(64) PATH '$.vendor_model_id' NULL ON EMPTY NULL ON ERROR,
            enabled TINYINT PATH '$.enabled' DEFAULT '1' ON EMPTY DEFAULT '1' ON ERROR
        )
    ) AS jt
    LEFT JOIN vendor AS v ON v.id = CAST(NULLIF(jt.vendor_id, 'null') AS UNSIGNED)
    LEFT JOIN vendor_model AS vm
        ON vm.id = CAST(NULLIF(jt.vendor_model_id, 'null') AS UNSIGNED)
       AND vm.vendor_id = v.id
    WHERE CAST(NULLIF(jt.vendor_id, 'null') AS UNSIGNED) > 0
      AND v.id IS NOT NULL
), deduped AS (
    SELECT source_rows.*,
           ROW_NUMBER() OVER (
               PARTITION BY source_rows.model_id, source_rows.vendor_id, source_rows.vendor_model_id
               ORDER BY source_rows.sort_order
           ) AS row_num
    FROM source_rows
)
SELECT model_id, vendor_id, vendor_model_id, enabled, sort_order
FROM deduped
WHERE row_num = 1;

-- 供应商调度及正式领域字段（旧 config 列保留至后续一次性数据导入完成）。
ALTER TABLE vendor ADD COLUMN auth_mode VARCHAR(32) NOT NULL DEFAULT 'bearer_token';
ALTER TABLE vendor ADD COLUMN skip_tls_verify TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE vendor ADD COLUMN proxy LONGTEXT NULL;
ALTER TABLE vendor ADD COLUMN supplier_name VARCHAR(255) NULL;
ALTER TABLE vendor ADD COLUMN channel_code VARCHAR(255) NULL;
ALTER TABLE vendor ADD COLUMN api_type VARCHAR(32) NULL;
ALTER TABLE vendor ADD COLUMN openai_protocol VARCHAR(32) NULL;
ALTER TABLE vendor ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active';
ALTER TABLE vendor ADD COLUMN remark TEXT NULL;
ALTER TABLE vendor ADD COLUMN available_models LONGTEXT NOT NULL DEFAULT ('[]');
ALTER TABLE vendor ADD COLUMN concurrency INT NOT NULL DEFAULT 10;
ALTER TABLE vendor ADD COLUMN load_factor DOUBLE NULL;
ALTER TABLE vendor ADD COLUMN priority INT NOT NULL DEFAULT 1;
ALTER TABLE vendor ADD COLUMN group_id BIGINT NULL;
ALTER TABLE vendor ADD CONSTRAINT vendor_group_fk FOREIGN KEY (group_id) REFERENCES user_group(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX vendor_channel_code_unique ON vendor(channel_code);
CREATE INDEX vendor_group_id_index ON vendor(group_id);

-- 将旧 config 中已经存在的正式字段迁移到列，并把存量供应商归入默认分组。
UPDATE vendor SET
    auth_mode = COALESCE(CASE WHEN JSON_VALID(config) THEN JSON_UNQUOTE(JSON_EXTRACT(config, '$.auth_mode')) END, auth_mode),
    skip_tls_verify = COALESCE(CASE WHEN JSON_VALID(config) THEN JSON_EXTRACT(config, '$.skip_tls_verify') END, skip_tls_verify),
    proxy = CASE WHEN JSON_VALID(config) AND JSON_EXTRACT(config, '$.proxy') IS NOT NULL THEN JSON_UNQUOTE(JSON_EXTRACT(config, '$.proxy')) ELSE proxy END,
    supplier_name = COALESCE(CASE WHEN JSON_VALID(config) THEN JSON_UNQUOTE(JSON_EXTRACT(config, '$.supplier_name')) END, supplier_name),
    channel_code = NULLIF(COALESCE(CASE WHEN JSON_VALID(config) THEN JSON_UNQUOTE(JSON_EXTRACT(config, '$.channel_code')) END, channel_code), ''),
    api_type = COALESCE(CASE WHEN JSON_VALID(config) THEN JSON_UNQUOTE(JSON_EXTRACT(config, '$.api_type')) END, api_type),
    openai_protocol = COALESCE(CASE WHEN JSON_VALID(config) THEN JSON_UNQUOTE(JSON_EXTRACT(config, '$.openai_protocol')) END, openai_protocol),
    status = COALESCE(CASE WHEN JSON_VALID(config) THEN JSON_UNQUOTE(JSON_EXTRACT(config, '$.status')) END, status),
    remark = COALESCE(CASE WHEN JSON_VALID(config) THEN JSON_UNQUOTE(JSON_EXTRACT(config, '$.remark')) END, remark),
    available_models = COALESCE(CASE WHEN JSON_VALID(config) THEN JSON_UNQUOTE(JSON_EXTRACT(config, '$.available_models')) END, available_models),
    concurrency = COALESCE(CASE WHEN JSON_VALID(config) THEN JSON_EXTRACT(config, '$.concurrency') END, concurrency),
    load_factor = COALESCE(CASE WHEN JSON_VALID(config) THEN JSON_EXTRACT(config, '$.load_factor') END, load_factor),
    priority = COALESCE(CASE WHEN JSON_VALID(config) THEN JSON_EXTRACT(config, '$.priority') END, priority),
    group_id = COALESCE(group_id, (SELECT id FROM user_group WHERE name = '默认分组' LIMIT 1))
WHERE config IS NOT NULL AND config <> '';

-- 即使旧 config 为空，存量供应商也必须进入默认分组；否则新建的
-- 分组 Key（或显式无分组 Key）会得到与迁移前不一致的路由池。
UPDATE vendor SET group_id = (SELECT id FROM user_group WHERE name = '默认分组' LIMIT 1)
WHERE group_id IS NULL;

-- 请求记录身份与统一结算快照（金额均为整数微元）。
ALTER TABLE record ADD COLUMN key_id BIGINT NULL;
ALTER TABLE record ADD COLUMN group_id BIGINT NULL;
ALTER TABLE record ADD COLUMN requested_model VARCHAR(255) NULL;
ALTER TABLE record ADD COLUMN billing_mode VARCHAR(32) NULL;
ALTER TABLE record ADD COLUMN base_cost BIGINT NOT NULL DEFAULT 0;
ALTER TABLE record ADD COLUMN rate_multiplier DOUBLE NOT NULL DEFAULT 1;
ALTER TABLE record ADD COLUMN settlement_status VARCHAR(32) NOT NULL DEFAULT 'pending';
ALTER TABLE record ADD CONSTRAINT record_key_fk FOREIGN KEY (key_id) REFERENCES user_key(id) ON DELETE SET NULL;
ALTER TABLE record ADD CONSTRAINT record_group_fk FOREIGN KEY (group_id) REFERENCES user_group(id) ON DELETE SET NULL;
CREATE INDEX record_key_id_index ON record(key_id);
CREATE INDEX record_group_id_index ON record(group_id);
