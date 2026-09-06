<template>
    <a-modal
        v-model:open="visible"
        title="调整余额"
        @ok="handleOk"
        @cancel="handleCancel"
        :confirm-loading="loading"
        width="500px"
    >
        <a-descriptions :column="1" bordered style="margin-bottom: 16px">
            <a-descriptions-item label="用户名">
                {{ currentUser?.name }}
            </a-descriptions-item>
            <a-descriptions-item label="当前余额">
                ¥{{ formatBalance(currentUser?.balance != null ? currentUser.balance / BALANCE_SCALE : null) }}
                <a-tag v-if="currentUser && currentUser.balance < 0" color="error" style="margin-left: 8px">欠费</a-tag>
            </a-descriptions-item>
        </a-descriptions>

        <a-form
            :model="formState"
            :rules="rules"
            layout="vertical"
            ref="formRef"
        >
            <a-form-item label="调整类型" name="type">
                <a-radio-group v-model:value="formState.type">
                    <a-radio value="recharge">充值</a-radio>
                    <a-radio value="adjustment">扣减</a-radio>
                </a-radio-group>
            </a-form-item>

            <a-form-item :label="formState.type === 'recharge' ? '充值金额' : '扣减金额'" name="amount">
                <a-input-number
                    v-model:value="formState.amount"
                    :placeholder="formState.type === 'recharge' ? '请输入充值金额' : '请输入扣减金额'"
                    :min="0"
                    :precision="2"
                    style="width: 100%"
                >
                    <template #prefix>¥</template>
                </a-input-number>
            </a-form-item>
        </a-form>

        <a-alert
            v-if="formState.type === 'adjustment'"
            message="注意"
            description="扣减后余额不能为负数，请确保用户余额充足"
            type="warning"
            show-icon
        />
    </a-modal>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import type { FormInstance } from 'ant-design-vue/es';
import type { User } from '@/types/user';
import userStore from '@/stores/users';
import { notifyRequestError, notifySuccess } from '@/utils/requestFeedback';
import { formatBalance, BALANCE_SCALE } from '@/utils/format';

const emit = defineEmits<{
    success: [];
}>();

const visible = ref(false);
const loading = ref(false);
const formRef = ref<FormInstance>();

const currentUser = ref<User>();

const formState = reactive({
    type: 'recharge' as 'recharge' | 'adjustment',
    amount: 0,
});

const rules = {
    type: [{ required: true, message: '请选择调整类型' }],
    amount: [
        { required: true, message: '请输入金额' },
        { type: 'number', min: 0.01, message: '金额必须大于0' },
    ],
};

function open(user: User) {
    currentUser.value = user;
    formState.type = 'recharge';
    formState.amount = 0;
    visible.value = true;
}

async function handleOk() {
    try {
        await formRef.value?.validate();
        loading.value = true;

        const actualAmount = formState.type === 'recharge'
            ? formState.amount
            : -formState.amount;

        const user = currentUser.value;
        if (!user) {
            throw new Error('未选择用户');
        }
        const updatedUser = await userStore.adjustBalance(user.id, actualAmount);
        if (!updatedUser) {
            throw new Error('用户不存在');
        }

        notifySuccess(formState.type === 'recharge' ? '充值成功' : '扣减成功');
        emit('success');
        handleCancel();
    } catch (error) {
        notifyRequestError(error, '调整余额失败');
    } finally {
        loading.value = false;
    }
}

function handleCancel() {
    visible.value = false;
    formState.type = 'recharge';
    formState.amount = 0;
}

defineExpose({ open });
</script>
