import { beforeEach, describe, expect, it, vi } from "vitest";
import { SgModel } from "../../../src/model/sgModel";
import { SgRecord } from "../../../src/model/sgRecord";
import { SgUser } from "../../../src/model/sgUser";
import { SgUserKey } from "../../../src/model/sgUserKey";

const mocks = vi.hoisted(() => ({
    userGroupManager: { findById: vi.fn() },
    recordManager: { findById: vi.fn() },
    configService: { isModuleBillingEnabled: vi.fn() },
    recordService: { update: vi.fn() },
    ormService: {
        isWorker: false as boolean,
        captureD1Batch: vi.fn(),
        getKnex: vi.fn(),
    },
}));

vi.mock("../../../src/manager/userGroupManager", () => ({ default: mocks.userGroupManager }));
vi.mock("../../../src/manager/recordManager", () => ({ default: mocks.recordManager }));
vi.mock("../../../src/service/configService", () => ({ default: mocks.configService }));
vi.mock("../../../src/service/recordService", () => ({ default: mocks.recordService }));
vi.mock("../../../src/service/ormService", () => ({ default: mocks.ormService }));

import billingService from "../../../src/service/billingService";

describe("billingService quote helpers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.ormService.isWorker = false;
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
            baseCost: 17.8,
            rateMultiplier: 1,
            cost: 17.8,
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

function d1Result(results: Array<Record<string, unknown>> = []) {
    return {
        success: true,
        results,
        meta: {},
    };
}

function workerRecord(overrides: Record<string, unknown> = {}) {
    return {
        id: 101,
        key_id: 9,
        group_id: null,
        billing_mode: "token",
        base_cost: 0,
        rate_multiplier: 1,
        cost: 0,
        settlement_status: "pending",
        ...overrides,
    };
}

function settlementInput() {
    const model = Object.assign(new SgModel(), {
        name: "billing-model",
        prices: { billing_mode: "token" },
    });
    const user = Object.assign(new SgUser(), { id: 7 });
    const key = Object.assign(new SgUserKey(), { id: 9 });
    return {
        model,
        user,
        key,
        baseCost: 2,
        d1Database: {} as D1Database,
    };
}

describe("billingService Worker settlement", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.ormService.isWorker = true;
        mocks.userGroupManager.findById.mockResolvedValue(null);
        mocks.configService.isModuleBillingEnabled.mockResolvedValue(true);
    });

    it("在一个 D1 batch 内 claim、扣用户与 Key 并写入终态", async () => {
        let settledRow = workerRecord();
        const batch = vi.fn(async (statements: Array<{ sql: string; bindings?: unknown[] }>) => {
            if (statements.length === 1) {
                return [d1Result([settledRow])];
            }

            const claimStatus = String(statements[0]?.bindings?.[0]);
            expect(claimStatus).toMatch(/^settling:[a-f0-9]{16}$/);
            expect(statements).toHaveLength(6);
            expect(statements[0]?.sql).toContain("quota_used + ? <= quota");
            expect(statements[1]?.bindings?.at(-1)).toBe(claimStatus);
            expect(statements[2]?.bindings?.at(-1)).toBe(claimStatus);
            expect(statements[4]?.bindings?.at(-1)).toBe(claimStatus);

            settledRow = workerRecord({
                base_cost: 2_000_000,
                cost: 2_000_000,
                settlement_status: "settled",
                user_exists: 1,
                key_exists: 1,
                key_has_quota: 1,
            });
            return [
                d1Result(),
                d1Result(),
                d1Result(),
                d1Result([{ claimed: 1 }]),
                d1Result(),
                d1Result([settledRow]),
            ];
        });
        mocks.ormService.captureD1Batch.mockReturnValue(batch);

        const input = settlementInput();
        await expect(billingService.settle(101, input)).resolves.toEqual({
            billingMode: "token",
            baseCost: 2,
            rateMultiplier: 1,
            cost: 2,
            status: "settled",
            alreadySettled: false,
        });
        expect(mocks.ormService.captureD1Batch).toHaveBeenCalledWith(input.d1Database);

        await expect(billingService.settle(101, settlementInput())).resolves.toMatchObject({
            status: "settled",
            alreadySettled: true,
            cost: 2,
        });
        expect(batch.mock.calls.filter(([statements]) => statements.length === 6)).toHaveLength(1);
    });

    it("额度不足时不取得 claim，并返回稳定的限额错误", async () => {
        const pending = workerRecord();
        const batch = vi.fn()
            .mockResolvedValueOnce([d1Result([pending])])
            .mockResolvedValueOnce([
                d1Result(),
                d1Result(),
                d1Result(),
                d1Result([{ claimed: 0 }]),
                d1Result(),
                d1Result([workerRecord({
                    user_exists: 1,
                    key_exists: 1,
                    key_has_quota: 0,
                })]),
            ]);
        mocks.ormService.captureD1Batch.mockReturnValue(batch);

        await expect(billingService.settle(101, settlementInput())).rejects.toMatchObject({
            message: "API key quota exhausted",
            statusCode: 429,
            code: "rate_limit_error",
        });

        const statements = batch.mock.calls[1]?.[0] as Array<{ sql: string }>;
        expect(statements).toHaveLength(6);
        expect(statements[1]?.sql).toContain("settlement_status = ?");
        expect(statements[2]?.sql).toContain("settlement_status = ?");
    });

    it("缺少当前请求的 D1 binding 时拒绝结算", async () => {
        const input = { ...settlementInput(), d1Database: undefined };

        await expect(billingService.settle(101, input)).rejects.toMatchObject({
            message: "D1 request binding is unavailable",
            statusCode: 500,
        });
        expect(mocks.ormService.captureD1Batch).not.toHaveBeenCalled();
    });
});
