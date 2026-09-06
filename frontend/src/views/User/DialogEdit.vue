<template>
    <a-modal
        v-model:open="visible"
        title="编辑用户"
        @ok="handleOk"
        @cancel="handleCancel"
        :confirm-loading="loading"
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
            <a-form-item label="状态" name="status">
                <a-switch
                    v-model:checked="formState.status"
                    checked-children="启用"
                    un-checked-children="禁用"
                    checked-value="active"
                    un-checked-value="disabled"
                />
            </a-form-item>
        </a-form>
    </a-modal>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import type { FormInstance } from 'ant-design-vue/es';
import userStore from '@/stores/users';
import type { User } from '@/types/user';
import { notifyError, notifyRequestError, notifySuccess } from '@/utils/requestFeedback';

const emit = defineEmits<{
    success: [user: User];
}>();

const visible = ref(false);
const loading = ref(false);
const formRef = ref<FormInstance>();
const userId = ref<number>();

const formState = reactive({
    name: '',
    status: 'active' as 'active' | 'disabled',
});

const rules = {
    name: [{ required: true, message: '请输入用户名' }],
};

function open(user: User) {
    userId.value = user.id;
    formState.name = user.name;
    formState.status = user.status || 'active';
    visible.value = true;
}

async function handleOk() {
    try {
        await formRef.value?.validate();
        if (!userId.value) {
            notifyError('用户 ID 无效');
            return;
        }

        loading.value = true;
        const user = await userStore.update(userId.value, {
            name: formState.name,
            status: formState.status,
        });
        if (!user) {
            notifyError('用户不存在');
            return;
        }
        notifySuccess('更新成功');
        emit('success', user);
        handleCancel();
    } catch (error) {
        notifyRequestError(error, '更新失败');
    } finally {
        loading.value = false;
    }
}

function handleCancel() {
    visible.value = false;
    formState.name = '';
    formState.status = 'active';
    userId.value = undefined;
}

defineExpose({ open });
</script>
