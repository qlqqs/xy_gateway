import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Model } from '@/types/model';
import type { Record as RequestRecord } from '@/types/record';

const mocks = vi.hoisted(() => ({
    listRecords: vi.fn(),
    latestRecords: vi.fn(),
    getRecord: vi.fn(),
    getRecordActivity: vi.fn(),
    getUser: vi.fn(),
    fetchUsersByIds: vi.fn(),
    getModel: vi.fn(),
    fetchModelsByIds: vi.fn(),
    getVendor: vi.fn(),
    fetchVendorsByIds: vi.fn(),
}));

vi.mock('@/api/record', () => ({
    listRecords: mocks.listRecords,
    latestRecords: mocks.latestRecords,
    getRecord: mocks.getRecord,
    getRecordActivity: mocks.getRecordActivity,
}));
vi.mock('@/api/user', () => ({
    getUser: mocks.getUser,
    fetchUsersByIds: mocks.fetchUsersByIds,
}));
vi.mock('@/api/model', () => ({
    getModel: mocks.getModel,
    fetchModelsByIds: mocks.fetchModelsByIds,
}));
vi.mock('@/api/vendor', () => ({
    getVendor: mocks.getVendor,
    fetchVendorsByIds: mocks.fetchVendorsByIds,
}));

import modelsStore from './models';
import userStore from './users';
import vendorsStore from './vendors';
import { useRecordStore } from './record';

function buildRecord(): RequestRecord {
    return {
        id: 1,
        created_at: new Date(0),
        updated_at: new Date(0),
        user_id: null,
        key_id: null,
        group_id: null,
        model_id: 9,
        requested_model: 'historical-model-name',
        request_data: null,
        response_data: null,
        status: 'success',
        failed_code: null,
        client_format: 'openai',
        upstream_format: null,
        usage: null,
        first_token_latency: 0,
        start_at: null,
        end_at: null,
        billing_mode: 'token',
        base_cost: 1,
        rate_multiplier: 1,
        cost: 1,
        settlement_status: 'settled',
        vendor_id: null,
    };
}

function buildCurrentModel(): Model {
    return {
        id: 9,
        name: 'renamed-current-model',
        mapping: { upstreams: [] },
        enable: true,
        prices: null,
        created_at: new Date(0),
        updated_at: new Date(0),
    };
}

describe('record store', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setActivePinia(createPinia());
        modelsStore.models.splice(0, modelsStore.models.length, buildCurrentModel());
        userStore.users.splice(0, userStore.users.length);
        vendorsStore.vendors.splice(0, vendorsStore.vendors.length);
        mocks.fetchUsersByIds.mockResolvedValue([]);
        mocks.fetchModelsByIds.mockResolvedValue([]);
        mocks.fetchVendorsByIds.mockResolvedValue([]);
        mocks.getRecordActivity.mockResolvedValue({ record_id: 1, activities: [] });
    });

    it('优先使用 requested_model 快照，避免模型重命名改变历史记录', async () => {
        const record = buildRecord();
        const store = useRecordStore();

        await store.enrichRecords([record]);

        expect(record.model_name).toBe('historical-model-name');
        expect(mocks.fetchModelsByIds).not.toHaveBeenCalled();

        mocks.getRecord.mockResolvedValue(buildRecord());
        await store.fetchRecordDetail(1);

        expect(store.currentRecord?.model_name).toBe('historical-model-name');
        expect(mocks.getModel).not.toHaveBeenCalled();
    });
});
