import { beforeEach, describe, expect, it, vi } from "vitest";
import { SgModel } from "../../../src/model/sgModel";
import { SgRecord } from "../../../src/model/sgRecord";
import { SgUser } from "../../../src/model/sgUser";
import { SgUserKey } from "../../../src/model/sgUserKey";

const mocks = vi.hoisted(() => ({
    recordManager: { findById: vi.fn() },
    userGroupManager: { findById: vi.fn() },
    configService: { isModuleBillingEnabled: vi.fn() },
    recordService: { update: vi.fn() },
    ormService: {
        getKnex: vi.fn(),
    },
}));

vi.mock("../../../src/manager/recordManager", () => ({ default: mocks.recordManager }));
vi.mock("../../../src/manager/userGroupManager", () => ({ default: mocks.userGroupManager }));
vi.mock("../../../src/service/configService", () => ({ default: mocks.configService }));
vi.mock("../../../src/service/recordService", () => ({ default: mocks.recordService }));
vi.mock("../../../src/service/ormService", () => ({ default: mocks.ormService }));

import billingService from "../../../src/service/billingService";

interface RawExpression {
    sql: string;
    bindings: unknown[];
}

interface CapturedUpdate {
    table: string;
    column: string;
    value: unknown;
    changes: Record<string, unknown>;
}

interface FakeKnexOptions {
    recordId: number;
    keyUpdateCount?: number;
}

function createFakeKnex(options: FakeKnexOptions) {
    const updates: CapturedUpdate[] = [];
    const raw = vi.fn((sql: string, bindings: unknown[]): RawExpression => ({
        sql,
        bindings,
    }));

    const db = ((table: string) => {
        let whereColumn = "";
        let whereValue: unknown;
        const query = {
            where(column: string, value: unknown) {
                whereColumn = column;
                whereValue = value;
                return query;
            },
            forUpdate() {
                return query;
            },
            async first() {
                if (table !== "record" || whereColumn !== "id" || whereValue !== options.recordId) {
                    return undefined;
                }
                return {
                    id: options.recordId,
                    key_id: 9,
                    group_id: null,
                    billing_mode: "token",
                    base_cost: 0,
                    rate_multiplier: 1,
                    cost: 0,
                    settlement_status: "pending",
                };
            },
            async update(changes: Record<string, unknown>) {
                updates.push({
                    table,
                    column: whereColumn,
                    value: whereValue,
                    changes,
                });
                if (table === "user_key") return options.keyUpdateCount ?? 1;
                return 1;
            },
        };
        return query;
    }) as any;
    db.raw = raw;

    const transaction = vi.fn(async (persist: (trx: typeof db) => Promise<unknown>) => persist(db));

    return {
        knex: { transaction },
        raw,
        updates,
    };
}


function makeRecord(recordId: number): SgRecord {
    return Object.assign(new SgRecord(), {
        id: recordId,
        key_id: 9,
        group_id: null,
        billing_mode: "token",
        base_cost: 0,
        rate_multiplier: 1,
        cost: 0,
        settlement_status: "pending",
    });
}


function makeSettlementInput(quota: number) {
    return {
        model: Object.assign(new SgModel(), {
            name: "billing-model",
            prices: { billing_mode: "token" },
        }),
        user: Object.assign(new SgUser(), {
            id: 7,
            balance: 10,
        }),
        key: Object.assign(new SgUserKey(), {
            id: 9,
            quota,
            quota_used: 0,
        }),
        baseCost: 0.02,
    };
}


describe("billingService Node settlement", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.userGroupManager.findById.mockResolvedValue(null);
        mocks.configService.isModuleBillingEnabled.mockResolvedValue(true);
    });

    it("实际费用超过 Key 剩余额度时仍结算并累计完整费用", async () => {
        const recordId = 201;
        const fake = createFakeKnex({ recordId });
        mocks.recordManager.findById.mockResolvedValue(makeRecord(recordId));
        mocks.ormService.getKnex.mockReturnValue(fake.knex);

        await expect(billingService.settle(recordId, makeSettlementInput(0.01))).resolves.toEqual({
            billingMode: "token",
            baseCost: 0.02,
            rateMultiplier: 1,
            cost: 0.02,
            status: "settled",
            alreadySettled: false,
        });

        const keyUpdate = fake.updates.find(update => update.table === "user_key");
        expect(keyUpdate).toMatchObject({
            column: "id",
            value: 9,
            changes: {
                quota_used: {
                    sql: "quota_used + ?",
                    bindings: [20_000],
                },
            },
        });
        expect(fake.updates.find(update => update.table === "record")?.changes).toMatchObject({
            cost: 20_000,
            settlement_status: "settled",
        });
    });

    it("事务内 Key 更新为零行时返回 API key not found", async () => {
        const recordId = 202;
        const fake = createFakeKnex({ recordId, keyUpdateCount: 0 });
        mocks.recordManager.findById.mockResolvedValue(makeRecord(recordId));
        mocks.ormService.getKnex.mockReturnValue(fake.knex);

        await expect(billingService.settle(recordId, makeSettlementInput(10))).rejects.toMatchObject({
            name: "NotFoundError",
            message: "API key not found",
            statusCode: 404,
            code: "not_found_error",
        });

        expect(fake.updates.map(update => update.table)).toEqual(["user", "user_key"]);
        expect(fake.updates.some(update => update.table === "record")).toBe(false);
    });
});
