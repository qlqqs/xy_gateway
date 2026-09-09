import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
    adminKeyApi: {
        getStatus: vi.fn(),
        regenerate: vi.fn(),
        remove: vi.fn(),
    },
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    checkUpdate: vi.fn(),
    clearPayload: vi.fn(),
    clearAllRecords: vi.fn(),
    openUrl: vi.fn(),
    notifyError: vi.fn(),
    notifySuccess: vi.fn(),
    message: {
        error: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
    },
    appStore: {
        version: '1.8.7-test',
        moduleBillingEnabled: false,
        fetchStatus: vi.fn(),
    },
}));

vi.mock('@/api/adminKey', () => ({ default: mocks.adminKeyApi }));
vi.mock('@/api/config', () => ({
    getConfig: mocks.getConfig,
    updateConfig: mocks.updateConfig,
}));
vi.mock('@/api/system', () => ({ checkUpdate: mocks.checkUpdate }));
vi.mock('@/api/record', () => ({
    clearPayload: mocks.clearPayload,
    clearAllRecords: mocks.clearAllRecords,
}));
vi.mock('@/stores/app', () => ({ useAppStore: () => mocks.appStore }));
vi.mock('@/utils/platform', () => ({ openUrl: mocks.openUrl }));
vi.mock('@/utils/requestFeedback', () => ({
    notifyError: mocks.notifyError,
    notifySuccess: mocks.notifySuccess,
}));
vi.mock('ant-design-vue/es', () => ({ message: mocks.message }));

import AdvancedSettings from './AdvancedSettings.vue';

/* eslint-disable vue/one-component-per-file -- test-only Ant Design control stubs. */
const ContainerStub = defineComponent({
    inheritAttrs: false,
    template: '<div v-bind="$attrs"><slot /></div>',
});

const ButtonStub = defineComponent({
    inheritAttrs: false,
    props: {
        disabled: { type: Boolean, default: false },
        loading: { type: Boolean, default: false },
    },
    emits: ['click'],
    template: '<button v-bind="$attrs" :disabled="disabled" :data-loading="loading ? \'true\' : \'false\'" @click="$emit(\'click\', $event)"><slot /></button>',
});

const InputStub = defineComponent({
    inheritAttrs: false,
    props: {
        value: { type: String, default: '' },
    },
    template: '<input v-bind="$attrs" :value="value" readonly />',
});

const TabsStub = defineComponent({
    template: '<div class="tabs-stub"><slot /></div>',
});

const TabPaneStub = defineComponent({
    template: '<section class="tab-pane-stub"><slot /></section>',
});
/* eslint-enable vue/one-component-per-file */

const global = {
    components: {
        AButton: ButtonStub,
        AInput: InputStub,
        ATabs: TabsStub,
        ATabPane: TabPaneStub,
    },
    stubs: {
        ASpin: ContainerStub,
        ASwitch: true,
        ASelect: ContainerStub,
        ASelectOption: ContainerStub,
        AModal: ContainerStub,
        ARadioGroup: ContainerStub,
        ARadio: ContainerStub,
    },
};

const config = {
    cch_rewrite_enabled: 'true',
    responses_prompt_cache_key_enabled: 'true',
    claude_code_tracking_rewrite_enabled: 'true',
    stream_log_enabled: 'false',
    record_payload_enabled: 'true',
    auto_update_enabled: 'true',
    module_billing_enabled: 'false',
};

function mountSettings() {
    return mount(AdvancedSettings, { global });
}

describe('AdvancedSettings Admin Key controls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mocks.getConfig.mockResolvedValue({ ...config });
        mocks.updateConfig.mockResolvedValue({ ...config });
        mocks.appStore.fetchStatus.mockResolvedValue(undefined);
        mocks.adminKeyApi.getStatus.mockResolvedValue({ exists: false });
        mocks.adminKeyApi.regenerate.mockResolvedValue({ key: 'agk_test_once_only' });
        mocks.adminKeyApi.remove.mockResolvedValue({ success: true });
    });

    it('loads only Admin Key existence and shows generated plaintext once', async () => {
        const wrapper = mountSettings();
        await flushPromises();

        expect(mocks.adminKeyApi.getStatus).toHaveBeenCalledOnce();
        expect(wrapper.text()).toContain('未配置');

        await wrapper.get('[data-testid="admin-key-generate"]').trigger('click');
        await flushPromises();

        expect(mocks.adminKeyApi.regenerate).toHaveBeenCalledOnce();
        expect(wrapper.find('[data-testid="admin-key-reveal"]').exists()).toBe(true);
        expect(wrapper.get('[data-testid="admin-key-value"]').attributes('value')).toBe('agk_test_once_only');
        expect(localStorage.length).toBe(0);
        expect(mocks.notifySuccess).toHaveBeenCalledWith('Admin Key 已生成，请立即复制并安全保存');
    });

    it('copies the in-memory key and clears it when the reveal area is closed', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        try {
            const wrapper = mountSettings();
            await flushPromises();
            await wrapper.get('[data-testid="admin-key-generate"]').trigger('click');
            await flushPromises();

            await wrapper.get('[data-testid="admin-key-copy"]').trigger('click');
            await flushPromises();
            expect(writeText).toHaveBeenCalledWith('agk_test_once_only');
            expect(mocks.notifySuccess).toHaveBeenCalledWith('Admin Key 已复制');

            await wrapper.get('[data-testid="admin-key-close"]').trigger('click');
            expect(wrapper.find('[data-testid="admin-key-reveal"]').exists()).toBe(false);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('does not restore plaintext after remount and clears it after revoke', async () => {
        const wrapper = mountSettings();
        await flushPromises();
        await wrapper.get('[data-testid="admin-key-generate"]').trigger('click');
        await flushPromises();
        await wrapper.get('[data-testid="admin-key-close"]').trigger('click');

        mocks.adminKeyApi.getStatus.mockResolvedValue({ exists: true });
        const reopened = mountSettings();
        await flushPromises();

        expect(reopened.find('[data-testid="admin-key-value"]').exists()).toBe(false);
        expect(reopened.text()).toContain('已配置');

        await reopened.get('[data-testid="admin-key-revoke"]').trigger('click');
        await flushPromises();
        expect(mocks.adminKeyApi.remove).toHaveBeenCalledOnce();
        expect(reopened.text()).toContain('未配置');
        expect(reopened.find('[data-testid="admin-key-reveal"]').exists()).toBe(false);
    });
});
