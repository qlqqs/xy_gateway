import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/types/user';

const mocks = vi.hoisted(() => ({
    users: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), updateKeys: vi.fn(), adjustBalance: vi.fn() },
    groups: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    models: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), batch: vi.fn() },
    vendors: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), batch: vi.fn(), listModels: vi.fn(), batchModels: vi.fn(), previewModels: vi.fn() },
}));

vi.mock('@/repositories/apiUsers', () => ({ default: mocks.users }));
vi.mock('@/repositories/apiGroups', () => ({ default: mocks.groups }));
vi.mock('@/repositories/apiModels', () => ({ default: mocks.models }));
vi.mock('@/repositories/apiVendors', () => ({ default: mocks.vendors }));

const user = (id: number, name = `user-${id}`): User => ({
    id, name, keys: [], type: 'normal', balance: 0, status: 'active',
    created_at: new Date(0), updated_at: new Date(0),
});

describe('资源 stores', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.resetModules();
    });

    it('users ensureLoaded 共享请求、合并分页并在 CRUD 后同步缓存', async () => {
        let release!: (value: { list: User[]; total: number }) => void;
        const firstPage = new Promise<{ list: User[]; total: number }>(resolve => { release = resolve; });
        mocks.users.list.mockReturnValueOnce(firstPage).mockResolvedValueOnce({ list: [user(2)], total: 2 });
        const { default: store } = await import('./users');
        const first = store.ensureLoaded();
        const second = store.ensureLoaded();
        expect(mocks.users.list).toHaveBeenCalledTimes(1);
        release({ list: [user(1)], total: 2 });
        await Promise.all([first, second]);
        expect(mocks.users.list).toHaveBeenCalledTimes(2);
        expect(store.users.map(item => item.id)).toEqual([1, 2]);

        mocks.users.create.mockResolvedValue(user(3));
        await store.create({ name: 'new', type: 'normal', keys: [] });
        expect(store.get(3)?.name).toBe('user-3');
        mocks.users.update.mockResolvedValue(null);
        expect(await store.update(1, { name: 'gone' })).toBeNull();
        expect(store.get(1)).toBeNull();
    });

    it('users refresh 等待在途加载后发起新的快照请求', async () => {
        let release!: (value: { list: never[]; total: number }) => void;
        const pending = new Promise<{ list: never[]; total: number }>(resolve => { release = resolve; });
        mocks.users.list.mockReturnValueOnce(pending).mockResolvedValueOnce({ list: [], total: 0 });
        const { default: store } = await import('./users');

        const loading = store.ensureLoaded();
        const refreshing = store.refresh();
        expect(mocks.users.list).toHaveBeenCalledTimes(1);

        release({ list: [], total: 0 });
        await loading;
        await refreshing;

        expect(mocks.users.list).toHaveBeenCalledTimes(2);
    });

    it('groups refresh 强制读取快照，删除成功才移除缓存', async () => {
        const group = { id: 1, name: 'g', description: '', inboundProtocols: [], customModels: [], whitelistEnabled: false, rateMultiplier: 1, status: 'active' as const, updatedAt: '' };
        mocks.groups.list.mockResolvedValueOnce({ list: [group], total: 1 }).mockResolvedValueOnce({ list: [], total: 0 });
        const { default: store } = await import('./groups');
        await store.ensureLoaded();
        expect(store.get(1)).toEqual(group);
        mocks.groups.remove.mockResolvedValue(false);
        expect(await store.remove(1)).toBe(false);
        expect(store.get(1)).toEqual(group);
        mocks.groups.remove.mockResolvedValue(true);
        expect(await store.remove(1)).toBe(true);
        expect(store.get(1)).toBeNull();
        await store.refresh();
        expect(store.groups.value).toEqual([]);
    });

    it('groups refresh 等待在途加载后发起新的快照请求', async () => {
        let release!: (value: { list: never[]; total: number }) => void;
        const pending = new Promise<{ list: never[]; total: number }>(resolve => { release = resolve; });
        mocks.groups.list.mockReturnValueOnce(pending).mockResolvedValueOnce({ list: [], total: 0 });
        const { default: store } = await import('./groups');

        const loading = store.ensureLoaded();
        const refreshing = store.refresh();
        expect(mocks.groups.list).toHaveBeenCalledTimes(1);

        release({ list: [], total: 0 });
        await loading;
        await refreshing;

        expect(mocks.groups.list).toHaveBeenCalledTimes(2);
    });

    it('groups refresh 不会让旧加载失败阻止新的快照请求', async () => {
        let reject!: (reason: Error) => void;
        const pending = new Promise<{ list: never[]; total: number }>((_, rejectPromise) => {
            reject = rejectPromise;
        });
        mocks.groups.list.mockReturnValueOnce(pending).mockResolvedValueOnce({ list: [], total: 0 });
        const { default: store } = await import('./groups');

        const loading = store.ensureLoaded();
        const loadingResult = expect(loading).rejects.toThrow('旧请求失败');
        const refreshing = store.refresh();
        reject(new Error('旧请求失败'));

        await loadingResult;
        await expect(refreshing).resolves.toBeUndefined();
        expect(mocks.groups.list).toHaveBeenCalledTimes(2);
    });

    it('models 分页合并并同步 batch/remove', async () => {
        const model = (id: number) => ({ id, name: `m${id}`, mapping: { upstreams: [] }, enable: true, prices: null, created_at: new Date(0), updated_at: new Date(0) });
        mocks.models.list.mockResolvedValueOnce({ list: [model(1)], total: 2 }).mockResolvedValueOnce({ list: [model(2)], total: 2 });
        const { default: store } = await import('./models');
        await store.ensureLoaded();
        mocks.models.batch.mockResolvedValue([model(3)]);
        expect((await store.batch([3])).map(item => item.id)).toEqual([3]);
        expect(store.get(3)?.name).toBe('m3');
        mocks.models.remove.mockResolvedValue({ success: true });
        await store.remove(1);
        expect(store.get(1)).toBeNull();
    });

    it('models refresh 等待在途加载后发起新的快照请求', async () => {
        let release!: (value: { list: never[]; total: number }) => void;
        const pending = new Promise<{ list: never[]; total: number }>(resolve => { release = resolve; });
        mocks.models.list.mockReturnValueOnce(pending).mockResolvedValueOnce({ list: [], total: 0 });
        const { default: store } = await import('./models');

        const loading = store.ensureLoaded();
        const refreshing = store.refresh();
        expect(mocks.models.list).toHaveBeenCalledTimes(1);

        release({ list: [], total: 0 });
        await loading;
        await refreshing;

        expect(mocks.models.list).toHaveBeenCalledTimes(2);
    });

    it('vendors 失败的 ensureLoaded 不残留加载状态，后续调用可重试', async () => {
        mocks.vendors.list.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce({ list: [], total: 0 });
        const { default: store } = await import('./vendors');
        await expect(store.ensureLoaded()).rejects.toThrow('temporary');
        await expect(store.ensureLoaded()).resolves.toBeUndefined();
        expect(mocks.vendors.list).toHaveBeenCalledTimes(2);
    });

    it('vendors refresh 等待在途加载后发起新的快照请求', async () => {
        let release!: (value: { list: never[]; total: number }) => void;
        const pending = new Promise<{ list: never[]; total: number }>(resolve => { release = resolve; });
        mocks.vendors.list.mockReturnValueOnce(pending).mockResolvedValueOnce({ list: [], total: 0 });
        const { default: store } = await import('./vendors');

        const loading = store.ensureLoaded();
        const refreshing = store.refresh();
        expect(mocks.vendors.list).toHaveBeenCalledTimes(1);

        release({ list: [], total: 0 });
        await loading;
        await refreshing;

        expect(mocks.vendors.list).toHaveBeenCalledTimes(2);
    });
});
