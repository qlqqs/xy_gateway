import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import type { Model } from '@/types/model';

const mocks = vi.hoisted(() => ({
    modelsStore: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    groupsStore: { refresh: vi.fn() },
    usersStore: { refresh: vi.fn() },
    modalConfirm: vi.fn<(options: { onOk: () => Promise<void> }) => void>(),
    notifySuccess: vi.fn(),
    notifyWarning: vi.fn(),
    notifyRequestError: vi.fn(),
    notifyError: vi.fn(),
}));

vi.mock('@/stores/models', () => ({ default: mocks.modelsStore }));
vi.mock('@/stores/groups', () => ({ default: mocks.groupsStore }));
vi.mock('@/stores/users', () => ({ default: mocks.usersStore }));
vi.mock('@/stores/vendors', () => ({ default: { vendors: [] } }));
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ moduleBillingEnabled: false }) }));
vi.mock('@/utils/requestFeedback', () => ({
    notifySuccess: mocks.notifySuccess,
    notifyWarning: mocks.notifyWarning,
    notifyRequestError: mocks.notifyRequestError,
    notifyError: mocks.notifyError,
}));
vi.mock('ant-design-vue/es', () => ({ Modal: { confirm: mocks.modalConfirm } }));
vi.mock('@/views/Vendor/DialogTest.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./UpstreamConfig.vue', () => ({
    default: {
        emits: ['update:upstreams'],
        template: '<button class="choose-upstream" @click="$emit(\'update:upstreams\', [{ vendor_id: 7, enabled: true }])">选择上游</button>',
    },
}));

import ModelList from './List.vue';

enableAutoUnmount(afterEach);

/* eslint-disable vue/one-component-per-file -- 本地组件替身保留表单提交、弹窗和表格事件。 */
const ContainerStub = defineComponent({ template: '<div><slot /></div>' });
const FormStub = defineComponent({
    setup(_props, { expose }) {
        expose({ validate: async () => undefined });
    },
    template: '<form @submit.prevent><slot /></form>',
});
const ButtonStub = defineComponent({
    emits: ['click'],
    template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
});
const InputStub = defineComponent({
    props: { value: { type: String, default: '' } },
    emits: ['update:value'],
    template: '<input :value="value" @input="$emit(\'update:value\', $event.target.value)">',
});
const ModalStub = defineComponent({
    props: { open: Boolean },
    template: '<div v-if="open" class="model-dialog"><slot name="title" /><slot /><slot name="footer" /></div>',
});
const TableStub = defineComponent({
    props: { dataSource: { type: Array, default: () => [] } },
    template: '<div><div v-for="record in dataSource" :key="record.id"><slot name="bodyCell" :column="{ key: \'action\' }" :record="record" /></div></div>',
});
/* eslint-enable vue/one-component-per-file */

const model: Model = {
    id: 1,
    name: 'gateway-model',
    mapping: { upstreams: [{ vendor_id: 7, enabled: true }] },
    enable: true,
    prices: null,
    created_at: new Date(0),
    updated_at: new Date(0),
};

const global = {
    components: {
        AForm: FormStub,
        AFormItem: ContainerStub,
        ASpace: ContainerStub,
        ATooltip: ContainerStub,
        ASelect: ContainerStub,
        ASelectOption: ContainerStub,
        AInput: InputStub,
        AButton: ButtonStub,
        AModal: ModalStub,
        ATable: TableStub,
    },
    stubs: {
        ASwitch: true,
        PriceConfig: true,
        UpstreamModel: true,
        DeleteOutlined: true,
        EditOutlined: true,
        ExperimentOutlined: true,
        InfoCircleOutlined: true,
    },
};


async function openWrite(mode: 'create' | 'update') {
    const wrapper = mount(ModelList, { global });
    await flushPromises();
    if (mode === 'create') {
        const createButton = wrapper.findAll('button').find(button => button.text() === '新建模型');
        if (!createButton) throw new Error('未找到新建模型按钮');
        await createButton.trigger('click');
        await wrapper.get('.model-dialog input').setValue('new-model');
        await wrapper.get('.choose-upstream').trigger('click');
    } else {
        await wrapper.get('button[aria-label="编辑"]').trigger('click');
        await wrapper.get('.model-dialog input').setValue('renamed-model');
    }
    return wrapper;
}


async function submitWrite(wrapper: Awaited<ReturnType<typeof openWrite>>) {
    const submitButton = wrapper.findAll('.model-dialog button')
        .find(button => button.text() === '创建' || button.text() === '保存');
    if (!submitButton) throw new Error('未找到保存按钮');
    await submitButton.trigger('click');
    await flushPromises();
}


async function confirmDelete() {
    const wrapper = mount(ModelList, { global });
    await flushPromises();
    await wrapper.get('button[aria-label="删除"]').trigger('click');
    expect(mocks.modelsStore.remove).not.toHaveBeenCalled();
    const confirmation = mocks.modalConfirm.mock.calls[0]?.[0];
    if (!confirmation) throw new Error('未出现删除确认框');
    await confirmation.onOk();
    await flushPromises();
}


describe('Model/List 写后关联刷新', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.modelsStore.list.mockResolvedValue({ list: [model], total: 1 });
        mocks.modelsStore.create.mockResolvedValue(model);
        mocks.modelsStore.update.mockResolvedValue(model);
        mocks.modelsStore.remove.mockResolvedValue({ success: true });
        mocks.groupsStore.refresh.mockResolvedValue(undefined);
        mocks.usersStore.refresh.mockResolvedValue(undefined);
    });

    it.each(['create', 'update'] as const)('%s 成功后刷新两个关联资源及模型列表', async mode => {
        const wrapper = await openWrite(mode);
        expect(mocks.groupsStore.refresh).not.toHaveBeenCalled();
        expect(mocks.usersStore.refresh).not.toHaveBeenCalled();
        await submitWrite(wrapper);

        expect(mocks.modelsStore[mode]).toHaveBeenCalledOnce();
        expect(mocks.groupsStore.refresh).toHaveBeenCalledOnce();
        expect(mocks.usersStore.refresh).toHaveBeenCalledOnce();
        expect(mocks.modelsStore.list).toHaveBeenCalledTimes(2);
        expect(mocks.notifyWarning).not.toHaveBeenCalled();
        expect(mocks.notifyRequestError).not.toHaveBeenCalled();
        expect(mocks.notifySuccess).toHaveBeenCalledWith(mode === 'create' ? '创建成功' : '更新成功');
    });

    it.each([
        ['create', 'groupsStore'],
        ['create', 'usersStore'],
        ['update', 'groupsStore'],
        ['update', 'usersStore'],
    ] as const)('%s 成功但 %s 刷新失败时明确警告', async (mode, resource) => {
        mocks[resource].refresh.mockRejectedValueOnce(new Error('关联刷新失败'));
        const wrapper = await openWrite(mode);
        await submitWrite(wrapper);

        expect(mocks.modelsStore[mode]).toHaveBeenCalledOnce();
        expect(mocks.groupsStore.refresh).toHaveBeenCalledOnce();
        expect(mocks.usersStore.refresh).toHaveBeenCalledOnce();
        expect(mocks.notifyWarning).toHaveBeenCalledExactlyOnceWith('模型已保存，但关联数据刷新失败，请刷新页面');
        expect(mocks.notifyRequestError).not.toHaveBeenCalled();
        expect(mocks.modelsStore.list).toHaveBeenCalledTimes(2);
        // 弹窗只确认主写成功；父页面的警告必须随后补充关联刷新结果。
        expect(mocks.notifyWarning.mock.invocationCallOrder[0]).toBeGreaterThan(
            mocks.notifySuccess.mock.invocationCallOrder[0] ?? 0,
        );
    });

    it.each(['create', 'update'] as const)('%s 写入失败时不刷新或提示成功', async mode => {
        const error = new Error('保存失败');
        mocks.modelsStore[mode].mockRejectedValueOnce(error);
        const wrapper = await openWrite(mode);
        await submitWrite(wrapper);

        expect(mocks.modelsStore[mode]).toHaveBeenCalledOnce();
        expect(mocks.groupsStore.refresh).not.toHaveBeenCalled();
        expect(mocks.usersStore.refresh).not.toHaveBeenCalled();
        expect(mocks.modelsStore.list).toHaveBeenCalledOnce();
        expect(mocks.notifySuccess).not.toHaveBeenCalled();
        expect(mocks.notifyWarning).not.toHaveBeenCalled();
        expect(mocks.notifyRequestError).toHaveBeenCalledWith(error, mode === 'create' ? '创建失败' : '更新失败');
    });

    it('删除及关联刷新均成功时才提示删除成功', async () => {
        await confirmDelete();

        expect(mocks.modelsStore.remove).toHaveBeenCalledWith(model.id);
        expect(mocks.groupsStore.refresh).toHaveBeenCalledOnce();
        expect(mocks.usersStore.refresh).toHaveBeenCalledOnce();
        expect(mocks.notifySuccess).toHaveBeenCalledExactlyOnceWith('删除成功');
        expect(mocks.notifyWarning).not.toHaveBeenCalled();
        expect(mocks.modelsStore.list).toHaveBeenCalledTimes(2);
    });

    it.each(['groupsStore', 'usersStore'] as const)('删除成功但 %s 刷新失败时仅提示警告', async resource => {
        mocks[resource].refresh.mockRejectedValueOnce(new Error('关联刷新失败'));
        await confirmDelete();

        expect(mocks.modelsStore.remove).toHaveBeenCalledWith(model.id);
        expect(mocks.groupsStore.refresh).toHaveBeenCalledOnce();
        expect(mocks.usersStore.refresh).toHaveBeenCalledOnce();
        expect(mocks.notifyWarning).toHaveBeenCalledExactlyOnceWith('模型已删除，但关联数据刷新失败，请刷新页面');
        expect(mocks.notifySuccess).not.toHaveBeenCalled();
        expect(mocks.notifyRequestError).not.toHaveBeenCalled();
        expect(mocks.modelsStore.list).toHaveBeenCalledTimes(2);
    });

    it('删除写入失败时保留错误反馈且不刷新', async () => {
        const error = new Error('删除失败');
        mocks.modelsStore.remove.mockRejectedValueOnce(error);
        await confirmDelete();

        expect(mocks.groupsStore.refresh).not.toHaveBeenCalled();
        expect(mocks.usersStore.refresh).not.toHaveBeenCalled();
        expect(mocks.modelsStore.list).toHaveBeenCalledOnce();
        expect(mocks.notifySuccess).not.toHaveBeenCalled();
        expect(mocks.notifyWarning).not.toHaveBeenCalled();
        expect(mocks.notifyRequestError).toHaveBeenCalledWith(error, '删除失败');
    });
});
