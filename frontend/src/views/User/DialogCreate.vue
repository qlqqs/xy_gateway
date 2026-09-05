<template>
    <a-modal
        v-model:open="visible"
        title="新建用户"
        @ok="handleOk"
        @cancel="handleCancel"
    >
        <a-form
            :model="formState"
            :rules="rules"
            layout="vertical"
            ref="formRef"
        >
            <a-form-item label="用户名" name="name">
                <a-input v-model:value="formState.name" placeholder="请输入用户名" />
            </a-form-item>
            <a-form-item label="Key（可选）" name="keys" extra="可添加多个 key，也可以不设置 key">
                <div class="keys-editor">
                    <div v-for="(_, index) in formState.keys" :key="index" class="key-row">
                        <a-input-password
                            v-model:value="formState.keys[index]"
                            class="key-input"
                            :placeholder="`请输入 Key ${index + 1}`"
                        >
                            <template #addonAfter>
                                <a-button type="link" size="small" html-type="button" @click="generateKey(index)">生成 key</a-button>
                            </template>
                        </a-input-password>
                        <a-select
                            v-model:value="formState.keyGroups[index]"
                            class="group-select"
                            :options="groupOptions"
                            allow-clear
                            placeholder="选择分组"
                        />
                        <a-button
                            type="text"
                            danger
                            aria-label="移除 key"
                            title="移除 key"
                            @click="removeKey(index)"
                        >
                            <DeleteOutlined />
                        </a-button>
                    </div>
                    <a-button type="dashed" block html-type="button" @click="addKey">
                        <PlusOutlined /> 添加 key
                    </a-button>
                </div>
            </a-form-item>
            <a-form-item label="类型" name="type" tooltip="管理员才能登录后台，不会余额不足；普通用户只能通过 API 调用 LLM">
                <a-select v-model:value="formState.type" placeholder="请选择用户类型">
                    <a-select-option value="normal">普通用户</a-select-option>
                    <a-select-option value="admin">管理员</a-select-option>
                </a-select>
            </a-form-item>
        </a-form>
    </a-modal>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import type { FormInstance } from 'ant-design-vue/es';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons-vue';
import userStore from '@/stores/users';
import groupStore from '@/stores/groups';
import type { User } from '@/types/user';
import { notifyError, notifyRequestError, notifySuccess } from '@/utils/requestFeedback';

const emit = defineEmits<{
    success: [user: User];
}>();

const visible = ref(false);
const formRef = ref<FormInstance>();

const formState = reactive({
    name: '',
    keys: [] as string[],
    keyGroups: [] as Array<number | null>,
    type: 'normal' as const,
});

const rules = {
    name: [{ required: true, message: '请输入用户名' }],
    type: [{ required: true, message: '请选择用户类型' }],
};

function open() {
    visible.value = true;
}

function addKey() {
    formState.keys.push('');
    formState.keyGroups.push(null);
}

function removeKey(index: number) {
    formState.keys.splice(index, 1);
    formState.keyGroups.splice(index, 1);
}

function generateKey(index: number) {
    formState.keys[index] = crypto.randomUUID();
}

const groupOptions = computed(() => groupStore.groups.value
    .filter(group => group.status === 'active')
    .map(group => ({ label: group.name, value: group.id })));

async function handleOk() {
    try {
        await formRef.value?.validate();
        const keyEntries = formState.keys
            .map((key, index) => ({ key: key.trim(), groupId: formState.keyGroups[index] ?? null }))
            .filter(entry => entry.key);
        const keys = keyEntries.map(entry => entry.key);
        if (new Set(keys).size !== keys.length) {
            notifyError('key 不能重复');
            return;
        }
        const keyGroups = Object.fromEntries(keyEntries.map(entry => [entry.key, entry.groupId]));
        const user = userStore.create({ name: formState.name, keys, keyGroups, type: formState.type });
        notifySuccess('创建成功');
        emit('success', user);
        handleCancel();
    } catch (error) {
        notifyRequestError(error, '表单校验失败');
    }
}

function handleCancel() {
    visible.value = false;
    formState.name = '';
    formState.keys = [];
    formState.keyGroups = [];
    formState.type = 'normal';
}

defineExpose({ open });
</script>

<style scoped>
.keys-editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.key-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.key-input {
    flex: 1;
    min-width: 0;
}

.group-select {
    width: 220px;
    flex: 0 0 220px;
}

@media (max-width: 640px) {
    .key-row {
        flex-wrap: wrap;
    }

    .group-select {
        width: calc(100% - 40px);
        flex-basis: calc(100% - 40px);
    }
}
</style>
