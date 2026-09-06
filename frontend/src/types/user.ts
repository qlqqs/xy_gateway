import type { BaseEntity, TableQuery } from './index';

export type UserType = 'normal' | 'admin' | 'root';
export type UserKeyStatus = 'active' | 'disabled';

/** 用户 Key 的领域实体；分组关系随 Key 保存，避免并行数组按下标错位。 */
export interface UserKey {
    id: number;
    value: string;
    groupId: number | null;
    status: UserKeyStatus;
    /** Key 在管理页面显示的名称。 */
    name: string;
    /** 是否只允许访问下方列出的模型。 */
    modelWhitelistEnabled: boolean;
    modelWhitelist: string[];
    /** 是否启用 IP 白名单/黑名单限制。 */
    ipRestrictionEnabled: boolean;
    ipWhitelist: string[];
    ipBlacklist: string[];
    /** 可消费的最大金额，0 表示不限制。 */
    quota: number;
    /** 最大并发请求数，0 表示不限制。 */
    rateLimit: number;
    /** 本地 ISO 时间字符串；null 表示永不过期。 */
    expiresAt: string | null;
}

/** 用户表单使用的 Key 草稿。 */
export interface UserKeyInput {
    id?: number;
    value: string;
    groupId?: number | null;
    status?: UserKeyStatus;
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

/** 单独编辑 Key 时允许更新的字段。 */
export interface UpdateUserKeyRequest {
    value?: string;
    groupId?: number | null;
    status?: UserKeyStatus;
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
