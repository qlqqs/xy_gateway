import request from '@/utils/request';
import type { ListResponse } from '@/types';
import type {
    CreateVendorRequest,
    UpdateVendorRequest,
    Vendor,
    VendorModel,
    VendorQuery,
    VendorUrls,
} from '@/types/vendor';
import apiUtils, { type ApiRecord } from './apiRepositoryUtils';


function toStrictPositiveId(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value > 0 ? value : null;
    }
    if (typeof value !== 'string' || !/^\+?\d+$/.test(value.trim())) {
        return null;
    }
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}


function normalizeGroupIds(value: unknown, fallback: number | null = null): number[] {
    if (!Array.isArray(value)) return fallback === null ? [] : [fallback];
    const normalized = [...new Set(value
        .map(toStrictPositiveId)
        .filter((groupId): groupId is number => groupId !== null))];
    // 显式空数组表示未分组；损坏的非空数组则保留正式标量投影，避免把已分组
    // 供应商错误放宽到未分组池。该规则与后端 SgVendor 保持一致。
    return normalized.length > 0 || value.length === 0
        ? normalized
        : (fallback === null ? [] : [fallback]);
}


function normalizeVendorModel(value: unknown): VendorModel {
    const raw = apiUtils.assertRecord(value, '后端供应商模型响应格式无效');
    return {
        id: apiUtils.toPositiveId(raw.id),
        vendor_id: apiUtils.toPositiveId(raw.vendor_id),
        model_id: apiUtils.toString(raw.model_id),
        allowed_formats: Array.isArray(raw.allowed_formats)
            ? apiUtils.toStringArray(raw.allowed_formats)
            : null,
        created_at: apiUtils.toString(raw.created_at),
        updated_at: apiUtils.toString(raw.updated_at),
    };
}

function normalizeVendor(value: unknown): Vendor {
    const raw = apiUtils.assertRecord(value, '后端供应商响应格式无效');
    const urls: VendorUrls = apiUtils.isRecord(raw.urls)
        ? Object.fromEntries(Object.entries(raw.urls).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
        ))
        : {};
    const config = apiUtils.isRecord(raw.config) ? { ...raw.config } : {};
    const rawGroupIds = config.group_ids !== undefined ? config.group_ids : config.groupIds;
    const legacyGroupId = toStrictPositiveId(
        config.group_id !== undefined ? config.group_id : config.groupId,
    );
    const groupIds = Array.isArray(rawGroupIds)
        ? normalizeGroupIds(rawGroupIds, legacyGroupId)
        : (legacyGroupId === null ? [] : [legacyGroupId]);
    const groupId = groupIds[0] ?? null;
    delete config.groupIds;
    delete config.groupId;
    config.group_ids = groupIds;
    return {
        id: apiUtils.toPositiveId(raw.id),
        type: apiUtils.toString(raw.type) as Vendor['type'],
        name: apiUtils.toString(raw.name),
        token: apiUtils.toString(raw.token),
        urls,
        config: {
            ...config,
            ...(config.available_models === undefined
                ? {}
                : { available_models: apiUtils.toStringArray(config.available_models) }),
            group_id: groupId,
            group_ids: groupIds,
            ...(config.status === 'disabled' ? { status: 'disabled' as const } : { status: 'active' as const }),
            ...(config.concurrency === undefined ? {} : { concurrency: apiUtils.toNumber(config.concurrency, 1) }),
            ...(config.priority === undefined ? {} : { priority: apiUtils.toNumber(config.priority, 1) }),
            ...(config.load_factor === undefined || config.load_factor === null
                ? { load_factor: config.load_factor ?? null }
                : { load_factor: apiUtils.toNumber(config.load_factor, 1) }),
        },
        model_count: apiUtils.toNumber(raw.model_count),
        created_at: apiUtils.toDate(raw.created_at),
        updated_at: apiUtils.toDate(raw.updated_at),
    };
}

function serializeVendor(data: CreateVendorRequest | UpdateVendorRequest, isUpdate = false): ApiRecord {
    const payload: ApiRecord = {};
    if (data.type !== undefined) payload.type = data.type;
    if (data.name !== undefined) payload.name = data.name;
    if (data.token !== undefined) payload.token = data.token;
    if (data.urls !== undefined) payload.urls = { ...data.urls };
    if (data.config !== undefined) {
        const config: ApiRecord = { ...data.config };
        // group_ids 是传输层规范字段；边界仍兼容 UI 旧对象中的 camelCase，
        // 并同步首个 ID 到旧标量字段。
        const rawGroupIds = config.group_ids !== undefined ? config.group_ids : config.groupIds;
        const rawGroupId = config.group_id !== undefined ? config.group_id : config.groupId;
        const legacyGroupId = toStrictPositiveId(rawGroupId);
        if (Array.isArray(rawGroupIds)) {
            const groupIds = normalizeGroupIds(rawGroupIds, legacyGroupId);
            if (groupIds.length > 0 || rawGroupIds.length === 0 || legacyGroupId !== null) {
                config.group_ids = groupIds;
                config.group_id = groupIds[0] ?? null;
            } else {
                delete config.group_ids;
                delete config.group_id;
            }
        } else if (rawGroupIds !== undefined) {
            // 只有显式空数组表示解绑。损坏的列表值优先回退旧标量；两者都无效时
            // 省略关系字段，避免更新请求意外清空现有分组。
            if (legacyGroupId !== null) {
                config.group_ids = [legacyGroupId];
                config.group_id = legacyGroupId;
            } else {
                delete config.group_ids;
                delete config.group_id;
            }
        } else {
            if (rawGroupId !== undefined) {
                if (legacyGroupId !== null) {
                    config.group_id = legacyGroupId;
                    config.group_ids = [legacyGroupId];
                } else if (isUpdate) {
                    delete config.group_id;
                    delete config.group_ids;
                } else {
                    config.group_id = null;
                    config.group_ids = [];
                }
            }
        }
        delete config.groupIds;
        delete config.groupId;
        payload.config = config;
    }
    return payload;
}

async function list(query: VendorQuery = {}): Promise<ListResponse<Vendor>> {
    const response = await request.get<unknown>('/vendor/list.json', { params: query });
    return apiUtils.toListResponse(response, normalizeVendor);
}

async function get(id: number): Promise<Vendor | null> {
    try {
        return normalizeVendor(await request.get<unknown>(`/vendor/${id}`));
    } catch (error) {
        if (apiUtils.isNotFoundError(error)) return null;
        throw error;
    }
}

async function create(data: CreateVendorRequest): Promise<Vendor> {
    return normalizeVendor(await request.post<unknown>('/vendor/create.json', serializeVendor(data)));
}

async function update(id: number, data: UpdateVendorRequest): Promise<Vendor> {
    return normalizeVendor(await request.put<unknown>(`/vendor/${id}`, serializeVendor(data, true)));
}

async function remove(id: number): Promise<{ success: boolean }> {
    try {
        await request.delete<unknown>(`/vendor/${id}`);
        return { success: true };
    } catch (error) {
        if (apiUtils.isNotFoundError(error)) return { success: false };
        throw error;
    }
}

async function batch(ids: number[]): Promise<Vendor[]> {
    if (ids.length === 0) return [];
    const response = await request.post<unknown>('/vendor/batch.json', { ids });
    if (!Array.isArray(response)) throw new Error('后端供应商批量响应格式无效');
    return response.map(normalizeVendor);
}

async function listModels(vendorId: number): Promise<VendorModel[]> {
    const response = await request.get<unknown>(`/vendor/${vendorId}/model/list.json`);
    if (!Array.isArray(response)) throw new Error('后端供应商模型列表格式无效');
    return response.map(normalizeVendorModel);
}

async function batchModels(ids: number[]): Promise<VendorModel[]> {
    if (ids.length === 0) return [];
    const response = await request.post<unknown>('/vendor-model/batch.json', { ids });
    if (!Array.isArray(response)) throw new Error('后端供应商模型批量响应格式无效');
    return response.map(normalizeVendorModel);
}

async function previewModels(data: Pick<CreateVendorRequest, 'type' | 'token' | 'urls' | 'config'>): Promise<{ models: string[] }> {
    const response = apiUtils.assertRecord(await request.post<unknown>('/vendor/models/fetch.json', serializeVendor(data)));
    return { models: apiUtils.toStringArray(response.models) };
}

export default {
    list,
    get,
    create,
    update,
    remove,
    batch,
    listModels,
    batchModels,
    previewModels,
    normalizeVendor,
};
