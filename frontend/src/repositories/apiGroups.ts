import request from '@/utils/request';
import type { ListResponse } from '@/types';
import type { GroupDraft, GroupRecord, GroupStatus, InboundProtocol } from '@/types/group';
import apiUtils, { type ApiRecord } from './apiRepositoryUtils';

function normalizeGroup(value: unknown): GroupRecord {
    const raw = apiUtils.assertRecord(value, '后端分组响应格式无效');
    const protocols = apiUtils.toStringArray(raw.inboundProtocols ?? raw.inbound_protocols)
        .filter((protocol): protocol is InboundProtocol => (
            protocol === 'openai_chat' || protocol === 'openai_responses' || protocol === 'anthropic'
        ));
    const status: GroupStatus = raw.status === 'disabled' ? 'disabled' : 'active';
    return {
        id: apiUtils.toPositiveId(raw.id),
        name: apiUtils.toString(raw.name),
        description: apiUtils.toString(raw.description),
        inboundProtocols: protocols,
        customModels: apiUtils.toStringArray(raw.customModels ?? raw.custom_models),
        whitelistEnabled: apiUtils.toBoolean(raw.whitelistEnabled ?? raw.whitelist_enabled),
        rateMultiplier: apiUtils.toNumber(raw.rateMultiplier ?? raw.rate_multiplier, 1),
        status,
        updatedAt: apiUtils.toNullableIsoDate(raw.updatedAt ?? raw.updated_at) ?? '',
        ...(raw.channelCount === undefined ? {} : { channelCount: apiUtils.toNumber(raw.channelCount) }),
    };
}

function serializeDraft(data: GroupDraft | Partial<GroupDraft>): ApiRecord {
    const payload: ApiRecord = {};
    if (data.name !== undefined) payload.name = data.name;
    if (data.description !== undefined) payload.description = data.description;
    if (data.inboundProtocols !== undefined) payload.inboundProtocols = [...data.inboundProtocols];
    if (data.customModels !== undefined) payload.customModels = [...data.customModels];
    if (data.whitelistEnabled !== undefined) payload.whitelistEnabled = data.whitelistEnabled;
    if (data.rateMultiplier !== undefined) payload.rateMultiplier = data.rateMultiplier;
    if (data.status !== undefined) payload.status = data.status;
    return payload;
}

async function list(params: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    status?: GroupStatus;
} = {}): Promise<ListResponse<GroupRecord>> {
    const response = await request.get<unknown>('/group/list.json', { params });
    return apiUtils.toListResponse(response, normalizeGroup);
}

async function get(id: number): Promise<GroupRecord | null> {
    try {
        return normalizeGroup(await request.get<unknown>(`/group/${id}`));
    } catch (error) {
        if (apiUtils.isNotFoundError(error)) return null;
        throw error;
    }
}

async function create(data: GroupDraft): Promise<GroupRecord> {
    return normalizeGroup(await request.post<unknown>('/group/create.json', serializeDraft(data)));
}

async function update(id: number, data: Partial<GroupDraft>): Promise<GroupRecord | null> {
    try {
        return normalizeGroup(await request.put<unknown>(`/group/${id}`, serializeDraft(data)));
    } catch (error) {
        if (apiUtils.isNotFoundError(error)) return null;
        throw error;
    }
}

async function remove(id: number): Promise<boolean> {
    try {
        await request.delete<unknown>(`/group/${id}`);
        return true;
    } catch (error) {
        if (apiUtils.isNotFoundError(error)) return false;
        throw error;
    }
}

export default {
    list,
    get,
    create,
    update,
    remove,
    normalizeGroup,
};
