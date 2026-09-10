import { ConfigKey, KEY_ENCRYPTION_SECRET_BYTES } from "../constants";
import configManager from "../manager/configManager";
import customError from "../util/customErrorUtil";
import type { DBAdapter } from "../util/db/dbAdapter";

const CONFIG_NAME = ConfigKey.KEY_ENCRYPTION_SECRET;
const CONFIG_LOOKUP_SQL = `SELECT value FROM config WHERE name = '${CONFIG_NAME}' LIMIT 1`;


interface SecretStore {
    read(): Promise<string>;
    persistIfAbsent(secret: string): Promise<string>;
}


function normalizeSecret(value: unknown): string {
    if (typeof value !== "string") {
        return "";
    }
    return value.trim();
}


function envSecret(): string {
    return normalizeSecret(typeof process !== "undefined" ? process.env.KEY_ENCRYPTION_SECRET : undefined);
}


function applyToProcessEnv(secret: string): string {
    if (typeof process !== "undefined") {
        process.env.KEY_ENCRYPTION_SECRET = secret;
    }
    return secret;
}


function bytesToHex(bytes: Uint8Array): string {
    let result = "";
    for (const byte of bytes) {
        result += byte.toString(16).padStart(2, "0");
    }
    return result;
}


function generateSecret(): string {
    const cryptoApi = (globalThis as unknown as { crypto?: { getRandomValues(array: Uint8Array): Uint8Array } }).crypto;
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
        throw new customError.AppError(
            "Secure random source is unavailable",
            500,
            "key_encryption_secret_generation_failed",
        );
    }

    const bytes = new Uint8Array(KEY_ENCRYPTION_SECRET_BYTES);
    cryptoApi.getRandomValues(bytes);
    return bytesToHex(bytes);
}


async function ensureWithStore(store: SecretStore): Promise<string> {
    const envValue = envSecret();
    const stored = await store.read();

    if (envValue) {
        if (stored && stored !== envValue) {
            console.warn(
                "KEY_ENCRYPTION_SECRET differs from the stored key_encryption_secret; using the environment value",
            );
        } else if (!stored) {
            await store.persistIfAbsent(envValue);
        }
        return applyToProcessEnv(envValue);
    }

    if (stored) {
        return applyToProcessEnv(stored);
    }

    const generated = generateSecret();
    const persisted = await store.persistIfAbsent(generated);
    return applyToProcessEnv(persisted);
}


function ormStore(): SecretStore {
    return {
        async read() {
            const config = await configManager.get(CONFIG_NAME);
            return normalizeSecret(config?.value);
        },
        async persistIfAbsent(secret: string) {
            const persisted = await configManager.createIfAbsent(CONFIG_NAME, secret);
            return normalizeSecret(persisted.value) || secret;
        },
    };
}


async function readAdapterSecret(adapter: DBAdapter): Promise<string> {
    const rows = await adapter.query<{ value: string }>(CONFIG_LOOKUP_SQL);
    return normalizeSecret(rows[0]?.value);
}


function adapterStore(adapter: DBAdapter): SecretStore {
    return {
        read() {
            return readAdapterSecret(adapter);
        },
        async persistIfAbsent(secret: string) {
            const existing = await readAdapterSecret(adapter);
            if (existing) {
                return existing;
            }

            try {
                await adapter.run(
                    "INSERT INTO config (name, value) VALUES (?, ?)",
                    CONFIG_NAME,
                    secret,
                );
            } catch {
                const winner = await readAdapterSecret(adapter);
                if (winner) {
                    return winner;
                }
                throw new customError.AppError(
                    "Failed to persist key encryption secret",
                    500,
                    "key_encryption_secret_write_failed",
                );
            }

            return (await readAdapterSecret(adapter)) || secret;
        },
    };
}


async function ensure(): Promise<string> {
    const secret = await ensureWithStore(ormStore());
    if (!secret) {
        throw new customError.AppError(
            "Failed to resolve key encryption secret",
            500,
            "key_encryption_secret_required",
        );
    }
    return secret;
}


async function ensureForAdapter(adapter: DBAdapter): Promise<string> {
    const secret = await ensureWithStore(adapterStore(adapter));
    if (!secret) {
        throw new customError.AppError(
            "Failed to resolve key encryption secret",
            500,
            "key_encryption_secret_required",
        );
    }
    return secret;
}


export default {
    ensure,
    ensureForAdapter,
};
