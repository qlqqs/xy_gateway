import { ConfigKey, ROOT_USER_ID, UserType, ADMIN_API_KEY_MAX_LENGTH, ADMIN_API_KEY_MIN_LENGTH, ADMIN_API_KEY_PREFIX, ADMIN_API_KEY_RANDOM_BYTES } from "../constants";
import configManager from "../manager/configManager";
import customError from "../util/customErrorUtil";

const textEncoder = new TextEncoder();

interface SecureRandomSource {
    getRandomValues(array: Uint8Array): Uint8Array;
}

interface AdminKeyOwner {
    id: number;
    type: string;
}


function normalizeValue(value: unknown): string | null {
    if (typeof value !== "string" || value.length === 0) {
        return null;
    }
    return value;
}


function hasValidShape(value: string): boolean {
    if (value.length < ADMIN_API_KEY_MIN_LENGTH || value.length > ADMIN_API_KEY_MAX_LENGTH) {
        return false;
    }
    // 逗号分隔的 Header 值存在歧义，不能作为单个 Admin Key 接受。
    if (value.includes(",") || value.trim() !== value) {
        return false;
    }
    return true;
}


/**
 * 比较字符串时不因长度或内容不匹配提前返回。
 * TextEncoder 也能稳定处理测试中的非 ASCII 值以及服务生成的 ASCII Key。
 */
function constantTimeEqual(left: string, right: string): boolean {
    const leftBytes = textEncoder.encode(left);
    const rightBytes = textEncoder.encode(right);
    const length = Math.max(leftBytes.length, rightBytes.length);
    let difference = leftBytes.length ^ rightBytes.length;

    for (let index = 0; index < length; index += 1) {
        difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
    }

    return difference === 0;
}


function randomHex(bytes: Uint8Array): string {
    let result = "";
    for (const byte of bytes) {
        result += byte.toString(16).padStart(2, "0");
    }
    return result;
}


function generateKeyValue(): string {
    const random = new Uint8Array(ADMIN_API_KEY_RANDOM_BYTES);
    const cryptoApi = (globalThis as unknown as { crypto?: SecureRandomSource }).crypto;
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
        throw new customError.AppError("Secure random source is unavailable", 500, "admin_key_generation_failed");
    }

    cryptoApi.getRandomValues(random);
    return `${ADMIN_API_KEY_PREFIX}${randomHex(random)}`;
}


function ownerIdFromUser(owner: AdminKeyOwner): number {
    const ownerId = Number(owner.id);
    if (owner.type === UserType.ROOT || ownerId === ROOT_USER_ID) {
        return ROOT_USER_ID;
    }
    if (owner.type === UserType.ADMIN && Number.isSafeInteger(ownerId) && ownerId > 0) {
        return ownerId;
    }
    throw new customError.AppError(
        "Admin API key must be bound to an admin or root user",
        500,
        "admin_key_owner_invalid",
    );
}


async function get(): Promise<string | null> {
    const config = await configManager.get(ConfigKey.ADMIN_API_KEY);
    return normalizeValue(config?.value);
}


async function getOwnerId(): Promise<number | null> {
    const config = await configManager.get(ConfigKey.ADMIN_API_KEY_OWNER_ID);
    const raw = normalizeValue(config?.value);
    if (raw == null) {
        return null;
    }
    const ownerId = Number(raw);
    if (!Number.isSafeInteger(ownerId)) {
        return null;
    }
    return ownerId;
}


async function exists(): Promise<boolean> {
    const value = await get();
    return value !== null && value.trim().length > 0;
}


/**
 * 校验请求中的 Admin Key 与当前数据库值。直接使用 config manager，
 * 避免普通配置缓存保留轮换或删除前的旧值。
 */
async function verify(value: unknown): Promise<boolean> {
    const presented = typeof value === "string" ? value : "";
    const stored = await get();
    const matches = constantTimeEqual(presented, stored ?? "");

    if (!stored || !hasValidShape(stored) || !hasValidShape(presented)) {
        return false;
    }
    return matches;
}


async function regenerate(owner: AdminKeyOwner): Promise<string> {
    const ownerId = ownerIdFromUser(owner);
    const value = generateKeyValue();
    try {
        await configManager.set(ConfigKey.ADMIN_API_KEY, value);
        await configManager.set(ConfigKey.ADMIN_API_KEY_OWNER_ID, String(ownerId));
    } catch {
        // 不向调用方暴露数据库细节或生成出的密钥。
        throw new customError.AppError("Failed to save Admin API key", 500, "admin_key_write_failed");
    }
    return value;
}


async function remove(): Promise<boolean> {
    const removed = await configManager.remove(ConfigKey.ADMIN_API_KEY);
    await configManager.remove(ConfigKey.ADMIN_API_KEY_OWNER_ID);
    return removed;
}


export default {
    get,
    getOwnerId,
    exists,
    verify,
    regenerate,
    remove,
    constantTimeEqual,
};
