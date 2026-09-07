import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import type { User } from '@/types/user';

const mocks = vi.hoisted(() => ({
    users: {
        get: vi.fn(),
        updateKeys: vi.fn(),
    },
    groups: { groups: { value: [] as Array<{ id: number; name: string; status: string }> } },
    models: { models: [] as Array<{ name: string; enable: boolean }> },
    confirm: vi.fn(),
    notifyError: vi.fn(),
    notifyRequestError: vi.fn(),
    notifySuccess: vi.fn(),
}));

vi.mock('@/stores/users', () => ({ default: mocks.users }));
vi.mock('@/stores/groups', () => ({ default: mocks.groups }));
vi.mock('@/stores/models', () => ({ default: mocks.models }));
vi.mock('ant-design-vue/es', () => ({ Modal: { confirm: mocks.confirm } }));
vi.mock('@/utils/requestFeedback', () => ({
    notifyError: mocks.notifyError,
    notifyRequestError: mocks.notifyRequestError,
    notifySuccess: mocks.notifySuccess,
}));

import KeyEdit from './KeyEdit.vue';

/* eslint-disable vue/one-component-per-file -- test-only Ant Design stubs. */
const ButtonStub = defineComponent({
    emits: ['click'],
    template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
});

const ModalStub = defineComponent({
    props: {
        open: { type: Boolean, default: false },
        confirmLoading: { type: Boolean, default: false },
    },
    emits: ['update:open', 'ok', 'cancel'],
    template: `
        <div v-if="open" class="modal-stub">
            <slot />
            <button class="modal-ok" type="button" @click="$emit('ok')">确定</button>
            <button class="modal-cancel" type="button" @click="$emit('cancel')">取消</button>
        </div>
    `,
});

const ContainerStub = defineComponent({
    template: '<div v-bind="$attrs"><slot name="header"/><slot name="extra"/><slot/></div>',
});

const PasswordStub = defineComponent({
    props: { value: { type: String, default: '' } },
    template: '<div class="input-password" :data-value="value"><slot name="addonAfter"/></div>',
});
/* eslint-enable vue/one-component-per-file */

const global = {
    components: {
        AModal: ModalStub,
        AButton: ButtonStub,
        ACollapse: ContainerStub,
        ACollapsePanel: ContainerStub,
        ACard: ContainerStub,
        AInputPassword: PasswordStub,
    },
    stubs: {
        AAlert: true,
        AForm: ContainerStub,
        AFormItem: ContainerStub,
        AEmpty: true,
        ARow: ContainerStub,
        ACol: ContainerStub,
        AInput: true,
        ASelect: true,
        ATextarea: true,
        AInputNumber: true,
        ASwitch: true,
        ADivider: true,
        ATag: true,
        PlusOutlined: true,
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
    keys: [{
        id: 11,
        value: 'key-original',
        groupId: null,
        status: 'active',
        name: 'Primary',
        modelWhitelistEnabled: false,
        modelWhitelist: [],
        ipRestrictionEnabled: false,
        ipWhitelist: [],
        ipBlacklist: [],
        quota: 0,
        rateLimit: 0,
        expiresAt: null,
    }],
};

async function mountEditor(target: User = user) {
    const wrapper = mount(KeyEdit, { global });
    const vm = wrapper.vm as unknown as { open: (value: User) => void };
    vm.open(target);
    await nextTick();
    return wrapper;
}

describe('KeyEdit button actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.users.get.mockReturnValue(null);
        mocks.users.updateKeys.mockResolvedValue(user);
        mocks.groups.groups.value = [];
        mocks.models.models = [];
    });

    it('adds a new key from the add button', async () => {
        const wrapper = await mountEditor();

        expect(wrapper.findAll('.input-password')).toHaveLength(1);
        await wrapper.get('.add-key-button').trigger('click');

        expect(wrapper.findAll('.input-password')).toHaveLength(2);
    });

    it('regenerates a key only after confirmation', async () => {
        const wrapper = await mountEditor();
        const before = wrapper.find('.input-password').attributes('data-value');
        const regenerate = wrapper.findAll('button').find(button => button.text().includes('重新生成'));

        expect(regenerate).toBeDefined();
        await regenerate?.trigger('click');
        expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '确认重新生成 Key' }));

        const options = mocks.confirm.mock.calls[0]?.[0] as { onOk: () => void };
        options.onOk();
        await nextTick();
        expect(wrapper.find('.input-password').attributes('data-value')).not.toBe(before);
        expect(mocks.notifySuccess).toHaveBeenCalledWith('新 Key 已生成，请保存后生效');
    });

    it('removes a key only after the destructive confirmation', async () => {
        const wrapper = await mountEditor();
        const remove = wrapper.findAll('button').find(button => button.text().includes('删除 Key'));

        expect(remove).toBeDefined();
        await remove?.trigger('click');
        expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '确认删除 Key', okType: 'danger' }));

        const options = mocks.confirm.mock.calls[0]?.[0] as { onOk: () => void };
        options.onOk();
        await nextTick();
        expect(wrapper.findAll('.input-password')).toHaveLength(0);
    });

    it('saves edited keys through the modal confirmation button', async () => {
        const wrapper = await mountEditor();

        await wrapper.get('.modal-ok').trigger('click');

        expect(mocks.users.updateKeys).toHaveBeenCalledWith(7, [expect.objectContaining({
            id: 11,
            value: 'key-original',
            groupId: null,
            ipWhitelist: [],
            ipBlacklist: [],
            expiresAt: null,
        })]);
        expect(mocks.notifySuccess).toHaveBeenCalledWith('Key 已更新');
        expect(wrapper.find('.modal-stub').exists()).toBe(false);
    });
});
