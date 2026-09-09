import request from '@/utils/request';

export interface AdminKeyStatusResponse {
    exists: boolean;
}

export interface AdminKeyGenerateResponse {
    key: string;
}

export interface AdminKeyRemoveResponse {
    success: boolean;
}

const ADMIN_API_ROOT = '/v1/admin/settings/admin-api-key';

async function getStatus(): Promise<AdminKeyStatusResponse> {
    return request.get(ADMIN_API_ROOT);
}

async function regenerate(): Promise<AdminKeyGenerateResponse> {
    return request.post(`${ADMIN_API_ROOT}/regenerate`);
}

async function remove(): Promise<AdminKeyRemoveResponse> {
    return request.delete(ADMIN_API_ROOT);
}

export default {
    getStatus,
    regenerate,
    remove,
};
