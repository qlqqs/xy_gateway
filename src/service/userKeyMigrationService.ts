import type { DBAdapter } from "../util/db/dbAdapter";
import customError from "../util/customErrorUtil";
import userKeyUtil from "../util/userKeyUtil";

/**
 * 一次性导入领域重构前的 `user.token` 值。
 *
 * 此模块只允许由迁移器在 migrate_0032 删除旧列前调用；它不属于请求鉴权，
 * 也绝不能作为运行时回退路径。
 */

interface LegacyUserRow {
    id: number;
    token: string | null;
}

interface ExistingKeyRow {
    id: number;
    user_id: number;
    key_hash: string;
}

export interface LegacyKeyImportReport {
    imported: number;
    skipped: number;
}

const MIGRATED_KEY_NAME = "迁移 API Key";

async function insertImportedKey(
    adapter: DBAdapter,
    userId: number,
    groupId: number,
    keyHash: string,
    keyPrefix: string,
    encryptedValue: string,
): Promise<void> {
    const sql = `INSERT INTO user_key
        (user_id, group_id, name, status, key_hash, key_prefix, encrypted_value,
         model_whitelist, ip_whitelist, ip_blacklist, quota, quota_used, concurrency_limit)
        VALUES (?, ?, ?, 'active', ?, ?, ?, '[]', '[]', '[]', 0, 0, 0)`;

    await adapter.run(
        sql,
        userId,
        groupId,
        MIGRATED_KEY_NAME,
        keyHash,
        keyPrefix,
        encryptedValue,
    );
}

/**
 * 将所有非空旧用户 Token 导入规范的 user_key 表。同一用户和摘要已存在时视为
 * 已导入，允许中断后安全重试；同一摘要属于不同用户则视为硬冲突，在删除旧列前
 * 中止切换。
 */
async function importLegacyUserKeys(
    adapter: DBAdapter,
    explicitSecret?: string,
): Promise<LegacyKeyImportReport> {
    let users: LegacyUserRow[];
    try {
        users = await adapter.query<LegacyUserRow>(
            "SELECT id, token FROM user WHERE token IS NOT NULL AND token <> '' ORDER BY id",
        );
    } catch (error) {
        throw new customError.AppError(
            "Cannot inspect legacy user tokens; run the domain migration from a pre-cutover database",
            500,
            "legacy_token_migration_failed",
        );
    }

    if (users.length === 0) {
        return { imported: 0, skipped: 0 };
    }

    const secret = userKeyUtil.resolveEncryptionSecret(explicitSecret);
    if (!secret) {
        throw new customError.AppError(
            "KEY_ENCRYPTION_SECRET is required to migrate existing API keys",
            500,
            "key_encryption_secret_required",
        );
    }

    const groups = await adapter.query<{ id: number }>(
        "SELECT id FROM user_group WHERE name = '默认分组' ORDER BY id LIMIT 1",
    );
    const defaultGroupId = Number(groups[0]?.id);
    if (!Number.isSafeInteger(defaultGroupId) || defaultGroupId <= 0) {
        throw new customError.AppError(
            "The default user group is missing; repair migrate_0031 before retrying",
            500,
            "default_group_missing",
        );
    }

    const existingRows = await adapter.query<ExistingKeyRow>(
        "SELECT id, user_id, key_hash FROM user_key",
    );
    const hashes = new Map<string, ExistingKeyRow>();
    for (const row of existingRows) {
        hashes.set(String(row.key_hash), row);
    }

    let imported = 0;
    let skipped = 0;
    for (const row of users) {
        // 不要 trim 凭据：必须保留旧列实际用于鉴权的完整值。SQL 已过滤空字符串，
        // 只有空值会被有意忽略。
        const token = typeof row.token === "string" ? row.token : "";
        if (!token) {
            skipped += 1;
            continue;
        }

        const keyHash = await userKeyUtil.hashKey(token);
        const existing = hashes.get(keyHash);
        if (existing) {
            if (Number(existing.user_id) !== Number(row.id)) {
                throw new customError.AppError(
                    `Legacy API key conflict between users ${row.id} and ${existing.user_id}`,
                    409,
                    "legacy_key_conflict",
                );
            }
            skipped += 1;
            continue;
        }

        const encryptedValue = await userKeyUtil.encryptKey(token, secret);
        await insertImportedKey(
            adapter,
            Number(row.id),
            defaultGroupId,
            keyHash,
            userKeyUtil.keyPrefix(token),
            encryptedValue,
        );
        hashes.set(keyHash, {
            id: 0,
            user_id: Number(row.id),
            key_hash: keyHash,
        });
        imported += 1;
    }

    return { imported, skipped };
}

export default {
    importLegacyUserKeys,
};
