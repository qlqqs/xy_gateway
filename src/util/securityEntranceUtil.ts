const SECURITY_ENTRANCE_ENV = "SECURE_LOGIN_ENTRY";
const SECURITY_AUTH_COOKIE = "adminToken";

function normalizeSecurityEntrance(value: string | undefined | null): string {
    const raw = value?.trim() ?? "";
    if (!raw) return "";

    const withoutSlashes = raw.replace(/^\/+|\/+$/g, "");
    if (!withoutSlashes || withoutSlashes.includes("?") || withoutSlashes.includes("#")) {
        return "";
    }

    return `/${withoutSlashes}`;
}

function getConfiguredSecurityEntrance(env: Record<string, string | undefined> = process.env): string {
    return normalizeSecurityEntrance(env[SECURITY_ENTRANCE_ENV]);
}

function isSecurityEntrancePath(pathname: string, entrance: string): boolean {
    if (!entrance) return true;
    return pathname === entrance || pathname === `${entrance}/`;
}

function getCookieValue(cookieHeader: string | undefined, name: string): string {
    if (!cookieHeader) return "";

    for (const item of cookieHeader.split(";")) {
        const separator = item.indexOf("=");
        if (separator < 0 || item.slice(0, separator).trim() !== name) continue;

        const value = item.slice(separator + 1).trim();
        try {
            return decodeURIComponent(value);
        } catch {
            return "";
        }
    }

    return "";
}

export default {
    SECURITY_AUTH_COOKIE,
    normalizeSecurityEntrance,
    getConfiguredSecurityEntrance,
    isSecurityEntrancePath,
    getCookieValue,
};
