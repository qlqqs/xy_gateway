import request from '@/utils/request';
import type { ListResponse } from '@/types';
import type {
    CreateVendorRequest,
    UpdateVendorRequest,
    Vendor,
    VendorConfig,
    VendorModel,
    VendorQuery,
    VendorUrls,
} from '@/types/vendor';
import apiUtils, { type ApiRecord } from './apiRepositoryUtils';

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
            ...(config.group_id === null || config.group_id === undefined
                ? { group_id: null }
                : { group_id: apiUtils.toPositiveId(config.group_id) || null }),
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

function serializeVendor(data: CreateVendorRequest | UpdateVendorRequest): ApiRecord {
    const payload: ApiRecord = {};
    if (data.type !== undefined) payload.type = data.type;
    if (data.name !== undefined) payload.name = data.name;
    if (data.token !== undefined) payload.token = data.token;
    if (data.urls !== undefined) payload.urls = { ...data.urls };
    if (data.config !== undefined) payload.config = { ...data.config };
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
    const vendor = normalizeVendor(await request.post<unknown>('/vendor/create.json', serializeVendor(data)));
    const syncedModels = await syncConfiguredModels(vendor.id, data.config);
    if (syncedModels) {
        vendor.model_count = syncedModels.length;
    }
    return vendor;
}

async function update(id: number, data: UpdateVendorRequest): Promise<Vendor> {
    const vendor = normalizeVendor(await request.put<unknown>(`/vendor/${id}`, serializeVendor(data)));
    const syncedModels = await syncConfiguredModels(vendor.id, data.config);
    if (syncedModels) {
        vendor.model_count = syncedModels.length;
    }
    return vendor;
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

/**
 * 将供应商表单中的可用模型同步到规范化 vendor_model 表。
 *
 * 使用增量 add/delete 而不是后端的全量 sync 接口，保留仍存在模型的
 * 稳定记录 ID，避免编辑供应商时无意义地清空模型上游映射。
 */
async function syncConfiguredModels(vendorId: number, config?: VendorConfig): Promise<VendorModel[] | null> {
    if (!config || config.available_models === undefined) return null;

    const desired = [...new Set(config.available_models
        .map(model => model.trim())
        .filter(Boolean))];
    const existing = await listModels(vendorId);
    const desiredSet = new Set(desired);
    const existingByName = new Map(existing.map(model => [model.model_id, model]));

    // 写操作按顺序执行。本地 Node 默认使用 SQLite，供应商表单保存时并发
    // DELETE/INSERT 可能争用唯一写锁并导致请求失败。
    for (const model of existing.filter(item => !desiredSet.has(item.model_id))) {
        await request.delete<unknown>(`/vendor/${vendorId}/model/${model.id}`);
    }

    for (const modelId of desired.filter(item => !existingByName.has(item))) {
        await request.post<unknown>(`/vendor/${vendorId}/model/add.json`, { model_id: modelId });
    }

    return listModels(vendorId);
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
