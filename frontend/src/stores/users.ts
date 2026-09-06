import { reactive } from 'vue';
import type { ListResponse } from '@/types';
import type { CreateUserRequest, UpdateUserRequest, User, UserQuery } from '@/types/user';
import mockUsers from '@/repositories/mockUsers';

const users = reactive<User[]>(mockUsers.all());

async function list(query: UserQuery = {}): Promise<ListResponse<User>> {
    const result = await mockUsers.list(query);
    const allUsers = mockUsers.all();
    users.splice(0, users.length, ...allUsers);
    return result;
}

function syncUser(user: User): void {
    const index = users.findIndex(item => item.id === user.id);
    if (index < 0) {
        users.unshift(user);
    } else {
        users.splice(index, 1, user);
    }
}

function get(id: number): User | null {
    const user = mockUsers.get(id);
    if (user) {
        syncUser(user);
    }
    return user;
}

async function create(data: CreateUserRequest): Promise<User> {
    const user = await mockUsers.create(data);
    syncUser(user);
    return user;
}

async function update(id: number, data: UpdateUserRequest): Promise<User | null> {
    const user = await mockUsers.update(id, data);
    if (!user) {
        return null;
    }

    syncUser(user);
    return user;
}

async function adjustBalance(id: number, amount: number): Promise<User | null> {
    const user = await mockUsers.adjustBalance(id, amount);
    if (user) {
        syncUser(user);
    }
    return user;
}

async function clearGroupReferences(groupId: number): Promise<number> {
    const changed = await mockUsers.clearGroupReferences(groupId);
    if (changed > 0) {
        users.splice(0, users.length, ...mockUsers.all());
    }
    return changed;
}

export default { users, list, get, create, update, adjustBalance, clearGroupReferences };
