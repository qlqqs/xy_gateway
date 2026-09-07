import request from '@/utils/request';
import type { ListResponse } from '@/types';
import type { CreateModelRequest, Model, ModelQuery, UpdateModelRequest } from '@/types/model';
import apiUtils, { type ApiRecord } from './apiRepositoryUtils';

function normalizeModel(value: unknown): Model {
    const raw = apiUtils.assertRecord(value, '后端模型响应格式无效');
    const rawMapping = apiUtils.isRecord(raw.mapping) ? raw.mapping : {};
    const rawUpstreams = Array.isArray(rawMapping.upstreams) ? rawMapping.upstreams : [];
    return {
        id: apiUtils.toPositiveId(raw.id),
        name: apiUtils.toString(raw.name),
        mapping: {
            upstreams: rawUpstreams
                .filter(apiUtils.isRecord)
                .map(upstream => {
                    const vendorModelId = apiUtils.toPositiveId(upstream.vendor_model_id);
                    return {
                        vendor_id: apiUtils.toPositiveId(upstream.vendor_id),
                        ...(vendorModelId > 0 ? { vendor_model_id: vendorModelId } : {}),
                        enabled: apiUtils.toBoolean(upstream.enabled, true),
                    };
                }),
        },
        enable: apiUtils.toBoolean(raw.enable, true),
        prices: apiUtils.isRecord(raw.prices) ? { ...raw.prices } as Model['prices'] : null,
        created_at: apiUtils.toDate(raw.created_at),
        updated_at: apiUtils.toDate(raw.updated_at),
    };
}

function serializeModel(data: CreateModelRequest | UpdateModelRequest): ApiRecord {
    return {
        name: data.name,
        enable: data.enable,
        mapping: {
            upstreams: data.mapping.upstreams.map(upstream => ({
                vendor_id: upstream.vendor_id,
                ...(upstream.vendor_model_id === undefined ? {} : { vendor_model_id: upstream.vendor_model_id }),
                enabled: upstream.enabled,
            })),
        },
        prices: data.prices ?? null,
    };
}

async function list(query: ModelQuery = {}): Promise<ListResponse<Model>> {
    const response = await request.get<unknown>('/model/list.json', { params: query });
    return apiUtils.toListResponse(response, normalizeModel);
}

async function get(id: number): Promise<Model | null> {
    try {
        return normalizeModel(await request.get<unknown>(`/model/${id}`));
    } catch (error) {
        if (apiUtils.isNotFoundError(error)) return null;
        throw error;
    }
}

async function create(data: CreateModelRequest): Promise<Model> {
    return normalizeModel(await request.post<unknown>('/model/create.json', serializeModel(data)));
}

async function update(id: number, data: UpdateModelRequest): Promise<Model> {
    return normalizeModel(await request.put<unknown>(`/model/${id}`, serializeModel(data)));
}

async function remove(id: number): Promise<{ success: boolean }> {
    await request.delete<unknown>(`/model/${id}`);
    return { success: true };
}

async function batch(ids: number[]): Promise<Model[]> {
    if (ids.length === 0) return [];
    const response = await request.post<unknown>('/model/batch.json', { ids });
    if (!Array.isArray(response)) throw new Error('后端模型批量响应格式无效');
    return response.map(normalizeModel);
}

export default {
    list,
    get,
    create,
    update,
    remove,
    batch,
    normalizeModel,
};
