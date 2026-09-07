<template>
    <div class="app-layout">
        <AppHeader />
        <div class="layout-body">
            <AppSidebar />
            <div class="main-content">
                <router-view />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import AppHeader from './AppHeader.vue';
import AppSidebar from './AppSidebar.vue';
import { useAuthStore } from '@/stores/auth';
import usersStore from '@/stores/users';
import groupsStore from '@/stores/groups';
import vendorsStore from '@/stores/vendors';
import modelsStore from '@/stores/models';

const authStore = useAuthStore();

onMounted(async () => {
    if (!authStore.isAuthenticated) return;

    if (!authStore.userType) {
        const result = await authStore.validateToken();
        if (!result.success) return;
    }

    // 预加载管理资源，保证仪表盘统计和各个表单的关联选项都来自同一
    // 份后端快照；单个资源失败不会阻止其它页面继续工作。
    await Promise.allSettled([
        usersStore.ensureLoaded(),
        groupsStore.ensureLoaded(),
        vendorsStore.ensureLoaded(),
        modelsStore.ensureLoaded(),
    ]);
});
</script>

<style scoped>
.app-layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-layout);
}

.layout-body {
    display: flex;
    flex: 1;
    overflow: hidden;
}

.main-content {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    background: var(--bg-page);
}
</style>
