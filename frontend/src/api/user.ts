import request from '../utils/request';
import type { User } from '../types/user';

export async function fetchUsersByIds(ids: number[]): Promise<User[]> {
    return request.post('/user/batch.json', { ids });
}

export async function getUser(id: number): Promise<User> {
    return request.get(`/user/${id}`);
}
