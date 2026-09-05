<template>
    <div class="user-detail">
        <a-page-header
            title="用户详情"
            @back="handleBack"
        >
            <template #extra>
                <a-button type="primary" @click="handleEdit">编辑</a-button>
            </template>
        </a-page-header>
        <a-card v-if="user" :loading="loading">
            <a-descriptions :column="1" bordered>
                <a-descriptions-item label="ID">{{ user.id }}</a-descriptions-item>
                <a-descriptions-item label="用户名">{{ user.name }}</a-descriptions-item>
                <a-descriptions-item label="Key">
                    <KeyDisplay :keys="user.keys" />
                </a-descriptions-item>
                <a-descriptions-item label="类型">
                    <a-tag
                        :style="user.type === 'admin'
                            ? {
                                color: 'var(--accent-danger)',
                                backgroundColor: 'var(--accent-danger-soft)',
                                borderColor: 'var(--accent-danger-border)',
                            }
                            : {
                                color: 'var(--accent-primary)',
                                backgroundColor: 'var(--accent-primary-soft)',
                                borderColor: 'var(--accent-primary-border)',
                            }"
                    >
                        {{ user.type === 'admin' ? '管理员' : '普通用户' }}
                    </a-tag>
                </a-descriptions-item>
                <a-descriptions-item label="状态">
                    <a-tag :color="user.status === 'active' ? 'success' : 'error'">
                        {{ user.status === 'active' ? '已启用' : '已禁用' }}
                    </a-tag>
                </a-descriptions-item>
                <a-descriptions-item label="创建时间">
                    {{ formatDate(user.created_at) }}
                </a-descriptions-item>
                <a-descriptions-item label="更新时间">
                    {{ formatDate(user.updated_at) }}
                </a-descriptions-item>
            </a-descriptions>
        </a-card>
    </div>

    <DialogEdit ref="editDialogRef" @success="handleEditSuccess" />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { formatDate } from '@/utils/format';
import KeyDisplay from '@/components/common/KeyDisplay.vue';
import DialogEdit from './DialogEdit.vue';
import type { User } from '@/types/user';
import userStore from '@/stores/users';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const user = ref<User | null>(null);
const editDialogRef = ref();

onMounted(async () => {
    const id = Number(route.params.id);
    if (id) {
        await loadUser(id);
    }
});

function loadUser(id: number) {
    loading.value = true;
    user.value = userStore.get(id);
    loading.value = false;
}

function handleBack() {
    router.push('/user');
}

function handleEdit() {
    if (user.value) {
        editDialogRef.value?.open(user.value);
    }
}

function handleEditSuccess(updatedUser: User) {
    user.value = updatedUser;
}
</script>

<style scoped>
.user-detail {
    max-width: 800px;
}
</style>
