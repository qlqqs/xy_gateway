<template>
    <div v-if="normalizedKeys.length" class="keys-display">
        <div v-for="(key, index) in normalizedKeys" :key="`${key}-${index}`" class="key-row">
            <span class="key-label">Key {{ index + 1 }}</span>
            <span class="key-text">{{ isVisible(index) ? key : maskKey(key) }}</span>
            <a-button
                type="link"
                size="small"
                class="icon-button"
                :aria-label="isVisible(index) ? `隐藏 Key ${index + 1}` : `显示 Key ${index + 1}`"
                :title="isVisible(index) ? '隐藏 key' : '显示 key'"
                @click="toggle(index)"
            >
                <template #icon>
                    <EyeInvisibleOutlined v-if="isVisible(index)" />
                    <EyeOutlined v-else />
                </template>
            </a-button>
            <a-button
                type="link"
                size="small"
                class="icon-button"
                :aria-label="`复制 Key ${index + 1}`"
                title="复制 key"
                @click="copyKey(key)"
            >
                <template #icon><CopyOutlined /></template>
            </a-button>
        </div>
    </div>
    <span v-else class="empty-key">未设置</span>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { message } from 'ant-design-vue/es';
import { CopyOutlined, EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons-vue';

interface Props {
    keys?: string[];
}

const props = defineProps<Props>();
const visibleIndexes = ref<Set<number>>(new Set());
const normalizedKeys = computed(() => props.keys ?? []);

function isVisible(index: number): boolean {
    return visibleIndexes.value.has(index);
}

function toggle(index: number) {
    const next = new Set(visibleIndexes.value);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    visibleIndexes.value = next;
}

function maskKey(key: string): string {
    if (!key) return '';
    if (key.length <= 8) return '******';
    return `${key.slice(0, 4)}******${key.slice(-4)}`;
}

async function copyKey(key: string) {
    try {
        await navigator.clipboard.writeText(key);
        message.success('已复制 key');
    } catch {
        message.error('复制失败，请手动复制');
    }
}
</script>

<style scoped>
.keys-display {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.key-row {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    gap: 4px;
}

.key-label {
    color: var(--text-secondary);
    font-size: 12px;
    flex: 0 0 auto;
}

.key-text {
    min-width: 0;
    font-family: monospace;
    overflow-wrap: anywhere;
}

.icon-button {
    padding-inline: 4px;
    flex: 0 0 auto;
}

.empty-key {
    color: var(--text-secondary);
}
</style>
