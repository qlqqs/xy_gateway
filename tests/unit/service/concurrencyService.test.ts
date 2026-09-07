import { afterEach, beforeEach, describe, expect, it } from "vitest";
import concurrencyService from "../../../src/service/concurrencyService";

describe("concurrencyService", () => {
    beforeEach(() => concurrencyService.clear());
    afterEach(() => concurrencyService.clear());

    it("enforces a finite limit and releases idempotently", () => {
        const first = concurrencyService.acquire("key", 1, 2);
        const second = concurrencyService.acquire("key", 1, 2);
        const blocked = concurrencyService.acquire("key", 1, 2);

        expect(first?.acquired).toBe(true);
        expect(second?.acquired).toBe(true);
        expect(blocked).toBeNull();
        expect(concurrencyService.current("key", 1)).toBe(2);

        first?.release();
        first?.release();
        expect(concurrencyService.current("key", 1)).toBe(1);
        second?.release();
        expect(concurrencyService.current("key", 1)).toBe(0);
    });

    it("isolates scopes and treats zero or negative limits as unlimited", () => {
        const keyLease = concurrencyService.acquire("key", 7, 1);
        const vendorLease = concurrencyService.acquire("vendor", 7, 1);
        expect(keyLease).not.toBeNull();
        expect(vendorLease).not.toBeNull();
        expect(concurrencyService.current("key", 7)).toBe(1);
        expect(concurrencyService.current("vendor", 7)).toBe(1);

        const unlimited = [
            concurrencyService.acquire("key", 8, 0),
            concurrencyService.acquire("key", 8, -1),
            concurrencyService.acquire("key", 8, Number.NaN),
        ];
        expect(unlimited.every(Boolean)).toBe(true);
        expect(concurrencyService.current("key", 8)).toBe(3);

        keyLease?.release();
        vendorLease?.release();
        unlimited.forEach(lease => lease?.release());
    });

    it("rejects invalid identifiers without changing counters", () => {
        expect(concurrencyService.acquire("key", 0, 1)).toBeNull();
        expect(concurrencyService.acquire("key", -1, 1)).toBeNull();
        expect(concurrencyService.acquire("key", 1.5, 1)).toBeNull();
        expect(concurrencyService.current("key", 1)).toBe(0);
    });
});
