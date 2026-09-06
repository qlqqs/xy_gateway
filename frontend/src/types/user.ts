import type { BaseEntity, TableQuery } from './index';

export type UserType = 'normal' | 'admin' | 'root';
export type UserKeyStatus = 'active' | 'disabled';

/** 用户 Key 的领域实体；分组关系随 Key 保存，避免并行数组按下标错位。 */
export interface UserKey {
    id: number;
    value: string;
    groupId: number | null;
    status: UserKeyStatus;
}

/** 用户表单使用的 Key 草稿。 */
export interface UserKeyInput {
    id?: number;
    value: string;
    groupId?: number | null;
    status?: UserKeyStatus;
}

export interface User extends BaseEntity {
    name: string;
    keys: UserKey[];
    type: UserType;
    balance: number; // 后端返回整数微元（1 元 = 1000000 微元），展示时除以 BALANCE_SCALE
    status: 'active' | 'disabled';
}

export interface CreateUserRequest {
    name: string;
    keys?: UserKeyInput[];
    type?: UserType;
}

export interface UpdateUserRequest {
    name?: string;
    keys?: UserKeyInput[];
    status?: 'active' | 'disabled';
}

export interface UserQuery extends TableQuery {
    type?: UserType;
}
