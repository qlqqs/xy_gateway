import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
}));

vi.mock('@/utils/request', () => ({
    default: mocks,
}));

import adminKeyApi from './adminKey';

describe('adminKeyApi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses only the external Admin API paths without .json suffixes', async () => {
        mocks.get.mockResolvedValue({ exists: true });
        mocks.post.mockResolvedValue({ key: 'admin-key-test' });
        mocks.delete.mockResolvedValue({ success: true });

        await expect(adminKeyApi.getStatus()).resolves.toEqual({ exists: true });
        await expect(adminKeyApi.regenerate()).resolves.toEqual({ key: 'admin-key-test' });
        await expect(adminKeyApi.remove()).resolves.toEqual({ success: true });

        expect(mocks.get).toHaveBeenCalledWith('/v1/admin/settings/admin-api-key');
        expect(mocks.post).toHaveBeenCalledWith('/v1/admin/settings/admin-api-key/regenerate');
        expect(mocks.delete).toHaveBeenCalledWith('/v1/admin/settings/admin-api-key');
        for (const call of [mocks.get, mocks.post, mocks.delete]) {
            expect(call.mock.calls[0]?.[0]).not.toContain('.json');
        }
    });
});
