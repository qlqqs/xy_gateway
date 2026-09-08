import customError from "./customErrorUtil";


function toPositiveInteger(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isSafeInteger(value) && value > 0 ? value : null;
    }
    if (typeof value !== "string" || !/^\d+$/.test(value)) {
        return null;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}


function requirePositiveInteger(value: unknown, message = "Invalid ID format"): number {
    const parsed = toPositiveInteger(value);
    if (parsed === null) {
        throw new customError.AppError(message);
    }
    return parsed;
}


function normalizePositiveIntegers(values: unknown[]): number[] {
    const result: number[] = [];
    const seen = new Set<number>();
    for (const value of values) {
        const parsed = toPositiveInteger(value);
        if (parsed !== null && !seen.has(parsed)) {
            seen.add(parsed);
            result.push(parsed);
        }
    }
    return result;
}


export default {
    toPositiveInteger,
    requirePositiveInteger,
    normalizePositiveIntegers,
};
