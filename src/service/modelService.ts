import { SgModel } from "../model/sgModel";
import modelManager from "../manager/modelManager";
import modelUpstreamManager from "../manager/modelUpstreamManager";
import vendorManager from "../manager/vendorManager";
import vendorModelManager from "../manager/vendorModelManager";
import userGroupManager from "../manager/userGroupManager";
import userKeyManager from "../manager/userKeyManager";
import customError from "../util/customErrorUtil";
import ormService from "./ormService";

export interface ModelUpstreamInput {
    vendor_id: number;
    vendor_model_id?: number | null;
    enabled?: boolean;
}

export interface ModelRequest {
    name: string;
    enable?: boolean;
    prices?: Record<string, unknown> | null;
    mapping: { upstreams: ModelUpstreamInput[] };
}

function parseRequest(input: unknown): ModelRequest {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new customError.AppError("Invalid model payload");
    }
    const body = input as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(body, "routing_mode")
        || Object.prototype.hasOwnProperty.call(body, "routing_config")) {
        throw new customError.AppError("routing_mode and routing_config are no longer model fields");
    }
    if (typeof body.name !== "string" || !body.name.trim()) {
        throw new customError.AppError("Model name is required");
    }
    const mapping = body.mapping;
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)
        || !Array.isArray((mapping as Record<string, unknown>).upstreams)) {
        throw new customError.AppError("mapping.upstreams must be an array");
    }
    const upstreams = ((mapping as Record<string, unknown>).upstreams as unknown[]).map((raw, index) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new customError.AppError(`Invalid upstream at index ${index}`);
        }
        const item = raw as Record<string, unknown>;
        const vendorId = Number(item.vendor_id);
        if (!Number.isSafeInteger(vendorId) || vendorId <= 0) {
            throw new customError.AppError("Each upstream must specify a valid vendor_id");
        }
        const vendorModelId = item.vendor_model_id == null || item.vendor_model_id === ""
            ? undefined
            : Number(item.vendor_model_id);
        if (vendorModelId !== undefined && (!Number.isSafeInteger(vendorModelId) || vendorModelId <= 0)) {
            throw new customError.AppError("vendor_model_id must be a positive integer");
        }
        if (item.enabled !== undefined && typeof item.enabled !== "boolean") {
            throw new customError.AppError("enabled must be a boolean");
        }
        return {
            vendor_id: vendorId,
            ...(vendorModelId === undefined ? {} : { vendor_model_id: vendorModelId }),
            enabled: item.enabled ?? true,
        } satisfies ModelUpstreamInput;
    });
    if (upstreams.length === 0 && body.enable !== false) {
        throw new customError.AppError("At least one upstream is required");
    }
    if (body.enable !== undefined && typeof body.enable !== "boolean") {
        throw new customError.AppError("enable must be a boolean");
    }
    if (body.prices !== undefined && body.prices !== null
        && (typeof body.prices !== "object" || Array.isArray(body.prices))) {
        throw new customError.AppError("prices must be an object or null");
    }
    return {
        name: body.name.trim(),
        enable: body.enable === undefined ? true : body.enable,
        prices: body.prices === null ? null : (body.prices as Record<string, unknown> | undefined ?? {}),
        mapping: { upstreams },
    };
}

async function validateUpstreams(modelName: string, upstreams: ModelUpstreamInput[], requireEnabled: boolean): Promise<void> {
    const seen = new Set<string>();
    let enabledCount = 0;
    for (const upstream of upstreams) {
        const vendor = await vendorManager.findById(upstream.vendor_id);
        if (!vendor) throw new customError.NotFoundError("Vendor not found");
        if (upstream.enabled !== false) enabledCount += 1;
        const vendorModelId = upstream.vendor_model_id ?? null;
        const key = `${upstream.vendor_id}:${vendorModelId ?? modelName}`;
        if (seen.has(key)) throw new customError.AppError("Duplicate upstream mapping");
        seen.add(key);
        if (vendorModelId !== null) {
            const vendorModel = await vendorModelManager.findById(vendorModelId);
            if (!vendorModel || Number(vendorModel.vendor_id) !== upstream.vendor_id) {
                throw new customError.AppError("Vendor model does not belong to the selected vendor");
            }
        }
    }
    if (requireEnabled && enabledCount === 0) {
        throw new customError.AppError("At least one upstream must be enabled");
    }
}

function persistenceData(request: ModelRequest): Record<string, unknown> {
    return {
        name: request.name,
        enable: request.enable,
        prices: request.prices ?? {},
    };
}

async function replaceMappings(
    modelId: number,
    upstreams: ModelUpstreamInput[],
    transaction?: any,
): Promise<void> {
    await modelUpstreamManager.replaceForModel(modelId, upstreams.map((upstream, index) => ({
        vendor_id: upstream.vendor_id,
        vendor_model_id: upstream.vendor_model_id ?? null,
        enabled: upstream.enabled !== false,
        sort_order: index,
    })), transaction);
}

function insertId(result: unknown): number {
    const raw = Array.isArray(result) ? result[0] : result;
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new customError.AppError("Failed to persist model", 500);
    }
    return id;
}

/**
 * MySQL checks the foreign-key parent row while inserting each normalized
 * mapping.  Two model writes for the same vendor can therefore deadlock even
 * though each aggregate touches disjoint model rows.  Deadlocks are
 * transaction-local and safe to retry from the beginning; never retry other
 * errors (or a transaction whose commit outcome is unknown).
 */
async function runAggregateTransaction<T>(knex: any, work: (transaction: any) => Promise<T>): Promise<T> {
    const maxAttempts = process.env.DB_DRIVER === "mysql" ? 3 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await knex.transaction(work);
        } catch (error: any) {
            const code = error?.code;
            const errno = Number(error?.errno);
            const retryable = code === "ER_LOCK_DEADLOCK"
                || code === "ER_LOCK_WAIT_TIMEOUT"
                || errno === 1213
                || errno === 1205;
            if (!retryable || attempt >= maxAttempts) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 25 * attempt));
        }
    }
    throw new Error("Aggregate transaction failed");
}

/**
 * Persist the model row and its normalized upstream mappings as one aggregate.
 * Node/MySQL use a real Knex transaction; D1 executes the same ordered writes
 * without claiming cross-statement atomicity (the documented Worker limit).
 */
async function persistAggregate(
    request: ModelRequest,
    modelId?: number,
): Promise<number> {
    const knex = ormService.getKnex();
    let insertedId: number | undefined;
    const data = {
        name: request.name,
        enable: request.enable ? 1 : 0,
        prices: JSON.stringify(request.prices ?? {}),
    };
    const persist = async (db: any): Promise<number> => {
        let id = modelId;
        if (id === undefined) {
            id = insertId(await db("model").insert(data));
            insertedId = id;
        } else {
            const changed = await db("model").where("id", id).update(data);
            if (Number(changed) === 0) {
                throw new customError.NotFoundError("Model not found");
            }
        }
        await replaceMappings(id, request.mapping.upstreams, db);
        return id;
    };

    if (ormService.isWorker) {
        try {
            return await persist(knex);
        } catch (error) {
            // D1 has no multi-statement transaction.  If creation inserted a
            // model row before a mapping statement failed, remove exactly that
            // row; never look it up by name, since a concurrent request may
            // own another model with the same transient name.
            if (modelId === undefined && insertedId !== undefined) {
                await modelManager.deleteModel(insertedId).catch(() => undefined);
            }
            throw error;
        }
    }
    return runAggregateTransaction(knex, persist);
}

async function createModel(input: unknown): Promise<SgModel> {
    const request = parseRequest(input);
    if (await modelManager.checkDuplicateModel(request.name)) {
        throw new customError.AppError("A model with this name already exists", 409);
    }
    const model = new SgModel(persistenceData(request));
    model.validatePrices();
    await validateUpstreams(request.name, request.mapping.upstreams, request.enable !== false);
    try {
        const modelId = await persistAggregate(request);
        const persisted = await modelManager.findById(modelId);
        if (!persisted) throw new customError.NotFoundError("Model not found");
        persisted.mapping = { upstreams: request.mapping.upstreams as any };
        return persisted;
    } catch (error) {
        // Node/MySQL transactions roll the aggregate back.  Worker/D1 cleanup
        // is performed inside persistAggregate with the exact inserted id.
        throw error;
    }
}

async function updateModel(id: number, input: unknown): Promise<SgModel | null> {
    const current = await modelManager.findById(id);
    if (!current) return null;
    const previousName = String(current.name ?? "");
    const request = parseRequest(input);
    if (await modelManager.checkDuplicateModel(request.name, id)) {
        throw new customError.AppError("A model with this name already exists", 409);
    }
    current.fill(persistenceData(request));
    current.validatePrices();
    await validateUpstreams(request.name, request.mapping.upstreams, request.enable !== false);
    try {
        await persistAggregate(request, id);
    } catch (error) {
        // Knex rolls the model and mapping writes back together on Node/MySQL.
        // Worker/D1 has no multi-statement transaction; the old aggregate is
        // left untouched only when the first model update itself fails.
        throw error;
    }
    if (previousName && previousName !== request.name) {
        // Model names are embedded in group/key whitelist snapshots.  Keep
        // those references coherent as part of the same domain operation;
        // otherwise a rename would silently make an allowed model unusable.
        await userGroupManager.renameModelReference(previousName, request.name);
        await userKeyManager.renameModelReference(previousName, request.name);
    }
    return await modelManager.findById(id);
}

async function deleteModel(id: number): Promise<boolean> {
    const model = await modelManager.findById(id);
    if (!model) return false;
    const name = String(model.name ?? "");
    if (name) {
        await userGroupManager.removeModelReference(name);
        await userKeyManager.removeModelReference(name);
    }
    return await modelManager.deleteModel(id);
}

export default {
    parseRequest,
    validateUpstreams,
    createModel,
    updateModel,
    deleteModel,
};
