<template>
    <a-collapse
        v-if="mode === 'edit'"
        v-model:active-key="activeKey"
        :bordered="false"
        class="price-settings"
    >
        <a-collapse-panel key="billing">
            <template #header>
                <span v-if="isExpanded">价格设置</span>
                <div v-else class="price-summary">
                    <a-tag class="billing-mode-tag" color="blue">{{ billingModeLabel }}</a-tag>
                    <template v-for="field in summaryFields" :key="field.key">
                        <span class="summary-item">
                            <span class="summary-label">{{ field.shortLabel }}</span>
                            <span>{{ formatPrice(prices[field.key]) }}</span>
                        </span>
                    </template>
                    <span v-if="summaryFields.length === 0" class="unset-price">未设置</span>
                </div>
            </template>

            <div class="pricing-content">
                <div class="mode-row">
                    <label class="settings-label">计费模式</label>
                    <a-select
                        :value="effectiveBillingMode"
                        class="mode-select"
                        aria-label="计费模式"
                        @update:value="updateBillingMode"
                    >
                        <a-select-option value="token">按 Token</a-select-option>
                        <a-select-option value="per_request">按次</a-select-option>
                        <a-select-option value="image">按图片</a-select-option>
                    </a-select>
                </div>

                <template v-if="effectiveBillingMode === 'token'">
                    <div class="price-section-title">
                        默认价格
                        <span>元/百万 tokens</span>
                    </div>
                    <div class="price-grid">
                        <div v-for="field in tokenPriceFields" :key="field.key" class="price-field">
                            <label class="price-field-label">
                                {{ field.label }}
                                <a-tooltip v-if="field.tooltip" :title="field.tooltip">
                                    <InfoCircleOutlined class="field-help-icon" />
                                </a-tooltip>
                            </label>
                            <a-input-number
                                :value="prices[field.key]"
                                class="price-input"
                                placeholder="默认"
                                :min="0"
                                :precision="6"
                                allow-clear
                                :aria-label="field.label"
                                @update:value="updatePrice(field.key, $event)"
                            />
                        </div>
                    </div>
                </template>

                <div v-else class="single-price-block">
                    <div class="price-section-title">
                        {{ singlePriceLabel }}
                        <span>元/次</span>
                    </div>
                    <a-input-number
                        :value="prices.per_request"
                        class="price-input"
                        placeholder="请输入价格"
                        :min="0"
                        :precision="6"
                        allow-clear
                        :aria-label="singlePriceLabel"
                        @update:value="updatePrice('per_request', $event)"
                    />
                </div>

                <div class="price-hint">留空或填写 0 表示不收费</div>
            </div>
        </a-collapse-panel>
    </a-collapse>

    <div v-else class="price-view">
        <div class="view-mode-row">
            <span class="view-mode-label">计费模式</span>
            <a-tag color="blue">{{ billingModeLabel }}</a-tag>
        </div>
        <div v-if="effectiveBillingMode === 'token'" class="price-view-grid">
            <div v-for="field in tokenPriceFields" :key="field.key" class="price-view-item">
                <span>{{ field.label }}</span>
                <span class="price-view-value">{{ formatPrice(prices[field.key]) }}</span>
            </div>
        </div>
        <div v-else class="price-view-grid">
            <div class="price-view-item">
                <span>{{ singlePriceLabel }}</span>
                <span class="price-view-value">{{ formatPrice(prices.per_request) }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { InfoCircleOutlined } from '@ant-design/icons-vue';
import type { ModelBillingMode, ModelPrices } from '@/types/model';

type TokenPriceKey =
    | 'input'
    | 'output'
    | 'cache_write'
    | 'cache_read'
    | 'image_input'
    | 'image_output';

interface TokenPriceField {
    key: TokenPriceKey;
    label: string;
    shortLabel: string;
    tooltip?: string;
}

const tokenPriceFields: TokenPriceField[] = [
    {
        key: 'input',
        label: '输入价格',
        shortLabel: '输入',
        tooltip: '输入 token 的计费价格（元/百万 tokens）',
    },
    {
        key: 'output',
        label: '输出价格',
        shortLabel: '输出',
        tooltip: '输出 token 的计费价格（元/百万 tokens）',
    },
    {
        key: 'cache_write',
        label: '缓存写入价格',
        shortLabel: '缓存写入',
        tooltip: '缓存写入 token 的计费价格（元/百万 tokens）',
    },
    {
        key: 'cache_read',
        label: '缓存读取价格',
        shortLabel: '缓存读取',
        tooltip: '缓存命中 token 的计费价格（元/百万 tokens）',
    },
    {
        key: 'image_input',
        label: '图片输入价格',
        shortLabel: '图片输入',
        tooltip: '图片输入 token 的计费价格（元/百万 tokens）',
    },
    {
        key: 'image_output',
        label: '图片输出价格',
        shortLabel: '图片输出',
        tooltip: '图片输出 token 的计费价格（元/百万 tokens）',
    },
];

interface Props {
    mode: 'edit' | 'view';
    prices: ModelPrices;
}

const props = defineProps<Props>();

const emit = defineEmits<{
    'update:prices': [prices: ModelPrices];
}>();

const activeKey = ref<string[]>([]);

const isExpanded = computed(() => activeKey.value.includes('billing'));

const effectiveBillingMode = computed<ModelBillingMode>(() => {
    const mode = props.prices.billing_mode;
    return mode === 'per_request' || mode === 'image' ? mode : 'token';
});

const billingModeLabel = computed(() => ({
    token: '按 Token',
    per_request: '按次',
    image: '按图片',
}[effectiveBillingMode.value]));

const singlePriceLabel = computed(() => (
    effectiveBillingMode.value === 'image' ? '图片单次价格' : '单次价格'
));

const summaryFields = computed(() => {
    if (effectiveBillingMode.value !== 'token') {
        return props.prices.per_request == null
            ? []
            : [{ key: 'per_request' as const, shortLabel: singlePriceLabel.value }];
    }
    return tokenPriceFields.filter(field => props.prices[field.key] != null).slice(0, 3);
});

function updatePrice(key: keyof ModelPrices, value: number | null) {
    emit('update:prices', {
        ...props.prices,
        [key]: value ?? undefined,
    });
}

function updateBillingMode(value: ModelBillingMode | undefined) {
    const nextMode: ModelBillingMode = value === 'per_request' || value === 'image'
        ? value
        : 'token';
    emit('update:prices', {
        ...props.prices,
        billing_mode: nextMode,
    });
}

function formatPrice(value?: number): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return '-';
    }
    return `¥${value.toFixed(6)}`;
}
</script>

<style scoped>
.price-settings {
    margin-top: 0;
    background: transparent;
    border: none;
}

.price-settings :deep(.ant-collapse-item) {
    border: 1px solid var(--border-color, #d9d9d9) !important;
    border-radius: 6px !important;
}

.price-settings :deep(.ant-collapse-header) {
    padding: 8px 16px;
    font-size: 13px;
}

.price-settings :deep(.ant-collapse-content-box) {
    padding: 0 16px 12px;
}

.price-summary {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    overflow: hidden;
}

.billing-mode-tag {
    flex-shrink: 0;
    margin-inline-end: 0;
}

.summary-item {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    color: var(--text-secondary, #666);
}

.summary-label {
    color: var(--text-secondary, #999);
}

.unset-price {
    color: var(--text-secondary, #999);
}

.pricing-content {
    padding-top: 4px;
}

.mode-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
}

.settings-label {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    width: 100px;
    font-size: 14px;
    color: var(--text-primary, rgba(0, 0, 0, 0.88));
}

.mode-select {
    flex: 1;
}

.price-section-title {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 8px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary, rgba(0, 0, 0, 0.88));
}

.price-section-title span {
    font-size: 12px;
    font-weight: 400;
    color: var(--text-secondary, #999);
}

.price-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 16px;
}

.price-field {
    min-width: 0;
}

.price-field-label {
    display: flex;
    align-items: center;
    margin-bottom: 5px;
    font-size: 12px;
    color: var(--text-secondary, #666);
}

.price-input {
    width: 100%;
}

.field-help-icon {
    margin-left: 4px;
    color: var(--text-secondary, #999);
    font-size: 12px;
}

.single-price-block {
    max-width: 280px;
}

.price-hint {
    margin: 12px 0 0;
    font-size: 12px;
    color: var(--text-secondary, #999);
}

.price-view {
    width: 100%;
}

.view-mode-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
}

.view-mode-label {
    color: var(--text-secondary, #666);
}

.price-view-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 20px;
}

.price-view-item {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--text-secondary, #666);
}

.price-view-value {
    color: var(--text-primary, rgba(0, 0, 0, 0.88));
    font-variant-numeric: tabular-nums;
}

@media (max-width: 560px) {
    .price-grid,
    .price-view-grid {
        grid-template-columns: 1fr;
    }
}
</style>
