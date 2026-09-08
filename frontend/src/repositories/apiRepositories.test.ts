import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
}));

vi.mock('@/utils/request', () => ({ default: requestMock }));

import apiGroups from './apiGroups';
import apiModels from './apiModels';
import apiUsers from './apiUsers';
import apiVendors from './apiVendors';

describe('API repositories', () => {
    beforeEach(() => vi.resetAllMocks());

    it('归一化用户列表并序列化完整 Key 字段', async () => {
        requestMock.get.mockResolvedValue({
            list: [{
                id: '7',
                name: 'Alice',
                type: 'unknown',
                status: 'disabled',
                balance: '12.5',
                keys: [
                    { id: '3', value: 'secret', group_id: '9', model_whitelist: [' a ', 'a'], expires_at: '2026-01-02T00:00:00Z' },
                    // 显式 camelCase null 不应回退到过期的 snake_case 值。
                    { id: '4', value: 'unbound', groupId: null, group_id: '12' },
                    { id: '5', value: 'camel', groupId: '10' },
                    { id: '6', value: 'no-expiry', expiresAt: null, expires_at: '2027-01-02T00:00:00Z' },
                ],
            }],
            total: '1',
        });
        const result = await apiUsers.list({ page: 2, pageSize: 20, keyword: 'ali' });
        expect(requestMock.get).toHaveBeenCalledWith('/user/list.json', { params: { page: 2, pageSize: 20, keyword: 'ali' } });
        expect(result.total).toBe(1);
        expect(result.list[0]).toMatchObject({ id: 7, type: 'normal', status: 'disabled', balance: 12.5 });
        expect(result.list[0]?.keys[0]).toMatchObject({ id: 3, groupId: 9, modelWhitelist: ['a'], expiresAt: '2026-01-02T00:00:00.000Z' });
        expect(result.list[0]?.keys[1]).toMatchObject({ id: 4, groupId: null });
        expect(result.list[0]?.keys[2]).toMatchObject({ id: 5, groupId: 10 });
        expect(result.list[0]?.keys[3]).toMatchObject({ id: 6, expiresAt: null });

        requestMock.put.mockResolvedValue({ id: 7, name: 'Alice', keys: [] });
        await apiUsers.updateKeys(7, [{ value: 'new-key', groupId: null, modelWhitelist: ['m1'] }]);
        expect(requestMock.put).toHaveBeenCalledWith('/user/7/keys.json', { keys: [{ value: 'new-key', groupId: null, modelWhitelist: ['m1'] }] });
    });

    it('按请求成员类型收窄用户创建和更新字段', async () => {
        requestMock.post.mockResolvedValue({ id: 8, name: 'Bob', type: 'admin', keys: [] });
        await apiUsers.create({
            name: 'Bob',
            type: 'admin',
            keys: [{ id: 6, value: 'key-bob' }],
        });
        expect(requestMock.post).toHaveBeenCalledWith('/user/create.json', {
            name: 'Bob',
            type: 'admin',
            keys: [{ id: 6, value: 'key-bob' }],
        });

        requestMock.put.mockResolvedValue({ id: 8, name: 'Bob', status: 'disabled', keys: [] });
        await apiUsers.update(8, { name: 'Bob', status: 'disabled' });
        expect(requestMock.put).toHaveBeenCalledWith('/user/8', {
            name: 'Bob',
            status: 'disabled',
        });
    });

    it('将 404 转换为 null/false，并透传其他错误', async () => {
        requestMock.get.mockRejectedValueOnce({ response: { status: 404 } });
        requestMock.delete.mockRejectedValueOnce({ status: 404 });
        expect(await apiGroups.get(4)).toBeNull();
        expect(await apiGroups.remove(4)).toBe(false);
        const failure = new Error('network');
        requestMock.get.mockRejectedValueOnce(failure);
        await expect(apiGroups.get(4)).rejects.toBe(failure);
    });

    it('发送分组和模型请求时保留数组字段并规范列表契约', async () => {
        requestMock.post.mockResolvedValueOnce({ id: 2, name: 'G', inbound_protocols: ['openai_chat'], custom_models: ['x'], rate_multiplier: '1.2' });
        await apiGroups.create({ name: 'G', description: '', inboundProtocols: ['openai_chat'], customModels: ['x'], whitelistEnabled: true, rateMultiplier: 1.2, status: 'active' });
        expect(requestMock.post).toHaveBeenCalledWith('/group/create.json', expect.objectContaining({ inboundProtocols: ['openai_chat'], customModels: ['x'], rateMultiplier: 1.2 }));

        requestMock.get.mockResolvedValueOnce({ list: [{ id: '5', name: 'model', mapping: { upstreams: [{ vendor_id: '2', vendor_model_id: '8', enabled: 0 }] }, enable: 0, prices: null }], total: 1 });
        const models = await apiModels.list();
        expect(models.list[0]).toMatchObject({ id: 5, enable: false, mapping: { upstreams: [{ vendor_id: 2, vendor_model_id: 8, enabled: false }] } });
    });

    it('空批量输入不发请求，余额非法输入在请求前拒绝', async () => {
        expect(await apiModels.batch([])).toEqual([]);
        expect(await apiVendors.batch([])).toEqual([]);
        expect(requestMock.post).not.toHaveBeenCalled();
        await expect(apiUsers.adjustBalance(1, 0)).rejects.toThrow('余额变动金额必须不为 0');
        await expect(apiUsers.adjustBalance(1, Number.NaN)).rejects.toThrow('余额变动金额必须不为 0');
    });

    it('供应商创建由后端单次请求聚合模型，并规范供应商模型响应', async () => {
        requestMock.post.mockResolvedValueOnce({
            id: 9,
            type: 'openai',
            name: 'Vendor',
            token: 'redacted',
            urls: { endpoint: 'https://example.test', malformed: 42 },
            config: { available_models: ['m2', 'm1'] },
            model_count: 2,
        });
        requestMock.get.mockResolvedValueOnce([
            { id: '11', vendor_id: '9', model_id: 'm1', allowed_formats: ['chat', 'chat'] },
        ]);
        const vendor = await apiVendors.create({ type: 'openai', name: 'Vendor', token: 'secret', urls: {}, config: { available_models: [' m2 ', 'm1', 'm2'] } });
        expect(requestMock.post).toHaveBeenCalledTimes(1);
        expect(requestMock.post).toHaveBeenCalledWith('/vendor/create.json', expect.objectContaining({ token: 'secret', config: { available_models: [' m2 ', 'm1', 'm2'] } }));
        expect(vendor.urls).toEqual({ endpoint: 'https://example.test' });
        expect(vendor.config.available_models).toEqual(['m2', 'm1']);
        expect(vendor.model_count).toBe(2);
        expect(await apiVendors.listModels(9)).toEqual([{ id: 11, vendor_id: 9, model_id: 'm1', allowed_formats: ['chat'], created_at: '', updated_at: '' }]);
    });

    it('供应商创建失败时直接透传错误且不追加模型请求', async () => {
        const createError = new Error('create failed');
        requestMock.post.mockRejectedValueOnce(createError);

        await expect(apiVendors.create({
            type: 'openai',
            name: 'Vendor',
            token: 'secret',
            config: { available_models: ['m1', 'm2'] },
        })).rejects.toBe(createError);
        expect(requestMock.post).toHaveBeenCalledTimes(1);
        expect(requestMock.get).not.toHaveBeenCalled();
        expect(requestMock.delete).not.toHaveBeenCalled();
    });

    it('供应商更新由后端单次请求聚合模型', async () => {
        requestMock.put.mockResolvedValueOnce({
            id: 9,
            type: 'openai',
            name: 'Vendor',
            token: 'redacted',
            urls: {},
            config: { available_models: ['m3'] },
            model_count: 1,
        });

        const vendor = await apiVendors.update(9, {
            config: { available_models: ['m3'] },
        });

        expect(requestMock.put).toHaveBeenCalledTimes(1);
        expect(requestMock.put).toHaveBeenCalledWith('/vendor/9', {
            config: { available_models: ['m3'] },
        });
        expect(requestMock.post).not.toHaveBeenCalled();
        expect(vendor.config.available_models).toEqual(['m3']);
        expect(vendor.model_count).toBe(1);
    });

    it('规范化供应商多分组并在旧标量更新时同步兼容字段', async () => {
        const normalized = apiVendors.normalizeVendor({
            id: '9',
            type: 'openai',
            name: 'Vendor',
            token: 'secret',
            urls: {},
            config: { group_ids: ['3', 3, '4', 0, 'invalid'], group_id: 99 },
        });
        expect(normalized.config).toMatchObject({ group_id: 3, group_ids: [3, 4] });

        const legacy = apiVendors.normalizeVendor({
            id: '10',
            type: 'openai',
            name: 'Legacy vendor',
            token: 'secret',
            urls: {},
            config: { group_id: '7' },
        });
        expect(legacy.config).toMatchObject({ group_id: 7, group_ids: [7] });

        const corrupted = apiVendors.normalizeVendor({
            id: '11',
            type: 'openai',
            name: 'Corrupted vendor',
            token: 'secret',
            urls: {},
            config: { group_ids: ['invalid', 0], group_id: '12' },
        });
        expect(corrupted.config).toMatchObject({ group_id: 12, group_ids: [12] });

        const explicitlyUngrouped = apiVendors.normalizeVendor({
            id: '12',
            type: 'openai',
            name: 'Ungrouped vendor',
            token: 'secret',
            urls: {},
            config: { group_ids: [], group_id: '13' },
        });
        expect(explicitlyUngrouped.config).toMatchObject({ group_id: null, group_ids: [] });

        const corruptedNullGroupIds = apiVendors.normalizeVendor({
            id: '13',
            type: 'openai',
            name: 'Corrupted group list vendor',
            token: 'secret',
            urls: {},
            config: { group_ids: null, group_id: '12' },
        });
        expect(corruptedNullGroupIds.config).toMatchObject({ group_id: 12, group_ids: [12] });

        requestMock.put.mockResolvedValue({
            id: 9,
            type: 'openai',
            name: 'Vendor',
            token: 'secret',
            urls: {},
            config: { group_ids: [8] },
        });
        await apiVendors.update(9, { config: { group_id: 8 } });
        expect(requestMock.put).toHaveBeenCalledWith('/vendor/9', {
            config: { group_id: 8, group_ids: [8] },
        });
    });

    it('序列化供应商分组时只有显式空数组执行解绑', async () => {
        requestMock.put.mockResolvedValue({
            id: 9,
            type: 'openai',
            name: 'Vendor',
            token: 'secret',
            urls: {},
            config: { group_ids: [8] },
        });

        await apiVendors.update(9, {
            config: { group_ids: null as unknown as number[], group_id: 12 },
        });
        await apiVendors.update(9, {
            config: { group_ids: 'invalid' as unknown as number[], group_id: 13 },
        });
        await apiVendors.update(9, {
            config: { group_ids: ['invalid' as unknown as number], remark: 'keep' },
        });
        await apiVendors.update(9, {
            config: { group_ids: [], group_id: 14 },
        });
        await apiVendors.update(9, {
            config: { group_id: null, remark: 'keep relation' },
        });

        expect(requestMock.put).toHaveBeenNthCalledWith(1, '/vendor/9', {
            config: { group_ids: [12], group_id: 12 },
        });
        expect(requestMock.put).toHaveBeenNthCalledWith(2, '/vendor/9', {
            config: { group_ids: [13], group_id: 13 },
        });
        expect(requestMock.put).toHaveBeenNthCalledWith(3, '/vendor/9', {
            config: { remark: 'keep' },
        });
        expect(requestMock.put).toHaveBeenNthCalledWith(4, '/vendor/9', {
            config: { group_ids: [], group_id: null },
        });
        expect(requestMock.put).toHaveBeenNthCalledWith(5, '/vendor/9', {
            config: { remark: 'keep relation' },
        });
    });
});
