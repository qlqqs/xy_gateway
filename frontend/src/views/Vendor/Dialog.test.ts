import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { Vendor } from '@/types/vendor';
import ModelSelect from './ModelSelect.vue';

const mocks = vi.hoisted(() => ({
    vendorsStore: {
        previewModels: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
    },
    groupsStore: {
        groups: { value: [] as Array<{ id: number; name: string; status: string }> },
        ensureLoaded: vi.fn().mockResolvedValue(undefined),
    },
    notifySuccess: vi.fn(),
    notifyError: vi.fn(),
    notifyRequestError: vi.fn(),
    validate: vi.fn(),
}));

vi.mock('@/stores/vendors', () => ({ default: mocks.vendorsStore }));
vi.mock('@/stores/groups', () => ({ default: mocks.groupsStore }));
vi.mock('@/utils/requestFeedback', () => ({
    notifySuccess: mocks.notifySuccess,
    notifyError: mocks.notifyError,
    notifyRequestError: mocks.notifyRequestError,
}));

import DialogCreate from './DialogCreate.vue';
import DialogEdit from './DialogEdit.vue';

/* eslint-disable vue/one-component-per-file -- compact form controls expose only user-facing events. */
const FormStub = defineComponent({
    setup(_, { expose }) {
        expose({ validate: () => mocks.validate() });
        return {};
    },
    template: '<form><slot /></form>',
});

const ModalStub = defineComponent({
    inheritAttrs: false,
    props: { open: { type: Boolean, default: false }, confirmLoading: Boolean },
    emits: ['update:open', 'ok', 'cancel'],
    template: '<div v-if="open" class="modal-stub"><slot /><button class="modal-ok" :data-loading="confirmLoading ? \'true\' : \'false\'" @click="$emit(\'ok\')">保存</button><button class="modal-cancel" @click="$emit(\'cancel\')">取消</button></div>',
});

const InputStub = defineComponent({
    inheritAttrs: false,
    props: { value: { type: [String, Number], default: '' } },
    emits: ['update:value'],
    template: '<input v-bind="$attrs" :value="value" @input="$emit(\'update:value\', $event.target.value)">',
});

const TextareaStub = defineComponent({
    inheritAttrs: false,
    props: { value: { type: String, default: '' } },
    emits: ['update:value'],
    template: '<textarea v-bind="$attrs" :value="value" @input="$emit(\'update:value\', $event.target.value)"></textarea>',
});

const SelectStub = defineComponent({
    inheritAttrs: false,
    props: {
        value: { type: [String, Number, Array], default: undefined },
        options: { type: Array, default: () => [] },
        open: Boolean,
    },
    emits: ['update:value', 'update:open', 'change', 'search', 'dropdownVisibleChange'],
    methods: {
        handleChange(event: Event) {
            const target = event.target as HTMLSelectElement;
            const value = target.value || undefined;
            this.$emit('update:value', value);
            this.$emit('change', value);
        },
    },
    template: '<select v-bind="$attrs" :value="Array.isArray(value) ? value[0] : (value ?? \'\')" @change="handleChange"><option value="">请选择</option><option v-for="option in options" :key="String(option.value)" :value="option.value">{{ option.label }}</option><slot /></select>',
});

const ButtonStub = defineComponent({
    inheritAttrs: false,
    props: { disabled: Boolean, loading: Boolean },
    emits: ['click'],
    template: '<button v-bind="$attrs" :disabled="disabled" :data-loading="loading ? \'true\' : \'false\'" @click="$emit(\'click\', $event)"><slot /></button>',
});

const NumberStub = defineComponent({
    inheritAttrs: false,
    props: { value: { type: Number, default: 0 } },
    emits: ['update:value'],
    template: '<input v-bind="$attrs" type="number" :value="value" @input="$emit(\'update:value\', Number($event.target.value))">',
});

const SwitchStub = defineComponent({
    inheritAttrs: false,
    props: { checked: Boolean, disabled: Boolean },
    emits: ['update:checked', 'change'],
    template: '<button v-bind="$attrs" class="switch-stub" :disabled="disabled" @click="$emit(\'update:checked\', !checked); $emit(\'change\', !checked)"><slot /></button>',
});

const PassthroughStub = defineComponent({ template: '<div><slot /></div>' });
const SelectOptionStub = defineComponent({
    inheritAttrs: false,
    props: { value: { type: [String, Number], default: '' } },
    template: '<option :value="value"><slot /></option>',
});
/* eslint-enable vue/one-component-per-file */

const global = {
    components: {
        AModal: ModalStub,
        AForm: FormStub,
        AFormItem: PassthroughStub,
        AInput: InputStub,
        AInputPassword: InputStub,
        ATextarea: TextareaStub,
        ASelect: SelectStub,
        ASelectOption: SelectOptionStub,
        AButton: ButtonStub,
        AInputNumber: NumberStub,
        ASwitch: SwitchStub,
        ARadioGroup: PassthroughStub,
        ARadio: PassthroughStub,
        ASpace: PassthroughStub,
        AAlert: PassthroughStub,
        ARow: PassthroughStub,
        ACol: PassthroughStub,
    },
};

const vendor: Vendor = {
    id: 9,
    type: 'openai',
    name: 'Existing channel',
    token: 'old-token',
    urls: { openai: 'https://api.example.test/v1/chat/completions' },
    config: {
        channel_code: 'existing',
        supplier_name: 'Example Inc',
        api_type: 'openai',
        openai_protocol: 'chat_completions',
        available_models: ['gpt-4o'],
        status: 'active',
        auth_mode: 'bearer_token',
        concurrency: 2,
        priority: 3,
        group_id: 4,
    },
    model_count: 1,
    created_at: new Date('2026-09-07T00:00:00Z'),
    updated_at: new Date('2026-09-07T00:00:00Z'),
};

function exposed<T>(wrapper: { vm: unknown }): T {
    return wrapper.vm as T;
}

describe('Vendor create/edit dialogs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.groupsStore.groups = ref([{ id: 4, name: 'Production', status: 'active' }]);
        mocks.groupsStore.ensureLoaded.mockResolvedValue(undefined);
        mocks.validate.mockResolvedValue(undefined);
        mocks.vendorsStore.previewModels.mockResolvedValue({ models: ['gpt-4o', 'gpt-4.1'] });
        mocks.vendorsStore.create.mockResolvedValue({ ...vendor, id: 10 });
        mocks.vendorsStore.update.mockResolvedValue({ ...vendor, name: 'Updated channel' });
    });

    it('keeps create and edit dialogs closed when groups fail to load', async () => {
        const error = new Error('groups unavailable');
        mocks.groupsStore.ensureLoaded.mockRejectedValue(error);
        const createWrapper = mount(DialogCreate, { global });
        const editWrapper = mount(DialogEdit, { global });

        await exposed<{ open: () => Promise<void> }>(createWrapper).open();
        await exposed<{ open: (value: Vendor) => Promise<void> }>(editWrapper).open(vendor);
        await flushPromises();

        expect(createWrapper.find('.modal-stub').exists()).toBe(false);
        expect(editWrapper.find('.modal-stub').exists()).toBe(false);
        expect(mocks.notifyRequestError).toHaveBeenNthCalledWith(1, error, '加载分组失败');
        expect(mocks.notifyRequestError).toHaveBeenNthCalledWith(2, error, '加载分组失败');
        expect(mocks.vendorsStore.create).not.toHaveBeenCalled();
        expect(mocks.vendorsStore.update).not.toHaveBeenCalled();
    });

    it('opens a create dialog, switches protocol endpoint, fetches models, and submits a complete payload', async () => {
        const wrapper = mount(DialogCreate, { global });
        exposed<{ open: () => void }>(wrapper).open();
        await flushPromises();
        expect(mocks.groupsStore.ensureLoaded).toHaveBeenCalledTimes(1);

        await wrapper.get('input[placeholder="例如：prod-openai-01"]').setValue('prod-01');
        await wrapper.get('input[placeholder="例如：星河云计算有限公司"]').setValue('Example Inc');
        await wrapper.get('input[placeholder="例如：生产环境主通道"]').setValue('Production channel');
        await wrapper.get('input[placeholder="https://api.example.com/v1"]').setValue('https://api.example.test/v1/chat/completions');
        await wrapper.get('input[placeholder="请输入或自定义 Bearer Token"]').setValue('new-token');

        const selects = wrapper.findAll('select');
        await selects[1]?.setValue('responses');
        expect((wrapper.get('input[placeholder="https://api.example.com/v1"]').element as HTMLInputElement).value).toBe('https://api.example.test/v1/responses');

        await wrapper.findAll('button').find((button) => button.text().includes('自动获取模型'))?.trigger('click');
        await flushPromises();
        expect(mocks.vendorsStore.previewModels).toHaveBeenCalledWith(expect.objectContaining({
            type: 'openai',
            token: 'new-token',
            urls: { openai: 'https://api.example.test/v1/chat/completions' },
            config: expect.objectContaining({
                auth_mode: 'bearer_token',
                api_type: 'openai',
                openai_protocol: 'responses',
            }),
        }));
        const modelSelect = wrapper.findComponent(ModelSelect);
        expect(wrapper.text()).toContain('已获取 2 个模型，请从下拉列表选择。');
        expect(modelSelect.props('options')).toEqual(['gpt-4o', 'gpt-4.1']);
        expect(modelSelect.props('open')).toBe(true);
        expect(modelSelect.props('value')).toEqual([]);

        modelSelect.vm.$emit('update:value', ['gpt-4.1']);
        await flushPromises();

        await wrapper.get('.modal-ok').trigger('click');
        await flushPromises();
        expect(mocks.vendorsStore.create).toHaveBeenCalledWith(expect.objectContaining({
            type: 'openai',
            name: 'Production channel',
            token: 'new-token',
            urls: { responses: 'https://api.example.test/v1/responses' },
            config: expect.objectContaining({
                channel_code: 'prod-01',
                supplier_name: 'Example Inc',
                group_id: null,
                group_ids: [],
                available_models: ['gpt-4.1'],
            }),
        }));
        expect(mocks.notifySuccess).toHaveBeenCalledWith('创建成功');
        expect(wrapper.emitted('success')).toHaveLength(1);
        expect(wrapper.find('.modal-stub').exists()).toBe(false);
    });

    it('shows model-fetch errors and restores the loading state', async () => {
        mocks.vendorsStore.previewModels.mockRejectedValueOnce(new Error('bad credentials'));
        const wrapper = mount(DialogCreate, { global });
        exposed<{ open: () => void }>(wrapper).open();
        await flushPromises();
        await wrapper.get('input[placeholder="https://api.example.com/v1"]').setValue('https://api.example.test/v1');
        await wrapper.get('input[placeholder="请输入或自定义 Bearer Token"]').setValue('test-token');
        await wrapper.findAll('button').find((button) => button.text().includes('自动获取模型'))?.trigger('click');
        await flushPromises();

        expect(wrapper.text()).toContain('模型获取失败，请检查 API 地址和认证凭证。');
        const fetchButton = wrapper.findAll('button').find((button) => button.text().includes('自动获取模型'));
        expect(fetchButton?.attributes('data-loading')).toBe('false');
    });

    it('reports an empty model response without opening an empty choices list', async () => {
        mocks.vendorsStore.previewModels.mockResolvedValueOnce({ models: [] });
        const wrapper = mount(DialogCreate, { global });
        exposed<{ open: () => void }>(wrapper).open();
        await flushPromises();
        await wrapper.get('input[placeholder="https://api.example.com/v1"]').setValue('https://api.example.test/v1');
        await wrapper.get('input[placeholder="请输入或自定义 Bearer Token"]').setValue('test-token');
        await wrapper.findAll('button').find((button) => button.text().includes('自动获取模型'))?.trigger('click');
        await flushPromises();

        const modelSelect = wrapper.findComponent(ModelSelect);
        expect(wrapper.text()).toContain('接口未返回可用模型，请检查地址或改为手动输入。');
        expect(wrapper.text()).not.toContain('请从下拉列表选择');
        expect(modelSelect.props('options')).toEqual([]);
        expect(modelSelect.props('open')).toBe(false);
        expect(modelSelect.props('value')).toEqual([]);
    });

    it('does not call create when form validation rejects and reports the failure', async () => {
        mocks.validate.mockRejectedValueOnce(new Error('invalid form'));
        const wrapper = mount(DialogCreate, { global });
        exposed<{ open: () => void }>(wrapper).open();
        await flushPromises();
        await wrapper.get('.modal-ok').trigger('click');
        await flushPromises();

        expect(mocks.vendorsStore.create).not.toHaveBeenCalled();
        expect(mocks.notifyRequestError).toHaveBeenCalledWith(expect.any(Error), '创建失败');
    });

    it('omits the OpenAI-only protocol field when creating an Anthropic vendor', async () => {
        const wrapper = mount(DialogCreate, { global });
        exposed<{ open: () => void }>(wrapper).open();
        await flushPromises();

        const typeSelect = wrapper.findAll('select')[0];
        await typeSelect?.setValue('anthropic');
        await wrapper.get('.modal-ok').trigger('click');
        await flushPromises();

        const payload = mocks.vendorsStore.create.mock.calls[mocks.vendorsStore.create.mock.calls.length - 1]?.[0];
        expect(payload.config).toMatchObject({ api_type: 'anthropic', auth_mode: 'api_key' });
        expect(payload.config).not.toHaveProperty('openai_protocol');
    });

    it('opens fetched model choices in the edit dialog without changing existing selections', async () => {
        const wrapper = mount(DialogEdit, { global });
        exposed<{ open: (value: Vendor) => void }>(wrapper).open(vendor);
        await flushPromises();

        await wrapper.findAll('button').find((button) => button.text().includes('自动获取模型'))?.trigger('click');
        await flushPromises();

        const modelSelect = wrapper.findComponent(ModelSelect);
        expect(wrapper.text()).toContain('已获取 2 个模型，请从下拉列表选择。');
        expect(modelSelect.props('options')).toEqual(['gpt-4o', 'gpt-4.1']);
        expect(modelSelect.props('open')).toBe(true);
        expect(modelSelect.props('value')).toEqual(['gpt-4o']);
    });

    it('loads an existing vendor, converts protocol URLs, and submits an update', async () => {
        const wrapper = mount(DialogEdit, { global });
        exposed<{ open: (value: Vendor) => void }>(wrapper).open(vendor);
        await flushPromises();

        expect((wrapper.get('input[placeholder="请输入或自定义 API Key / Token"]').element as HTMLInputElement).value).toBe('old-token');
        const selects = wrapper.findAll('select');
        await selects[1]?.setValue('responses');
        expect((wrapper.get('input').element as HTMLInputElement).value).toBe('existing');
        expect(wrapper.find('input').exists()).toBe(true);

        await wrapper.get('.modal-ok').trigger('click');
        await flushPromises();
        expect(mocks.vendorsStore.update).toHaveBeenCalledWith(9, expect.objectContaining({
            name: 'Existing channel',
            urls: { responses: 'https://api.example.test/v1/responses' },
            config: expect.objectContaining({ group_id: 4, group_ids: [4], available_models: ['gpt-4o'] }),
        }));
        expect(mocks.notifySuccess).toHaveBeenCalledWith('更新成功');
        expect(wrapper.emitted('success')).toHaveLength(1);
    });

    it('round-trips multiple groups and preserves an explicit clear', async () => {
        mocks.groupsStore.groups = ref([
            { id: 4, name: 'Production', status: 'active' },
            { id: 5, name: 'Fallback', status: 'active' },
        ]);
        const multiGroupVendor: Vendor = {
            ...vendor,
            config: {
                ...vendor.config,
                group_id: 4,
                group_ids: [4, 5],
            },
        };
        const wrapper = mount(DialogEdit, { global });
        exposed<{ open: (value: Vendor) => void }>(wrapper).open(multiGroupVendor);
        await flushPromises();

        const groupSelect = wrapper.findAllComponents(SelectStub)
            .find(component => component.attributes('mode') === 'multiple');
        expect(groupSelect?.props('value')).toEqual([4, 5]);

        groupSelect?.vm.$emit('update:value', [5, 4]);
        await wrapper.get('.modal-ok').trigger('click');
        await flushPromises();
        expect(mocks.vendorsStore.update).toHaveBeenLastCalledWith(9, expect.objectContaining({
            config: expect.objectContaining({ group_id: 5, group_ids: [5, 4] }),
        }));

        exposed<{ open: (value: Vendor) => void }>(wrapper).open(multiGroupVendor);
        await flushPromises();
        const reopenedGroupSelect = wrapper.findAllComponents(SelectStub)
            .find(component => component.attributes('mode') === 'multiple');
        reopenedGroupSelect?.vm.$emit('update:value', []);
        await wrapper.get('.modal-ok').trigger('click');
        await flushPromises();
        expect(mocks.vendorsStore.update).toHaveBeenLastCalledWith(9, expect.objectContaining({
            config: expect.objectContaining({ group_id: null, group_ids: [] }),
        }));
    });

    it('handles update failures and allows cancelling without a write', async () => {
        mocks.vendorsStore.update.mockRejectedValueOnce(new Error('server rejected'));
        const wrapper = mount(DialogEdit, { global });
        exposed<{ open: (value: Vendor) => void }>(wrapper).open(vendor);
        await flushPromises();
        await wrapper.get('.modal-ok').trigger('click');
        await flushPromises();

        expect(mocks.notifyRequestError).toHaveBeenCalledWith(expect.any(Error), '更新失败');
        expect(wrapper.get('.modal-ok').attributes('data-loading')).toBe('false');
        await wrapper.get('.modal-cancel').trigger('click');
        expect(wrapper.find('.modal-stub').exists()).toBe(false);
    });

    it('omits the OpenAI-only protocol field when editing an Anthropic vendor', async () => {
        const anthropicVendor: Vendor = {
            ...vendor,
            type: 'anthropic',
            config: {
                ...vendor.config,
                api_type: 'anthropic',
                auth_mode: 'api_key',
                openai_protocol: undefined,
            },
        };
        const wrapper = mount(DialogEdit, { global });
        exposed<{ open: (value: Vendor) => void }>(wrapper).open(anthropicVendor);
        await flushPromises();
        await wrapper.get('.modal-ok').trigger('click');
        await flushPromises();

        const payload = mocks.vendorsStore.update.mock.calls[mocks.vendorsStore.update.mock.calls.length - 1]?.[1];
        expect(payload.config).toMatchObject({ api_type: 'anthropic', auth_mode: 'api_key' });
        expect(payload.config).not.toHaveProperty('openai_protocol');
    });

    it('infers a legacy custom Anthropic vendor without changing its protocol on save', async () => {
        const legacyVendor: Vendor = {
            ...vendor,
            type: 'other',
            urls: { anthropic: 'https://legacy.example.test/v1/messages' },
            config: { ...vendor.config, api_type: undefined, openai_protocol: undefined },
        };
        const wrapper = mount(DialogEdit, { global });
        exposed<{ open: (value: Vendor) => void }>(wrapper).open(legacyVendor);
        await flushPromises();
        await wrapper.get('.modal-ok').trigger('click');
        await flushPromises();

        const calls = mocks.vendorsStore.update.mock.calls;
        const payload = calls[calls.length - 1]?.[1];
        expect(payload.urls).toEqual({ anthropic: 'https://legacy.example.test/v1/messages' });
        expect(payload.config).toMatchObject({ api_type: 'anthropic', auth_mode: 'bearer_token' });
        expect(payload.config).not.toHaveProperty('openai_protocol');
    });

    it('uses the preset endpoint when editing a vendor without stored URLs', async () => {
        const presetVendor: Vendor = {
            ...vendor,
            type: 'openrouter',
            urls: {},
            config: { ...vendor.config, api_type: 'openai', openai_protocol: 'chat_completions' },
        };
        const wrapper = mount(DialogEdit, { global });
        exposed<{ open: (value: Vendor) => void }>(wrapper).open(presetVendor);
        await flushPromises();
        await wrapper.get('.modal-ok').trigger('click');
        await flushPromises();

        const calls = mocks.vendorsStore.update.mock.calls;
        const payload = calls[calls.length - 1]?.[1];
        expect(payload.urls).toEqual({ openai: 'https://openrouter.ai/api/v1/chat/completions' });
    });
});

describe('Vendor model select', () => {
    it('bridges Ant Design dropdown visibility changes to the open model', async () => {
        const wrapper = mount(ModelSelect, {
            props: {
                value: [],
                options: ['gpt-4o'],
                loading: false,
                open: false,
            },
            global,
        });

        wrapper.findComponent(SelectStub).vm.$emit('dropdownVisibleChange', true);
        await flushPromises();

        expect(wrapper.emitted('update:open')).toEqual([[true]]);
    });
});
