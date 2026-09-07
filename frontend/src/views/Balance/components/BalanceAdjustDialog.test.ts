import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import type { User } from '@/types/user';

const mocks = vi.hoisted(() => ({
    adjustBalance: vi.fn(),
    notifyRequestError: vi.fn(),
    notifySuccess: vi.fn(),
}));

vi.mock('@/stores/users', () => ({ default: { adjustBalance: mocks.adjustBalance } }));
vi.mock('@/utils/requestFeedback', () => ({
    notifyRequestError: mocks.notifyRequestError,
    notifySuccess: mocks.notifySuccess,
}));

import BalanceAdjustDialog from './BalanceAdjustDialog.vue';

/* eslint-disable vue/one-component-per-file -- test-only Ant Design stubs. */
const ModalStub = defineComponent({
    props: { open: { type: Boolean, default: false } },
    emits: ['update:open', 'ok', 'cancel'],
    template: `
        <div v-if="open" class="modal-stub">
            <slot />
            <button class="modal-ok" type="button" @click="$emit('ok')">确定</button>
            <button class="modal-cancel" type="button" @click="$emit('cancel')">取消</button>
        </div>
    `,
});

const FormStub = defineComponent({
    setup(_, { expose, slots }) {
        expose({ validate: async () => undefined });
        return () => h('form', slots.default?.());
    },
});

const InputNumberStub = defineComponent({
    props: { value: { type: Number, default: 0 } },
    emits: ['update:value'],
    template: '<input class="amount-input" type="number" :value="value" @input="$emit(\'update:value\', Number($event.target.value))">',
});

const RadioGroupStub = defineComponent({
    emits: ['update:value'],
    template: `
        <div class="radio-group">
            <button type="button" class="recharge-option" @click="$emit('update:value', 'recharge')">充值</button>
            <button type="button" class="adjustment-option" @click="$emit('update:value', 'adjustment')">扣减</button>
        </div>
    `,
});

const ContainerStub = defineComponent({
    template: '<div><slot /></div>',
});
/* eslint-enable vue/one-component-per-file */

const global = {
    components: {
        AModal: ModalStub,
        AForm: FormStub,
        AInputNumber: InputNumberStub,
        ARadioGroup: RadioGroupStub,
    },
    stubs: {
        ADescriptions: ContainerStub,
        ADescriptionsItem: ContainerStub,
        AFormItem: ContainerStub,
        ARadio: true,
        AAlert: true,
        ATag: true,
    },
};

const user: User = {
    id: 8,
    name: 'Balance user',
    type: 'normal',
    status: 'active',
    balance: 25_000_000,
    created_at: new Date(0),
    updated_at: new Date(0),
    keys: [],
};

async function mountDialog() {
    const wrapper = mount(BalanceAdjustDialog, { global });
    const vm = wrapper.vm as unknown as { open: (value: User) => void };
    vm.open(user);
    await nextTick();
    return wrapper;
}

describe('BalanceAdjustDialog button actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.adjustBalance.mockResolvedValue({ ...user, balance: 30_000_000 });
    });

    it('submits a recharge and emits success', async () => {
        const wrapper = await mountDialog();

        await wrapper.get('.amount-input').setValue('5.5');
        await wrapper.get('.modal-ok').trigger('click');

        expect(mocks.adjustBalance).toHaveBeenCalledWith(8, 5.5);
        expect(mocks.notifySuccess).toHaveBeenCalledWith('充值成功');
        expect(wrapper.emitted('success')).toHaveLength(1);
        expect(wrapper.find('.modal-stub').exists()).toBe(false);
    });

    it('submits a negative amount for the deduction button path', async () => {
        const wrapper = await mountDialog();

        await wrapper.get('.adjustment-option').trigger('click');
        await wrapper.get('.amount-input').setValue('3');
        await wrapper.get('.modal-ok').trigger('click');

        expect(mocks.adjustBalance).toHaveBeenCalledWith(8, -3);
        expect(mocks.notifySuccess).toHaveBeenCalledWith('扣减成功');
    });

    it('keeps the dialog open and reports a failed adjustment', async () => {
        mocks.adjustBalance.mockRejectedValue(new Error('余额不足'));
        const wrapper = await mountDialog();

        await wrapper.get('.amount-input').setValue('99');
        await wrapper.get('.modal-ok').trigger('click');

        expect(mocks.notifyRequestError).toHaveBeenCalledWith(expect.any(Error), '调整余额失败');
        expect(wrapper.find('.modal-stub').exists()).toBe(true);
    });
});
