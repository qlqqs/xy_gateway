import { SgUserKey } from "../model/sgUserKey";
import userKeyManager from "../manager/userKeyManager";
import userGroupManager from "../manager/userGroupManager";
import ormService from "./ormService";
import customError from "../util/customErrorUtil";
import userKeyUtil from "../util/userKeyUtil";
import billingUtil from "../util/protocol/billingUtil";
import dateUtil from "../util/dateUtil";

export interface UserKeyDto {
    id: number;
    value: string;
    groupId: number | null;
    status: "active" | "disabled";
    name: string;
    modelWhitelistEnabled: boolean;
    modelWhitelist: string[];
    ipRestrictionEnabled: boolean;
    ipWhitelist: string[];
    ipBlacklist: string[];
    quota: number;
    rateLimit: number;
    expiresAt: string | null;
}

export interface UserKeyInput {
    id?: number;
    value?: string;
    groupId?: number | null;
    status?: "active" | "disabled";
    name?: string;
    modelWhitelistEnabled?: boolean;
    modelWhitelist?: string[];
    ipRestrictionEnabled?: boolean;
    ipWhitelist?: string[];
    ipBlacklist?: string[];
    quota?: number;
    rateLimit?: number;
    expiresAt?: string | null;
}

interface KeyPersistenceInput {
    user_id: number;
    group_id: number | null;
    name: string;
    status: "active" | "disabled";
    key_hash: string;
    key_prefix: string;
    encrypted_value: string;
    model_whitelist_enabled: boolean;
    model_whitelist: string[];
    ip_restriction_enabled: boolean;
    ip_whitelist: string[];
    ip_blacklist: string[];
    quota: number;
    concurrency_limit: number;
    expires_at: Date | null;
}

const keyStatuses = new Set(["active", "disabled"]);

function normalizeStringList(value: unknown, field: string): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
        throw new customError.AppError(`${field} must be an array of strings`);
    }
    return [...new Set(value.map(item => item.trim()).filter(Boolean))];
}

function parsePositiveId(value: unknown, field: string): number | null {
    if (value === null || value === undefined || value === "") return null;
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new customError.AppError(`${field} must be a positive integer`);
    }
    return id;
}

function parseExpiry(value: unknown): Date | null {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string" && typeof value !== "number") {
        throw new customError.AppError("expiresAt must be an ISO date or null");
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new customError.AppError("expiresAt must be a valid date");
    }
    return date;
}

function parseNumber(value: unknown, field: string, min: number): number {
    if (typeof value !== "number") {
        throw new customError.AppError(`${field} must be a number >= ${min}`);
    }
    const number = value;
    // Amounts are persisted as integer micro-yuan.  Reject values that would
    // overflow a safe integer at that boundary instead of silently rounding.
    if (!Number.isFinite(number) || number < min
        || !Number.isSafeInteger(Math.round(number * 1_000_000))) {
        throw new customError.AppError(`${field} must be a number >= ${min}`);
    }
    return number;
}

function parseBoolean(value: unknown, field: string, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") {
        throw new customError.AppError(`${field} must be a boolean`);
    }
    return value;
}

function parseConcurrency(value: unknown): number {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new customError.AppError("rateLimit must be a non-negative integer");
    }
    return number;
}

function normalizeValue(value: unknown, allowGenerate: boolean): string {
    if (value === undefined || value === null || value === "") {
        if (allowGenerate) return userKeyUtil.generateKey();
        throw new customError.AppError("value is required");
    }
    if (typeof value !== "string") {
        throw new customError.AppError("value must be a string");
    }
    const normalized = value.trim();
    if (normalized.length < 1 || normalized.length > 256) {
        throw new customError.AppError("value must contain between 1 and 256 characters");
    }
    return normalized;
}

async function validateGroup(groupId: number | null): Promise<void> {
    if (groupId == null) return;
    if (!await userGroupManager.findById(groupId)) {
        throw new customError.NotFoundError("User group not found");
    }
}

function parseInput(input: UserKeyInput, current?: SgUserKey): {
    value?: string;
    group_id: number | null;
    name: string;
    status: "active" | "disabled";
    model_whitelist_enabled: boolean;
    model_whitelist: string[];
    ip_restriction_enabled: boolean;
    ip_whitelist: string[];
    ip_blacklist: string[];
    quota: number;
    concurrency_limit: number;
    expires_at: Date | null;
} {
    const groupId = input.groupId !== undefined
        ? parsePositiveId(input.groupId, "groupId")
        : (current?.group_id ?? null);
    const status = input.status ?? current?.status ?? "active";
    if (!keyStatuses.has(status)) {
        throw new customError.AppError("status must be active or disabled");
    }
    if (input.name !== undefined && typeof input.name !== "string") {
        throw new customError.AppError("name must be a string");
    }
    if (input.modelWhitelistEnabled !== undefined && typeof input.modelWhitelistEnabled !== "boolean") {
        throw new customError.AppError("modelWhitelistEnabled must be a boolean");
    }
    if (input.ipRestrictionEnabled !== undefined && typeof input.ipRestrictionEnabled !== "boolean") {
        throw new customError.AppError("ipRestrictionEnabled must be a boolean");
    }
    const name = input.name !== undefined
        ? input.name.trim()
        : (current?.name ?? "");
    if (name.length > 255) {
        throw new customError.AppError("name is too long");
    }

    const modelWhitelist = input.modelWhitelist !== undefined
        ? normalizeStringList(input.modelWhitelist, "modelWhitelist")
        : [...(current?.model_whitelist ?? [])];
    const ipWhitelist = input.ipWhitelist !== undefined
        ? normalizeStringList(input.ipWhitelist, "ipWhitelist")
        : [...(current?.ip_whitelist ?? [])];
    const ipBlacklist = input.ipBlacklist !== undefined
        ? normalizeStringList(input.ipBlacklist, "ipBlacklist")
        : [...(current?.ip_blacklist ?? [])];

    const quota = input.quota !== undefined
        ? parseNumber(input.quota, "quota", 0)
        : (current?.quota ?? 0);
    const concurrencyLimit = input.rateLimit !== undefined
        ? parseConcurrency(input.rateLimit)
        : (current?.concurrency_limit ?? 0);

    return {
        value: input.value !== undefined ? normalizeValue(input.value, false) : undefined,
        group_id: groupId,
        name,
        status: status as "active" | "disabled",
        model_whitelist_enabled: parseBoolean(
            input.modelWhitelistEnabled,
            "modelWhitelistEnabled",
            current?.model_whitelist_enabled ?? false,
        ),
        model_whitelist: modelWhitelist,
        ip_restriction_enabled: parseBoolean(
            input.ipRestrictionEnabled,
            "ipRestrictionEnabled",
            current?.ip_restriction_enabled ?? false,
        ),
        ip_whitelist: ipWhitelist,
        ip_blacklist: ipBlacklist,
        quota,
        concurrency_limit: concurrencyLimit,
        expires_at: input.expiresAt !== undefined ? parseExpiry(input.expiresAt) : (current?.expires_at ?? null),
    };
}

function asIsoDate(value: Date | string | null | undefined): string | null {
    if (value == null) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function toDto(key: SgUserKey, secret: string): Promise<UserKeyDto> {
    const decrypted = key.encrypted_value
        ? await userKeyUtil.decryptKey(key.encrypted_value, secret)
        : null;
    return {
        id: Number(key.id),
        value: decrypted ?? key.value ?? "",
        groupId: key.group_id == null ? null : Number(key.group_id),
        status: key.status,
        name: key.name ?? "",
        modelWhitelistEnabled: Boolean(key.model_whitelist_enabled),
        modelWhitelist: [...(key.model_whitelist ?? [])],
        ipRestrictionEnabled: Boolean(key.ip_restriction_enabled),
        ipWhitelist: [...(key.ip_whitelist ?? [])],
        ipBlacklist: [...(key.ip_blacklist ?? [])],
        quota: Number(key.quota ?? 0),
        rateLimit: Number(key.concurrency_limit ?? 0),
        expiresAt: asIsoDate(key.expires_at),
    };
}

async function persistNewKey(
    userId: number,
    input: UserKeyInput = {},
    secret: string,
): Promise<SgUserKey> {
    const parsed = parseInput(input, undefined);
    await validateGroup(parsed.group_id);
    const value = normalizeValue(parsed.value, true);
    const keyHash = await userKeyUtil.hashKey(value);
    const existing = await userKeyManager.findByHash(keyHash);
    if (existing) {
        throw new customError.AppError("A key with this value already exists", 409);
    }
    const encryptedValue = await userKeyUtil.encryptKey(value, secret);
    const data: KeyPersistenceInput = {
        user_id: userId,
        group_id: parsed.group_id,
        name: parsed.name,
        status: parsed.status,
        key_hash: keyHash,
        key_prefix: userKeyUtil.keyPrefix(value),
        encrypted_value: encryptedValue,
        model_whitelist_enabled: parsed.model_whitelist_enabled,
        model_whitelist: parsed.model_whitelist,
        ip_restriction_enabled: parsed.ip_restriction_enabled,
        ip_whitelist: parsed.ip_whitelist,
        ip_blacklist: parsed.ip_blacklist,
        quota: parsed.quota,
        concurrency_limit: parsed.concurrency_limit,
        expires_at: parsed.expires_at,
    };
    const created = await userKeyManager.create(data as unknown as Record<string, unknown>);
    created.value = value;
    return created;
}

/** Prepare a new user's key rows before opening the user transaction. */
async function prepareManyForUser(
    inputs: UserKeyInput[],
    secret: string,
): Promise<Array<Omit<KeyPersistenceInput, "user_id">>> {
    if (!Array.isArray(inputs)) {
        throw new customError.AppError("keys must be an array");
    }

    const prepared: Array<Omit<KeyPersistenceInput, "user_id">> = [];
    const hashes = new Set<string>();
    for (const input of inputs) {
        if (!input || typeof input !== "object") {
            throw new customError.AppError("Invalid key input");
        }
        const parsed = parseInput(input, undefined);
        await validateGroup(parsed.group_id);
        const value = normalizeValue(parsed.value, true);
        const keyHash = await userKeyUtil.hashKey(value);
        if (hashes.has(keyHash)) {
            throw new customError.AppError("Duplicate key value", 409);
        }
        hashes.add(keyHash);
        if (await userKeyManager.findByHash(keyHash)) {
            throw new customError.AppError("A key with this value already exists", 409);
        }
        prepared.push({
            group_id: parsed.group_id,
            name: parsed.name,
            status: parsed.status,
            key_hash: keyHash,
            key_prefix: userKeyUtil.keyPrefix(value),
            encrypted_value: await userKeyUtil.encryptKey(value, secret),
            model_whitelist_enabled: parsed.model_whitelist_enabled,
            model_whitelist: parsed.model_whitelist,
            ip_restriction_enabled: parsed.ip_restriction_enabled,
            ip_whitelist: parsed.ip_whitelist,
            ip_blacklist: parsed.ip_blacklist,
            quota: parsed.quota,
            concurrency_limit: parsed.concurrency_limit,
            expires_at: parsed.expires_at,
        });
    }

    return prepared;
}

/** Insert prevalidated key rows using the caller's transaction handle. */
async function insertPreparedKeys(
    userId: number,
    prepared: Array<Omit<KeyPersistenceInput, "user_id">>,
    transaction: any,
): Promise<void> {
    for (const data of prepared) {
        await transaction("user_key").insert(serializePersistence({ user_id: userId, ...data }));
    }
}

/** Prepare and insert the initial key set for a newly-created user. */
async function createManyForUser(
    userId: number,
    inputs: UserKeyInput[],
    secret: string,
    transaction: any,
): Promise<void> {
    const prepared = await prepareManyForUser(inputs, secret);
    await insertPreparedKeys(userId, prepared, transaction);
}

function serializePersistence(data: KeyPersistenceInput): Record<string, unknown> {
    return {
        ...data,
        model_whitelist_enabled: data.model_whitelist_enabled ? 1 : 0,
        model_whitelist: JSON.stringify(data.model_whitelist),
        ip_restriction_enabled: data.ip_restriction_enabled ? 1 : 0,
        ip_whitelist: JSON.stringify(data.ip_whitelist),
        ip_blacklist: JSON.stringify(data.ip_blacklist),
        quota: billingUtil.toUnits(data.quota),
        expires_at: data.expires_at ? dateUtil.toDatabaseTimestamp(data.expires_at) : null,
    };
}

function serializeUpdate(data: Record<string, unknown>): Record<string, unknown> {
    const update = { ...data };
    for (const field of ["model_whitelist", "ip_whitelist", "ip_blacklist"]) {
        if (Array.isArray(update[field])) update[field] = JSON.stringify(update[field]);
    }
    for (const field of ["quota", "quota_used"]) {
        if (typeof update[field] === "number") update[field] = billingUtil.toUnits(update[field] as number);
    }
    for (const field of ["model_whitelist_enabled", "ip_restriction_enabled"]) {
        if (typeof update[field] === "boolean") update[field] = update[field] ? 1 : 0;
    }
    if (update.expires_at instanceof Date) update.expires_at = dateUtil.toDatabaseTimestamp(update.expires_at);
    return update;
}

async function createForUser(userId: number, input: UserKeyInput = {}, secret: string): Promise<UserKeyDto> {
    const key = await persistNewKey(userId, input, secret);
    return toDto(key, secret);
}


async function getForUser(userId: number, keyId: number, secret: string): Promise<UserKeyDto | null> {
    const key = await userKeyManager.findById(keyId);
    if (!key || Number(key.user_id) !== userId) return null;
    return toDto(key, secret);
}


async function deleteForUser(userId: number, keyId: number): Promise<boolean> {
    const key = await userKeyManager.findById(keyId);
    if (!key || Number(key.user_id) !== userId) return false;
    return userKeyManager.remove(keyId);
}


async function updateForUser(userId: number, keyId: number, input: UserKeyInput, secret: string): Promise<UserKeyDto | null> {
    const key = await userKeyManager.findById(keyId);
    if (!key || Number(key.user_id) !== userId) return null;
    const parsed = parseInput(input, key);
    await validateGroup(parsed.group_id);
    const data: Record<string, unknown> = {
        group_id: parsed.group_id,
        name: parsed.name,
        status: parsed.status,
        model_whitelist_enabled: parsed.model_whitelist_enabled,
        model_whitelist: parsed.model_whitelist,
        ip_restriction_enabled: parsed.ip_restriction_enabled,
        ip_whitelist: parsed.ip_whitelist,
        ip_blacklist: parsed.ip_blacklist,
        quota: parsed.quota,
        concurrency_limit: parsed.concurrency_limit,
        expires_at: parsed.expires_at,
    };
    if (parsed.value !== undefined) {
        const hash = await userKeyUtil.hashKey(parsed.value);
        const duplicate = await userKeyManager.findByHash(hash);
        if (duplicate && Number(duplicate.id) !== keyId) {
            throw new customError.AppError("A key with this value already exists", 409);
        }
        data.key_hash = hash;
        data.key_prefix = userKeyUtil.keyPrefix(parsed.value);
        data.encrypted_value = await userKeyUtil.encryptKey(parsed.value, secret);
    }
    const updated = await userKeyManager.update(keyId, data);
    return updated ? toDto(updated, secret) : null;
}

async function listForUser(userId: number, secret: string): Promise<UserKeyDto[]> {
    const keys = await userKeyManager.listByUser(userId);
    return Promise.all(keys.map(key => toDto(key, secret)));
}

async function replaceForUser(
    userId: number,
    inputs: UserKeyInput[],
    secret: string,
    options: {
        transaction?: any;
        beforeCommit?: (transaction: any) => Promise<void>;
    } = {},
): Promise<UserKeyDto[]> {
    if (!Array.isArray(inputs)) {
        throw new customError.AppError("keys must be an array");
    }
    const existing = await userKeyManager.listByUser(userId);
    const existingById = new Map(existing.map(key => [Number(key.id), key]));
    const existingIds = new Set(existingById.keys());
    const seenIds = new Set<number>();
    const prepared: Array<{
        existingId: number | null;
        data: KeyPersistenceInput | Record<string, unknown>;
        value?: string;
    }> = [];
    const hashes = new Map<string, number | null>();
    for (const input of inputs) {
        if (!input || typeof input !== "object") {
            throw new customError.AppError("Invalid key input");
        }
        let requestedId: number | undefined;
        if (input.id !== undefined) {
            requestedId = Number(input.id);
            if (!Number.isSafeInteger(requestedId) || requestedId <= 0 || seenIds.has(requestedId)) {
                throw new customError.AppError("Invalid or duplicate key id");
            }
            // IDs generated by the frontend for unsaved drafts are valid
            // positive integers but do not exist in the database; they are
            // treated as new rows below.
            seenIds.add(requestedId);
        }
        if (requestedId !== undefined && existingIds.has(requestedId)) {
            const id = requestedId;
            const current = existingById.get(id)!;
            const parsed = parseInput(input, current);
            await validateGroup(parsed.group_id);
            const updateData: Record<string, unknown> = {
                group_id: parsed.group_id,
                name: parsed.name,
                status: parsed.status,
                model_whitelist_enabled: parsed.model_whitelist_enabled,
                model_whitelist: parsed.model_whitelist,
                ip_restriction_enabled: parsed.ip_restriction_enabled,
                ip_whitelist: parsed.ip_whitelist,
                ip_blacklist: parsed.ip_blacklist,
                quota: parsed.quota,
                concurrency_limit: parsed.concurrency_limit,
                expires_at: parsed.expires_at,
            };
            let value: string | undefined;
            if (parsed.value !== undefined) {
                value = parsed.value;
                updateData.key_hash = await userKeyUtil.hashKey(value);
                updateData.key_prefix = userKeyUtil.keyPrefix(value);
                updateData.encrypted_value = await userKeyUtil.encryptKey(value, secret);
            } else {
                updateData.key_hash = current.key_hash;
            }
            const hash = String(updateData.key_hash);
            if (hashes.has(hash)) throw new customError.AppError("Duplicate key value", 409);
            hashes.set(hash, id);
            prepared.push({ existingId: id, data: updateData, value });
        } else {
            // The frontend uses a temporary local id for unsaved keys.  It is
            // not a database identity and must be treated as a new row.
            // A positive id that *does* exist for another user is different:
            // silently treating it as a draft would let a caller smuggle an
            // unrelated key id through the aggregate replacement endpoint.
            if (requestedId !== undefined) {
                const foreignKey = await userKeyManager.findById(requestedId);
                if (foreignKey && Number(foreignKey.user_id) !== userId) {
                    throw new customError.AppError("API key does not belong to this user", 403);
                }
            }
            const parsed = parseInput(input, undefined);
            await validateGroup(parsed.group_id);
            const value = normalizeValue(parsed.value, true);
            const keyHash = await userKeyUtil.hashKey(value);
            if (hashes.has(keyHash)) throw new customError.AppError("Duplicate key value", 409);
            hashes.set(keyHash, null);
            prepared.push({
                existingId: null,
                value,
                data: {
                    user_id: userId,
                    group_id: parsed.group_id,
                    name: parsed.name,
                    status: parsed.status,
                    key_hash: keyHash,
                    key_prefix: userKeyUtil.keyPrefix(value),
                    encrypted_value: await userKeyUtil.encryptKey(value, secret),
                    model_whitelist_enabled: parsed.model_whitelist_enabled,
                    model_whitelist: parsed.model_whitelist,
                    ip_restriction_enabled: parsed.ip_restriction_enabled,
                    ip_whitelist: parsed.ip_whitelist,
                    ip_blacklist: parsed.ip_blacklist,
                    quota: parsed.quota,
                    concurrency_limit: parsed.concurrency_limit,
                    expires_at: parsed.expires_at,
                } satisfies KeyPersistenceInput,
            });
        }
    }

    // Validate global uniqueness against the final replacement set.  Looking
    // only at the current row would incorrectly reject an atomic swap (A → B,
    // B → A); rows that are retained in this replacement are allowed to move
    // to each other's former hash, while rows omitted from the payload are
    // deleted before new values are inserted.
    const keepIds = new Set(
        prepared
            .map(item => item.existingId)
            .filter((id): id is number => id !== null),
    );
    for (const [hash] of hashes) {
        const duplicate = await userKeyManager.findByHash(hash);
        if (!duplicate) continue;
        const duplicateId = Number(duplicate.id);
        // Rows belonging to another user remain globally conflicting.  A
        // same-user row that is omitted from this replacement is deleted at
        // the start of `persist`, so allowing it here is what makes replacing
        // an old key with a new temporary frontend id work.  Retained rows are
        // also safe because their hashes are moved through pending values
        // before the final updates (which enables A <-> B swaps).
        if (Number(duplicate.user_id) !== userId) {
            throw new customError.AppError("A key with this value already exists", 409);
        }
    }

    const knex = ormService.getKnex();
    const persist = async (db: any): Promise<void> => {
        const deleteQuery = db("user_key").where("user_id", userId);
        if (keepIds.size > 0) {
            await deleteQuery.whereNotIn("id", [...keepIds]).delete();
        } else {
            await deleteQuery.delete();
        }

        // Clear existing hashes first so an atomic replacement can swap two
        // key values without tripping the unique index mid-transaction.
        for (const item of prepared) {
            if (item.existingId === null) continue;
            await db("user_key").where({ id: item.existingId, user_id: userId }).update({
                key_hash: `__pending__${userId}_${item.existingId}_${Date.now()}_${Math.random()}`,
            });
        }
        for (const item of prepared) {
            if (item.existingId === null) {
                await db("user_key").insert(serializePersistence(item.data as KeyPersistenceInput));
            } else {
                await db("user_key")
                    .where({ id: item.existingId, user_id: userId })
                    .update(serializeUpdate(item.data as Record<string, unknown>));
            }
        }
    };

    const commit = async (db: any): Promise<void> => {
        await persist(db);
        await options.beforeCommit?.(db);
    };

    if (options.transaction) {
        await commit(options.transaction);
    } else {
        await knex.transaction(commit);
    }
    return listForUser(userId, secret);
}

export default {
    toDto,
    createForUser,
    getForUser,
    deleteForUser,
    updateForUser,
    listForUser,
    replaceForUser,
    prepareManyForUser,
    insertPreparedKeys,
    persistNewKey,
    createManyForUser,
};
