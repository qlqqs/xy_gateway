import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { Vendor } from '@/types/vendor';

const mocks = vi.hoisted(() => ({
    vendorsStore: {
        vendors: [] as Vendor[],
        list: vi.fn(),
        remove: vi.fn(),
    },
    modelsStore: { refresh: vi.fn() },
    groupsStore: { refresh: vi.fn() },
    createOpen: vi.fn(),
    editOpen: vi.fn(),
    testOpen: vi.fn(),
    modalConfirm: vi.fn(),
    notifySuccess: vi.fn(),
    notifyRequestError: vi.fn(),
    dialogStubs: {
        create: {
            name: 'DialogCreate',
            emits: ['success'],
            setup(_props: unknown, context: { expose: (value: Record<string, unknown>) => void }) {
                context.expose({ open: mocks.createOpen });
                return {};
            },
            template: '<div data-dialog="create"></div>',
        },
        edit: {
            name: 'DialogEdit',
            emits: ['success'],
            setup(_props: unknown, context: { expose: (value: Record<string, unknown>) => void }) {
                context.expose({ open: mocks.editOpen });
                return {};
            },
            template: '<div data-dialog="edit"></div>',
        },
        test: {
            name: 'DialogTest',
            setup(_props: unknown, context: { expose: (value: Record<string, unknown>) => void }) {
                context.expose({ openVendorTest: mocks.testOpen });
                return {};
            },
            template: '<div data-dialog="test"></div>',
        },
    },
}));

vi.mock('@/stores/vendors', () => ({ default: mocks.vendorsStore }));
vi.mock('@/stores/models', () => ({ default: mocks.modelsStore }));
vi.mock('@/stores/groups', () => ({ default: mocks.groupsStore }));
vi.mock('@/utils/requestFeedback', () => ({
    notifySuccess: mocks.notifySuccess,
    notifyRequestError: mocks.notifyRequestError,
}));
vi.mock('ant-design-vue/es', () => ({ Modal: { confirm: mocks.modalConfirm } }));
vi.mock('./DialogCreate.vue', () => ({ default: mocks.dialogStubs.create }));
vi.mock('./DialogEdit.vue', () => ({ default: mocks.dialogStubs.edit }));
vi.mock('./DialogTest.vue', () => ({ default: mocks.dialogStubs.test }));

import VendorList from './List.vue';

/* eslint-disable vue/one-component-per-file -- local stubs model user-facing events without Ant Design internals. */
const FormStub = defineComponent({ template: '<form><slot /></form>' });
const FormItemStub = defineComponent({ template: '<div><slot /></div>' });
const SpaceStub = defineComponent({ template: '<span><slot /></span>' });
const TooltipStub = defineComponent({ template: '<span><slot /></span>' });
const SelectOptionStub = defineComponent({ template: '<option><slot /></option>' });

const InputStub = defineComponent({
    inheritAttrs: false,
    props: { value: { type: [String, Number], default: '' } },
    emits: ['update:value'],
    template: '<input v-bind="$attrs" :value="value" @input="$emit(\'update:value\', $event.target.value)">',
});

const SelectStub = defineComponent({
    inheritAttrs: false,
    props: {
        value: { type: [String, Number], default: undefined },
        options: { type: Array, default: () => [] },
    },
    emits: ['update:value', 'change'],
    methods: {
        handleChange(event: Event) {
            const value = (event.target as HTMLSelectElement).value || undefined;
            this.$emit('update:value', value);
            this.$emit('change', value);
        },
    },
    template: '<select v-bind="$attrs" :value="value ?? \'\'" @change="handleChange"><option value="">全部</option><option v-for="option in options" :key="String(option.value)" :value="option.value">{{ option.label }}</option><slot /></select>',
});

const ButtonStub = defineComponent({
    inheritAttrs: false,
    props: { disabled: Boolean, loading: Boolean },
    emits: ['click'],
    template: '<button v-bind="$attrs" :disabled="disabled" :data-loading="loading ? \'true\' : \'false\'" @click="$emit(\'click\', $event)"><slot /></button>',
});

const TableStub = defineComponent({
    inheritAttrs: false,
    props: { columns: { type: Array, default: () => [] }, dataSource: { type: Array, default: () => [] }, loading: Boolean },
    emits: ['change'],
    template: '<div class="table-stub"><div v-for="record in dataSource" :key="record.id" class="table-row"><template v-for="column in columns" :key="String(column.key)"><slot name="bodyCell" :column="column" :record="record" /></template></div></div>',
});

/* eslint-enable vue/one-component-per-file */

const global = {
    components: {
        AForm: FormStub,
        AFormItem: FormItemStub,
        ASpace: SpaceStub,
        AInput: InputStub,
        ASelect: SelectStub,
        ASelectOption: SelectOptionStub,
        AButton: ButtonStub,
        ATable: TableStub,
        ATooltip: TooltipStub,
        ATag: TooltipStub,
    },
    stubs: {
        DeleteOutlined: true,
        EditOutlined: true,
        ExperimentOutlined: true,
    },
};

const vendor: Vendor = {
    id: 7,
    type: 'openai',
    name: 'Primary OpenAI',
    token: 'secret-token',
    urls: { openai: 'https://api.example.test/v1/chat/completions' },
    config: { status: 'active', channel_code: 'primary' },
    model_count: 2,
    created_at: new Date('2026-09-07T00:00:00Z'),
    updated_at: new Date('2026-09-07T00:00:00Z'),
};

function mountList() {
    return mount(VendorList, { global });
}

describe('Vendor/List user actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.vendorsStore.vendors = reactive([vendor]);
        mocks.vendorsStore.list.mockResolvedValue({ list: [vendor], total: 1 });
        mocks.vendorsStore.remove.mockResolvedValue({ success: true });
        mocks.modelsStore.refresh.mockResolvedValue(undefined);
        mocks.groupsStore.refresh.mockResolvedValue(undefined);
    });

    it('loads, searches, resets and paginates with the visible query controls', async () => {
        const wrapper = mountList();
        await flushPromises();
        expect(mocks.vendorsStore.list).toHaveBeenCalledWith({ keyword: undefined, type: undefined, page: 1, pageSize: 10 });

        const keyword = wrapper.get('input[placeholder="搜索供应商名称"]');
        await keyword.setValue('primary');
        await wrapper.findAll('button').find((button) => button.text() === '搜索')?.trigger('click');
        await flushPromises();
        expect(mocks.vendorsStore.list).toHaveBeenLastCalledWith({ keyword: 'primary', type: undefined, page: 1, pageSize: 10 });

        await keyword.setValue('stale');
        await wrapper.findAll('button').find((button) => button.text() === '重置')?.trigger('click');
        await flushPromises();
        expect((keyword.element as HTMLInputElement).value).toBe('');
        expect(mocks.vendorsStore.list).toHaveBeenLastCalledWith({ keyword: undefined, type: undefined, page: 1, pageSize: 10 });

        wrapper.findComponent(TableStub).vm.$emit('change', { current: 2, pageSize: 20 });
        await flushPromises();
        expect(mocks.vendorsStore.list).toHaveBeenLastCalledWith({ keyword: undefined, type: undefined, page: 2, pageSize: 20 });
    });

    it('opens create, edit and test dialogs from the corresponding user actions', async () => {
        const wrapper = mountList();
        await flushPromises();

        await wrapper.findAll('button').find((button) => button.text().includes('新建供应商'))?.trigger('click');
        expect(mocks.createOpen).toHaveBeenCalledTimes(1);

        await wrapper.get('button[aria-label="编辑"]').trigger('click');
        expect(mocks.editOpen).toHaveBeenCalledWith(vendor);

        await wrapper.get('button[aria-label="测试"]').trigger('click');
        expect(mocks.testOpen).toHaveBeenCalledWith(vendor);
    });

    it('refreshes related resources after child-dialog success events', async () => {
        const wrapper = mountList();
        await flushPromises();
        wrapper.findComponent({ name: 'DialogCreate' }).vm.$emit('success', vendor);
        await flushPromises();
        expect(mocks.groupsStore.refresh).toHaveBeenCalledTimes(1);
        expect(mocks.vendorsStore.list).toHaveBeenCalledTimes(2);

        wrapper.findComponent({ name: 'DialogEdit' }).vm.$emit('success', vendor);
        await flushPromises();
        expect(mocks.modelsStore.refresh).toHaveBeenCalledTimes(1);
        expect(mocks.groupsStore.refresh).toHaveBeenCalledTimes(2);
        expect(mocks.vendorsStore.list).toHaveBeenCalledTimes(3);
    });

    it('deletes only after confirmation and reports success', async () => {
        const wrapper = mountList();
        await flushPromises();
        await wrapper.get('button[aria-label="删除"]').trigger('click');

        expect(mocks.modalConfirm).toHaveBeenCalledTimes(1);
        expect(mocks.vendorsStore.remove).not.toHaveBeenCalled();
        const config = mocks.modalConfirm.mock.calls[0]?.[0] as { onOk: () => Promise<void> };
        await config.onOk();

        expect(mocks.vendorsStore.remove).toHaveBeenCalledWith(vendor.id);
        expect(mocks.modelsStore.refresh).toHaveBeenCalledTimes(1);
        expect(mocks.groupsStore.refresh).toHaveBeenCalledTimes(1);
        expect(mocks.notifySuccess).toHaveBeenCalledWith('删除成功');
    });

    it('shows a normalized error and does not refresh when deletion fails', async () => {
        mocks.vendorsStore.remove.mockRejectedValueOnce(new Error('network down'));
        const wrapper = mountList();
        await flushPromises();
        await wrapper.get('button[aria-label="删除"]').trigger('click');
        const config = mocks.modalConfirm.mock.calls[0]?.[0] as { onOk: () => Promise<void> };
        await config.onOk();

        expect(mocks.notifyRequestError).toHaveBeenCalledWith(expect.any(Error), '删除失败');
        expect(mocks.modelsStore.refresh).not.toHaveBeenCalled();
        expect(mocks.groupsStore.refresh).not.toHaveBeenCalled();
    });
});
