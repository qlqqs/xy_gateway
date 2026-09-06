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
            <a-form-item label="认证凭证" name="token"><a-input-password v-model:value="formState.token" placeholder="请输入 API Token" /></a-form-item>
            <a-form-item label="可用模型"><a-space direction="vertical" style="width: 100%"><a-select v-model:value="formState.models" mode="tags" :token-separators="[',', ' ']" placeholder="输入模型 ID 后回车"><a-select-option v-for="model in fetchedModels" :key="model" :value="model">{{ model }}</a-select-option></a-select><a-button size="small" :loading="modelsLoading" @click="fetchModels">自动获取模型</a-button></a-space><div v-if="modelsError" class="field-hint field-error">{{ modelsError }}</div><div v-else class="field-hint">支持手动输入，也可以使用当前接口地址和凭证自动获取。</div></a-form-item>
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
            <a-form-item label="分组" name="group_id">
                <a-select v-model:value="formState.group_id" :options="groupOptions" allow-clear placeholder="选择分组（可选）" />
                <div class="field-hint">用于标识供应商所属的调用分组</div>
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

const emit = defineEmits<{
    success: [vendor: Vendor];
}>();

const visible = ref(false);
const loading = ref(false);
const formRef = ref<FormInstance>();
const modelsLoading = ref(false);
const modelsError = ref('');
const fetchedModels = ref<string[]>([]);

const { vendorTypeOptions, presetUrls } = useVendorPresets();

const currentId = ref<number>(0);
const skipTlsVerify = ref<boolean | undefined>();

const groupOptions = computed(() => groupStore.groups.value
    .filter(group => group.status === 'active')
    .map(group => ({ label: group.name, value: group.id })));

const formState = reactive({
    type: 'openai' as VendorType,
    api_type: 'openai' as VendorApiType,
    channel_code: '',
    supplier_name: '',
    group_id: null as number | null,
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

function handleProtocolChange() {
    if (formState.api_type !== 'openai') {
        return;
    }

    const endpoint = formState.openai_protocol === 'responses' ? 'responses' : 'chat_completions';
    formState.api_url = formState.api_url
        ? toEndpoint(formState.api_url, endpoint)
        : presetUrls[formState.type]?.[formState.openai_protocol === 'responses' ? 'responses' : 'openai'] || '';
}

function toEndpoint(url: string, endpoint: 'responses' | 'chat_completions'): string {
    const clean = url.replace(/\/$/, '');
    if (endpoint === 'responses') {
        return clean.replace(/\/chat\/completions$/, '') + '/responses';
    }
    return clean.replace(/\/responses$/, '') + '/chat/completions';
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

function open(vendor: Vendor) {
    currentId.value = vendor.id;
    skipTlsVerify.value = vendor.config?.skip_tls_verify;
    formState.type = vendor.type;
    formState.api_type = vendor.config?.api_type
        || (formState.type === 'anthropic' ? 'anthropic' : 'openai');
    formState.channel_code = vendor.config?.channel_code || '';
    formState.supplier_name = vendor.config?.supplier_name || '';
    formState.group_id = vendor.config?.group_id ?? null;
    formState.name = vendor.name;
    formState.token = vendor.token;
    formState.openai_protocol = vendor.config?.openai_protocol || 'chat_completions';
    const urlKey = formState.api_type === 'openai' && formState.openai_protocol === 'responses'
        ? 'responses'
        : formState.api_type;
    formState.api_url = vendor.urls?.[urlKey] || vendor.urls?.[formState.type] || '';
    formState.models = vendor.config?.available_models || [];
    fetchedModels.value = [...formState.models];
    modelsError.value = '';
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
    modelsLoading.value = true;
    modelsError.value = '';
    try {
        const result = await vendorsStore.previewModels({
            type: formState.type,
            token: formState.token,
            urls: {
                [formState.api_type === 'openai' && formState.openai_protocol === 'responses'
                    ? 'responses'
                    : formState.api_type]:
                    formState.api_type === 'openai' && formState.openai_protocol === 'responses'
                        ? formState.api_url.replace(/\/responses\/?$/, '') + '/chat/completions'
                        : formState.api_url,
            },
            config: { auth_mode: formState.auth_mode },
        });
        fetchedModels.value = result.models;
        if (!result.models.length) modelsError.value = '接口未返回可用模型，请检查地址或手动输入。';
    } catch {
        modelsError.value = '模型获取失败，请检查 API 地址和认证凭证。';
    } finally {
        modelsLoading.value = false;
    }
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
                group_id: formState.group_id,
                api_type: formState.api_type,
                openai_protocol: formState.openai_protocol,
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
</style>
