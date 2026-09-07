import { SgModel } from "../model/sgModel";
import { SgRecord } from "../model/sgRecord";
import { SgUser } from "../model/sgUser";
import { SgUserKey } from "../model/sgUserKey";
import recordManager from "../manager/recordManager";
import userGroupManager from "../manager/userGroupManager";
import userKeyManager from "../manager/userKeyManager";
import configService from "./configService";
import recordService from "./recordService";
import ormService from "./ormService";
import usageUtils from "../util/protocol/usageUtil";
import billingUtil from "../util/protocol/billingUtil";
import customError from "../util/customErrorUtil";

export interface BillingUsage {
    promptTokens?: number | null;
    outputTokens?: number | null;
    cacheReadTokens?: number | null;
    cacheWriteTokens?: number | null;
}

export interface BillingQuote {
    billingMode: string | null;
    baseCost: number;
    rateMultiplier: number;
    cost: number;
}

export interface SettlementResult extends BillingQuote {
    status: "settled" | "skipped";
    alreadySettled: boolean;
}

export interface SettlementInput {
    model: SgModel;
    user: SgUser;
    key?: SgUserKey | null;
    groupId?: number | null;
    baseCost: number;
}

// A record is the idempotency key.  The promise chain protects Node/Tauri
// workers from duplicate finalizers (for example a stream completion event
// racing with an abort callback).  Database-level repair remains possible for
// multi-instance deployments because the settlement status is persisted.
const settlementLocks = new Map<number, Promise<SettlementResult>>();

function billingMode(model: SgModel): string | null {
    const value = model.prices?.billing_mode;
    return typeof value === "string" ? value : null;
}

function normalizeCost(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return billingUtil.quantizeAmount(value);
}

async function getRateMultiplier(groupId: number | null | undefined): Promise<number> {
    if (groupId == null) return 1;
    const group = await userGroupManager.findById(Number(groupId));
    if (!group || !Number.isFinite(Number(group.rate_multiplier))) return 1;
    return Math.max(0, Number(group.rate_multiplier));
}

async function quote(
    model: SgModel,
    baseCost: number,
    groupId: number | null | undefined = null,
    rateMultiplierOverride?: number,
): Promise<BillingQuote> {
    const normalizedBase = normalizeCost(baseCost);
    const rateMultiplier = rateMultiplierOverride !== undefined
        && Number.isFinite(rateMultiplierOverride)
        ? Math.max(0, rateMultiplierOverride)
        : await getRateMultiplier(groupId);
    return {
        billingMode: billingMode(model),
        baseCost: normalizedBase,
        rateMultiplier,
        cost: normalizeCost(normalizedBase * rateMultiplier),
    };
}

async function quoteUsage(
    model: SgModel,
    usage: BillingUsage,
    groupId: number | null | undefined = null,
): Promise<BillingQuote> {
    const baseCost = usageUtils.calculateCost(
        model,
        Math.max(0, Number(usage.promptTokens ?? 0)),
        Math.max(0, Number(usage.outputTokens ?? 0)),
        Math.max(0, Number(usage.cacheReadTokens ?? 0)),
        Math.max(0, Number(usage.cacheWriteTokens ?? 0)),
    );
    return quote(model, baseCost, groupId);
}

async function settle(recordId: number, input: SettlementInput): Promise<SettlementResult> {
    const previous = settlementLocks.get(recordId) ?? Promise.resolve<SettlementResult | undefined>(undefined);
    const current = previous
        .catch(() => undefined)
        .then(async () => {
            const record = await recordManager.findById(recordId);
            if (!record) throw new customError.NotFoundError("Record not found");

            if (record.settlement_status === "settled" || record.settlement_status === "skipped") {
                return {
                    billingMode: record.billing_mode,
                    baseCost: Number(record.base_cost ?? 0),
                    rateMultiplier: Number(record.rate_multiplier ?? 1),
                    cost: Number(record.cost ?? 0),
                    status: record.settlement_status as "settled" | "skipped",
                    alreadySettled: true,
                } satisfies SettlementResult;
            }

            const groupId = input.groupId ?? record.group_id ?? null;
            const key = input.key ?? (record.key_id == null
                ? null
                : await userKeyManager.findById(Number(record.key_id)));
            const storedMultiplier = Number(record.rate_multiplier);
            const quoteResult = await quote(
                input.model,
                input.baseCost,
                groupId,
                Number.isFinite(storedMultiplier) ? storedMultiplier : undefined,
            );
            const billingEnabled = await configService.isModuleBillingEnabled();
            const shouldCharge = billingEnabled && input.user.id >= 0 && quoteResult.cost > 0;

            // Token billing is only knowable after the upstream responds.  A
            // request can therefore pass the edge pre-check and still exceed
            // the key's remaining quota at settlement; reject before touching
            // either balance so the key cap is enforced on the actual cost.
            if (shouldCharge && key && Number(key.quota ?? 0) > 0
                && Number(key.quota_used ?? 0) + quoteResult.cost > Number(key.quota)) {
                throw new customError.AppError("API key quota exhausted", 429, "rate_limit_error");
            }

            const status: "settled" | "skipped" = billingEnabled ? "settled" : "skipped";
            const persistedCost = billingEnabled ? quoteResult.cost : 0;
            const costUnits = billingUtil.toUnits(persistedCost);

            /**
             * Persist the charge and its record marker as one database unit.
             * Sutando's model helpers open their own connection, so the hot
             * path intentionally uses the transaction handle directly.  The
             * conditional key update is important even after the in-process
             * quota check: another request may consume the last units while
             * this request is waiting for the transaction.
             */
            const persist = async (db: any): Promise<SettlementResult> => {
                const current = await db("record").where("id", recordId).first();
                if (!current) throw new customError.NotFoundError("Record not found");

                const currentStatus = String(current.settlement_status ?? "pending");
                if (currentStatus === "settled" || currentStatus === "skipped") {
                    return {
                        billingMode: current.billing_mode ?? null,
                        baseCost: billingUtil.toYuan(Number(current.base_cost ?? 0)),
                        rateMultiplier: Number(current.rate_multiplier ?? 1),
                        cost: billingUtil.toYuan(Number(current.cost ?? 0)),
                        status: currentStatus as "settled" | "skipped",
                        alreadySettled: true,
                    };
                }

                if (shouldCharge) {
                    const userUpdateCount = await db("user")
                        .where("id", input.user.id)
                        .update({ balance: db.raw("balance - ?", [costUnits]) });
                    if (Number(userUpdateCount) === 0) {
                        throw new customError.NotFoundError("User not found");
                    }

                    if (key?.id != null) {
                        const keyQuery = db("user_key").where("id", Number(key.id));
                        if (Number(key.quota ?? 0) > 0) {
                            keyQuery.whereRaw("quota_used + ? <= quota", [costUnits]);
                        }
                        const keyUpdateCount = await keyQuery.update({
                            quota_used: db.raw("quota_used + ?", [costUnits]),
                        });
                        if (Number(keyUpdateCount) === 0) {
                            throw new customError.AppError("API key quota exhausted", 429, "rate_limit_error");
                        }
                    }
                }

                await db("record").where("id", recordId).update({
                    base_cost: billingUtil.toUnits(quoteResult.baseCost),
                    rate_multiplier: quoteResult.rateMultiplier,
                    billing_mode: quoteResult.billingMode,
                    cost: costUnits,
                    settlement_status: status,
                });

                return {
                    ...quoteResult,
                    // Root requests are audited but never deducted.  Billing-
                    // off requests retain the quote in base fields while
                    // cost is zero in the record.
                    cost: persistedCost,
                    status,
                    alreadySettled: false,
                };
            };

            // D1 currently exposes no transaction callback.  Keep its
            // deterministic sequence (and the persisted idempotency marker)
            // while using a real transaction on Node/MySQL.
            if (ormService.isWorker) {
                return await persist(ormService.getKnex());
            }
            return await ormService.getKnex().transaction(persist);
        });
    settlementLocks.set(recordId, current);
    try {
        return await current;
    } finally {
        if (settlementLocks.get(recordId) === current) settlementLocks.delete(recordId);
    }
}

async function markUnsettled(record: SgRecord): Promise<void> {
    // Failed requests are intentionally never charged.  Keep a terminal
    // status so a late stream callback cannot settle them accidentally.
    if (record.settlement_status === "pending" || !record.settlement_status) {
        await recordService.update(Number(record.id), {
            settlement_status: "skipped",
            cost: 0,
        });
    }
}

export default {
    quote,
    quoteUsage,
    settle,
    markUnsettled,
};
