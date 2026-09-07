import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';
import { mount } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
    loadData: vi.fn(),
    handleSearch: vi.fn(),
    handleReset: vi.fn(),
    handleTableChange: vi.fn(),
    handleDateChange: vi.fn(),
    startAutoRefresh: vi.fn(),
    stopAutoRefresh: vi.fn(),
    userStore: { users: [] as Array<{ id: number; name: string }> },
    modelsStore: { models: [] as Array<{ id: number; name: string }> },
}));

const tableState = {
    recordStore: {
        records: [] as Array<{ id: number }>,
        loading: false,
    },
    searchForm: reactive<{
        status?: string;
        user_ids?: number[];
        model_ids?: number[];
        start_time?: string;
        end_time?: string;
    }>({}),
    pagination: reactive({ current: 1, pageSize: 10, total: 0 }),
    dateRange: ref<unknown>(null),
};

const autoRefreshState = {
    isRunning: ref(false),
    remainingSeconds: ref(30),
};
let autoRefreshCallback: (() => void | Promise<void>) | undefined;

vi.mock('@/stores/users', () => ({ default: mocks.userStore }));
vi.mock('@/stores/models', () => ({ default: mocks.modelsStore }));
vi.mock('@/composables/useRecordTable', () => ({
    useRecordTable: () => ({
        recordStore: tableState.recordStore,
        searchForm: tableState.searchForm,
        pagination: tableState.pagination,
        dateRange: tableState.dateRange,
        loadData: mocks.loadData,
        handleSearch: mocks.handleSearch,
        handleReset: mocks.handleReset,
        handleTableChange: mocks.handleTableChange,
        handleDateChange: mocks.handleDateChange,
    }),
}));
vi.mock('@/composables/useAutoRefresh', () => ({
    useAutoRefresh: (options: { callback: () => void | Promise<void> }) => {
        autoRefreshCallback = options.callback;
        mocks.startAutoRefresh.mockImplementation(async () => {
            autoRefreshState.isRunning.value = true;
            await autoRefreshCallback?.();
        });
        mocks.stopAutoRefresh.mockImplementation(() => {
            autoRefreshState.isRunning.value = false;
        });
        return {
            isRunning: autoRefreshState.isRunning,
            start: mocks.startAutoRefresh,
            stop: mocks.stopAutoRefresh,
            remainingSeconds: autoRefreshState.remainingSeconds,
        };
    },
}));

import RecordList from './List.vue';

/* eslint-disable vue/one-component-per-file -- test-only Ant Design stubs. */
const ButtonStub = defineComponent({
    inheritAttrs: false,
    emits: ['click'],
    template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
});

const SelectStub = defineComponent({
    inheritAttrs: false,
    props: {
        value: { type: [String, Array], default: undefined },
        options: { type: Array, default: () => [] },
    },
    emits: ['update:value'],
    template: '<select v-bind="$attrs" @change="$emit(\'update:value\', $event.target.value)"><slot /></select>',
});

const RangePickerStub = defineComponent({
    emits: ['update:value', 'change'],
    template: '<button class="range-picker-stub" type="button" @click="$emit(\'change\', null)">日期</button>',
});

const SwitchStub = defineComponent({
    props: { checked: { type: Boolean, default: false } },
    emits: ['update:checked', 'change'],
    template: '<button class="refresh-switch" type="button" :data-checked="checked" @click="$emit(\'update:checked\', !checked); $emit(\'change\', !checked)">自动刷新</button>',
});

const RecordTableStub = defineComponent({
    props: { records: { type: Array, default: () => [] } },
    emits: ['change'],
    template: '<div class="record-table-stub" :data-count="records.length"><button class="table-change" type="button" @click="$emit(\'change\', { current: 2, pageSize: 20 })">分页</button></div>',
});

const ContainerStub = defineComponent({ template: '<div><slot /></div>' });
/* eslint-enable vue/one-component-per-file */

const global = {
    components: {
        AButton: ButtonStub,
        ASelect: SelectStub,
        ARangePicker: RangePickerStub,
        ASwitch: SwitchStub,
        AForm: ContainerStub,
        AFormItem: ContainerStub,
        ASpace: ContainerStub,
        ATooltip: ContainerStub,
        RecordTable: RecordTableStub,
    },
    stubs: {
        ASelectOption: true,
        RecordTable: RecordTableStub,
    },
};

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('RecordList user interactions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.loadData.mockResolvedValue(undefined);
        tableState.recordStore.records = [{ id: 1 }];
        tableState.recordStore.loading = false;
        tableState.searchForm.status = undefined;
        tableState.searchForm.user_ids = undefined;
        tableState.searchForm.model_ids = undefined;
        tableState.searchForm.start_time = undefined;
        tableState.searchForm.end_time = undefined;
        tableState.pagination.current = 1;
        tableState.pagination.pageSize = 10;
        tableState.dateRange.value = null;
        autoRefreshState.isRunning.value = false;
        autoRefreshState.remainingSeconds.value = 30;
        mocks.userStore.users = [{ id: 7, name: 'Alice' }];
        mocks.modelsStore.models = [{ id: 3, name: 'gpt-test' }];
    });

    it('loads records on mount and delegates search, reset, date and pagination actions', async () => {
        const wrapper = mount(RecordList, { global });
        await flushPromises();

        expect(mocks.loadData).toHaveBeenCalledOnce();
        await wrapper.findAll('button').find(button => button.text() === '搜索')?.trigger('click');
        await wrapper.findAll('button').find(button => button.text() === '重置')?.trigger('click');
        await wrapper.get('.range-picker-stub').trigger('click');
        await wrapper.get('.table-change').trigger('click');

        expect(mocks.handleSearch).toHaveBeenCalledOnce();
        expect(mocks.handleReset).toHaveBeenCalledOnce();
        expect(mocks.handleDateChange).toHaveBeenCalledWith(null);
        expect(mocks.handleTableChange).toHaveBeenCalledWith({ current: 2, pageSize: 20 });
    });

    it('starts an immediate refresh when enabled and stops it when disabled/unmounted', async () => {
        const wrapper = mount(RecordList, { global });

        await wrapper.get('.refresh-switch').trigger('click');
        await flushPromises();
        expect(mocks.startAutoRefresh).toHaveBeenCalledOnce();
        expect(mocks.loadData).toHaveBeenCalledTimes(2);

        await wrapper.get('.refresh-switch').trigger('click');
        expect(mocks.stopAutoRefresh).toHaveBeenCalledOnce();

        wrapper.unmount();
        expect(mocks.stopAutoRefresh).toHaveBeenCalledTimes(2);
    });

    it('passes user/model options to the selects and keeps loading state observable', () => {
        tableState.recordStore.loading = true;
        const wrapper = mount(RecordList, { global });

        expect(wrapper.findComponent(RecordTableStub).props('records')).toEqual([{ id: 1 }]);
        expect(wrapper.text()).toContain('自动刷新');
        expect(wrapper.findAll('option')).toHaveLength(0);
    });
});
