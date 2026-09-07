import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import type { User } from '@/types/user';

const mocks = vi.hoisted(() => ({
    appStore: { moduleBillingEnabled: false },
    userStore: { list: vi.fn() },
    child: {
        createOpen: vi.fn(),
        editOpen: vi.fn(),
        keyOpen: vi.fn(),
        createSuccess: (_user: User): void => {},
        editSuccess: (_user: User): void => {},
        keySuccess: (): void => {},
    },
}));

vi.mock('@/stores/app', () => ({
    useAppStore: () => mocks.appStore,
}));
vi.mock('@/stores/users', () => ({ default: mocks.userStore }));
vi.mock('./DialogCreate.vue', () => ({
    default: {
        name: 'DialogCreate',
        emits: ['success'],
        setup(_: unknown, { expose, emit }: { expose: (value: unknown) => void; emit: (event: string, value?: unknown) => void }) {
            expose({ open: mocks.child.createOpen });
            mocks.child.createSuccess = (user: User) => emit('success', user);
            return () => null;
        },
    },
}));
vi.mock('./DialogEdit.vue', () => ({
    default: {
        name: 'DialogEdit',
        emits: ['success'],
        setup(_: unknown, { expose, emit }: { expose: (value: unknown) => void; emit: (event: string, value?: unknown) => void }) {
            expose({ open: mocks.child.editOpen });
            mocks.child.editSuccess = (user: User) => emit('success', user);
            return () => null;
        },
    },
}));
vi.mock('./KeyEdit.vue', () => ({
    default: {
        name: 'KeyEdit',
        emits: ['success'],
        setup(_: unknown, { expose, emit }: { expose: (value: unknown) => void; emit: (event: string) => void }) {
            expose({ open: mocks.child.keyOpen });
            mocks.child.keySuccess = () => emit('success');
            return () => null;
        },
    },
}));

import UserList from './List.vue';

const ButtonStub = defineComponent({
    inheritAttrs: false,
    emits: ['click'],
    template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
});

const InputStub = defineComponent({
    props: { value: { type: String, default: '' } },
    emits: ['update:value'],
    template: '<input v-bind="$attrs" :value="value" @input="$emit(\'update:value\', $event.target.value)">',
});

const SelectStub = defineComponent({
    props: { value: { type: [String, Array], default: undefined } },
    emits: ['update:value', 'change'],
    template: '<select v-bind="$attrs" @change="$emit(\'change\', $event.target.value)"><slot /></select>',
});

const FormStub = defineComponent({ template: '<form><slot /></form>' });
const FormItemStub = defineComponent({ template: '<div><slot /></div>' });
const ContainerStub = defineComponent({ template: '<div><slot /></div>' });
const TagStub = defineComponent({ template: '<span><slot /></span>' });
const IconStub = defineComponent({ template: '<span />' });

const TableStub = defineComponent({
    props: { dataSource: { type: Array, default: () => [] } },
    emits: ['change'],
    setup(props, { slots }) {
        return () => h('div', { class: 'table-stub' }, (props.dataSource as User[]).map(record => h(
            'div',
            { class: 'table-row', key: record.id },
            slots.bodyCell?.({ column: { key: 'action' }, record }),
        )));
    },
});

const global = {
    components: {
        AButton: ButtonStub,
        AInput: InputStub,
        ASelect: SelectStub,
        ATable: TableStub,
        AForm: FormStub,
        AFormItem: FormItemStub,
        ASpace: ContainerStub,
        ATag: TagStub,
        EditOutlined: IconStub,
        KeyOutlined: IconStub,
    },
    stubs: {
        ASelectOption: true,
        AStatistic: true,
        'a-tooltip': ContainerStub,
        AModal: true,
        ASwitch: true,
        AAlert: true,
        AEmpty: true,
        ACol: true,
        ARow: true,
        AInputPassword: true,
        ADivider: true,
        ATextarea: true,
        AInputNumber: true,
        ACard: true,
        ACollapsePanel: true,
        ACollapse: true,
    },
};

const user: User = {
    id: 7,
    name: 'Alice',
    type: 'normal',
    status: 'active',
    balance: 0,
    created_at: new Date(0),
    updated_at: new Date(0),
    keys: [],
};

describe('User list button actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.userStore.list.mockResolvedValue({ list: [user], total: 1 });
        mocks.appStore.moduleBillingEnabled = false;
        mocks.child.createSuccess = () => undefined;
        mocks.child.editSuccess = () => undefined;
        mocks.child.keySuccess = () => undefined;
    });

    it('delegates search and reset clicks to the resource table', async () => {
        const wrapper = mount(UserList, { global });

        const buttons = wrapper.findAll('button');
        await buttons.find(button => button.text() === '搜索')?.trigger('click');
        await buttons.find(button => button.text() === '重置')?.trigger('click');

        expect(mocks.userStore.list).toHaveBeenCalledTimes(3);
        expect(mocks.userStore.list).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 1 }));
        expect(mocks.userStore.list).toHaveBeenNthCalledWith(3, expect.objectContaining({ page: 1 }));
    });

    it('opens create, edit and key dialogs with the selected user', async () => {
        const wrapper = mount(UserList, { global });

        await wrapper.findAll('button').find(button => button.text().includes('新建用户'))?.trigger('click');
        await wrapper.get('button[aria-label="编辑"]').trigger('click');
        await wrapper.get('button[aria-label="编辑 Key"]').trigger('click');

        expect(mocks.child.createOpen).toHaveBeenCalledOnce();
        expect(mocks.child.editOpen).toHaveBeenCalledWith(user);
        expect(mocks.child.keyOpen).toHaveBeenCalledWith(user);
    });

    it('reloads the table after child dialogs report success', async () => {
        mount(UserList, { global });
        mocks.child.createSuccess(user);
        mocks.child.editSuccess(user);
        mocks.child.keySuccess();
        await nextTick();
        await Promise.resolve();

        expect(mocks.userStore.list).toHaveBeenCalledTimes(4);
    });
});
