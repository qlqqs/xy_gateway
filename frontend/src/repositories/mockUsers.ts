import type { ListResponse } from '@/types';
import type {
    CreateUserRequest,
    UpdateUserRequest,
    User,
    UserKey,
    UserKeyInput,
    UserKeyStatus,
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
            { id: 1_000_001, value: 'demo-key-001', groupId: 1, status: 'active' },
            { id: 1_000_002, value: 'demo-key-002', groupId: 1, status: 'active' },
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
            { id: 2_000_001, value: 'admin-key-001', groupId: 1, status: 'active' },
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
                && (key.groupId === null || typeof key.groupId === 'number')
                && (key.groupId === null || (Number.isSafeInteger(key.groupId) && key.groupId > 0))
                && (key.status === 'active' || key.status === 'disabled'))
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
            keys: item.keys.map(key => ({
                id: key.id as number,
                value: (key.value as string).trim(),
                groupId: key.groupId as number | null,
                status: key.status as UserKeyStatus,
            })),
            type: item.type,
            balance: item.balance,
            status: item.status,
            created_at: parseDate(item.created_at, now),
            updated_at: parseDate(item.updated_at, now),
        } satisfies User;
    });
}

let state = storage.load(STORAGE_KEY, seedUsers, parseUsers);

function cloneUser(user: User): User {
    return {
        ...user,
        keys: user.keys.map(key => ({ ...key })),
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

function normalizeKeys(
    userId: number,
    input: UserKeyInput[] | undefined,
    current: UserKey[] = [],
): UserKey[] {
    const existingByValue = new Map(current.map(key => [key.value, key]));
    const usedIds = new Set<number>();
    let nextId = Math.max(userId * 1_000_000, ...current.map(key => key.id)) + 1;
    const keys: UserKey[] = [];

    for (const raw of input ?? []) {
        const value = raw.value.trim();
        if (!value || keys.some(key => key.value === value)) {
            continue;
        }

        const previous = existingByValue.get(value);
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
        keys.push({
            id,
            value,
            groupId: raw.groupId === undefined ? previous?.groupId ?? null : toGroupId(raw.groupId),
            status: toStatus(raw.status ?? previous?.status),
        });
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
    adjustBalance,
    clearGroupReferences,
    get,
    all,
};
