import type { ListResponse } from '@/types';
import type {
    CreateUserRequest,
    UpdateUserRequest,
    User,
    UserKey,
    UserKeyInput,
    UserKeyStatus,
    UpdateUserKeyRequest,
    UserQuery,
} from '@/types/user';
import { BALANCE_SCALE } from '@/utils/format';
import storage from './storage';

const STORAGE_KEY = 'xy-gateway:mock-users:v2';

const seedUsers: User[] = [
    {
        id: 1,
        name: '演示用户',
        keys: [
            {
                id: 1_000_001,
                value: 'demo-key-001',
                groupId: 1,
                status: 'active',
                name: '演示 Key 1',
                modelWhitelistEnabled: false,
                modelWhitelist: [],
                ipRestrictionEnabled: false,
                ipWhitelist: [],
                ipBlacklist: [],
                quota: 0,
                rateLimit: 0,
                expiresAt: null,
            },
            {
                id: 1_000_002,
                value: 'demo-key-002',
                groupId: 1,
                status: 'active',
                name: '演示 Key 2',
                modelWhitelistEnabled: false,
                modelWhitelist: [],
                ipRestrictionEnabled: false,
                ipWhitelist: [],
                ipBlacklist: [],
                quota: 0,
                rateLimit: 0,
                expiresAt: null,
            },
        ],
        type: 'normal',
        balance: 128000000,
        status: 'active',
        created_at: new Date('2026-01-12T09:30:00Z'),
        updated_at: new Date('2026-02-08T14:20:00Z'),
    },
    {
        id: 2,
        name: '管理员示例',
        keys: [
            {
                id: 2_000_001,
                value: 'admin-key-001',
                groupId: 1,
                status: 'active',
                name: '管理员 Key',
                modelWhitelistEnabled: false,
                modelWhitelist: [],
                ipRestrictionEnabled: false,
                ipWhitelist: [],
                ipBlacklist: [],
                quota: 0,
                rateLimit: 0,
                expiresAt: null,
            },
        ],
        type: 'admin',
        balance: 0,
        status: 'active',
        created_at: new Date('2026-01-18T10:00:00Z'),
        updated_at: new Date('2026-01-18T10:00:00Z'),
    },
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseDate(value: unknown, fallback: Date): Date {
    const date = new Date(typeof value === 'string' || typeof value === 'number' ? value : NaN);
    return Number.isNaN(date.getTime()) ? fallback : date;
}

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return [...new Set(value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean))];
}

function parseNonNegativeNumber(value: unknown, fallback = 0): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return fallback;
    }
    return value;
}

function parseRateLimit(value: unknown): number {
    const limit = parseNonNegativeNumber(value);
    return Number.isSafeInteger(limit) ? limit : 0;
}

function parseExpiresAt(value: unknown): string | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    if (typeof value !== 'string') {
        return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseKey(value: Record<string, unknown>): UserKey {
    const id = value.id as number;
    const keyValue = (value.value as string).trim();
    const modelWhitelist = normalizeStringList(value.modelWhitelist ?? value.model_whitelist);
    const ipWhitelist = normalizeStringList(value.ipWhitelist ?? value.ip_whitelist);
    const ipBlacklist = normalizeStringList(value.ipBlacklist ?? value.ip_blacklist);
    const modelWhitelistEnabled = typeof value.modelWhitelistEnabled === 'boolean'
        ? value.modelWhitelistEnabled
        : typeof value.model_whitelist_enabled === 'boolean'
            ? value.model_whitelist_enabled
            : modelWhitelist.length > 0;
    const ipRestrictionEnabled = typeof value.ipRestrictionEnabled === 'boolean'
        ? value.ipRestrictionEnabled
        : typeof value.ip_restriction_enabled === 'boolean'
            ? value.ip_restriction_enabled
            : ipWhitelist.length > 0 || ipBlacklist.length > 0;

    return {
        id,
        value: keyValue,
        groupId: value.groupId === null || value.groupId === undefined
            ? null
            : value.groupId as number,
        status: value.status === 'disabled' ? 'disabled' : 'active',
        name: typeof value.name === 'string' && value.name.trim()
            ? value.name.trim()
            : `Key ${id}`,
        modelWhitelistEnabled,
        modelWhitelist,
        ipRestrictionEnabled,
        ipWhitelist,
        ipBlacklist,
        quota: parseNonNegativeNumber(value.quota),
        rateLimit: parseRateLimit(value.rateLimit ?? value.concurrencyLimit ?? value.concurrency_limit ?? value.rate_limit),
        expiresAt: parseExpiresAt(value.expiresAt ?? value.expires_at),
    };
}

function parseUsers(value: unknown): User[] {
    if (!Array.isArray(value)) {
        throw new Error('用户存储格式无效');
    }

    return value.map(item => {
        if (!isRecord(item)
            || typeof item.id !== 'number'
            || !Number.isSafeInteger(item.id)
            || item.id <= 0
            || typeof item.name !== 'string'
            || !item.name.trim()
            || !Array.isArray(item.keys)
            || !item.keys.every(key => isRecord(key)
                && typeof key.id === 'number'
                && Number.isSafeInteger(key.id)
                && key.id > 0
                && typeof key.value === 'string'
                && !!key.value.trim()
                && (key.groupId === null || key.groupId === undefined || typeof key.groupId === 'number')
                && (key.groupId === null || key.groupId === undefined || (Number.isSafeInteger(key.groupId) && key.groupId > 0))
                && (key.status === undefined || key.status === 'active' || key.status === 'disabled'))
            || (item.type !== 'normal' && item.type !== 'admin' && item.type !== 'root')
            || typeof item.balance !== 'number'
            || !Number.isSafeInteger(item.balance)
            || (item.status !== 'active' && item.status !== 'disabled')) {
            throw new Error('用户存储包含无效记录');
        }

        const keyValues = item.keys.map(key => ((key as Record<string, unknown>).value as string).trim());
        const keyIds = item.keys.map(key => (key as Record<string, unknown>).id as number);
        if (new Set(keyValues).size !== keyValues.length || new Set(keyIds).size !== keyIds.length) {
            throw new Error('用户存储包含重复 Key');
        }

        const now = new Date();
        return {
            id: item.id,
            name: item.name.trim(),
            keys: item.keys.map(key => parseKey(key)),
            type: item.type,
            balance: item.balance,
            status: item.status,
            created_at: parseDate(item.created_at, now),
            updated_at: parseDate(item.updated_at, now),
        } satisfies User;
    });
}

let state = storage.load(STORAGE_KEY, seedUsers, parseUsers);

function cloneKey(key: UserKey): UserKey {
    return {
        ...key,
        modelWhitelist: [...key.modelWhitelist],
        ipWhitelist: [...key.ipWhitelist],
        ipBlacklist: [...key.ipBlacklist],
    };
}

function cloneUser(user: User): User {
    return {
        ...user,
        keys: user.keys.map(cloneKey),
        created_at: new Date(user.created_at),
        updated_at: new Date(user.updated_at),
    };
}

function persist(next: User[]): void {
    state = next.map(cloneUser);
    storage.save(STORAGE_KEY, state);
}

function toGroupId(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const groupId = typeof value === 'number' ? value : Number(value);
    return Number.isSafeInteger(groupId) && groupId > 0 ? groupId : null;
}

function toStatus(value: unknown): UserKeyStatus {
    return value === 'disabled' ? 'disabled' : 'active';
}

function normalizeList(value: unknown, fallback: string[] = []): string[] {
    if (value === undefined) {
        return [...fallback];
    }
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new Error('Key 列表字段无效');
    }
    return normalizeStringList(value);
}

function normalizeQuota(value: unknown, fallback: number): number {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error('额度限制必须是非负数');
    }
    return value;
}

function normalizeRateLimit(value: unknown, fallback: number): number {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error('速率限制必须是非负整数');
    }
    return value;
}

function normalizeExpiresAt(value: unknown, fallback: string | null): string | null {
    if (value === undefined) {
        return fallback;
    }
    if (value === null || value === '') {
        return null;
    }
    if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
        throw new Error('密钥有效期格式无效');
    }
    return new Date(value).toISOString();
}

function normalizeKey(
    raw: UserKeyInput | UpdateUserKeyRequest,
    previous: UserKey | undefined,
    id: number,
): UserKey {
    const value = raw.value === undefined ? previous?.value ?? '' : raw.value.trim();
    if (!value) {
        throw new Error('Key 不能为空');
    }

    const nameValue = raw.name === undefined ? previous?.name : raw.name;
    const name = typeof nameValue === 'string' && nameValue.trim()
        ? nameValue.trim()
        : `Key ${id}`;
    const modelWhitelist = normalizeList(raw.modelWhitelist, previous?.modelWhitelist);
    const ipWhitelist = normalizeList(raw.ipWhitelist, previous?.ipWhitelist);
    const ipBlacklist = normalizeList(raw.ipBlacklist, previous?.ipBlacklist);
    const modelWhitelistEnabled = raw.modelWhitelistEnabled === undefined
        ? previous?.modelWhitelistEnabled ?? false
        : Boolean(raw.modelWhitelistEnabled);
    const ipRestrictionEnabled = raw.ipRestrictionEnabled === undefined
        ? previous?.ipRestrictionEnabled ?? (ipWhitelist.length > 0 || ipBlacklist.length > 0)
        : Boolean(raw.ipRestrictionEnabled);

    return {
        id,
        value,
        groupId: raw.groupId === undefined ? previous?.groupId ?? null : toGroupId(raw.groupId),
        status: toStatus(raw.status ?? previous?.status),
        name,
        modelWhitelistEnabled,
        modelWhitelist,
        ipRestrictionEnabled,
        ipWhitelist,
        ipBlacklist,
        quota: normalizeQuota(raw.quota, previous?.quota ?? 0),
        rateLimit: normalizeRateLimit(raw.rateLimit, previous?.rateLimit ?? 0),
        expiresAt: normalizeExpiresAt(raw.expiresAt, previous?.expiresAt ?? null),
    };
}

function normalizeKeys(
    userId: number,
    input: UserKeyInput[] | undefined,
    current: UserKey[] = [],
): UserKey[] {
    const existingById = new Map(current.map(key => [key.id, key]));
    const existingByValue = new Map(current.map(key => [key.value, key]));
    const usedIds = new Set<number>();
    let nextId = Math.max(userId * 1_000_000, ...current.map(key => key.id)) + 1;
    const keys: UserKey[] = [];

    for (const raw of input ?? []) {
        const value = raw.value.trim();
        if (!value || keys.some(key => key.value === value)) {
            continue;
        }

        const previous = (raw.id === undefined ? undefined : existingById.get(raw.id))
            ?? existingByValue.get(value);
        const requestedId = raw.id ?? previous?.id;
        let id = requestedId !== undefined
            && Number.isSafeInteger(requestedId)
            && requestedId > 0
            ? requestedId
            : nextId++;
        while (usedIds.has(id)) {
            id = nextId++;
        }
        usedIds.add(id);
        keys.push(normalizeKey({ ...raw, value }, previous, id));
    }

    return keys;
}

function assertKeysAvailable(keys: UserKey[], userId?: number): void {
    const existing = new Set(
        state
            .filter(user => user.id !== userId)
            .flatMap(user => user.keys.map(key => key.value)),
    );
    const duplicate = keys.find(key => existing.has(key.value));
    if (duplicate) {
        throw new Error(`Key 已被其他用户使用：${duplicate.value}`);
    }
}

function assertUniqueName(name: string, currentId?: number): void {
    if (state.some(user => user.id !== currentId && user.name.toLowerCase() === name.toLowerCase())) {
        throw new Error('用户名不能重复');
    }
}

async function list(query: UserQuery = {}): Promise<ListResponse<User>> {
    const keyword = query.keyword?.trim().toLowerCase();
    const filtered = state.filter(user => (
        (!keyword || user.name.toLowerCase().includes(keyword))
        && (!query.type || user.type === query.type)
    ));
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, query.pageSize ?? 10);
    const start = (page - 1) * pageSize;

    return {
        list: filtered.slice(start, start + pageSize).map(cloneUser),
        total: filtered.length,
    };
}

async function create(data: CreateUserRequest): Promise<User> {
    const name = data.name.trim();
    if (!name) {
        throw new Error('用户名不能为空');
    }

    const id = Math.max(0, ...state.map(item => item.id)) + 1;
    const now = new Date();
    const keys = normalizeKeys(id, data.keys);
    assertUniqueName(name);
    assertKeysAvailable(keys);
    const user: User = {
        id,
        name,
        keys,
        type: data.type ?? 'normal',
        balance: 0,
        status: 'active',
        created_at: now,
        updated_at: now,
    };

    persist([user, ...state]);
    return cloneUser(user);
}

async function update(id: number, data: UpdateUserRequest): Promise<User | null> {
    const current = state.find(user => user.id === id);
    if (!current) {
        return null;
    }

    const name = data.name === undefined ? current.name : data.name.trim();
    if (!name) {
        throw new Error('用户名不能为空');
    }

    assertUniqueName(name, id);

    const keys = data.keys === undefined
        ? current.keys.map(key => ({ ...key }))
        : normalizeKeys(id, data.keys, current.keys);
    assertKeysAvailable(keys, id);
    const next: User = {
        ...current,
        name,
        status: data.status ?? current.status,
        keys,
        updated_at: new Date(),
    };

    persist(state.map(user => user.id === id ? next : user));
    return cloneUser(next);
}

/** 原子替换用户的全部 Key，用于 Key 管理弹窗一次性保存增删改。 */
async function updateKeys(id: number, input: UserKeyInput[]): Promise<User | null> {
    const current = state.find(user => user.id === id);
    if (!current) {
        return null;
    }

    const keys = normalizeKeys(id, input, current.keys);
    assertKeysAvailable(keys, id);
    const next: User = {
        ...current,
        keys,
        updated_at: new Date(),
    };
    persist(state.map(user => user.id === id ? next : user));
    return cloneUser(next);
}

async function updateKey(
    userId: number,
    keyId: number,
    data: UpdateUserKeyRequest,
): Promise<UserKey | null> {
    const current = state.find(user => user.id === userId);
    if (!current) {
        return null;
    }

    const keyIndex = current.keys.findIndex(key => key.id === keyId);
    const previous = current.keys[keyIndex];
    if (!previous || keyIndex < 0) {
        return null;
    }

    const nextKey = normalizeKey(data, previous, previous.id);
    const otherKeys = current.keys.filter(key => key.id !== keyId);
    if (otherKeys.some(key => key.value === nextKey.value)) {
        throw new Error(`用户内不能重复使用 Key：${nextKey.value}`);
    }
    assertKeysAvailable([nextKey], userId);

    const nextUser: User = {
        ...current,
        keys: current.keys.map(key => key.id === keyId ? nextKey : { ...key }),
        updated_at: new Date(),
    };
    persist(state.map(user => user.id === userId ? nextUser : user));
    return cloneKey(nextKey);
}

async function adjustBalance(id: number, amount: number): Promise<User | null> {
    if (!Number.isFinite(amount)) {
        throw new Error('余额变动金额无效');
    }
    const current = state.find(user => user.id === id);
    if (!current) {
        return null;
    }

    const amountUnits = Math.round(amount * BALANCE_SCALE);
    if (!Number.isSafeInteger(amountUnits)) {
        throw new Error('余额变动金额超出范围');
    }
    if (amountUnits === 0) {
        throw new Error('余额变动金额必须大于 0.000001 元');
    }
    if (current.balance + amountUnits < 0) {
        throw new Error('扣减后余额不能为负数');
    }

    const next: User = {
        ...current,
        balance: current.balance + amountUnits,
        updated_at: new Date(),
    };
    persist(state.map(user => user.id === id ? next : user));
    return cloneUser(next);
}

async function clearGroupReferences(groupId: number): Promise<number> {
    let changed = 0;
    const next = state.map(user => {
        if (!user.keys.some(key => key.groupId === groupId)) {
            return user;
        }
        changed += 1;
        return {
            ...user,
            keys: user.keys.map(key => key.groupId === groupId ? { ...key, groupId: null } : { ...key }),
            updated_at: new Date(),
        };
    });
    if (changed > 0) {
        persist(next);
    }
    return changed;
}

function get(id: number): User | null {
    const user = state.find(item => item.id === id);
    return user ? cloneUser(user) : null;
}

function all(): User[] {
    return state.map(cloneUser);
}

export default {
    list,
    create,
    update,
    updateKeys,
    updateKey,
    adjustBalance,
    clearGroupReferences,
    get,
    all,
};
