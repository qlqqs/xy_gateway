import branding from './branding';

const config = {
    apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '',
    appTitle: import.meta.env.VITE_APP_TITLE || branding.englishName,
    frontendOnly: import.meta.env.DEV && import.meta.env.VITE_FRONTEND_ONLY === 'true',
};

export default config;
