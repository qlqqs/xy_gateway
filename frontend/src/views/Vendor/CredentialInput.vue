<template>
    <div class="credential-input">
        <a-input-password
            v-model:value="credential"
            class="credential-field"
            :placeholder="placeholder"
            autocomplete="off"
        />
        <a-tooltip title="复制 Key">
            <a-button
                class="copy-button"
                html-type="button"
                aria-label="复制 Key"
                :disabled="!value"
                @click="copyCredential"
            >
                <CheckOutlined v-if="copied" />
                <CopyOutlined v-else />
            </a-button>
        </a-tooltip>
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { CheckOutlined, CopyOutlined } from '@ant-design/icons-vue';
import { notifyError, notifySuccess } from '@/utils/requestFeedback';

interface Props {
    value: string;
    placeholder?: string;
}

const props = withDefaults(defineProps<Props>(), {
    placeholder: '请输入 API Key 或 Token',
});

const emit = defineEmits<{
    'update:value': [value: string];
}>();

const credential = computed({
    get: () => props.value,
    set: (value: string) => emit('update:value', value),
});
const copied = ref(false);
let copiedResetTimer: ReturnType<typeof setTimeout> | null = null;


function copyWithLegacyApi(value: string): boolean {
    const input = document.createElement('textarea');
    input.value = value;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    try {
        input.focus();
        input.select();
        return document.execCommand('copy');
    } finally {
        input.remove();
    }
}


function scheduleCopiedReset(): void {
    if (copiedResetTimer !== null) clearTimeout(copiedResetTimer);
    copiedResetTimer = setTimeout(() => {
        copied.value = false;
        copiedResetTimer = null;
    }, 1200);
}

async function copyCredential() {
    if (!props.value) return;
    copied.value = false;
    try {
        let copySucceeded = false;
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(props.value);
                copySucceeded = true;
            } catch {
                // Some browsers expose Clipboard API but reject it outside a
                // secure context; the legacy path still works for user clicks.
            }
        }
        if (!copySucceeded && typeof document !== 'undefined') {
            copySucceeded = copyWithLegacyApi(props.value);
        }
        if (!copySucceeded) throw new Error('Clipboard copy failed');

        copied.value = true;
        notifySuccess('Key 已复制');
        scheduleCopiedReset();
    } catch {
        notifyError('Key 复制失败');
    }
}


onBeforeUnmount(() => {
    if (copiedResetTimer !== null) clearTimeout(copiedResetTimer);
});
</script>

<style scoped>
.credential-input {
    display: flex;
    width: 100%;
}

.credential-field {
    min-width: 0;
    flex: 1;
}

.copy-button {
    flex: 0 0 40px;
    height: 32px;
    margin-left: -1px;
    border-radius: 0 6px 6px 0;
}
</style>
