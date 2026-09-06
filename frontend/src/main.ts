import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { ConfigProvider } from 'ant-design-vue';
import App from './App.vue';
import router from './router';
import './style.css';
import { setBaseURL } from './utils/request';
import { setAuthToken } from './utils/authSession';
import posthog from 'posthog-js';

function loadBrowserStoredConfig(): void {
    const storedUrl = localStorage.getItem('backendBaseURL');
    if (storedUrl) {
        setBaseURL(storedUrl);
    }

    const token = localStorage.getItem('adminToken');
    if (token) {
        setAuthToken(token);
    }
}

import { isTauri } from '@/utils/platform';

async function loadDesktopRuntimeConfig(): Promise<boolean> {
    if (!isTauri()) {
        return false;
    }

    try {
        const { invoke } = await import('@tauri-apps/api/core');
        const [url, token] = await Promise.all([
            invoke<string>('get_backend_url'),
            invoke<string>('get_auth_token'),
        ]);

        if (url) {
            setBaseURL(url);
        }

        if (token) {
            setAuthToken(token, { persist: false });
        }
    } catch (e) {
        console.error('Failed to load desktop runtime config:', e);
    }

    return true;
}

async function bootstrap() {
    const loadedDesktopConfig = await loadDesktopRuntimeConfig();
    if (!loadedDesktopConfig) {
        loadBrowserStoredConfig();
    }

    const app = createApp(App);
    const pinia = createPinia();
    
    posthog.init('phc_ugm7dcRiZDbQhggrmJZFMuzmRaGUbnE2t4KgqM62FEyA', {
        api_host: 'https://us.i.posthog.com',
        person_profiles: 'identified_only',
        autocapture: false,
        capture_pageview: false,
        disable_session_recording: true,
        opt_out_capturing_by_default: true,
    });
    
    // 默认关闭自动采集，设置页根据服务端配置决定是否启用。
    window.posthog = posthog;

    app.use(pinia);
    app.use(router);
    app.component('AConfigProvider', ConfigProvider);
    app.mount('#app');
}

bootstrap();
