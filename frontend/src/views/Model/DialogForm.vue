<template>
    <a-modal
        v-model:open="visible"
        @cancel="handleCancel"
        :confirm-loading="loading"
        :width="760"
    >
        <template #title>
            <div class="modal-title">
                <span>{{ dialogTitle }}</span>
                <div class="model-status">
                    <span>启用</span>
                    <a-switch v-model:checked="formState.enable" size="small" />
                </div>
            </div>
        </template>
        <template #footer>
            <div class="modal-footer">
                <a-button @click="handleCancel">取消</a-button>
                <a-button type="primary" :loading="loading" @click="handleOk">
                    {{ isEdit ? '保存' : '创建' }}
                </a-button>
            </div>
        </template>
        <a-form
            :model="formState"
            :rules="rules"
            class="model-form"
            layout="horizontal"
            :colon="false"
            :label-col="{ style: { width: '128px' } }"
            :wrapper-col="{ style: { flex: 1 } }"
            ref="formRef"
        >
            <a-form-item name="name">
                <template #label>
                    <span class="upstream-label">
                        模型名称
                        <a-tooltip title="客户端请求时使用的模型名称">
                            <InfoCircleOutlined class="field-help-icon" />
                        </a-tooltip>
                    </span>
                </template>
                <a-input v-model:value="formState.name" placeholder="请输入模型名称" />
            </a-form-item>
            <a-form-item required>
                <template #label>
                    <span class="upstream-label">
                        上游模型
                        <a-tooltip title="可配置多个供应商及其上游模型">
                            <InfoCircleOutlined class="field-help-icon" />
                        </a-tooltip>
                    </span>
                </template>
                <UpstreamConfig
                    :upstreams="formState.upstreams"
                    mode="edit"
                    :model-name="formState.name"
                    @update:upstreams="formState.upstreams = $event"
                />
            </a-form-item>
            <a-form-item v-if="appStore.moduleBillingEnabled" label="价格设置">
                <PriceConfig
                    :prices="formState.prices"
                    mode="edit"
                    @update:prices="formState.prices = $event"
                />
            </a-form-item>
        </a-form>
    </a-modal>
</template>

<script setup lang="ts">
import { computed, ref, reactive } from 'vue';
import type { FormInstance } from 'ant-design-vue/es';
import { InfoCircleOutlined } from '@ant-design/icons-vue';
import modelsStore from '@/stores/models';
import { useAppStore } from '@/stores/app';
import type {
    CreateModelRequest,
    Model,
    ModelPrices,
    ModelUpstreamFormValue,
} from '@/types/model';
import { notifyError, notifyRequestError, notifySuccess } from '@/utils/requestFeedback';
import PriceConfig from './PriceConfig.vue';
import UpstreamConfig from './UpstreamConfig.vue';

const emit = defineEmits<{
    success: [model: Model];
}>();

const visible = ref(false);
const loading = ref(false);
const formRef = ref<FormInstance>();
const appStore = useAppStore();

const dialogMode = ref<'create' | 'edit'>('create');
const currentId = ref<number>(0);

const isEdit = computed(() => dialogMode.value === 'edit');
const dialogTitle = computed(() => ({
    create: '新建模型',
    edit: '编辑模型',
}[dialogMode.value]));

function createUpstream(data?: Partial<ModelUpstreamFormValue>): ModelUpstreamFormValue {
    const upstream: ModelUpstreamFormValue = {
        enabled: data?.enabled ?? true,
    };
    if (data?.vendor_id !== undefined) {
        upstream.vendor_id = data.vendor_id;
    }
    if (data?.vendor_model_id !== undefined) {
        upstream.vendor_model_id = data.vendor_model_id;
    }
    return upstream;
}

const formState = reactive({
    name: '',
    upstreams: [createUpstream()] as ModelUpstreamFormValue[],
    enable: true,
    prices: {
        billing_mode: 'token' as const,
        input: undefined as number | undefined,
        output: undefined as number | undefined,
        cache_write: undefined as number | undefined,
        cache_read: undefined as number | undefined,
        image_input: undefined as number | undefined,
        image_output: undefined as number | undefined,
        per_request: undefined as number | undefined,
    } as ModelPrices,
});

const rules = {
    name: [{ required: true, message: '请输入模型名称' }],
};

function toRequestPrices(prices: ModelPrices): ModelPrices {
    const requestPrices: ModelPrices = { billing_mode: prices.billing_mode };
    const priceKeys = [
        'input',
        'output',
        'cache_write',
        'cache_read',
        'image_input',
        'image_output',
        'per_request',
    ] as const;

    for (const key of priceKeys) {
        const value = prices[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            requestPrices[key] = value;
        }
    }

    return requestPrices;
}

function openCreate() {
    resetForm();
    dialogMode.value = 'create';
    currentId.value = 0;
    visible.value = true;
}

function openEdit(model: Model) {
    resetForm();
    dialogMode.value = 'edit';
    currentId.value = model.id;
    formState.name = model.name;
    const upstreams = model.mapping.upstreams;
    formState.upstreams = upstreams.map(upstream => createUpstream({
        vendor_id: upstream.vendor_id,
        vendor_model_id: upstream.vendor_model_id,
        enabled: upstream.enabled,
    }));
    formState.enable = Boolean(model.enable);
    formState.prices = {
        billing_mode: model.prices?.billing_mode ?? 'token',
        input: model.prices?.input ?? undefined,
        output: model.prices?.output ?? undefined,
        cache_write: model.prices?.cache_write ?? undefined,
        cache_read: model.prices?.cache_read ?? undefined,
        image_input: model.prices?.image_input ?? undefined,
        image_output: model.prices?.image_output ?? undefined,
        per_request: model.prices?.per_request ?? undefined,
    };
    visible.value = true;
}

async function handleOk() {
    try {
        await formRef.value?.validate();
        if (formState.upstreams.some(upstream => !upstream.vendor_id)) {
            notifyError('请为每个上游选择供应商');
            return;
        }

        const enabledCount = formState.upstreams.filter(upstream => upstream.enabled).length;
        if (formState.enable && enabledCount === 0) {
            notifyError('至少需要启用一个上游');
            return;
        }

        loading.value = true;
        const upstreams = formState.upstreams.map(upstream => {
            if (upstream.vendor_id === undefined) {
                throw new Error('请为每个上游选择供应商');
            }
            return {
                vendor_id: upstream.vendor_id,
                ...(upstream.vendor_model_id ? { vendor_model_id: upstream.vendor_model_id } : {}),
                enabled: upstream.enabled,
            };
        });
        const requestData: CreateModelRequest = {
            name: formState.name,
            enable: formState.enable,
            mapping: { upstreams },
            prices: toRequestPrices(formState.prices),
        };

        if (isEdit.value) {
            const model = await modelsStore.update(currentId.value, requestData);
            notifySuccess('更新成功');
            emit('success', model);
        } else {
            const model = await modelsStore.create(requestData);
            notifySuccess('创建成功');
            emit('success', model);
        }
        handleCancel();
    } catch (error) {
        notifyRequestError(error, isEdit.value ? '更新失败' : '创建失败');
    } finally {
        loading.value = false;
    }
}

function resetForm() {
    formState.name = '';
    formState.upstreams = [createUpstream()];
    formState.enable = true;
    formState.prices = {
        billing_mode: 'token',
        input: undefined,
        output: undefined,
        cache_write: undefined,
        cache_read: undefined,
        image_input: undefined,
        image_output: undefined,
        per_request: undefined,
    };
}

function handleCancel() {
    visible.value = false;
    dialogMode.value = 'create';
    currentId.value = 0;
    resetForm();
}

defineExpose({ openCreate, openEdit });
</script>

<style scoped>
.modal-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-right: 56px;
}

.model-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: normal;
}

.modal-footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
}

.model-form {
    padding-top: 12px;
}

.upstream-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
}

.field-help-icon {
    color: var(--text-secondary);
    font-size: 13px;
}

</style>
