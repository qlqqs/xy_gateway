import request from '@/utils/request';
import type { ListResponse } from '@/types';
import type {
    CreateUserRequest,
    UpdateUserKeyRequest,
    UpdateUserRequest,
    User,
    UserKey,
    UserKeyInput,
    UserQuery,
} from '@/types/user';
import apiUtils, { type ApiRecord } from './apiRepositoryUtils';

function normalizeKey(value: unknown): UserKey {
    const raw = apiUtils.assertRecord(value, '后端 Key 响应格式无效');
    const status = raw.status === 'disabled' ? 'disabled' : 'active';
    const rawExpiresAt = raw.expiresAt !== undefined ? raw.expiresAt : raw.expires_at;
    const expiresAt = apiUtils.toNullableIsoDate(rawExpiresAt);
    // camelCase 是当前 canonical 字段，但后端历史响应仍可能使用
    // snake_case；只有字段缺失时才回退，保留显式 null 的解绑语义。
    const rawGroupId = raw.groupId !== undefined ? raw.groupId : raw.group_id;
    return {
        id: apiUtils.toPositiveId(raw.id),
        value: apiUtils.toString(raw.value),
        groupId: rawGroupId === null || rawGroupId === undefined
            ? null
            : (apiUtils.toPositiveId(rawGroupId) || null),
        status,
        name: apiUtils.toString(raw.name, `Key ${apiUtils.toPositiveId(raw.id)}`),
        modelWhitelistEnabled: apiUtils.toBoolean(raw.modelWhitelistEnabled ?? raw.model_whitelist_enabled),
        modelWhitelist: apiUtils.toStringArray(raw.modelWhitelist ?? raw.model_whitelist),
        ipRestrictionEnabled: apiUtils.toBoolean(raw.ipRestrictionEnabled ?? raw.ip_restriction_enabled),
        ipWhitelist: apiUtils.toStringArray(raw.ipWhitelist ?? raw.ip_whitelist),
        ipBlacklist: apiUtils.toStringArray(raw.ipBlacklist ?? raw.ip_blacklist),
        quota: apiUtils.toNumber(raw.quota),
        rateLimit: apiUtils.toNumber(raw.rateLimit ?? raw.concurrency_limit ?? raw.rate_limit),
        expiresAt,
    };
}

function normalizeUser(value: unknown): User {
    const raw = apiUtils.assertRecord(value, '后端用户响应格式无效');
    const type = raw.type === 'admin' || raw.type === 'root' ? raw.type : 'normal';
    const status = raw.status === 'disabled' ? 'disabled' : 'active';
    const keys = Array.isArray(raw.keys) ? raw.keys.map(normalizeKey) : [];
    return {
        id: apiUtils.toPositiveId(raw.id),
        name: apiUtils.toString(raw.name),
        keys,
        type,
        balance: apiUtils.toNumber(raw.balance),
        status,
        created_at: apiUtils.toDate(raw.created_at),
        updated_at: apiUtils.toDate(raw.updated_at),
    };
}

function serializeKey(key: UserKeyInput | UpdateUserKeyRequest): ApiRecord {
    const payload: ApiRecord = {};
    if ('id' in key && key.id !== undefined) payload.id = key.id;
    if (key.value !== undefined) payload.value = key.value;
    if (key.groupId !== undefined) payload.groupId = key.groupId;
    if (key.status !== undefined) payload.status = key.status;
    if (key.name !== undefined) payload.name = key.name;
    if (key.modelWhitelistEnabled !== undefined) payload.modelWhitelistEnabled = key.modelWhitelistEnabled;
    if (key.modelWhitelist !== undefined) payload.modelWhitelist = [...key.modelWhitelist];
    if (key.ipRestrictionEnabled !== undefined) payload.ipRestrictionEnabled = key.ipRestrictionEnabled;
    if (key.ipWhitelist !== undefined) payload.ipWhitelist = [...key.ipWhitelist];
    if (key.ipBlacklist !== undefined) payload.ipBlacklist = [...key.ipBlacklist];
    if (key.quota !== undefined) payload.quota = key.quota;
    if (key.rateLimit !== undefined) payload.rateLimit = key.rateLimit;
    if (key.expiresAt !== undefined) payload.expiresAt = key.expiresAt;
    return payload;
}

function serializeUser(data: CreateUserRequest | UpdateUserRequest): ApiRecord {
    const payload: ApiRecord = {};
    if (data.name !== undefined) payload.name = data.name;
    if ('type' in data && data.type !== undefined) payload.type = data.type;
    if ('status' in data && data.status !== undefined) payload.status = data.status;
    if (data.keys !== undefined) payload.keys = data.keys.map(serializeKey);
    return payload;
}

async function list(query: UserQuery = {}): Promise<ListResponse<User>> {
    const response = await request.get<unknown>('/user/list.json', { params: query });
    return apiUtils.toListResponse(response, normalizeUser);
}

async function get(id: number): Promise<User | null> {
    try {
        return normalizeUser(await request.get<unknown>(`/user/${id}`));
    } catch (error) {
        if (apiUtils.isNotFoundError(error)) return null;
        throw error;
    }
}

async function create(data: CreateUserRequest): Promise<User> {
    return normalizeUser(await request.post<unknown>('/user/create.json', serializeUser(data)));
}

async function update(id: number, data: UpdateUserRequest): Promise<User | null> {
    try {
        return normalizeUser(await request.put<unknown>(`/user/${id}`, serializeUser(data)));
    } catch (error) {
        if (apiUtils.isNotFoundError(error)) return null;
        throw error;
    }
}

async function updateKeys(userId: number, keys: UserKeyInput[]): Promise<User | null> {
    try {
        return normalizeUser(await request.put<unknown>(`/user/${userId}/keys.json`, {
            keys: keys.map(serializeKey),
        }));
    } catch (error) {
        if (apiUtils.isNotFoundError(error)) return null;
        throw error;
    }
}

async function updateKey(
    userId: number,
    keyId: number,
    data: UpdateUserKeyRequest,
): Promise<UserKey | null> {
    const user = await get(userId);
    if (!user) return null;
    const current = user.keys.find(key => key.id === keyId);
    if (!current) return null;
    const nextKeys = user.keys.map(key => key.id === keyId
        ? { ...key, ...data }
        : key);
    const updated = await updateKeys(userId, nextKeys);
    return updated?.keys.find(key => key.id === keyId) ?? null;
}

async function adjustBalance(id: number, amount: number): Promise<User | null> {
    if (!Number.isFinite(amount) || amount === 0) {
        throw new Error('余额变动金额必须不为 0');
    }

    try {
        return normalizeUser(await request.post<unknown>(`/user/${id}/balance/adjust.json`, {
            amount,
            type: amount > 0 ? 'recharge' : 'adjustment',
        }));
    } catch (error) {
        if (apiUtils.isNotFoundError(error)) return null;
        throw error;
    }
}

export default {
    list,
    get,
    create,
    update,
    updateKeys,
    updateKey,
    adjustBalance,
    normalizeUser,
};
