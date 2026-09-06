const ADMIN_TOKEN_KEY = 'adminToken';

let memoryToken = '';

export function getAuthToken(): string {
    if (memoryToken) {
        return memoryToken;
    }

    if (typeof window === 'undefined') {
        return '';
    }

    return window.localStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

export function setAuthToken(token: string, options: { persist?: boolean } = {}): void {
    memoryToken = token;

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
}
