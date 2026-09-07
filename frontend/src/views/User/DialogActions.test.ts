import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import type { User } from '@/types/user';

const mocks = vi.hoisted(() => ({
    create: vi.fn(),
    update: vi.fn(),
    notifySuccess: vi.fn(),
    notifyError: vi.fn(),
    notifyRequestError: vi.fn(),
}));

vi.mock('@/stores/users', () => ({
    default: {
        create: mocks.create,
        update: mocks.update,
    },
}));
vi.mock('@/utils/requestFeedback', () => ({
    notifySuccess: mocks.notifySuccess,
    notifyError: mocks.notifyError,
    notifyRequestError: mocks.notifyRequestError,
}));

import DialogCreate from './DialogCreate.vue';
import DialogEdit from './DialogEdit.vue';

const ModalStub = defineComponent({
    props: {
        open: { type: Boolean, default: false },
        confirmLoading: { type: Boolean, default: false },
    },
    emits: ['ok', 'cancel', 'update:open'],
    template: `
        <div v-if="open" class="modal-stub" :data-loading="confirmLoading ? 'true' : 'false'">
            <slot />
            <button class="modal-ok" type="button" @click="$emit('ok')">确定</button>
            <button class="modal-cancel" type="button" @click="$emit('cancel')">取消</button>
        </div>
    `,
});

const FormStub = defineComponent({
    setup(_, { expose, slots }) {
        const validate = vi.fn().mockResolvedValue(undefined);
        expose({ validate });
        return () => h('form', {}, slots.default?.());
    },
});

const InputStub = defineComponent({
    props: { value: { type: String, default: '' } },
    emits: ['update:value'],
    template: '<input class="text-input" :value="value" @input="$emit(\'update:value\', $event.target.value)">',
});

const SelectStub = defineComponent({
    props: { value: { type: String, default: '' } },
    emits: ['update:value'],
    template: '<select class="select-input" :value="value"><slot /></select>',
});

const SwitchStub = defineComponent({
    props: { checked: { type: String, default: '' } },
    emits: ['update:checked'],
    template: '<input class="status-input" :value="checked" @input="$emit(\'update:checked\', $event.target.value)">',
});

const ContainerStub = defineComponent({ template: '<div><slot /></div>' });
const global = {
    components: {
        AModal: ModalStub,
        AForm: FormStub,
        AFormItem: ContainerStub,
        AInput: InputStub,
        ASelect: SelectStub,
        ASelectOption: ContainerStub,
        ASwitch: SwitchStub,
    },
};

const user: User = {
    id: 8,
    name: 'Bob',
    type: 'normal',
    status: 'active',
    balance: 0,
    created_at: new Date(0),
    updated_at: new Date(0),
    keys: [],
};

describe('user create/edit dialog actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.create.mockResolvedValue(user);
        mocks.update.mockResolvedValue(user);
    });

    it('submits the create form and emits the created user', async () => {
        const wrapper = mount(DialogCreate, { global });
        (wrapper.vm as unknown as { open: () => void }).open();
        await nextTick();
        await wrapper.get('.text-input').setValue('New user');
        await wrapper.get('.modal-ok').trigger('click');

        expect(mocks.create).toHaveBeenCalledWith({ name: 'New user', type: 'normal' });
        expect(mocks.notifySuccess).toHaveBeenCalledWith('创建成功');
        expect(wrapper.emitted('success')).toHaveLength(1);
        expect(wrapper.find('.modal-stub').exists()).toBe(false);
    });

    it('reports create failures and leaves the dialog open for correction', async () => {
        mocks.create.mockRejectedValue(new Error('duplicate'));
        const wrapper = mount(DialogCreate, { global });
        (wrapper.vm as unknown as { open: () => void }).open();
        await nextTick();
        await wrapper.get('.text-input').setValue('Duplicate');
        await wrapper.get('.modal-ok').trigger('click');

        expect(mocks.notifyRequestError).toHaveBeenCalledWith(expect.any(Error), '表单校验失败');
        expect(wrapper.find('.modal-stub').exists()).toBe(true);
    });

    it('keeps the create action busy until the request settles', async () => {
        let resolveCreate: (value: User) => void = () => undefined;
        mocks.create.mockReturnValue(new Promise<User>((resolve) => {
            resolveCreate = resolve;
        }));
        const wrapper = mount(DialogCreate, { global });
        (wrapper.vm as unknown as { open: () => void }).open();
        await nextTick();
        await wrapper.get('.text-input').setValue('Slow user');
        await wrapper.get('.modal-ok').trigger('click');
        await nextTick();

        expect(wrapper.get('.modal-stub').attributes('data-loading')).toBe('true');
        resolveCreate(user);
        await nextTick();
        await Promise.resolve();
        expect(wrapper.find('.modal-stub').exists()).toBe(false);
    });

    it('submits edited name/status and resets loading after success', async () => {
        const wrapper = mount(DialogEdit, { global });
        (wrapper.vm as unknown as { open: (value: User) => void }).open(user);
        await nextTick();
        await wrapper.get('.text-input').setValue('Renamed');
        await wrapper.get('.status-input').setValue('disabled');
        await wrapper.get('.modal-ok').trigger('click');

        expect(mocks.update).toHaveBeenCalledWith(8, { name: 'Renamed', status: 'disabled' });
        expect(mocks.notifySuccess).toHaveBeenCalledWith('更新成功');
        expect(wrapper.find('.modal-stub').exists()).toBe(false);
    });

    it('does not call update when the opened user has an invalid id', async () => {
        const wrapper = mount(DialogEdit, { global });
        (wrapper.vm as unknown as { open: (value: User) => void }).open({ ...user, id: 0 });
        await nextTick();
        await wrapper.get('.modal-ok').trigger('click');

        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.notifyError).toHaveBeenCalledWith('用户 ID 无效');
    });
});
