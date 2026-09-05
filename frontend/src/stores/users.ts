import { reactive } from 'vue';
import type { ListResult } from '@/types';
import type { CreateUserRequest, UpdateUserRequest, User, UserQuery } from '@/types/user';

const users = reactive<User[]>([
    {
        id: 1,
        name: '演示用户',
        keys: ['demo-key-001', 'demo-key-002'],
        keyGroups: { 'demo-key-001': 1, 'demo-key-002': 1 },
        type: 'normal',
        balance: 128000000,
        status: 'active',
        created_at: new Date('2026-01-12T09:30:00Z'),
        updated_at: new Date('2026-02-08T14:20:00Z'),
    },
    {
        id: 2,
        name: '管理员示例',
        keys: ['admin-key-001'],
        keyGroups: { 'admin-key-001': 1 },
        type: 'admin',
        balance: 0,
        status: 'active',
        created_at: new Date('2026-01-18T10:00:00Z'),
        updated_at: new Date('2026-01-18T10:00:00Z'),
    },
]);

async function list(query: UserQuery = {}): Promise<ListResult<User>> {
    const keyword = query.keyword?.trim().toLowerCase();
    const filtered = users.filter((user) => {
        const matchesKeyword = !keyword || user.name.toLowerCase().includes(keyword);
        const matchesType = !query.type || user.type === query.type;
        return matchesKeyword && matchesType;
    });
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const start = (page - 1) * pageSize;
    return {
        list: filtered.slice(start, start + pageSize),
        total: filtered.length,
    };
}

function get(id: number): User | null {
    return users.find(user => user.id === id) ?? null;
}

function create(data: CreateUserRequest): User {
    const now = new Date();
    const user: User = {
        id: users.reduce((max, item) => Math.max(max, item.id), 0) + 1,
        name: data.name,
        keys: data.keys ?? [],
        keyGroups: data.keyGroups ?? {},
        type: data.type ?? 'normal',
        balance: 0,
        status: 'active',
        created_at: now,
        updated_at: now,
    };
    users.unshift(user);
    return user;
}

function update(id: number, data: UpdateUserRequest): User | null {
    const user = get(id);
    if (!user) return null;
    if (data.name !== undefined) user.name = data.name;
    if (data.keys !== undefined) user.keys = [...data.keys];
    if (data.keyGroups !== undefined) user.keyGroups = { ...data.keyGroups };
    if (data.status !== undefined) user.status = data.status;
    user.updated_at = new Date();
    return user;
}

export default {
    users,
    list,
    get,
    create,
    update,
};
