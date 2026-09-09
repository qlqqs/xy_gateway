import { defineStore } from 'pinia';
import { ref } from 'vue';
import { status } from '@/api/system';
import packageJson from '../../package.json';

const FALLBACK_VERSION = packageJson.version;

export const useAppStore = defineStore('app', () => {
    const sidebarCollapsed = ref(false);
    const version = ref(FALLBACK_VERSION);
    const isDeveloperMode = ref(localStorage.getItem('developerMode') === 'true');

    // 功能模块开关
    // 管理端本地领域状态默认开启计费字段；后端状态可在连接后覆盖该值。
    const moduleBillingEnabled = ref(true);

    function toggleSidebar() {
        sidebarCollapsed.value = !sidebarCollapsed.value;
    }

    function enableDeveloperMode() {
        isDeveloperMode.value = true;
        localStorage.setItem('developerMode', 'true');
    }

    function disableDeveloperMode() {
        isDeveloperMode.value = false;
        localStorage.removeItem('developerMode');
    }

    async function fetchStatus() {
        try {
            const data = await status();
            version.value = data.system?.version || FALLBACK_VERSION;
            moduleBillingEnabled.value = data.modules?.billing ?? moduleBillingEnabled.value;
        } catch (error) {
            console.error('Failed to fetch version:', error);
        }
    }

    return {
        sidebarCollapsed,
        version,
        isDeveloperMode,
        moduleBillingEnabled,
        toggleSidebar,
        enableDeveloperMode,
        disableDeveloperMode,
        fetchStatus,
    };
});
