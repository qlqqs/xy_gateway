import { beforeEach, describe, expect, it, vi } from "vitest";
import { SgModel } from "../../../src/model/sgModel";
import { SgRecord } from "../../../src/model/sgRecord";

const mocks = vi.hoisted(() => ({
    userGroupManager: { findById: vi.fn() },
    configService: { isModuleBillingEnabled: vi.fn() },
    recordService: { update: vi.fn() },
}));

vi.mock("../../../src/manager/userGroupManager", () => ({ default: mocks.userGroupManager }));
vi.mock("../../../src/service/configService", () => ({ default: mocks.configService }));
vi.mock("../../../src/service/recordService", () => ({ default: mocks.recordService }));

import billingService from "../../../src/service/billingService";

describe("billingService quote helpers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.userGroupManager.findById.mockResolvedValue({ rate_multiplier: 1.5 });
        mocks.configService.isModuleBillingEnabled.mockResolvedValue(false);
    });

    it("normalizes costs, applies group multiplier and honors an explicit override", async () => {
        const model = new SgModel({ name: "m", prices: { billing_mode: "token" } });

        await expect(billingService.quote(model, -1, 4)).resolves.toEqual({
            billingMode: "token",
            baseCost: 0,
            rateMultiplier: 1.5,
            cost: 0,
        });

        await expect(billingService.quote(model, 1.0000004, 4)).resolves.toEqual({
            billingMode: "token",
            baseCost: 1,
            rateMultiplier: 1.5,
            cost: 1.5,
        });

        await expect(billingService.quote(model, 2, 4, 0)).resolves.toMatchObject({
            baseCost: 2,
            rateMultiplier: 0,
            cost: 0,
        });
    });

    it("quotes token usage including cache read and cache write prices", async () => {
        const model = new SgModel({
            name: "m",
            prices: {
                billing_mode: "token",
                input: 10,
                output: 20,
                cache_read: 2,
                cache_write: 4,
            },
        });

        const quote = await billingService.quoteUsage(model, {
            promptTokens: 1_000_000,
            outputTokens: 500_000,
            cacheReadTokens: 200_000,
            cacheWriteTokens: 100_000,
        });

        expect(quote).toMatchObject({
            billingMode: "token",
            baseCost: 18.8,
            rateMultiplier: 1,
            cost: 18.8,
        });
    });

    it("marks only pending records as unsettled", async () => {
        const pending = new SgRecord();
        Object.assign(pending, { id: 8, settlement_status: "pending" });
        await billingService.markUnsettled(pending);
        expect(mocks.recordService.update).toHaveBeenCalledWith(8, {
            settlement_status: "skipped",
            cost: 0,
        });

        mocks.recordService.update.mockClear();
        const settled = new SgRecord();
        Object.assign(settled, { id: 9, settlement_status: "settled" });
        await billingService.markUnsettled(settled);
        expect(mocks.recordService.update).not.toHaveBeenCalled();
    });
});
