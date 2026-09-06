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
import { ref, reactive } from 'vue';
import type { FormInstance } from 'ant-design-vue/es';
import userStore from '@/stores/users';
import type { User } from '@/types/user';
import { notifyRequestError, notifySuccess } from '@/utils/requestFeedback';

const emit = defineEmits<{
    success: [user: User];
}>();

const visible = ref(false);
const formRef = ref<FormInstance>();

const formState = reactive({
    name: '',
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

async function handleOk() {
    try {
        await formRef.value?.validate();
        const user = await userStore.create({ name: formState.name, type: formState.type });
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
    formState.type = 'normal';
}

defineExpose({ open });
</script>
