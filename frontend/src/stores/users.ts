import { reactive } from 'vue';
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
import apiUsers from '@/repositories/apiUsers';

/**
 * 管理端用户缓存。
 *
 * 列表和写操作都通过 API repository 完成；缓存只负责让不同页面之间
 * 共享最近一次的后端快照，不再承担任何业务持久化或本地 mock 行为。
 */
const users = reactive<User[]>([]);
let loaded = false;
let loadingPromise: Promise<void> | null = null;

function syncUser(user: User): void {
    const index = users.findIndex(item => item.id === user.id);
    if (index < 0) {
        users.unshift(user);
    } else {
        users.splice(index, 1, user);
    }
}

function syncUsers(nextUsers: User[], replace = false): void {
    if (replace) {
        users.splice(0, users.length, ...nextUsers);
        return;
    }

    const additions: User[] = [];
    nextUsers.forEach(user => {
        const index = users.findIndex(item => item.id === user.id);
        if (index < 0) {
            additions.push(user);
        } else {
            users.splice(index, 1, user);
        }
    });
    if (additions.length > 0) users.push(...additions);
}

function removeCachedUser(id: number): void {
    const index = users.findIndex(user => user.id === id);
    if (index >= 0) users.splice(index, 1);
}

function isUnfilteredFirstPage(query: UserQuery): boolean {
    return !query.keyword
        && !query.type
        && (query.page === undefined || query.page === 1)
        && (query.pageSize === undefined || query.pageSize >= 100);
}

async function list(query: UserQuery = {}): Promise<ListResponse<User>> {
    const result = await apiUsers.list(query);
    // 表格分页不能驱逐供选择器和仪表盘计数使用的缓存；只有完整的无筛选
    // 预加载才会有意替换整个缓存。
    syncUsers(result.list, isUnfilteredFirstPage(query) && result.list.length >= result.total);
    if (isUnfilteredFirstPage(query) && result.list.length >= result.total) loaded = true;
    return result;
}

/** 保留同步缓存查询，供已经持有列表行的弹窗使用。 */
function get(id: number): User | null {
    return users.find(user => user.id === id) ?? null;
}

/** 调用方需要最新快照时，从后端获取单个用户。 */
async function fetch(id: number): Promise<User | null> {
    const user = await apiUsers.get(id);
    if (user) {
        syncUser(user);
    } else {
        removeCachedUser(id);
    }
    return user;
}

async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
        const pageSize = 100;
        const firstPage = await apiUsers.list({ page: 1, pageSize });
        const allUsers = [...firstPage.list];
        let page = 2;
        while (allUsers.length < firstPage.total) {
            const nextPage = await apiUsers.list({ page, pageSize });
            if (nextPage.list.length === 0) break;
            allUsers.push(...nextPage.list);
            page += 1;
        }
        // API 单页最多返回 100 条；选择器和仪表盘计数需要把所有分页结果
        // 合并到共享缓存中。
        syncUsers(allUsers, true);
        loaded = allUsers.length >= firstPage.total;
    })().finally(() => {
        loadingPromise = null;
    });

    return loadingPromise;
}

/** 强制重新读取后端快照，供跨资源删除/重命名后的缓存校正使用。 */
async function refresh(): Promise<void> {
    if (loadingPromise) {
        try {
            await loadingPromise;
        } catch {
            // refresh 仍需发起自己的强制请求，由该请求的结果决定调用是否成功。
        }
    }
    loaded = false;
    await ensureLoaded();
}

async function create(data: CreateUserRequest): Promise<User> {
    const user = await apiUsers.create(data);
    syncUser(user);
    return user;
}

async function update(id: number, data: UpdateUserRequest): Promise<User | null> {
    const user = await apiUsers.update(id, data);
    if (!user) {
        removeCachedUser(id);
        return null;
    }

    syncUser(user);
    return user;
}

async function updateKeys(userId: number, keys: UserKeyInput[]): Promise<User | null> {
    const user = await apiUsers.updateKeys(userId, keys);
    if (user) {
        syncUser(user);
    } else {
        removeCachedUser(userId);
    }
    return user;
}

async function updateKey(
    userId: number,
    keyId: number,
    data: UpdateUserKeyRequest,
): Promise<UserKey | null> {
    const user = await fetch(userId);
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
    const user = await apiUsers.adjustBalance(id, amount);
    if (user) {
        syncUser(user);
    } else {
        removeCachedUser(id);
    }
    return user;
}

export default {
    users,
    list,
    get,
    fetch,
    ensureLoaded,
    refresh,
    create,
    update,
    updateKeys,
    updateKey,
    adjustBalance,
};
