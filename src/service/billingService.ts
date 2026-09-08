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
import type { D1BatchExecutor } from "../util/dbAdapterUtil";

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
    d1Database?: D1Database;
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

interface D1SettlementRecordRow {
    id: number;
    key_id: number | null;
    group_id: number | null;
    billing_mode: string | null;
    base_cost: number | null;
    rate_multiplier: number | null;
    cost: number | null;
    settlement_status: string | null;
    user_exists?: number;
    key_exists?: number;
    key_has_quota?: number;
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

function snapshotFromD1Row(row: D1SettlementRecordRow): SettlementRecordSnapshot {
    return {
        id: Number(row.id),
        keyId: row.key_id == null ? null : Number(row.key_id),
        groupId: row.group_id == null ? null : Number(row.group_id),
        billingMode: row.billing_mode ?? null,
        baseCost: billingUtil.toYuan(Number(row.base_cost ?? 0)),
        rateMultiplier: Number(row.rate_multiplier ?? 1),
        cost: billingUtil.toYuan(Number(row.cost ?? 0)),
        settlementStatus: String(row.settlement_status ?? "pending"),
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

async function findSettlementRecord(
    recordId: number,
    d1Batch: D1BatchExecutor | null,
): Promise<SettlementRecordSnapshot | null> {
    if (!d1Batch) {
        const record = await recordManager.findById(recordId);
        return record ? snapshotFromRecord(record) : null;
    }

    const [result] = await d1Batch<D1SettlementRecordRow>([{
        sql: `SELECT id, key_id, group_id, billing_mode, base_cost,
                     rate_multiplier, cost, settlement_status
              FROM record WHERE id = ?`,
        bindings: [recordId],
    }]);
    const row = result?.results?.[0];
    return row ? snapshotFromD1Row(row) : null;
}

async function settleWithD1Batch(
    d1Batch: D1BatchExecutor,
    recordId: number,
    userId: number,
    keyId: number | null,
    quoteResult: BillingQuote,
    status: "settled" | "skipped",
    persistedCost: number,
    shouldCharge: boolean,
): Promise<SettlementResult> {
    const costUnits = billingUtil.toUnits(persistedCost);
    const claimStatus = `settling:${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const chargeFlag = shouldCharge ? 1 : 0;

    // D1 batch 具备事务语义。唯一 claim 同时约束两次余额更新，因此额度不足、
    // 重复收尾或任一语句失败都不会留下部分扣费。
    const results = await d1Batch<D1SettlementRecordRow>([
        {
            sql: `UPDATE record
                  SET settlement_status = ?, base_cost = ?, rate_multiplier = ?,
                      billing_mode = ?, cost = ?
                  WHERE id = ?
                    AND COALESCE(settlement_status, 'pending') NOT IN ('settled', 'skipped')
                    AND (
                        ? = 0
                        OR (
                            EXISTS (SELECT 1 FROM user WHERE id = ?)
                            AND (
                                ? IS NULL
                                OR EXISTS (
                                    SELECT 1 FROM user_key
                                    WHERE id = ?
                                      AND (quota <= 0 OR quota_used + ? <= quota)
                                )
                            )
                        )
                    )`,
            bindings: [
                claimStatus,
                billingUtil.toUnits(quoteResult.baseCost),
                quoteResult.rateMultiplier,
                quoteResult.billingMode,
                costUnits,
                recordId,
                chargeFlag,
                userId,
                keyId,
                keyId,
                costUnits,
            ],
        },
        {
            sql: `UPDATE user SET balance = balance - ?
                  WHERE id = ? AND ? = 1
                    AND EXISTS (
                        SELECT 1 FROM record
                        WHERE id = ? AND settlement_status = ?
                    )`,
            bindings: [costUnits, userId, chargeFlag, recordId, claimStatus],
        },
        {
            sql: `UPDATE user_key SET quota_used = quota_used + ?
                  WHERE id = ? AND ? = 1
                    AND EXISTS (
                        SELECT 1 FROM record
                        WHERE id = ? AND settlement_status = ?
                    )`,
            bindings: [costUnits, keyId, chargeFlag, recordId, claimStatus],
        },
        {
            sql: `SELECT CASE WHEN EXISTS (
                      SELECT 1 FROM record WHERE id = ? AND settlement_status = ?
                  ) THEN 1 ELSE 0 END AS claimed`,
            bindings: [recordId, claimStatus],
        },
        {
            sql: `UPDATE record SET settlement_status = ?
                  WHERE id = ? AND settlement_status = ?`,
            bindings: [status, recordId, claimStatus],
        },
        {
            sql: `SELECT r.id, r.key_id, r.group_id, r.billing_mode, r.base_cost,
                         r.rate_multiplier, r.cost, r.settlement_status,
                         EXISTS (SELECT 1 FROM user WHERE id = ?) AS user_exists,
                         CASE WHEN ? IS NULL THEN 1 ELSE EXISTS (
                             SELECT 1 FROM user_key WHERE id = ?
                         ) END AS key_exists,
                         CASE WHEN ? IS NULL THEN 1 ELSE EXISTS (
                             SELECT 1 FROM user_key
                             WHERE id = ?
                               AND (quota <= 0 OR quota_used + ? <= quota)
                         ) END AS key_has_quota
                  FROM record r WHERE r.id = ?`,
            bindings: [userId, keyId, keyId, keyId, keyId, costUnits, recordId],
        },
    ]);

    const claimed = Number((results[3]?.results?.[0] as { claimed?: number } | undefined)?.claimed ?? 0) === 1;
    const finalRow = results[5]?.results?.[0];
    if (!finalRow) throw new customError.NotFoundError("Record not found");

    const finalRecord = snapshotFromD1Row(finalRow);
    if (isTerminalSettlement(finalRecord.settlementStatus)) {
        return settledResult(finalRecord, !claimed);
    }

    if (shouldCharge && Number(finalRow.user_exists ?? 0) === 0) {
        throw new customError.NotFoundError("User not found");
    }
    if (shouldCharge && keyId != null
        && (Number(finalRow.key_exists ?? 0) === 0 || Number(finalRow.key_has_quota ?? 0) === 0)) {
        throw new customError.AppError("API key quota exhausted", 429, "rate_limit_error");
    }
    throw new customError.AppError("Record settlement conflict", 409, "settlement_conflict");
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
    // 在等待 isolate 内相同 record 的结算前捕获请求级 D1 binding。
    let d1Batch: D1BatchExecutor | null = null;
    if (ormService.isWorker) {
        const requestDb = input.d1Database;
        if (!requestDb) {
            throw new customError.AppError("D1 request binding is unavailable", 500);
        }
        d1Batch = ormService.captureD1Batch(requestDb);
    }
    const previous = settlementLocks.get(recordId) ?? Promise.resolve<SettlementResult | undefined>(undefined);
    const current = previous
        .catch(() => undefined)
        .then(async () => {
            const record = await findSettlementRecord(recordId, d1Batch);
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

            if (d1Batch) {
                return await settleWithD1Batch(
                    d1Batch,
                    recordId,
                    Number(input.user.id),
                    keyId,
                    quoteResult,
                    status,
                    persistedCost,
                    shouldCharge,
                );
            }

            /**
             * 将扣费与 record 标记作为一个数据库单元持久化。Sutando 模型 helper 会打开自己的连接，
             * 因此热路径有意直接使用事务句柄。token 请求的最终费用只能在响应结束后确定；即使本次
             * 费用越过 Key 额度，也必须记入 quota_used，后续请求再由入口额度检查阻断。
             */
            const persist = async (db: any): Promise<SettlementResult> => {
                let currentQuery = db("record").where("id", recordId);
                if (!ormService.isWorker && process.env.DB_DRIVER === "mysql") {
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
