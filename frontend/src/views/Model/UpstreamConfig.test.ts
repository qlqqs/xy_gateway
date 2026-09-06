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
            routingMode: 'first_available',
            modelName: 'gateway-model',
            upstreams,
        },
        global,
    });
}

describe('UpstreamConfig', () => {
    it('adds an enabled upstream in multi-upstream modes', async () => {
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

    it('moves first_available upstreams without modifying their configuration', async () => {
        const wrapper = mountEditor();

        await wrapper.get('button[aria-label="下移"]').trigger('click');

        expect(wrapper.emitted('update:upstreams')).toEqual([[
            [
                { vendor_id: 2, vendor_model_id: 22, enabled: true },
                { vendor_id: 1, vendor_model_id: 11, enabled: true },
            ],
        ]]);
    });

    it('sizes the actions column by content (auto) instead of hardcoded widths', () => {
        const mountCases = [
            { routingMode: 'single' as const, upstreams: [{ enabled: true }], hasEnabledColumn: false },
            { routingMode: 'load_balance' as const, upstreams: [{ enabled: true }, { enabled: true }, { enabled: true }], hasEnabledColumn: true },
            { routingMode: 'first_available' as const, upstreams: [{ enabled: true }, { enabled: true }, { enabled: true }], hasEnabledColumn: true },
        ];

        for (const { routingMode, upstreams, hasEnabledColumn } of mountCases) {
            const wrapper = mount(UpstreamConfig, {
                props: { mode: 'edit', routingMode, modelName: 'gateway-model', upstreams },
                global,
            });
            const style = wrapper.get('.upstream-table').attributes('style') ?? '';
            expect(style).toContain('auto');
            expect(style).not.toContain('calc(');
            if (hasEnabledColumn) {
                expect(style).toContain('44px');
            } else {
                expect(style).not.toContain('44px');
            }
        }
    });
});
