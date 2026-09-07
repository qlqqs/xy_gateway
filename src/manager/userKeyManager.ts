import { SgUserKey } from "../model/sgUserKey";
import billingUtil from "../util/protocol/billingUtil";
import dateUtil from "../util/dateUtil";

async function findById(id: number): Promise<SgUserKey | null> {
    return await SgUserKey.query().find(id);
}

async function findByHash(keyHash: string): Promise<SgUserKey | null> {
    if (!keyHash) return null;
    return await SgUserKey.query().where("key_hash", keyHash).first();
}

async function listByUser(userId: number): Promise<SgUserKey[]> {
    return (await SgUserKey.query().where("user_id", userId).orderBy("id", "asc").get()).all();
}

async function create(data: Record<string, unknown>): Promise<SgUserKey> {
    return await SgUserKey.query().create(data);
}

async function update(id: number, data: Record<string, unknown>): Promise<SgUserKey | null> {
    const updateData = { ...data };
    // `value` is an in-memory/plaintext DTO field, never a database column.
    delete updateData.value;
    for (const field of ["model_whitelist", "ip_whitelist", "ip_blacklist"]) {
        if (Array.isArray(updateData[field])) updateData[field] = JSON.stringify(updateData[field]);
    }
    for (const field of ["quota", "quota_used"]) {
        if (typeof updateData[field] === "number") updateData[field] = billingUtil.toUnits(updateData[field] as number);
    }
    if (typeof updateData.model_whitelist_enabled === "boolean") {
        updateData.model_whitelist_enabled = updateData.model_whitelist_enabled ? 1 : 0;
    }
    if (typeof updateData.ip_restriction_enabled === "boolean") {
        updateData.ip_restriction_enabled = updateData.ip_restriction_enabled ? 1 : 0;
    }
    await SgUserKey.query().where("id", id).update(updateData);
    return await findById(id);
}

async function remove(id: number): Promise<boolean> {
    const key = await findById(id);
    if (!key) return false;
    await SgUserKey.query().where("id", id).delete();
    return true;
}

/** Replace all keys for a user. Callers should wrap this sequence in a transaction. */
async function replaceForUser(userId: number, keys: Array<Record<string, unknown>>): Promise<SgUserKey[]> {
    await SgUserKey.query().where("user_id", userId).delete();
    for (const key of keys) {
        await create({ ...key, user_id: userId });
    }
    return await listByUser(userId);
}

async function incrementQuotaUsed(id: number, delta: number): Promise<void> {
    // The model exposes quota in yuan while the database stores integer
    // micro-yuan.  Keep the conversion at this persistence boundary so every
    // caller uses the same application-level unit.
    await SgUserKey.query().where("id", id).increment("quota_used", billingUtil.toUnits(delta));
}

async function clearGroup(groupId: number): Promise<void> {
    await SgUserKey.query().where("group_id", groupId).update({ group_id: null });
}

async function markUsed(id: number): Promise<void> {
    await SgUserKey.query().where("id", id).update({ last_used_at: dateUtil.toDatabaseTimestamp(new Date()) });
}

async function deleteById(id: number): Promise<boolean> {
    return await remove(id);
}

async function deleteByUser(userId: number): Promise<void> {
    await SgUserKey.query().where("user_id", userId).delete();
}

async function removeModelReference(modelName: string): Promise<number> {
    const keys = (await SgUserKey.query().get()).all();
    let changed = 0;
    for (const key of keys) {
        const models = key.model_whitelist ?? [];
        const next = models.filter(model => model !== modelName);
        if (next.length !== models.length) {
            await update(Number(key.id), { model_whitelist: next });
            changed += 1;
        }
    }
    return changed;
}

async function renameModelReference(oldName: string, newName: string): Promise<number> {
    if (oldName === newName) return 0;
    const keys = (await SgUserKey.query().get()).all();
    let changed = 0;
    for (const key of keys) {
        const models = key.model_whitelist ?? [];
        if (!models.includes(oldName)) continue;
        const next = [...new Set(models.map(model => model === oldName ? newName : model))];
        await update(Number(key.id), { model_whitelist: next });
        changed += 1;
    }
    return changed;
}

export default {
    findById,
    findByHash,
    findByKeyHash: findByHash,
    listByUser,
    listByUserId: listByUser,
    create,
    update,
    remove,
    deleteById,
    deleteByUser,
    removeModelReference,
    renameModelReference,
    replaceForUser,
    incrementQuotaUsed,
    clearGroup,
    markUsed,
};
