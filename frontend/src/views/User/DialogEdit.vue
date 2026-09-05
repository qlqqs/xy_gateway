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
            <a-form-item label="Key" name="keys" extra="可添加多个 key；保存后将使用当前 key 列表">
                <div class="keys-editor">
                    <div v-for="(_, index) in formState.keys" :key="index" class="key-row">
                        <a-input-password
                            v-model:value="formState.keys[index]"
                            class="key-input"
                            :placeholder="`请输入 Key ${index + 1}`"
                        >
                            <template #addonAfter>
                                <a-button type="link" size="small" html-type="button" @click="showRegenerateConfirm(index)">重新生成 key</a-button>
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
        </a-form>
    </a-modal>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { Modal } from 'ant-design-vue/es';
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
const loading = ref(false);
const formRef = ref<FormInstance>();
const userId = ref<number>();

const formState = reactive({
    name: '',
    keys: [''],
    keyGroups: [null] as Array<number | null>,
    status: 'active' as 'active' | 'disabled',
});

const rules = {
    name: [{ required: true, message: '请输入用户名' }],
};

function open(user: User) {
    userId.value = user.id;
    formState.name = user.name;
    formState.keys = [...user.keys];
    if (formState.keys.length === 0) formState.keys = [''];
    formState.keyGroups = formState.keys.map(key => user.keyGroups[key] ?? null);
    formState.status = user.status || 'active';
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

const groupOptions = computed(() => groupStore.groups.value
    .filter(group => group.status === 'active')
    .map(group => ({ label: group.name, value: group.id })));

function showRegenerateConfirm(index: number) {
    Modal.confirm({
        title: '确认重新生成 key',
        content: '重新生成 key 后，当前 key 将立即失效。确定要继续吗？',
        okText: '确定',
        cancelText: '取消',
        onOk: async () => {
            formState.keys[index] = crypto.randomUUID();
            notifySuccess('新 key 已生成，请点击确定保存');
        },
    });
}

async function handleOk() {
    try {
        await formRef.value?.validate();
        if (!userId.value) {
            notifyError('用户 ID 无效');
            return;
        }

        const keyEntries = formState.keys
            .map((key, index) => ({ key: key.trim(), groupId: formState.keyGroups[index] ?? null }))
            .filter(entry => entry.key);
        const keys = keyEntries.map(entry => entry.key);
        if (new Set(keys).size !== keys.length) {
            throw new Error('key 不能重复');
        }

        loading.value = true;
        const keyGroups = Object.fromEntries(keyEntries.map(entry => [entry.key, entry.groupId]));
        const user = userStore.update(userId.value, {
            name: formState.name,
            keys,
            keyGroups,
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
    formState.keys = [''];
    formState.keyGroups = [null];
    formState.status = 'active';
    userId.value = undefined;
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
