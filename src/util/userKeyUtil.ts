/**
 * 管理 API 与 LLM 鉴权链路共用的 API Key 工具。
 *
 * 数据库只保存用于鉴权的 SHA-256 摘要；可回显值单独加密保存，使管理界面能够
 * 展示管理员创建的 Key，同时不让鉴权查询依赖明文。
 */

const ENCRYPTION_VERSION = "v1";
const IV_LENGTH = 12;

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
        + "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(base64);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

interface RuntimeCrypto {
    subtle?: SubtleCrypto;
    getRandomValues<T extends ArrayBufferView>(array: T): T;
    randomUUID?: () => string;
}

function runtimeCrypto(): RuntimeCrypto {
    return (globalThis as unknown as { crypto: RuntimeCrypto }).crypto;
}

function subtleCrypto(): SubtleCrypto {
    const subtle = runtimeCrypto()?.subtle;
    if (!subtle) {
        throw new Error("Web Crypto API is unavailable");
    }
    return subtle;
}

async function hashKey(value: string): Promise<string> {
    const digest = await subtleCrypto().digest("SHA-256", new TextEncoder().encode(value));
    return bytesToHex(new Uint8Array(digest));
}

function generateKey(): string {
    // 可识别前缀便于运维在日志中定位凭据；完整值仍由密码学安全的随机 UUID 生成。
    const cryptoApi = runtimeCrypto();
    const uuid = cryptoApi?.randomUUID?.bind(cryptoApi);
    if (uuid) {
        return `sk-${uuid().replace(/-/g, "")}${uuid().replace(/-/g, "").slice(0, 16)}`;
    }
    // Cloudflare 与新版本 Node 提供 randomUUID；保留 getRandomValues 回退，避免
    // 引入仅 Node 可用的 `crypto` 模块（该工具也会打包到 Worker）。
    const bytes = new Uint8Array(32);
    cryptoApi.getRandomValues(bytes);
    return `sk-${bytesToHex(bytes)}`;
}

function keyPrefix(value: string): string {
    return value.slice(0, 8);
}

async function deriveEncryptionKey(secret: string): Promise<CryptoKey> {
    if (!secret) {
        throw new Error("KEY_ENCRYPTION_SECRET must be configured");
    }
    const digest = await subtleCrypto().digest("SHA-256", new TextEncoder().encode(secret));
    return subtleCrypto().importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptKey(value: string, secret: string): Promise<string> {
    const iv = new Uint8Array(IV_LENGTH);
    runtimeCrypto().getRandomValues(iv);
    const key = await deriveEncryptionKey(secret);
    const encrypted = await subtleCrypto().encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(value),
    );
    return `${ENCRYPTION_VERSION}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}

async function decryptKey(payload: string, secret: string): Promise<string | null> {
    try {
        const [version, ivText, cipherText] = payload.split(".");
        if (version !== ENCRYPTION_VERSION || !ivText || !cipherText) return null;
        const key = await deriveEncryptionKey(secret);
        const plain = await subtleCrypto().decrypt(
            { name: "AES-GCM", iv: base64UrlToBytes(ivText) },
            key,
            base64UrlToBytes(cipherText),
        );
        return new TextDecoder().decode(plain);
    } catch {
        return null;
    }
}

function resolveEncryptionSecret(explicitSecret?: string, fallbackSecret?: string): string {
    if (explicitSecret) return explicitSecret;
    const configured = typeof process !== "undefined" ? process.env.KEY_ENCRYPTION_SECRET : undefined;
    // 必须使用独立的 Key 加密密钥；ROOT_TOKEN 是鉴权凭据，不能静默地充当 AES 密钥。
    // fallback 是每次请求的 Worker binding（KEY_ENCRYPTION_SECRET），不是 root token；
    // Node 调用方通常直接使用上面的 process.env。
    return configured || fallbackSecret || "";
}

export default {
    hashKey,
    generateKey,
    keyPrefix,
    encryptKey,
    decryptKey,
    resolveEncryptionSecret,
};
