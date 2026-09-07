import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
    auth: {
        isAuthenticated: false,
        userType: '',
        validateToken: vi.fn(),
    },
    users: { ensureLoaded: vi.fn() },
    groups: { ensureLoaded: vi.fn() },
    vendors: { ensureLoaded: vi.fn() },
    models: { ensureLoaded: vi.fn() },
}));

vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }));
vi.mock('@/stores/users', () => ({ default: mocks.users }));
vi.mock('@/stores/groups', () => ({ default: mocks.groups }));
vi.mock('@/stores/vendors', () => ({ default: mocks.vendors }));
vi.mock('@/stores/models', () => ({ default: mocks.models }));
vi.mock('./AppHeader.vue', () => ({ default: defineComponent({ template: '<header />' }) }));
vi.mock('./AppSidebar.vue', () => ({ default: defineComponent({ template: '<aside />' }) }));

import AppLayout from './AppLayout.vue';

const RouterViewStub = defineComponent({ template: '<main><slot /></main>' });
const global = {
    stubs: { RouterView: RouterViewStub },
};

describe('AppLayout resource preload', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.auth.isAuthenticated = false;
        mocks.auth.userType = '';
        mocks.auth.validateToken.mockResolvedValue({ success: true });
        mocks.users.ensureLoaded.mockResolvedValue(undefined);
        mocks.groups.ensureLoaded.mockResolvedValue(undefined);
        mocks.vendors.ensureLoaded.mockResolvedValue(undefined);
        mocks.models.ensureLoaded.mockResolvedValue(undefined);
    });

    it('does not preload protected resources for an unauthenticated session', async () => {
        mount(AppLayout, { global });
        await nextTick();

        expect(mocks.auth.validateToken).not.toHaveBeenCalled();
        expect(mocks.users.ensureLoaded).not.toHaveBeenCalled();
        expect(mocks.groups.ensureLoaded).not.toHaveBeenCalled();
    });

    it('validates an authenticated session without a known user type before preloading', async () => {
        mocks.auth.isAuthenticated = true;
        mocks.auth.userType = '';

        mount(AppLayout, { global });
        await nextTick();
        await Promise.resolve();

        expect(mocks.auth.validateToken).toHaveBeenCalledOnce();
        expect(mocks.users.ensureLoaded).toHaveBeenCalledOnce();
        expect(mocks.groups.ensureLoaded).toHaveBeenCalledOnce();
        expect(mocks.vendors.ensureLoaded).toHaveBeenCalledOnce();
        expect(mocks.models.ensureLoaded).toHaveBeenCalledOnce();
    });

    it('stops before resource preload when token validation fails', async () => {
        mocks.auth.isAuthenticated = true;
        mocks.auth.validateToken.mockResolvedValue({ success: false });

        mount(AppLayout, { global });
        await nextTick();
        await Promise.resolve();

        expect(mocks.auth.validateToken).toHaveBeenCalledOnce();
        expect(mocks.users.ensureLoaded).not.toHaveBeenCalled();
        expect(mocks.models.ensureLoaded).not.toHaveBeenCalled();
    });
});
