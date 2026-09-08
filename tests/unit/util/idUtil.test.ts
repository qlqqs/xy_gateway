import { describe, expect, it } from "vitest";
import idUtil from "../../../src/util/idUtil";


describe("idUtil", () => {
    it("accepts positive safe integer numbers and decimal strings", () => {
        expect(idUtil.toPositiveInteger(12)).toBe(12);
        expect(idUtil.toPositiveInteger("12")).toBe(12);
        expect(idUtil.toPositiveInteger("0012")).toBe(12);
    });

    it("rejects partial, non-integral, unsafe, and non-positive IDs", () => {
        const invalid = ["12abc", "1e2", "1.5", " 12", "", 1.5, 0, -1, Number.MAX_SAFE_INTEGER + 1];

        for (const value of invalid) {
            expect(idUtil.toPositiveInteger(value)).toBeNull();
        }
    });

    it("normalizes valid batch IDs without aliases or duplicates", () => {
        expect(idUtil.normalizePositiveIntegers(["2", 1, "2", "1abc", 0])).toEqual([2, 1]);
    });
});
