import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
    push: vi.fn(),
    logout: vi.fn(),
    toggleTheme: vi.fn(),
    enableDeveloperMode: vi.fn(),
    messageSuccess: vi.fn(),
    authStore: { userType: 'admin' as string | null },
    themeStore: { isDark: false, toggleTheme: vi.fn() },
    appStore: { isDeveloperMode: false, enableDeveloperMode: vi.fn() },
}));

vi.mock('vue-router', () => ({
    useRouter: () => ({ push: mocks.push }),
}));
vi.mock('@/stores/auth', () => ({
    useAuthStore: () => ({
        userType: mocks.authStore.userType,
        logout: mocks.logout,
    }),
}));
vi.mock('@/stores/theme', () => ({
    useThemeStore: () => ({
        isDark: mocks.themeStore.isDark,
        toggleTheme: mocks.themeStore.toggleTheme,
    }),
}));
vi.mock('@/stores/app', () => ({
    useAppStore: () => ({
        isDeveloperMode: mocks.appStore.isDeveloperMode,
        enableDeveloperMode: mocks.appStore.enableDeveloperMode,
    }),
}));
vi.mock('ant-design-vue/es', () => ({
    message: { success: mocks.messageSuccess },
}));

import AppHeader from './AppHeader.vue';

/* eslint-disable vue/one-component-per-file -- test-only Ant Design stubs. */
const ButtonStub = defineComponent({
    inheritAttrs: false,
    emits: ['click'],
    template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
});

const DropdownStub = defineComponent({
    template: '<div class="dropdown-stub"><slot /><slot name="overlay" /></div>',
});

const MenuStub = defineComponent({
    template: '<div class="menu-stub"><slot /></div>',
});

const MenuItemStub = defineComponent({
    emits: ['click'],
    template: '<button class="menu-item-stub" type="button" @click="$emit(\'click\', $event)"><slot /></button>',
});

const IconStub = defineComponent({ template: '<span class="icon-stub" />' });
/* eslint-enable vue/one-component-per-file */

const global = {
    components: {
        AButton: ButtonStub,
        ADropdown: DropdownStub,
        AMenu: MenuStub,
        AMenuItem: MenuItemStub,
        UserOutlined: IconStub,
        LogoutOutlined: IconStub,
    },
};

describe('AppHeader user interactions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.authStore.userType = 'admin';
        mocks.themeStore.isDark = false;
        mocks.appStore.isDeveloperMode = false;
    });

    it('logs out only through the visible menu action and redirects to login', async () => {
        const wrapper = mount(AppHeader, { global });

        expect(mocks.logout).not.toHaveBeenCalled();
        await wrapper.get('.menu-item-stub').trigger('click');

        expect(mocks.logout).toHaveBeenCalledOnce();
        expect(mocks.push).toHaveBeenCalledWith('/login');
        expect(mocks.messageSuccess).toHaveBeenCalledWith('已退出登录');
    });

    it('toggles the theme and reports the resulting action', async () => {
        const wrapper = mount(AppHeader, { global });

        await wrapper.get('.theme-btn').trigger('click');

        expect(mocks.themeStore.toggleTheme).toHaveBeenCalledOnce();
        expect(mocks.messageSuccess).toHaveBeenCalledWith('已切换为深色模式');
    });

    it('enables developer mode after ten logo clicks in the same window', async () => {
        vi.useFakeTimers();
        try {
            const wrapper = mount(AppHeader, { global });
            const logo = wrapper.get('.logo');

            for (let index = 0; index < 9; index += 1) {
                await logo.trigger('click');
            }
            expect(mocks.appStore.enableDeveloperMode).not.toHaveBeenCalled();

            await logo.trigger('click');

            expect(mocks.appStore.enableDeveloperMode).toHaveBeenCalledOnce();
            expect(mocks.messageSuccess).toHaveBeenCalledWith('已开启开发者模式');
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not expose another developer-mode action after the mode is enabled', async () => {
        mocks.appStore.isDeveloperMode = true;
        const wrapper = mount(AppHeader, { global });

        for (let index = 0; index < 10; index += 1) {
            await wrapper.get('.logo').trigger('click');
        }

        expect(mocks.appStore.enableDeveloperMode).not.toHaveBeenCalled();
    });
});
