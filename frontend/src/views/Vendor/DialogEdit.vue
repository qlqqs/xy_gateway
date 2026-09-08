<template>
    <a-modal
        v-model:open="visible"
        title="编辑供应商"
        @ok="handleOk"
        @cancel="handleCancel"
        :confirm-loading="loading"
        width="680px"
        :style="{ top: '5vh' }"
    >
        <a-form
            :model="formState"
            :rules="rules"
            layout="vertical"
            ref="formRef"
            class="vendor-edit-form"
        >
            <a-form-item label="通道编码"><a-input v-model:value="formState.channel_code" :maxlength="64" /></a-form-item>
            <a-form-item label="供应商名称" name="supplier_name"><a-input v-model:value="formState.supplier_name" /></a-form-item>
            <a-form-item label="通道名称" name="name"><a-input v-model:value="formState.name" /></a-form-item>
            <a-form-item label="接口类型" name="type"><a-select v-model:value="formState.type" placeholder="请选择接口类型" show-search option-filter-prop="label" :options="vendorTypeOptions" @change="handleTypeChange" /></a-form-item>
            <a-form-item v-if="formState.api_type === 'openai'" label="OpenAI 接口协议"><a-select v-model:value="formState.openai_protocol" @change="handleProtocolChange"><a-select-option value="chat_completions">/v1/chat/completions</a-select-option><a-select-option value="responses">/v1/responses</a-select-option></a-select></a-form-item>
            <a-form-item label="API 地址"><a-input v-model:value="formState.api_url" /></a-form-item>
            <a-form-item label="认证凭证（Key，可自定义）" name="token">
                <CredentialInput v-model:value="formState.token" placeholder="请输入或自定义 API Key / Token" />
            </a-form-item>
            <a-form-item label="可用模型" name="models">
                <ModelSelect
                    v-model:value="formState.models"
                    v-model:open="modelsOpen"
                    :options="fetchedModels"
                    :loading="modelsLoading"
                    @fetch="fetchModels"
                    @clear="clearModels"
                    @update:value="modelsSuccess = ''"
                />
                <div v-if="modelsError" class="field-hint field-error" role="alert">{{ modelsError }}</div>
                <div v-else-if="modelsSuccess" class="field-hint field-success" role="status" aria-live="polite">{{ modelsSuccess }}</div>
            </a-form-item>
            <a-form-item label="代理配置"><a-select v-model:value="formState.proxy_type" allow-clear placeholder="不使用代理"><a-select-option :value="null">不使用</a-select-option><a-select-option value="http">HTTP</a-select-option><a-select-option value="socks5">SOCKS5</a-select-option></a-select></a-form-item>
            <a-form-item v-if="formState.proxy_type" label="代理地址"><a-input v-model:value="formState.proxy_url" placeholder="http://host:port 或 socks5://user:pass@host:port" /></a-form-item>
            <a-row :gutter="[16, 0]" class="scheduler-settings-row">
                <a-col :xs="24" :sm="8">
                    <a-form-item label="并发数" name="concurrency">
                        <a-input-number
                            v-model:value="formState.concurrency"
                            :min="1"
                            :precision="0"
                            style="width: 100%"
                        />
                    </a-form-item>
                </a-col>
                <a-col :xs="24" :sm="8">
                    <a-form-item label="负载因子" name="load_factor">
                        <a-input-number
                            v-model:value="formState.load_factor"
                            :min="1"
                            :precision="0"
                            :placeholder="String(formState.concurrency || 1)"
                            style="width: 100%"
                        />
                        <div class="field-hint">提高负载因子可以提高对账号的调度频率</div>
                    </a-form-item>
                </a-col>
                <a-col :xs="24" :sm="8">
                    <a-form-item label="优先级" name="priority">
                        <a-input-number
                            v-model:value="formState.priority"
                            :min="1"
                            :precision="0"
                            style="width: 100%"
                        />
                        <div class="field-hint">优先级越小的账号优先使用</div>
                    </a-form-item>
                </a-col>
            </a-row>
            <a-form-item label="分组" name="group_ids">
                <a-select v-model:value="formState.group_ids" mode="multiple" :options="groupOptions" allow-clear placeholder="选择分组（可选，可多选）" max-tag-count="responsive" />
                <div class="field-hint">供应商可以同时归属于多个调用分组</div>
            </a-form-item>
            <a-form-item label="状态"><a-radio-group v-model:value="formState.status"><a-radio value="active">启用</a-radio><a-radio value="disabled">停用</a-radio></a-radio-group></a-form-item>
            <a-form-item label="备注"><a-textarea v-model:value="formState.remark" :rows="3" :maxlength="200" show-count /></a-form-item>
        </a-form>
    </a-modal>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import type { FormInstance } from 'ant-design-vue/es';
import vendorsStore from '@/stores/vendors';
import type { UpdateVendorRequest, Vendor, VendorApiType, VendorType, VendorAuthMode, VendorProxyType, VendorUrls } from '@/types/vendor';
import { notifyRequestError, notifySuccess } from '@/utils/requestFeedback';
import { useVendorPresets } from '@/composables/useVendorPresets';
import groupStore from '@/stores/groups';
import ModelSelect from '@/views/Vendor/ModelSelect.vue';
import CredentialInput from '@/views/Vendor/CredentialInput.vue';
import vendorProtocol from '@/utils/vendorProtocol';

const emit = defineEmits<{
    success: [vendor: Vendor];
}>();

const visible = ref(false);
const loading = ref(false);
const formRef = ref<FormInstance>();
const modelsLoading = ref(false);
const modelsError = ref('');
const modelsSuccess = ref('');
const fetchedModels = ref<string[]>([]);
const modelsOpen = ref(false);

const { vendorTypeOptions, presetUrls } = useVendorPresets();

const currentId = ref<number>(0);
const skipTlsVerify = ref<boolean | undefined>();

const groupOptions = computed(() => groupStore.groups.value
    .filter(group => group.status === 'active' || formState.group_ids.includes(group.id))
    .map(group => ({ label: group.name, value: group.id })));

const formState = reactive({
    type: 'openai' as VendorType,
    api_type: 'openai' as VendorApiType,
    channel_code: '',
    supplier_name: '',
    group_ids: [] as number[],
    name: '',
    token: '',
    api_url: '',
    openai_protocol: 'chat_completions' as 'chat_completions' | 'responses',
    models: [] as string[],
    concurrency: 1,
    load_factor: null as number | null,
    priority: 1,
    status: 'active' as 'active' | 'disabled',
    remark: '',
    auth_mode: 'bearer_token' as VendorAuthMode,
    proxy_type: null as VendorProxyType | null,
    proxy_url: '',
});

function syncApiType() {
    formState.api_type = formState.type === 'anthropic' ? 'anthropic' : 'openai';
    formState.auth_mode = formState.api_type === 'anthropic' ? 'api_key' : 'bearer_token';
}

function handleTypeChange() {
    syncApiType();
    const preset = formState.api_type === 'openai'
        ? (formState.openai_protocol === 'responses'
            ? presetUrls[formState.type]?.responses
            : presetUrls[formState.type]?.openai)
        : presetUrls[formState.type]?.anthropic;
    if (preset) {
        formState.api_url = preset;
    }
}

function handleProtocolChange(value?: 'chat_completions' | 'responses') {
    if (formState.api_type !== 'openai') {
        return;
    }

    if (value === 'chat_completions' || value === 'responses') {
        formState.openai_protocol = value;
    }

    const endpoint = formState.openai_protocol === 'responses' ? 'responses' : 'chat_completions';
    formState.api_url = formState.api_url
        ? toEndpoint(formState.api_url, endpoint)
        : presetUrls[formState.type]?.[formState.openai_protocol === 'responses' ? 'responses' : 'openai'] || '';
}

function toEndpoint(url: string, endpoint: 'responses' | 'chat_completions'): string {
    const clean = url.replace(/\/$/, '');
    if (endpoint === 'responses') {
        return clean.replace(/(\/chat\/completions)+$/, '')
            .replace(/\/responses$/, '') + '/responses';
    }
    return clean.replace(/(\/chat\/completions)+$/, '').replace(/\/responses$/, '') + '/chat/completions';
}

const rules = {
    type: [{ required: true, message: '请选择供应商类型' }],
    supplier_name: [{ required: true, message: '请输入供应商名称' }],
    name: [{ required: true, message: '请输入供应商名称' }],
    token: [{ required: true, message: '请输入 API Token' }],
    concurrency: [{ required: true, type: 'number', min: 1, message: '并发数必须大于或等于 1' }],
    load_factor: [{ type: 'number', min: 1, message: '负载因子必须大于或等于 1' }],
    priority: [{ required: true, type: 'number', min: 1, message: '优先级必须大于或等于 1' }],
};

async function open(vendor: Vendor) {
    try {
        await groupStore.ensureLoaded();
    } catch (error) {
        notifyRequestError(error, '加载分组失败');
        visible.value = false;
        return;
    }
    currentId.value = vendor.id;
    skipTlsVerify.value = vendor.config?.skip_tls_verify;
    formState.type = vendor.type;
    formState.api_type = vendorProtocol.resolveApiType(vendor);
    formState.channel_code = vendor.config?.channel_code || '';
    formState.supplier_name = vendor.config?.supplier_name || '';
    formState.group_ids = vendor.config?.group_ids !== undefined
        ? [...vendor.config.group_ids]
        : (vendor.config?.group_id == null ? [] : [vendor.config.group_id]);
    formState.name = vendor.name;
    formState.token = vendor.token;
    formState.openai_protocol = vendorProtocol.resolveOpenAiProtocol(vendor, formState.api_type);
    const urlKey = formState.api_type === 'openai' && formState.openai_protocol === 'responses'
        ? 'responses'
        : formState.api_type;
    const presetKey = urlKey === 'responses' ? 'responses' : formState.api_type;
    const presetUrl = presetUrls[formState.type]?.[presetKey];
    const openAiFallback = urlKey === 'responses'
        ? (vendor.urls?.openai || presetUrls[formState.type]?.openai)
        : undefined;
    formState.api_url = vendor.urls?.[urlKey]
        || vendor.urls?.[formState.type]
        || presetUrl
        || (openAiFallback ? toEndpoint(openAiFallback, 'responses') : '');
    formState.models = [...(vendor.config?.available_models || [])];
    fetchedModels.value = [...formState.models];
    modelsOpen.value = false;
    modelsError.value = '';
    modelsSuccess.value = '';
    formState.concurrency = vendor.config?.concurrency ?? 1;
    formState.load_factor = vendor.config?.load_factor ?? null;
    formState.priority = vendor.config?.priority ?? 1;
    formState.status = vendor.config?.status || 'active';
    formState.remark = vendor.config?.remark || '';
    formState.auth_mode = vendor.config?.auth_mode
        || (formState.api_type === 'anthropic' ? 'api_key' : 'bearer_token');
    formState.proxy_type = vendor.config?.proxy?.type ?? null;
    formState.proxy_url = vendor.config?.proxy?.url ?? '';

    visible.value = true;
}

async function fetchModels() {
    modelsError.value = '';
    modelsSuccess.value = '';
    fetchedModels.value = [];
    modelsOpen.value = false;
    if (!formState.api_url.trim()) {
        modelsError.value = '请先填写 API 地址。';
        return;
    }
    if (!formState.token.trim()) {
        modelsError.value = '请先填写认证凭证。';
        return;
    }
    modelsLoading.value = true;
    try {
        const result = await vendorsStore.previewModels({
            type: formState.type,
            token: formState.token,
            // 模型预览接口按 OpenAI 兼容的 /models 地址查询；Responses
            // 协议需临时使用 chat completions 地址，保存时仍保留原地址。
            urls: {
                [formState.api_type]: formState.api_type === 'openai' && formState.openai_protocol === 'responses'
                    ? toEndpoint(formState.api_url, 'chat_completions')
                    : formState.api_url,
            },
            config: {
                auth_mode: formState.auth_mode,
                api_type: formState.api_type,
                ...(formState.api_type === 'openai' ? { openai_protocol: formState.openai_protocol } : {}),
            },
        });
        const models = [...new Set(result.models.map(model => model.trim()).filter(Boolean))];
        if (!models.length) {
            modelsError.value = '接口未返回可用模型，请检查地址或改为手动输入。';
        } else {
            fetchedModels.value = models;
            modelsOpen.value = true;
            modelsSuccess.value = `已获取 ${fetchedModels.value.length} 个模型，请从下拉列表选择。`;
        }
    } catch {
        modelsError.value = '模型获取失败，请检查 API 地址和认证凭证。';
    } finally {
        modelsLoading.value = false;
    }
}


function clearModels() {
    formState.models = [];
    fetchedModels.value = [];
    modelsOpen.value = false;
    modelsError.value = '';
    modelsSuccess.value = '';
}


async function handleOk() {
    try {
        await formRef.value?.validate();

        const urls: VendorUrls = {};
        const urlKey = formState.api_type === 'openai' && formState.openai_protocol === 'responses'
            ? 'responses'
            : formState.api_type;
        urls[urlKey] = formState.api_url;

        const updateData: UpdateVendorRequest = {
            type: formState.type,
            name: formState.name,
            token: formState.token,
            urls,
            config: {
                ...(skipTlsVerify.value === undefined ? {} : { skip_tls_verify: skipTlsVerify.value }),
                channel_code: formState.channel_code,
                supplier_name: formState.supplier_name,
                group_id: formState.group_ids[0] ?? null,
                group_ids: [...formState.group_ids],
                api_type: formState.api_type,
                ...(formState.api_type === 'openai'
                    ? { openai_protocol: formState.openai_protocol }
                    : {}),
                available_models: formState.models,
                concurrency: formState.concurrency,
                load_factor: formState.load_factor,
                priority: formState.priority,
                status: formState.status,
                remark: formState.remark,
                auth_mode: formState.auth_mode,
                proxy: formState.proxy_type
                    ? { type: formState.proxy_type, url: formState.proxy_url }
                    : null,
            },
        };

        loading.value = true;
        const vendor = await vendorsStore.update(currentId.value, updateData);
        notifySuccess('更新成功');
        emit('success', vendor);
        handleCancel();
    } catch (error) {
        notifyRequestError(error, '更新失败');
    } finally {
        loading.value = false;
    }
}

function handleCancel() {
    visible.value = false;
}

defineExpose({ open });
</script>

<style scoped>
.vendor-edit-form {
    max-height: 78vh;
    overflow-y: auto;
    padding-right: 8px;
    scrollbar-width: thin;
    scrollbar-color: rgba(0, 0, 0, 0.18) transparent;
}

.vendor-edit-form::-webkit-scrollbar {
    width: 6px;
}

.vendor-edit-form::-webkit-scrollbar-track {
    background: transparent;
}

.vendor-edit-form::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.18);
    border-radius: 999px;
}

.vendor-edit-form::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.32);
}

.field-hint {
    color: var(--color-text-secondary, #8c8c8c);
    font-size: 12px;
    line-height: 1.5;
    margin-top: 6px;
}

.field-error {
    color: #d4380d;
}

.field-success {
    color: var(--accent-primary);
}
</style>
