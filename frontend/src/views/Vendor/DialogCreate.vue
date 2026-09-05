<template>
    <a-modal
        v-model:open="visible"
        title="新建供应商"
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
            class="vendor-create-form"
        >
            <a-alert message="通道编码用于区分和调用当前通道，请使用易于识别的英文、数字或短横线。" type="info" show-icon class="form-note" />
            <a-form-item label="通道编码" name="channel_code"><a-input v-model:value="formState.channel_code" placeholder="例如：prod-openai-01" :maxlength="64" /></a-form-item>
            <a-form-item label="供应商名称" name="supplier_name"><a-input v-model:value="formState.supplier_name" placeholder="例如：星河云计算有限公司" /></a-form-item>
            <a-form-item label="通道名称" name="name"><a-input v-model:value="formState.name" placeholder="例如：生产环境主通道" /></a-form-item>
            <a-form-item label="接口类型" name="type"><a-select v-model:value="formState.type" placeholder="请选择接口类型" show-search option-filter-prop="label" :options="vendorTypeOptions" @change="syncAuthMode" /><div class="field-hint">认证方式将自动匹配为 {{ authModeLabel }}</div></a-form-item>
            <a-form-item v-if="formState.type === 'openai'" label="OpenAI 接口协议" name="openai_protocol"><a-select v-model:value="formState.openai_protocol" @change="syncAuthMode"><a-select-option value="chat_completions">/v1/chat/completions</a-select-option><a-select-option value="responses">/v1/responses</a-select-option></a-select></a-form-item>
            <a-form-item label="API 地址" name="api_url"><a-input v-model:value="formState.api_url" placeholder="https://api.example.com/v1" /></a-form-item>
            <a-form-item label="认证凭证" name="token"><a-input-password v-model:value="formState.token" :placeholder="authModeLabel === 'API Key' ? '请输入 API Key' : '请输入 Bearer Token'" /></a-form-item>
            <a-form-item label="可用模型" name="models"><a-space direction="vertical" style="width: 100%"><a-select v-model:value="formState.models" mode="tags" :token-separators="[',', ' ']" placeholder="输入模型 ID 后回车，可添加多个"><a-select-option v-for="model in fetchedModels" :key="model" :value="model">{{ model }}</a-select-option></a-select><a-button size="small" :loading="modelsLoading" @click="fetchModels">自动获取模型</a-button></a-space><div v-if="modelsError" class="field-hint field-error">{{ modelsError }}</div><div v-else class="field-hint">支持手动输入，也可以使用当前接口地址和凭证自动获取。</div></a-form-item>
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
            <a-form-item label="状态" name="status"><a-radio-group v-model:value="formState.status"><a-radio value="active">启用</a-radio><a-radio value="disabled">停用</a-radio></a-radio-group></a-form-item>
            <a-form-item label="备注"><a-textarea v-model:value="formState.remark" :rows="3" placeholder="可填写环境、用途或维护说明" :maxlength="200" show-count /></a-form-item>
        </a-form>
    </a-modal>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import type { FormInstance } from 'ant-design-vue/es';
import { createVendor, fetchModelsPreview } from '@/api/vendor';
import type { CreateVendorRequest, Vendor, VendorType, VendorAuthMode, VendorProxyType } from '@/types/vendor';
import { notifyRequestError, notifySuccess } from '@/utils/requestFeedback';
import { useVendorPresets } from '@/composables/useVendorPresets';

const emit = defineEmits<{
    success: [vendor: Vendor];
}>();

const visible = ref(false);
const loading = ref(false);
const formRef = ref<FormInstance>();
const modelsLoading = ref(false);
const modelsError = ref('');
const fetchedModels = ref<string[]>([]);

const { presetUrls, vendorTypeOptions, load: loadPresets } = useVendorPresets();
const PRESET_URLS = presetUrls;

const formState = reactive({
    type: 'openai' as VendorType,
    channel_code: '',
    name: '',
    supplier_name: '',
    token: '',
    api_type: 'openai' as 'openai' | 'anthropic',
    openai_protocol: 'chat_completions' as 'chat_completions' | 'responses',
    api_url: '',
    models: [] as string[],
    concurrency: 1,
    load_factor: null as number | null,
    priority: 1,
    status: 'active' as 'active' | 'disabled',
    remark: '',
    auth_mode: 'api_key' as VendorAuthMode,
    proxy_type: null as VendorProxyType | null,
    proxy_url: '',
});

const authModeLabel = computed(() => formState.type === 'anthropic' ? 'API Key' : 'Bearer Token');
function syncAuthMode() {
    formState.api_type = formState.type === 'anthropic' ? 'anthropic' : 'openai';
    formState.auth_mode = formState.api_type === 'anthropic' ? 'api_key' : 'bearer_token';
    if (formState.api_type === 'openai') {
        const preset = PRESET_URLS.value[formState.type]?.openai;
        if (formState.openai_protocol === 'responses') {
            const responsesPreset = PRESET_URLS.value[formState.type]?.responses;
            formState.api_url = responsesPreset || toEndpoint(formState.api_url, 'responses');
        } else if (preset) {
            formState.api_url = preset;
        }
    } else {
        const preset = PRESET_URLS.value[formState.type]?.[formState.api_type];
        if (preset) formState.api_url = preset;
    }
}

function toEndpoint(url: string, endpoint: 'responses' | 'chat_completions'): string {
    const clean = url.replace(/\/$/, '');
    if (endpoint === 'responses') {
        return clean.replace(/\/chat\/completions$/, '') + '/responses';
    }
    return clean.replace(/\/responses$/, '') + '/chat/completions';
}

const rules = {
    type: [{ required: true, message: '请选择接口类型' }],
    channel_code: [
        { required: true, message: '请输入通道编码' },
        { pattern: /^[A-Za-z0-9][A-Za-z0-9_-]*$/, message: '通道编码仅支持英文、数字、下划线和短横线' },
    ],
    name: [{ required: true, message: '请输入通道名称' }],
    supplier_name: [{ required: true, message: '请输入供应商名称' }],
    openai_protocol: [{ required: true, message: '请选择 OpenAI 接口协议' }],
    api_url: [{ required: true, message: '请输入 API 地址' }],
    token: [{ required: true, message: '请输入 API Token' }],
    concurrency: [{ required: true, type: 'number', min: 1, message: '并发数必须大于或等于 1' }],
    load_factor: [{ type: 'number', min: 1, message: '负载因子必须大于或等于 1' }],
    priority: [{ required: true, type: 'number', min: 1, message: '优先级必须大于或等于 1' }],
    status: [{ required: true, message: '请选择状态' }],
};

async function open() {
    await loadPresets();
    formState.type = 'openai';
    formState.channel_code = '';
    formState.name = '';
    formState.supplier_name = '';
    formState.token = '';
    formState.api_type = 'openai';
    formState.openai_protocol = 'chat_completions';
    formState.api_url = PRESET_URLS.value.openai?.openai || '';
    formState.models = [];
    fetchedModels.value = [];
    modelsError.value = '';
    formState.concurrency = 1;
    formState.load_factor = null;
    formState.priority = 1;
    formState.status = 'active';
    formState.remark = '';
    syncAuthMode();
    formState.proxy_type = null;
    formState.proxy_url = '';
    visible.value = true;
}

async function fetchModels() {
    modelsLoading.value = true;
    modelsError.value = '';
    try {
        const result = await fetchModelsPreview({
            type: formState.type,
            token: formState.token,
            urls: { [formState.api_type === 'openai' ? 'openai' : formState.api_type]: formState.api_type === 'openai' && formState.openai_protocol === 'responses' ? toEndpoint(formState.api_url, 'chat_completions') : formState.api_url },
            config: { auth_mode: formState.auth_mode },
        });
        fetchedModels.value = result.models;
        if (!result.models.length) modelsError.value = '接口未返回可用模型，请检查地址或改为手动输入。';
    } catch {
        modelsError.value = '模型获取失败，请检查 API 地址和认证凭证。';
    } finally {
        modelsLoading.value = false;
    }
}

async function handleOk() {
    try {
        await formRef.value?.validate();

        const createData: CreateVendorRequest = {
            type: formState.type,
            name: formState.name,
            token: formState.token,
            urls: { [formState.api_type === 'openai' && formState.openai_protocol === 'responses' ? 'responses' : formState.api_type]: formState.api_url },
            config: {
                auth_mode: formState.auth_mode,
                supplier_name: formState.supplier_name,
                channel_code: formState.channel_code,
                api_type: formState.api_type,
                openai_protocol: formState.openai_protocol,
                status: formState.status,
                remark: formState.remark,
                available_models: formState.models,
                concurrency: formState.concurrency,
                load_factor: formState.load_factor,
                priority: formState.priority,
                proxy: formState.proxy_type
                    ? { type: formState.proxy_type, url: formState.proxy_url }
                    : null,
            },
        };

        loading.value = true;
        const vendor = await createVendor(createData);
        notifySuccess('创建成功');
        emit('success', vendor);
        handleCancel();
    } catch (error) {
        notifyRequestError(error, '创建失败');
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
.url-item {
    margin-bottom: 12px;
}

.urls-view {
    border: 1px solid var(--color-border, #d9d9d9);
    border-radius: 6px;
    padding: 8px 12px;
    background: var(--color-bg-container-disabled, #f5f5f5);
}

.url-view-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 3px 0;
    font-size: 13px;
}

.url-key {
    color: var(--color-text-secondary, #888);
    text-transform: uppercase;
    font-size: 11px;
    min-width: 72px;
    flex-shrink: 0;
}

.url-value {
    color: var(--color-text, #333);
    word-break: break-all;
    flex: 1;
}

.custom-tag {
    flex-shrink: 0;
}

.toggle-btn {
    padding: 0;
    margin-top: 6px;
    height: auto;
}

.urls-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
}

.urls-header .ant-form-item-label {
    margin-bottom: 0;
}

.urls-header .toggle-btn {
    margin-top: 0;
}

.auth-hint {
    color: #8c8c8c;
    font-size: 12px;
}

.form-note {
    margin-bottom: 20px;
}

.vendor-create-form {
    max-height: 78vh;
    overflow-y: auto;
    padding-right: 8px;
    scrollbar-width: thin;
    scrollbar-color: rgba(0, 0, 0, 0.18) transparent;
}

.vendor-create-form::-webkit-scrollbar {
    width: 6px;
}

.vendor-create-form::-webkit-scrollbar-track {
    background: transparent;
}

.vendor-create-form::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.18);
    border-radius: 999px;
}

.vendor-create-form::-webkit-scrollbar-thumb:hover {
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
