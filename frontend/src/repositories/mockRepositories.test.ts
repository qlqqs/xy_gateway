import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupDraft } from '@/types/group';

describe('前端领域 mock repository', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    it('以 UserKey 实体完成去重、分组绑定、重排和持久化', async () => {
        const { default: users } = await import('./mockUsers');
        const created = await users.create({
            name: '  新用户  ',
            keys: [
                { value: ' key-a ', groupId: 2 },
                { value: 'key-a', groupId: 3 },
                { value: 'key-b' },
            ],
        });

        expect(created.name).toBe('新用户');
        expect(created.keys.map(key => key.value)).toEqual(['key-a', 'key-b']);
        expect(created.keys[0]?.groupId).toBe(2);
        const keyAId = created.keys[0]?.id;

        const updated = await users.update(created.id, {
            keys: [
                { value: 'key-b', groupId: 4 },
                { id: keyAId, value: 'key-a', groupId: null },
            ],
        });
        expect(updated?.keys.map(key => key.value)).toEqual(['key-b', 'key-a']);
        expect(updated?.keys[1]?.id).toBe(keyAId);
        expect(updated?.keys[0]?.groupId).toBe(4);

        await users.clearGroupReferences(4);
        expect(users.get(created.id)?.keys[0]?.groupId).toBeNull();

        vi.resetModules();
        const { default: reopenedUsers } = await import('./mockUsers');
        expect(reopenedUsers.get(created.id)?.keys.map(key => key.value)).toEqual(['key-b', 'key-a']);
        expect(reopenedUsers.get(created.id)?.keys[0]?.groupId).toBeNull();
    });

    it('单独更新 Key 后保持限制开关、字段持久化和快照隔离', async () => {
        const { default: users } = await import('./mockUsers');
        const key = users.get(1)?.keys[0];
        expect(key).toBeDefined();
        if (!key) {
            return;
        }

        const expiresAt = '2027-01-02T03:04:00.000Z';
        const updated = await users.updateKey(1, key.id, {
            name: '受限 Key',
            groupId: null,
            modelWhitelistEnabled: false,
            modelWhitelist: ['gpt-4o-mini'],
            ipRestrictionEnabled: false,
            ipWhitelist: ['192.168.1.100'],
            ipBlacklist: ['10.0.0.0/8'],
            quota: 12.5,
            rateLimit: 3,
            expiresAt,
        });

        expect(updated).toMatchObject({
            name: '受限 Key',
            groupId: null,
            modelWhitelistEnabled: false,
            modelWhitelist: ['gpt-4o-mini'],
            ipRestrictionEnabled: false,
            ipWhitelist: ['192.168.1.100'],
            ipBlacklist: ['10.0.0.0/8'],
            quota: 12.5,
            rateLimit: 3,
            expiresAt,
        });

        const snapshot = users.get(1);
        snapshot?.keys[0]?.modelWhitelist.push('不应写回');
        snapshot?.keys[0]?.ipWhitelist.push('127.0.0.1');
        expect(users.get(1)?.keys[0]?.modelWhitelist).toEqual(['gpt-4o-mini']);
        expect(users.get(1)?.keys[0]?.ipWhitelist).toEqual(['192.168.1.100']);

        vi.resetModules();
        const { default: reopenedUsers } = await import('./mockUsers');
        expect(reopenedUsers.get(1)?.keys[0]).toMatchObject({
            modelWhitelistEnabled: false,
            modelWhitelist: ['gpt-4o-mini'],
            ipRestrictionEnabled: false,
            ipWhitelist: ['192.168.1.100'],
            ipBlacklist: ['10.0.0.0/8'],
            quota: 12.5,
            rateLimit: 3,
            expiresAt,
        });
    });

    it('保留供应商调度字段、稳定供应商模型 ID，并完整保存模型映射与计费模式', async () => {
        const { default: vendors } = await import('./mockVendors');
        const vendor = await vendors.create({
            type: 'openai',
            name: '测试通道',
            token: 'token',
            urls: { openai: 'https://example.test/v1' },
            config: {
                supplier_name: '测试供应商',
                channel_code: 'test-channel',
                group_id: 9,
                concurrency: 8,
                load_factor: 2,
                priority: 3,
                status: 'active',
                remark: '保留备注',
                available_models: ['model-a', 'model-b'],
                proxy: null,
            },
        });
        expect(vendor.config.concurrency).toBe(8);
        expect(vendor.config.proxy).toBeNull();

        const firstModels = await vendors.listModels(vendor.id);
        await vendors.update(vendor.id, {
            config: { available_models: ['model-b', 'model-a'] },
        });
        const reorderedModels = await vendors.listModels(vendor.id);
        expect(reorderedModels.map(model => model.id).sort()).toEqual(firstModels.map(model => model.id).sort());

        const { default: models } = await import('./mockModels');
        const model = await models.create({
            name: 'gateway-model',
            enable: true,
            mapping: {
                upstreams: [{ vendor_id: vendor.id, vendor_model_id: firstModels[0]?.id, enabled: true }],
            },
            prices: { billing_mode: 'per_request', per_request: 0.02 },
        });
        expect(model.prices?.billing_mode).toBe('per_request');

        const updated = await models.update(model.id, {
            name: model.name,
            enable: model.enable,
            mapping: { upstreams: model.mapping.upstreams },
            prices: { billing_mode: 'image', image_input: 0.5 },
        });
        expect(updated.prices).toEqual({ billing_mode: 'image', image_input: 0.5 });
        expect(updated.mapping).toEqual(model.mapping);
    });

    it('拒绝余额扣减超过当前余额，并保持原状态不变', async () => {
        const { default: users } = await import('./mockUsers');
        const before = users.get(1);
        const balance = (before?.balance ?? 0) / 1_000_000;
        await expect(users.adjustBalance(1, -balance - 0.01)).rejects.toThrow('不能为负数');
        expect(users.get(1)?.balance).toBe(before?.balance);
    });

    it('按元调整余额并以微元持久化', async () => {
        const { default: users } = await import('./mockUsers');
        const updated = await users.adjustBalance(1, 1.25);

        expect(updated?.balance).toBe(129250000);
        vi.resetModules();
        const { default: reopenedUsers } = await import('./mockUsers');
        expect(reopenedUsers.get(1)?.balance).toBe(129250000);
    });

    it('移除供应商引用后清理模型上游并停用无可用上游的模型', async () => {
        const { default: vendors } = await import('./mockVendors');
        const vendor = await vendors.create({
            type: 'openai',
            name: '待删除通道',
            token: 'token',
            urls: { openai: 'https://example.test/v1' },
            config: { available_models: ['model-a'] },
        });
        const { default: models } = await import('./mockModels');
        const model = await models.create({
            name: '引用待删除通道的模型',
            enable: true,
            mapping: {
                upstreams: [{ vendor_id: vendor.id, enabled: true }],
            },
            prices: null,
        });

        expect(await models.clearVendorReferences(vendor.id)).toBe(1);
        expect(models.get(model.id)).toMatchObject({
            enable: false,
            mapping: { upstreams: [] },
        });
    });

    it('移除供应商模型后清空路由中的失效模型引用', async () => {
        const { default: vendors } = await import('./mockVendors');
        const vendor = await vendors.create({
            type: 'openai',
            name: '模型引用同步通道',
            token: 'token',
            urls: { openai: 'https://example.test/v1' },
            config: { available_models: ['model-a', 'model-b'] },
        });
        const vendorModels = await vendors.listModels(vendor.id);
        const { default: models } = await import('./mockModels');
        const model = await models.create({
            name: '失效上游模型引用',
            enable: true,
            mapping: {
                upstreams: [{ vendor_id: vendor.id, vendor_model_id: vendorModels[0]?.id, enabled: true }],
            },
            prices: null,
        });

        await vendors.update(vendor.id, { config: { available_models: ['model-b'] } });
        const remainingModels = await vendors.listModels(vendor.id);
        expect(await models.clearVendorModelReferences(vendor.id, remainingModels.map(item => item.id))).toBe(1);
        expect(models.get(model.id)?.mapping.upstreams[0]?.vendor_model_id).toBeUndefined();
    });

    it('允许没有上游的模型保持停用状态', async () => {
        const { default: models } = await import('./mockModels');
        const model = await models.create({
            name: '无上游停用模型',
            enable: false,
            mapping: { upstreams: [] },
            prices: null,
        });

        expect(model.enable).toBe(false);
        expect(model.mapping.upstreams).toEqual([]);
    });

    it('规范化分组字段并清理模型白名单引用', async () => {
        const { default: groups } = await import('./mockGroups');
        const draft: GroupDraft = {
            name: '  业务分组  ',
            description: '  仅供测试  ',
            inboundProtocols: ['openai_chat', 'openai_chat'],
            customModels: ['model-a', ' model-a ', ''],
            whitelistEnabled: true,
            rateMultiplier: 1.235,
            status: 'disabled',
        };
        const created = groups.create(draft);

        expect(created).toMatchObject({
            name: '业务分组',
            description: '仅供测试',
            inboundProtocols: ['openai_chat'],
            customModels: ['model-a'],
            rateMultiplier: 1.24,
            status: 'disabled',
        });
        expect(() => groups.create(draft)).toThrow('分组名称不能重复');

        groups.update(created.id, { customModels: ['model-a', 'model-b'] });
        expect(groups.clearModelReferences('model-a')).toBe(1);
        expect(groups.get(created.id)?.customModels).toEqual(['model-b']);

        vi.resetModules();
        const { default: reopenedGroups } = await import('./mockGroups');
        expect(reopenedGroups.get(created.id)?.customModels).toEqual(['model-b']);
    });
});
