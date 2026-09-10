const ADMIN_TOKEN_KEY = 'adminToken';
const ADMIN_TOKEN_COOKIE = 'adminToken';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

let memoryToken = '';

function getCookieToken(): string {
    if (typeof document === 'undefined') return '';

    const cookie = document.cookie
        .split('; ')
        .find((item) => item.startsWith(`${ADMIN_TOKEN_COOKIE}=`));
    if (!cookie) return '';

    try {
        return decodeURIComponent(cookie.slice(ADMIN_TOKEN_COOKIE.length + 1));
    } catch {
        return '';
    }
}

function setCookieToken(token: string): void {
    if (typeof document === 'undefined') return;
    document.cookie = `${ADMIN_TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

function clearCookieToken(): void {
    if (typeof document === 'undefined') return;
    document.cookie = `${ADMIN_TOKEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function getAuthToken(): string {
    if (memoryToken) {
        return memoryToken;
    }

    if (typeof window === 'undefined') {
        return '';
    }

    return window.localStorage.getItem(ADMIN_TOKEN_KEY) || getCookieToken();
}

export function setAuthToken(token: string, options: { persist?: boolean } = {}): void {
    memoryToken = token;
    setCookieToken(token);

    if (typeof window === 'undefined') {
        return;
    }

    if (options.persist !== false) {
        window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
    }
}

export function clearAuthToken(): void {
    memoryToken = '';

    if (typeof window === 'undefined') {
        return;
    }

    window.localStorage.removeItem(ADMIN_TOKEN_KEY);
    clearCookieToken();
}
