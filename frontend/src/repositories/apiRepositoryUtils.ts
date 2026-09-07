import type { ListResponse } from '@/types';

export type ApiRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ApiRecord {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toNumber(value: unknown, fallback = 0): number {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function toPositiveId(value: unknown): number {
    const number = Math.trunc(toNumber(value));
    return number > 0 ? number : 0;
}

function toBoolean(value: unknown, fallback = false): boolean {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
    return fallback;
}

function toString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

function toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean))];
}

function toDate(value: unknown, fallback = new Date(0)): Date {
    if (value instanceof Date) return new Date(value);
    const date = new Date(typeof value === 'string' || typeof value === 'number' ? value : NaN);
    return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
}

function toNullableIsoDate(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    const date = toDate(value);
    return date.getTime() === 0 ? null : date.toISOString();
}

function toListResponse<T>(
    value: unknown,
    mapper: (item: unknown) => T,
): ListResponse<T> {
    if (!isRecord(value) || !Array.isArray(value.list)) {
        throw new Error('后端列表响应格式无效');
    }

    const total = toNumber(value.total, value.list.length);
    return {
        list: value.list.map(mapper),
        total: Math.max(0, Math.trunc(total)),
    };
}

function isNotFoundError(error: unknown): boolean {
    if (!isRecord(error)) return false;
    if (error.status === 404) return true;
    const response = error.response;
    return isRecord(response) && response.status === 404;
}

function assertRecord(value: unknown, message = '后端响应格式无效'): ApiRecord {
    if (!isRecord(value)) throw new Error(message);
    return value;
}

export default {
    isRecord,
    toNumber,
    toPositiveId,
    toBoolean,
    toString,
    toStringArray,
    toDate,
    toNullableIsoDate,
    toListResponse,
    isNotFoundError,
    assertRecord,
};
