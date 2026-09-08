<template>
    <div class="vendor-models">
        <a-select
            v-model:value="selectedModels"
            :open="open"
            class="model-select"
            mode="tags"
            show-search
            allow-clear
            default-active-first-option
            option-filter-prop="label"
            :options="modelOptions"
            :token-separators="[',', ' ', '\n', '\r']"
            :disabled="loading"
            aria-label="可用模型"
            placeholder="输入模型 ID 后回车，可添加多个"
            @clear="handleClear"
            @dropdown-visible-change="handleDropdownVisibleChange"
        />
        <div class="model-toolbar">
            <a-button
                type="primary"
                html-type="button"
                size="small"
                :loading="loading"
                @click="emit('fetch')"
            >
                <template #icon><CloudDownloadOutlined /></template>
                自动获取模型
            </a-button>
            <a-tooltip title="清空模型">
                <a-button
                    class="clear-models-button"
                    html-type="button"
                    size="small"
                    aria-label="清空模型"
                    :disabled="loading || (!value.length && !options.length)"
                    @click="handleClear"
                >
                    <template #icon><ClearOutlined /></template>
                </a-button>
            </a-tooltip>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ClearOutlined, CloudDownloadOutlined } from '@ant-design/icons-vue';

interface Props {
    value: string[];
    options: string[];
    loading: boolean;
    open: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
    'update:value': [value: string[]];
    'update:open': [value: boolean];
    fetch: [];
    clear: [];
}>();

const selectedModels = computed({
    get: () => props.value,
    set: (value: string[]) => {
        emit('update:value', [...new Set(value.map(model => model.trim()).filter(Boolean))]);
    },
});
const modelOptions = computed(() => [...new Set([...props.options, ...props.value])]
    .map(model => ({ label: model, value: model })));


function handleDropdownVisibleChange(value: boolean) {
    emit('update:open', value);
}


function handleClear() {
    selectedModels.value = [];
    emit('update:open', false);
    emit('clear');
}
</script>

<style scoped>
.vendor-models,
.model-select {
    width: 100%;
    min-width: 0;
}

.model-select :deep(.ant-select-selector) {
    height: 108px;
    align-items: flex-start;
    padding-block: 5px;
}

.model-select :deep(.ant-select-selection-overflow) {
    max-height: 96px;
    align-content: flex-start;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
}

.model-select :deep(.ant-select-selection-overflow-item) {
    min-width: 0;
}

.model-select :deep(.ant-select-selection-item) {
    height: auto;
    min-height: 24px;
}

.model-select :deep(.ant-select-selection-item-content) {
    min-width: 0;
    white-space: normal;
    overflow-wrap: anywhere;
}

.model-select :deep(.ant-select-selection-item-remove) {
    flex-shrink: 0;
}

.model-select :deep(.ant-select-selection-placeholder) {
    top: 8px;
    transform: none;
    white-space: normal;
}

.model-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
}

.clear-models-button {
    width: 24px;
    height: 24px;
}
</style>
