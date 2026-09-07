import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { GroupRecord } from '@/types/group';

const mocks = vi.hoisted(() => ({
    groupStore: {
        groups: { value: [] as GroupRecord[] },
        ensureLoaded: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
    },
    modelsStore: {
        models: [] as Array<{ name: string }>,
        ensureLoaded: vi.fn(),
    },
    usersStore: { refresh: vi.fn() },
    vendorsStore: { refresh: vi.fn() },
    modalConfirm: vi.fn(),
    messageSuccess: vi.fn(),
    messageError: vi.fn(),
    validate: vi.fn(),
}));

vi.mock('@/stores/groups', () => ({ default: mocks.groupStore }));
vi.mock('@/stores/models', () => ({ default: mocks.modelsStore }));
vi.mock('@/stores/users', () => ({ default: mocks.usersStore }));
vi.mock('@/stores/vendors', () => ({ default: mocks.vendorsStore }));
vi.mock('ant-design-vue/es', () => ({
    Modal: { confirm: mocks.modalConfirm },
    message: { success: mocks.messageSuccess, error: mocks.messageError },
}));

import GroupList from './List.vue';

/* eslint-disable vue/one-component-per-file -- local interaction stubs keep the test independent of Ant Design DOM. */
const FormStub = defineComponent({
    emits: ['finish'],
    setup(_, { expose }) {
        expose({ validate: () => mocks.validate() });
        return {};
    },
    template: '<form class="form-stub" @submit.prevent="$emit(\'finish\', {})"><slot /></form>',
});

const InputStub = defineComponent({
    inheritAttrs: false,
    props: { value: { type: [String, Number], default: '' } },
    emits: ['update:value'],
    template: '<input v-bind="$attrs" :value="value" @input="$emit(\'update:value\', $event.target.value)">',
});

const TextareaStub = InputStub;

const SelectStub = defineComponent({
    inheritAttrs: false,
    props: {
        value: { type: [String, Number, Array], default: undefined },
        options: { type: Array, default: () => [] },
    },
    emits: ['update:value', 'change'],
    methods: {
        handleChange(event: Event) {
            const target = event.target as HTMLSelectElement;
            const value = target.value || undefined;
            this.$emit('update:value', value);
            this.$emit('change', value);
        },
    },
    template: '<select v-bind="$attrs" :value="value ?? \'\'" @change="handleChange"><option value="">全部</option><option v-for="option in options" :key="String(option.value)" :value="option.value">{{ option.label }}</option><slot /></select>',
});

const ButtonStub = defineComponent({
    inheritAttrs: false,
    props: { disabled: { type: Boolean, default: false }, loading: { type: Boolean, default: false } },
    emits: ['click'],
    template: '<button v-bind="$attrs" :disabled="disabled" :data-loading="loading ? \'true\' : \'false\'" @click="$emit(\'click\', $event)"><slot /></button>',
});

const ModalStub = defineComponent({
    inheritAttrs: false,
    props: { open: { type: Boolean, default: false }, confirmLoading: { type: Boolean, default: false } },
    emits: ['update:open', 'ok', 'cancel'],
    template: '<div v-if="open" class="modal-stub"><slot /><button class="modal-ok" :data-loading="confirmLoading ? \'true\' : \'false\'" @click="$emit(\'ok\')">确定</button><button class="modal-cancel" @click="$emit(\'cancel\')">取消</button></div>',
});

const TableStub = defineComponent({
    inheritAttrs: false,
    props: { columns: { type: Array, default: () => [] }, dataSource: { type: Array, default: () => [] }, loading: Boolean },
    emits: ['change'],
    template: '<div class="table-stub"><div v-for="record in dataSource" :key="record.id" class="table-row"><template v-for="column in columns" :key="String(column.key)"><slot name="bodyCell" :column="column" :record="record" /></template></div></div>',
});

const PassthroughStub = defineComponent({ template: '<div><slot /></div>' });
const SwitchStub = defineComponent({
    inheritAttrs: false,
    props: { checked: { type: Boolean, default: false }, disabled: Boolean },
    emits: ['update:checked', 'change'],
    template: '<button class="switch-stub" :disabled="disabled" :aria-pressed="checked" @click="$emit(\'update:checked\', !checked); $emit(\'change\', !checked)"><slot /></button>',
});
const NumberStub = defineComponent({
    inheritAttrs: false,
    props: { value: { type: Number, default: 0 } },
    emits: ['update:value'],
    template: '<input v-bind="$attrs" type="number" :value="value" @input="$emit(\'update:value\', Number($event.target.value))">',
});
const RadioGroupStub = defineComponent({
    inheritAttrs: false,
    props: { value: { type: String, default: '' } },
    emits: ['update:value'],
    template: '<div class="radio-group-stub"><slot /></div>',
});
/* eslint-enable vue/one-component-per-file */

const global = {
    components: {
        AForm: FormStub,
        AFormItem: PassthroughStub,
        AInput: InputStub,
        ATextarea: TextareaStub,
        ASelect: SelectStub,
        ASelectOption: PassthroughStub,
        AButton: ButtonStub,
        AModal: ModalStub,
        ATable: TableStub,
        ASpace: PassthroughStub,
        ATag: PassthroughStub,
        ATooltip: PassthroughStub,
        ASwitch: SwitchStub,
        AInputNumber: NumberStub,
        ARadioGroup: RadioGroupStub,
        ARadio: PassthroughStub,
    },
    stubs: {
        DeleteOutlined: true,
        EditOutlined: true,
        PlusOutlined: true,
    },
};

const groupA: GroupRecord = {
    id: 1,
    name: 'Alpha',
    description: 'primary traffic',
    inboundProtocols: ['openai_responses'],
    customModels: [],
    whitelistEnabled: false,
    rateMultiplier: 1,
    status: 'active',
    updatedAt: '2026-09-07T00:00:00Z',
    channelCount: 2,
};

const groupB: GroupRecord = {
    id: 2,
    name: 'Beta',
    description: 'legacy traffic',
    inboundProtocols: ['anthropic'],
    customModels: ['claude'],
    whitelistEnabled: true,
    rateMultiplier: 1.25,
    status: 'disabled',
    updatedAt: '2026-09-07T00:00:00Z',
    channelCount: 0,
};

function mountList() {
    return mount(GroupList, { global });
}

describe('Group/List user actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.groupStore.groups = ref([groupA, groupB]);
        mocks.modelsStore.models = [{ name: 'gpt-4o' }];
        mocks.groupStore.ensureLoaded.mockResolvedValue(undefined);
        mocks.modelsStore.ensureLoaded.mockResolvedValue(undefined);
        mocks.usersStore.refresh.mockResolvedValue(undefined);
        mocks.vendorsStore.refresh.mockResolvedValue(undefined);
        mocks.groupStore.create.mockResolvedValue({ ...groupA, id: 3, name: 'Created' });
        mocks.groupStore.update.mockResolvedValue({ ...groupA, name: 'Updated' });
        mocks.groupStore.remove.mockResolvedValue(true);
        mocks.validate.mockResolvedValue(undefined);
    });

    it('filters by keyword only after search and resets the filter', async () => {
        const wrapper = mountList();
        await flushPromises();

        const keyword = wrapper.get('input[placeholder="搜索分组名称"]');
        await keyword.setValue('beta');
        expect(wrapper.text()).toContain('Alpha');
        await wrapper.findAll('button').find((button) => button.text() === '搜索')?.trigger('click');
        expect(wrapper.text()).toContain('Beta');
        expect(wrapper.text()).not.toContain('Alpha');

        await wrapper.findAll('button').find((button) => button.text() === '重置')?.trigger('click');
        expect((keyword.element as HTMLInputElement).value).toBe('');
        expect(wrapper.text()).toContain('Alpha');
        expect(wrapper.text()).toContain('Beta');
    });

    it('creates a group from the modal and reports success', async () => {
        const wrapper = mountList();
        await flushPromises();
        await wrapper.findAll('button').find((button) => button.text().includes('新建分组'))?.trigger('click');
        await wrapper.get('input[placeholder="请输入分组名称"]').setValue('Created');
        await wrapper.get('.modal-ok').trigger('click');
        await flushPromises();

        expect(mocks.groupStore.create).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Created',
            inboundProtocols: ['openai_responses'],
            status: 'active',
        }));
        expect(mocks.messageSuccess).toHaveBeenCalledWith('分组已创建');
        expect(wrapper.find('.modal-stub').exists()).toBe(false);
    });

    it('updates an existing group and restores loading after a failed save', async () => {
        const wrapper = mountList();
        await flushPromises();
        await wrapper.get('button[aria-label="编辑"]').trigger('click');
        await wrapper.get('input[placeholder="请输入分组名称"]').setValue('Renamed');
        mocks.groupStore.update.mockRejectedValueOnce(new Error('保存失败'));
        await wrapper.get('.modal-ok').trigger('click');
        await flushPromises();

        expect(mocks.groupStore.update).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'Renamed' }));
        expect(mocks.messageError).toHaveBeenCalledWith('保存失败');
        expect(wrapper.get('.modal-ok').attributes('data-loading')).toBe('false');
    });

    it('requires form validation before writing a new group', async () => {
        mocks.validate.mockRejectedValueOnce(new Error('invalid'));
        const wrapper = mountList();
        await flushPromises();
        await wrapper.findAll('button').find((button) => button.text().includes('新建分组'))?.trigger('click');
        await wrapper.get('.modal-ok').trigger('click');
        await flushPromises();

        expect(mocks.groupStore.create).not.toHaveBeenCalled();
        expect(mocks.messageError).not.toHaveBeenCalled();
    });

    it('deletes only after confirmation and refreshes related resources', async () => {
        const wrapper = mountList();
        await flushPromises();
        await wrapper.get('button[aria-label="删除"]').trigger('click');

        expect(mocks.modalConfirm).toHaveBeenCalledTimes(1);
        expect(mocks.groupStore.remove).not.toHaveBeenCalled();
        const config = mocks.modalConfirm.mock.calls[0]?.[0] as { onOk: () => Promise<void> };
        await config.onOk();

        expect(mocks.groupStore.remove).toHaveBeenCalledWith(1);
        expect(mocks.usersStore.refresh).toHaveBeenCalledTimes(1);
        expect(mocks.vendorsStore.refresh).toHaveBeenCalledTimes(1);
        expect(mocks.messageSuccess).toHaveBeenCalledWith('分组已删除');
    });

    it('shows a delete error and leaves related state untouched when removal fails', async () => {
        mocks.groupStore.remove.mockResolvedValueOnce(false);
        const wrapper = mountList();
        await flushPromises();
        await wrapper.get('button[aria-label="删除"]').trigger('click');
        const config = mocks.modalConfirm.mock.calls[0]?.[0] as { onOk: () => Promise<void> };
        await config.onOk();

        expect(mocks.messageError).toHaveBeenCalledWith('分组删除失败，请稍后重试');
        expect(mocks.usersStore.refresh).not.toHaveBeenCalled();
        expect(mocks.vendorsStore.refresh).not.toHaveBeenCalled();
    });
});
