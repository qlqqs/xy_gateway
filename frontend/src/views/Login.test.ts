import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
    router: {
        currentRoute: { value: { query: {} as Record<string, string> } },
        push: vi.fn(),
    },
    auth: {
        isAuthenticated: false,
        validateToken: vi.fn(),
        login: vi.fn(),
    },
    notifyError: vi.fn(),
    notifySuccess: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRouter: () => mocks.router }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }));
vi.mock('@/utils/platform', () => ({ isTauri: () => false }));
vi.mock('@/config', () => ({ default: { frontendOnly: false } }));
vi.mock('@/utils/requestFeedback', () => ({
    notifyError: mocks.notifyError,
    notifySuccess: mocks.notifySuccess,
}));

import Login from './Login.vue';

/* eslint-disable vue/one-component-per-file -- test-only form/control stubs. */
const FormStub = defineComponent({
    emits: ['finish'],
    template: '<form @submit.prevent="$emit(\'finish\', {})"><slot /></form>',
});

const InputStub = defineComponent({
    props: { value: { type: String, default: '' } },
    emits: ['update:value'],
    template: '<input v-bind="$attrs" :value="value" @input="$emit(\'update:value\', $event.target.value)">',
});

const ButtonStub = defineComponent({
    props: { loading: { type: Boolean, default: false } },
    template: '<button type="submit" v-bind="$attrs" :data-loading="loading ? \'true\' : \'false\'"><slot /></button>',
});

const ContainerStub = defineComponent({
    template: '<div><slot /></div>',
});
/* eslint-enable vue/one-component-per-file */

const global = {
    components: {
        AForm: FormStub,
        AInput: InputStub,
        AButton: ButtonStub,
    },
    stubs: {
        ACard: ContainerStub,
        AAlert: true,
        AFormItem: ContainerStub,
    },
};

function mountLogin() {
    return mount(Login, { global });
}

describe('Login button actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.router.currentRoute.value.query = {};
        mocks.auth.isAuthenticated = false;
        mocks.auth.login.mockResolvedValue({ success: true });
    });

    it('rejects an empty token without calling the auth store', async () => {
        const wrapper = mountLogin();

        await wrapper.get('button[type="submit"]').trigger('click');
        await wrapper.get('form').trigger('submit');

        expect(mocks.auth.login).not.toHaveBeenCalled();
        expect(mocks.notifyError).toHaveBeenCalledWith('请输入 Token');
    });

    it('logs in and follows an explicit redirect after the button click', async () => {
        mocks.router.currentRoute.value.query = { redirect: '/records' };
        const wrapper = mountLogin();

        await wrapper.get('input').setValue('  admin-token  ');
        await wrapper.get('button[type="submit"]').trigger('click');
        await wrapper.get('form').trigger('submit');

        expect(mocks.auth.login).toHaveBeenCalledWith('  admin-token  ');
        expect(mocks.notifySuccess).toHaveBeenCalledWith('登录成功');
        expect(mocks.router.push).toHaveBeenCalledWith('/records');
        expect(wrapper.get('button[type="submit"]').attributes('data-loading')).toBe('false');
    });

    it('shows a server rejection and resets loading state', async () => {
        mocks.auth.login.mockResolvedValue({ success: false, message: 'Token 验证失败' });
        const wrapper = mountLogin();

        await wrapper.get('input').setValue('bad-token');
        await wrapper.get('button[type="submit"]').trigger('click');
        await wrapper.get('form').trigger('submit');

        expect(mocks.notifyError).toHaveBeenCalledWith('Token 验证失败');
        expect(mocks.router.push).not.toHaveBeenCalled();
        expect(wrapper.get('button[type="submit"]').attributes('data-loading')).toBe('false');
    });
});
