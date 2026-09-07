import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
    push: vi.fn(),
    fetchStatus: vi.fn(),
    toggleSidebar: vi.fn(),
    getConfig: vi.fn(),
    checkUpdate: vi.fn(),
    route: { path: '/dashboard' },
    appStore: {
        sidebarCollapsed: false,
        version: '1.2.3',
        moduleBillingEnabled: true,
        isDeveloperMode: false,
        fetchStatus: vi.fn(),
        toggleSidebar: vi.fn(),
    },
    posthog: {
        opt_in_capturing: vi.fn(),
        opt_out_capturing: vi.fn(),
    },
}));

vi.mock('vue-router', () => ({
    useRouter: () => ({ push: mocks.push }),
    useRoute: () => mocks.route,
}));
vi.mock('@/stores/app', () => ({
    useAppStore: () => mocks.appStore,
}));
vi.mock('@/api/system', () => ({
    checkUpdate: mocks.checkUpdate,
}));
vi.mock('@/api/config', () => ({
    getConfig: mocks.getConfig,
}));

import AppSidebar from './AppSidebar.vue';

/* eslint-disable vue/one-component-per-file -- test-only Ant Design stubs. */
const MenuStub = defineComponent({
    props: {
        selectedKeys: { type: Array, default: () => [] },
        inlineCollapsed: { type: Boolean, default: false },
    },
    emits: ['select'],
    template: '<div class="menu-stub"><slot /></div>',
});

const MenuItemStub = defineComponent({
    template: '<div class="menu-item-stub"><slot /></div>',
});

const ButtonStub = defineComponent({
    inheritAttrs: false,
    emits: ['click'],
    template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
});

const BadgeStub = defineComponent({ template: '<div class="badge-stub"><slot /></div>' });
const ContainerStub = defineComponent({ template: '<div><slot /></div>' });
const IconStub = defineComponent({ template: '<span class="icon-stub" />' });
/* eslint-enable vue/one-component-per-file */

const global = {
    components: {
        AMenu: MenuStub,
        AMenuItem: MenuItemStub,
        AButton: ButtonStub,
        ABadge: BadgeStub,
        DashboardOutlined: IconStub,
        TeamOutlined: IconStub,
        GroupOutlined: IconStub,
        CloudUploadOutlined: IconStub,
        DatabaseOutlined: IconStub,
        FileTextOutlined: IconStub,
        MenuFoldOutlined: IconStub,
        MenuUnfoldOutlined: IconStub,
        DollarOutlined: IconStub,
        CodeOutlined: IconStub,
        SettingOutlined: IconStub,
    },
    stubs: {
        'a-tooltip': ContainerStub,
    },
};

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('AppSidebar user interactions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.route.path = '/dashboard';
        mocks.appStore.sidebarCollapsed = false;
        mocks.appStore.version = '1.2.3';
        mocks.appStore.moduleBillingEnabled = true;
        mocks.appStore.isDeveloperMode = false;
        mocks.appStore.fetchStatus.mockResolvedValue(undefined);
        mocks.getConfig.mockResolvedValue({
            telemetry_disabled: 'false',
            auto_update_enabled: 'true',
        });
        mocks.checkUpdate.mockResolvedValue({
            has_update: false,
            release_url: '',
        });
        window.posthog = mocks.posthog;
    });

    it('maps nested routes to a selected menu key and navigates on selection', async () => {
        mocks.route.path = '/record/42';
        const wrapper = mount(AppSidebar, { global });
        await flushPromises();

        const menu = wrapper.findComponent(MenuStub);
        expect(menu.props('selectedKeys')).toEqual(['/record']);

        await menu.vm.$emit('select', { key: '/model' });
        expect(mocks.push).toHaveBeenCalledWith('/model');
    });

    it('loads status/update information and toggles the sidebar from the footer button', async () => {
        const wrapper = mount(AppSidebar, { global });
        await flushPromises();

        expect(mocks.appStore.fetchStatus).toHaveBeenCalledOnce();
        expect(mocks.getConfig).toHaveBeenCalledOnce();
        expect(mocks.checkUpdate).toHaveBeenCalledWith();

        await wrapper.get('.collapse-btn').trigger('click');
        expect(mocks.appStore.toggleSidebar).toHaveBeenCalledOnce();
    });

    it('only renders billing and developer entries when their feature flags are enabled', () => {
        mocks.appStore.moduleBillingEnabled = false;
        mocks.appStore.isDeveloperMode = false;
        const wrapper = mount(AppSidebar, { global });

        expect(wrapper.text()).not.toContain('余额管理');
        expect(wrapper.text()).not.toContain('开发者');

        mocks.appStore.moduleBillingEnabled = true;
        mocks.appStore.isDeveloperMode = true;
        const enabledWrapper = mount(AppSidebar, { global });
        expect(enabledWrapper.text()).toContain('余额管理');
        expect(enabledWrapper.text()).toContain('开发者');
    });

    it('shows an update link and opts telemetry out when configured', async () => {
        mocks.getConfig.mockResolvedValue({
            telemetry_disabled: 'true',
            auto_update_enabled: 'true',
        });
        mocks.checkUpdate.mockResolvedValue({
            has_update: true,
            release_url: 'https://example.com/release',
        });

        const wrapper = mount(AppSidebar, { global });
        await flushPromises();

        expect(mocks.posthog.opt_out_capturing).toHaveBeenCalledOnce();
        const link = wrapper.get('.version-text');
        expect(link.attributes('href')).toBe('https://example.com/release');
        expect(link.text()).toContain('发现新版本');
    });

    it('does not check updates when auto-update is disabled', async () => {
        mocks.getConfig.mockResolvedValue({
            telemetry_disabled: 'false',
            auto_update_enabled: 'false',
        });

        mount(AppSidebar, { global });
        await flushPromises();

        expect(mocks.checkUpdate).not.toHaveBeenCalled();
    });
});
