import storageManager from "../manager/storageManager";
import customError from "../util/customErrorUtil";

function assertValidKey(key: string): void {
    if (!key || !key.trim()) {
        throw new customError.AppError("object key is required", 400);
    }
}


function assertValidPrefix(prefix: string): void {
    if (!prefix || !prefix.trim()) {
        throw new customError.AppError("object key prefix is required", 400);
    }
}


async function put(key: string, data: Uint8Array): Promise<void> {
    assertValidKey(key);
    await storageManager.putToTable(key, data);
}


async function get(key: string): Promise<Uint8Array | null> {
    assertValidKey(key);
    const object = await storageManager.getFromTable(key);
    return object?.data ?? null;
}


async function deleteObject(key: string): Promise<void> {
    assertValidKey(key);
    await storageManager.deleteFromTable(key);
}


async function deleteByPrefix(prefix: string): Promise<number> {
    assertValidPrefix(prefix);
    return storageManager.deleteFromTableByPrefix(prefix);
}


async function putText(key: string, text: string): Promise<void> {
    await put(key, new TextEncoder().encode(text));
}


async function getText(key: string): Promise<string | null> {
    const data = await get(key);
    return data ? new TextDecoder().decode(data) : null;
}


export default {
    put,
    get,
    delete: deleteObject,
    deleteByPrefix,
    putText,
    getText,
};
