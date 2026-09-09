import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    post: vi.fn(),
}));

vi.mock('../utils/request', () => ({
    default: { post: mocks.post },
}));

import { testVendor } from './vendor';

describe('vendor API', () => {
    it('默认启用供应商协议自动转换', async () => {
        mocks.post.mockResolvedValueOnce({ success: true });

        await testVendor(7, 'anthropic', 'claude-sonnet');

        expect(mocks.post).toHaveBeenCalledWith('/vendor/7/test.json', {
            format: 'anthropic',
            model: 'claude-sonnet',
            auto_convert: true,
        });
    });
});
