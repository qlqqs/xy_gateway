import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import UpstreamConfig from './UpstreamConfig.vue';

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
/* eslint-enable vue/one-component-per-file */

const global = {
    components: {
        AButton: ButtonStub,
        ACollapse: CollapseStub,
        ATooltip: TooltipStub,
    },
    stubs: {
        ASelect: true,
        ASelectOption: true,
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
});
