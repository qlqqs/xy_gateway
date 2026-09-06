import { defineStore } from 'pinia';
import { ref } from 'vue';
import { status } from '@/api/system';
import type { RunMode } from '@/types/system';
import packageJson from '../../package.json';

const FALLBACK_VERSION = packageJson.version;

export const useAppStore = defineStore('app', () => {
    const sidebarCollapsed = ref(false);
    const version = ref(FALLBACK_VERSION);
    const mode = ref<RunMode | ''>('');
    const isDeveloperMode = ref(localStorage.getItem('developerMode') === 'true');
    const r2StorageAvailable = ref(false);
    const r2StorageUnavailableReason = ref('');

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
            mode.value = data.mode || '';
            moduleBillingEnabled.value = data.modules?.billing ?? moduleBillingEnabled.value;
            r2StorageAvailable.value = data.storage?.r2_available ?? false;
            r2StorageUnavailableReason.value = data.storage?.r2_unavailable_reason || '';
        } catch (error) {
            console.error('Failed to fetch version:', error);
        }
    }

    return {
        sidebarCollapsed,
        version,
        mode,
        isDeveloperMode,
        r2StorageAvailable,
        r2StorageUnavailableReason,
        moduleBillingEnabled,
        toggleSidebar,
        enableDeveloperMode,
        disableDeveloperMode,
        fetchStatus,
    };
});
