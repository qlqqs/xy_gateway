const SECURITY_ENTRANCE_ENV = "SECURE_LOGIN_ENTRY";

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

export default {
    normalizeSecurityEntrance,
    getConfiguredSecurityEntrance,
    isSecurityEntrancePath,
};
