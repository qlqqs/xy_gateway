import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import UpstreamConfig from './UpstreamConfig.vue';
const mocks = vi.hoisted(() => ({
    listModels: vi.fn(),
    notifyRequestError: vi.fn(),
}));

vi.mock('@/stores/vendors', () => ({
    default: {
        vendors: [],
        listModels: mocks.listModels,
    },
}));
vi.mock('@/utils/requestFeedback', () => ({
    notifyRequestError: mocks.notifyRequestError,
}));


/* eslint-disable vue/one-component-per-file -- keep the test-only UI stubs next to the fixture. */
const ButtonStub = defineComponent({
    emits: ['click'],
    template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
});

const CollapseStub = defineComponent({
    template: '<div><slot /></div>',
});

const TooltipStub = defineComponent({
    template: '<span><slot /></span>',
});
const SelectStub = defineComponent({
    name: 'ASelect',
    emits: ['change', 'dropdown-visible-change'],
    template: '<div class="select-stub"><slot /></div>',
});

const SelectOptionStub = defineComponent({
    name: 'ASelectOption',
    template: '<span class="select-option-stub"><slot /></span>',
});


/* eslint-enable vue/one-component-per-file */
const global = {
    components: {
        AButton: ButtonStub,
        ACollapse: CollapseStub,
        ATooltip: TooltipStub,
    },

    stubs: {
        ASelect: SelectStub,
        ASelectOption: SelectOptionStub,
        ASwitch: true,
        DialogTest: true,
        ArrowDownOutlined: true,
        ArrowUpOutlined: true,
        DeleteOutlined: true,
        ExperimentOutlined: true,
        PlusOutlined: true,
    },
};

function mountEditor(upstreams = [
    { vendor_id: 1, vendor_model_id: 11, enabled: true },
    { vendor_id: 2, vendor_model_id: 22, enabled: true },
]) {
    return mount(UpstreamConfig, {
        props: {
            mode: 'edit',
            modelName: 'gateway-model',
            upstreams,
        },
        global,
    });
}

describe('UpstreamConfig', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listModels.mockResolvedValue([]);
    });
    it('adds an enabled upstream mapping', async () => {
        const wrapper = mountEditor();

        await wrapper.get('button:not([aria-label])').trigger('click');

        expect(wrapper.emitted('update:upstreams')).toEqual([[
            [
                { vendor_id: 1, vendor_model_id: 11, enabled: true },
                { vendor_id: 2, vendor_model_id: 22, enabled: true },
                { enabled: true },
            ],
        ]]);
    });

    it('keeps the mapping columns stable regardless of the number of upstreams', () => {
        const mountCases = [
            [{ enabled: true }],
            [{ enabled: true }, { enabled: true }, { enabled: true }],
        ];

        for (const upstreams of mountCases) {
            const wrapper = mount(UpstreamConfig, {
                props: { mode: 'edit', modelName: 'gateway-model', upstreams },
                global,
            });
            const style = wrapper.get('.upstream-table').attributes('style') ?? '';
            expect(style).toContain('auto');
            expect(style).not.toContain('calc(');
            expect(style).toContain('44px');
        }
    });

    it('keeps a selected vendor model visible and retries after loading fails', async () => {
        mocks.listModels
            .mockRejectedValueOnce(new Error('加载失败'))
            .mockResolvedValueOnce([{
                id: 11,
                vendor_id: 1,
                model_id: 'upstream-model',
                allowed_formats: [],
                created_at: '',
                updated_at: '',
            }]);
        const wrapper = mountEditor([{ vendor_id: 1, vendor_model_id: 11, enabled: true }]);
        await flushPromises();

        expect(mocks.notifyRequestError).toHaveBeenCalledWith(expect.any(Error), '供应商模型加载失败');
        expect(wrapper.text()).toContain('已选模型 ID 11（当前列表不可用）');
        expect(wrapper.emitted('update:upstreams')).toBeUndefined();

        const modelSelect = wrapper.findAllComponents({ name: 'ASelect' })[1];
        modelSelect?.vm.$emit('dropdown-visible-change', true);
        await flushPromises();

        expect(mocks.listModels).toHaveBeenCalledTimes(2);
        expect(wrapper.text()).toContain('upstream-model');
        expect(wrapper.text()).not.toContain('当前列表不可用');
    });
});
