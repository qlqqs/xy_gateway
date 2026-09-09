import { SgModel } from "../model/sgModel";
import { SgRecord } from "../model/sgRecord";
import { SgUser } from "../model/sgUser";
import { SgUserKey } from "../model/sgUserKey";
import recordManager from "../manager/recordManager";
import userGroupManager from "../manager/userGroupManager";
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
    cacheCreation5mTokens?: number | null;
    cacheCreation1hTokens?: number | null;
    imageInputTokens?: number | null;
    imageOutputTokens?: number | null;
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

interface SettlementRecordSnapshot {
    id: number;
    keyId: number | null;
    groupId: number | null;
    billingMode: string | null;
    baseCost: number;
    rateMultiplier: number;
    cost: number;
    settlementStatus: string;
}

// record 是幂等键。Promise 链保护 Node/Tauri 不受重复收尾影响（例如流完成事件
// 与中止回调竞态）。结算状态已持久化，多实例部署仍可在数据库层修复。
const settlementLocks = new Map<number, Promise<SettlementResult>>();

function billingMode(model: SgModel): string | null {
    const value = model.prices?.billing_mode;
    return typeof value === "string" ? value : null;
}

function normalizeCost(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return billingUtil.quantizeAmount(value);
}

function snapshotFromRecord(record: SgRecord): SettlementRecordSnapshot {
    return {
        id: Number(record.id),
        keyId: record.key_id == null ? null : Number(record.key_id),
        groupId: record.group_id == null ? null : Number(record.group_id),
        billingMode: record.billing_mode ?? null,
        baseCost: Number(record.base_cost ?? 0),
        rateMultiplier: Number(record.rate_multiplier ?? 1),
        cost: Number(record.cost ?? 0),
        settlementStatus: String(record.settlement_status ?? "pending"),
    };
}

function settledResult(
    record: SettlementRecordSnapshot,
    alreadySettled: boolean,
): SettlementResult {
    return {
        billingMode: record.billingMode,
        baseCost: record.baseCost,
        rateMultiplier: record.rateMultiplier,
        cost: record.cost,
        status: record.settlementStatus as "settled" | "skipped",
        alreadySettled,
    };
}

function isTerminalSettlement(status: string): status is "settled" | "skipped" {
    return status === "settled" || status === "skipped";
}

async function findSettlementRecord(recordId: number): Promise<SettlementRecordSnapshot | null> {
    const record = await recordManager.findById(recordId);
    return record ? snapshotFromRecord(record) : null;
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
        Math.max(0, Number(usage.cacheCreation5mTokens ?? 0)),
        Math.max(0, Number(usage.cacheCreation1hTokens ?? 0)),
        Math.max(0, Number(usage.imageInputTokens ?? 0)),
        Math.max(0, Number(usage.imageOutputTokens ?? 0)),
    );
    return quote(model, baseCost, groupId);
}

async function settle(recordId: number, input: SettlementInput): Promise<SettlementResult> {
    const previous = settlementLocks.get(recordId) ?? Promise.resolve<SettlementResult | undefined>(undefined);
    const current = previous
        .catch(() => undefined)
        .then(async () => {
            const record = await findSettlementRecord(recordId);
            if (!record) throw new customError.NotFoundError("Record not found");

            if (isTerminalSettlement(record.settlementStatus)) {
                return settledResult(record, true);
            }

            const groupId = input.groupId ?? record.groupId;
            const keyId = input.key?.id == null ? record.keyId : Number(input.key.id);
            const storedMultiplier = Number(record.rateMultiplier);
            const quoteResult = await quote(
                input.model,
                input.baseCost,
                groupId,
                Number.isFinite(storedMultiplier) ? storedMultiplier : undefined,
            );
            const billingEnabled = await configService.isModuleBillingEnabled();
            const shouldCharge = billingEnabled && input.user.id >= 0 && quoteResult.cost > 0;

            const status: "settled" | "skipped" = billingEnabled ? "settled" : "skipped";
            const persistedCost = billingEnabled ? quoteResult.cost : 0;
            const costUnits = billingUtil.toUnits(persistedCost);

            /**
             * 将扣费与 record 标记作为一个数据库单元持久化。Sutando 模型 helper 会打开自己的连接，
             * 因此热路径有意直接使用事务句柄。token 请求的最终费用只能在响应结束后确定；即使本次
             * 费用越过 Key 额度，也必须记入 quota_used，后续请求再由入口额度检查阻断。
             */
            const persist = async (db: any): Promise<SettlementResult> => {
                let currentQuery = db("record").where("id", recordId);
                if (process.env.DB_DRIVER === "mysql") {
                    currentQuery = currentQuery.forUpdate();
                }
                const current = await currentQuery.first();
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

                    if (keyId != null) {
                        const keyUpdateCount = await db("user_key")
                            .where("id", keyId)
                            .update({
                                quota_used: db.raw("quota_used + ?", [costUnits]),
                            });
                        if (Number(keyUpdateCount) === 0) {
                            throw new customError.NotFoundError("API key not found");
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
                    // Root 请求会被审计，但不扣款。关闭计费时在基础字段保留报价，
                    // record 中的 cost 为零。
                    cost: persistedCost,
                    status,
                    alreadySettled: false,
                };
            };

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
    // 失败请求有意不计费。保留终态，避免迟到的流回调误结算。
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
