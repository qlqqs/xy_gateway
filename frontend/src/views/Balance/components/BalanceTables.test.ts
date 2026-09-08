import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import type { RechargeRecord } from '@/types/billing';
import type { User } from '@/types/user';

const mocks = vi.hoisted(() => ({
    listUsers: vi.fn(),
    listRechargeRecords: vi.fn(),
}));

vi.mock('@/stores/users', () => ({
    default: { list: mocks.listUsers },
}));
vi.mock('@/api/billing', () => ({
    listRechargeRecords: mocks.listRechargeRecords,
}));

import UserBalanceTable from './UserBalanceTable.vue';
import RechargeRecordsTable from './RechargeRecordsTable.vue';

/* eslint-disable vue/one-component-per-file -- test-only Ant Design stubs. */
const ButtonStub = defineComponent({
    inheritAttrs: false,
    emits: ['click'],
    template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
});

const InputStub = defineComponent({
    inheritAttrs: false,
    props: { value: { type: [String, Number], default: undefined } },
    emits: ['update:value'],
    template: '<input v-bind="$attrs" :value="value ?? \'\'" @input="$emit(\'update:value\', $event.target.value)">',
});

const SelectStub = defineComponent({
    inheritAttrs: false,
    props: { value: { type: [String, Number], default: undefined } },
    emits: ['update:value', 'change'],
    template: '<select v-bind="$attrs" :value="value" @change="$emit(\'update:value\', $event.target.value); $emit(\'change\', $event.target.value)"><slot /></select>',
});

const SelectOptionStub = defineComponent({
    inheritAttrs: false,
    props: { value: { type: [String, Number], default: '' } },
    template: '<option :value="value"><slot /></option>',
});

const TableStub = defineComponent({
    props: {
        dataSource: { type: Array, default: () => [] },
        pagination: { type: Object, default: () => ({}) },
        loading: { type: Boolean, default: false },
    },
    emits: ['change'],
    setup(props, { emit, slots }) {
        return () => h(
            'div',
            {
                class: 'table-stub',
                'data-loading': props.loading ? 'true' : 'false',
                'data-total': String((props.pagination as { total?: number }).total ?? 0),
                onChange: (event: unknown) => emit('change', event),
            },
            (props.dataSource as Array<{ id: number }>).map(record => h(
                'div',
                { class: 'table-row', key: record.id },
                slots.bodyCell?.({ column: { key: 'action' }, record }),
            )),
        );
    },
});

const ContainerStub = defineComponent({ template: '<div><slot /></div>' });
const TagStub = defineComponent({ template: '<span><slot /></span>' });
const StatisticStub = defineComponent({ template: '<span class="statistic-stub"><slot /></span>' });
/* eslint-enable vue/one-component-per-file */

const global = {
    components: {
        AButton: ButtonStub,
        AInput: InputStub,
        ASelect: SelectStub,
        ATable: TableStub,
        AForm: ContainerStub,
        AFormItem: ContainerStub,
        ASpace: ContainerStub,
        ATag: TagStub,
        AStatistic: StatisticStub,
    },
    stubs: {
        ASelectOption: SelectOptionStub,
    },
};

const user: User = {
    id: 7,
    name: 'Alice',
    type: 'normal',
    status: 'active',
    balance: 12_500_000,
    created_at: new Date(0),
    updated_at: new Date(0),
    keys: [],
};

const recharge: RechargeRecord = {
    id: 3,
    user_id: 7,
    amount: 5,
    type: 'recharge',
    remark: 'manual',
    operator: 'admin',
    created_at: new Date(0),
    updated_at: new Date(0),
};

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await nextTick();
    await Promise.resolve();
}

describe('balance table user interactions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listUsers.mockResolvedValue({ list: [user], total: 1 });
        mocks.listRechargeRecords.mockResolvedValue({ list: [recharge], total: 1 });
    });

    it('loads, searches, resets and paginates the user balance table', async () => {
        const wrapper = mount(UserBalanceTable, { global });
        await flushPromises();

        expect(mocks.listUsers).toHaveBeenCalledWith({
            keyword: undefined,
            page: 1,
            pageSize: 10,
        });
        await wrapper.get('input').setValue('ali');
        await wrapper.get('button').trigger('click');
        await flushPromises();
        expect(mocks.listUsers).toHaveBeenLastCalledWith({
            keyword: 'ali',
            page: 1,
            pageSize: 10,
        });

        const buttons = wrapper.findAll('button');
        await buttons.find(button => button.text() === '重置')?.trigger('click');
        await flushPromises();
        expect(mocks.listUsers).toHaveBeenLastCalledWith({
            keyword: undefined,
            page: 1,
            pageSize: 10,
        });

        await wrapper.findComponent(TableStub).vm.$emit('change', { current: 2, pageSize: 20 });
        await flushPromises();
        expect(mocks.listUsers).toHaveBeenLastCalledWith({
            keyword: undefined,
            page: 2,
            pageSize: 20,
        });
    });

    it('emits the selected user from the adjust button', async () => {
        const wrapper = mount(UserBalanceTable, { global });
        await flushPromises();

        const adjustButton = wrapper.findAll('button').find(button => button.text() === '调整余额');
        expect(adjustButton).toBeDefined();
        await adjustButton?.trigger('click');

        expect(wrapper.emitted('adjust')).toEqual([[user]]);
    });

    it('clears rows and loading state when the user request fails', async () => {
        mocks.listUsers.mockRejectedValue(new Error('network'));
        const wrapper = mount(UserBalanceTable, { global });
        await flushPromises();

        const table = wrapper.findComponent(TableStub);
        expect(table.attributes('data-loading')).toBe('false');
        expect(table.findAll('.table-row')).toHaveLength(0);
        expect(table.attributes('data-total')).toBe('0');
    });
});

describe('recharge records table user interactions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listUsers.mockResolvedValue({ list: [], total: 0 });
        mocks.listRechargeRecords.mockResolvedValue({ list: [recharge], total: 1 });
    });

    it('loads the selected user and forwards search/reset/pagination queries', async () => {
        const wrapper = mount(RechargeRecordsTable, {
            global,
            props: { selectedUserId: 7 },
        });
        await flushPromises();

        expect(mocks.listRechargeRecords).toHaveBeenCalledWith({
            user_id: 7,
            type: undefined,
            page: 1,
            pageSize: 10,
        });

        const inputs = wrapper.findAll('input');
        await inputs[0]?.setValue('8');
        await wrapper.get('select').setValue('adjustment');
        await wrapper.findAll('button').find(button => button.text() === '搜索')?.trigger('click');
        await flushPromises();
        expect(mocks.listRechargeRecords).toHaveBeenLastCalledWith({
            user_id: '8',
            type: 'adjustment',
            page: 1,
            pageSize: 10,
        });

        await wrapper.findAll('button').find(button => button.text() === '重置')?.trigger('click');
        await flushPromises();
        expect(mocks.listRechargeRecords).toHaveBeenLastCalledWith({
            user_id: undefined,
            type: undefined,
            page: 1,
            pageSize: 10,
        });

        await wrapper.findComponent(TableStub).vm.$emit('change', { current: 3, pageSize: 50 });
        await flushPromises();
        expect(mocks.listRechargeRecords).toHaveBeenLastCalledWith({
            user_id: undefined,
            type: undefined,
            page: 3,
            pageSize: 50,
        });
    });

    it('recovers to an empty table after a rejected records request', async () => {
        mocks.listRechargeRecords.mockRejectedValue(new Error('unavailable'));
        const wrapper = mount(RechargeRecordsTable, { global });
        await flushPromises();

        const table = wrapper.findComponent(TableStub);
        expect(table.attributes('data-loading')).toBe('false');
        expect(table.findAll('.table-row')).toHaveLength(0);
        expect(table.attributes('data-total')).toBe('0');
    });
});
