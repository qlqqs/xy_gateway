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
                    <div v-for="(key, index) in formState.keys" :key="index" class="key-row">
                        <a-input-password
                            v-model:value="key.value"
                            class="key-input"
                            :placeholder="`请输入 Key ${index + 1}`"
                        >
                            <template #addonAfter>
                                <a-button type="link" size="small" html-type="button" @click="generateKey(index)">生成 key</a-button>
                            </template>
                        </a-input-password>
                        <a-select
                            v-model:value="key.groupId"
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
import type { User, UserKeyInput } from '@/types/user';
import { notifyError, notifyRequestError, notifySuccess } from '@/utils/requestFeedback';

const emit = defineEmits<{
    success: [user: User];
}>();

const visible = ref(false);
const formRef = ref<FormInstance>();

const formState = reactive({
    name: '',
    keys: [] as UserKeyInput[],
    type: 'normal' as const,
});

const rules = {
    name: [{ required: true, message: '请输入用户名' }],
    type: [{ required: true, message: '请选择用户类型' }],
};

function open() {
    handleCancel();
    visible.value = true;
}

function addKey() {
    formState.keys.push({ value: '', groupId: null });
}

function removeKey(index: number) {
    formState.keys.splice(index, 1);
}

function generateKey(index: number) {
    const key = formState.keys[index];
    if (key) {
        key.value = crypto.randomUUID();
    }
}

const groupOptions = computed(() => groupStore.groups.value
    .filter(group => group.status === 'active')
    .map(group => ({ label: group.name, value: group.id })));

async function handleOk() {
    try {
        await formRef.value?.validate();
        const keys = formState.keys
            .map(key => ({ ...key, value: key.value.trim(), groupId: key.groupId ?? null }))
            .filter(key => key.value);
        if (new Set(keys.map(key => key.value)).size !== keys.length) {
            notifyError('key 不能重复');
            return;
        }
        const user = await userStore.create({ name: formState.name, keys, type: formState.type });
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
