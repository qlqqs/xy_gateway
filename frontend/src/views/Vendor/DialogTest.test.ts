import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { Vendor } from '@/types/vendor';

const mocks = vi.hoisted(() => ({
    listVendorModels: vi.fn(),
    testVendor: vi.fn(),
    testModelRoute: vi.fn(),
}));

vi.mock('@/api/vendor', () => ({
    listVendorModels: mocks.listVendorModels,
    testVendor: mocks.testVendor,
}));
vi.mock('@/api/model', () => ({ testModelRoute: mocks.testModelRoute }));
vi.mock('@/utils/requestFeedback', () => ({
    notifyRequestError: vi.fn(error => error),
    notifySuccess: vi.fn(),
    notifyWarning: vi.fn(),
}));

import DialogTest from './DialogTest.vue';

/* eslint-disable vue/one-component-per-file -- 局部桩组件仅暴露弹窗可见交互。 */
const PassthroughStub = defineComponent({ template: '<div><slot /></div>' });
const ModalStub = defineComponent({
    props: { open: Boolean },
    template: '<div v-if="open"><slot /></div>',
});
const RadioGroupStub = defineComponent({
    props: { value: { type: String, default: '' } },
    emits: ['update:value'],
    template: '<div data-testid="format">{{ value }}<slot /></div>',
});
const SelectStub = defineComponent({
    props: { value: { type: String, default: '' }, options: { type: Array, default: () => [] } },
    emits: ['update:value', 'search'],
    template: '<select><slot /></select>',
});
/* eslint-enable vue/one-component-per-file */

const global = {
    components: {
        AModal: ModalStub,
        AForm: PassthroughStub,
        AFormItem: PassthroughStub,
        ARadioGroup: RadioGroupStub,
        ARadioButton: PassthroughStub,
        ASelect: SelectStub,
        AButton: PassthroughStub,
        ADivider: PassthroughStub,
        ASpace: PassthroughStub,
        ABadge: PassthroughStub,
        ATabs: PassthroughStub,
        ATabPane: PassthroughStub,
    },
    stubs: { CopyOutlined: true },
};

function makeVendor(overrides: Partial<Vendor>): Vendor {
    return {
        id: 1,
        type: 'other',
        name: 'Test vendor',
        token: 'token',
        urls: {},
        config: {},
        model_count: 0,
        created_at: new Date(0),
        updated_at: new Date(0),
        ...overrides,
    };
}

describe('Vendor/DialogTest', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listVendorModels.mockResolvedValue([]);
    });

    it('按供应商声明或旧 URL 选择直连测试协议', async () => {
        const wrapper = mount(DialogTest, { global });
        const dialog = wrapper.vm as unknown as { openVendorTest: (vendor: Vendor) => void };

        dialog.openVendorTest(makeVendor({
            urls: { anthropic: 'https://example.test/v1/messages' },
        }));
        await flushPromises();
        expect(wrapper.get('[data-testid="format"]').text()).toContain('anthropic');

        dialog.openVendorTest(makeVendor({
            config: { api_type: 'openai', openai_protocol: 'responses' },
            urls: { responses: 'https://example.test/v1/responses' },
        }));
        await flushPromises();
        expect(wrapper.get('[data-testid="format"]').text()).toContain('responses');
    });
});
