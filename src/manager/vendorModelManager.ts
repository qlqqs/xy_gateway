import { SgVendorModel } from "../model/sgVendorModel";
import customError from "../util/customErrorUtil";
import ormService from "../service/ormService";
import modelUpstreamManager from "./modelUpstreamManager";

async function listByVendor(vendorId: number): Promise<SgVendorModel[]> {
    return (await SgVendorModel.query()
        .where("vendor_id", vendorId)
        .orderBy("model_id", "asc")
        .get()).all();
}

async function findById(recordId: number): Promise<SgVendorModel | null> {
    return await SgVendorModel.query().find(recordId);
}

/**
 * 按 vendor + model_id 查找；不存在时返回 null。
 */
async function findByVendorAndModel(vendorId: number, modelId: string | null): Promise<SgVendorModel | null> {
    return await SgVendorModel.query()
        .where("vendor_id", vendorId)
        .where("model_id", modelId)
        .first();
}

/**
 * 直接插入一条 vendor model（不做重复检查，供路由自动补全等场景使用）。
 */
async function create(vendorId: number, modelId: string): Promise<SgVendorModel> {
    return await SgVendorModel.query().create({
        vendor_id: vendorId,
        model_id: modelId,
    });
}

/** 在指定连接中同步模型差异，供更大的供应商事务复用。 */
async function syncByVendorWithConnection(db: any, vendorId: number, modelIds: string[]): Promise<void> {
    const existing = await db("vendor_model")
        .where("vendor_id", vendorId)
        .select("id", "model_id");
    const desired = new Set(modelIds);
    const existingModelIds = new Set(existing.map((record: any) => String(record.model_id)));

    // 先补齐新增项。Worker/D1 暂无跨语句事务，即使后续删除失败，
    // 也不会先丢失原有模型；Node/MySQL 则由调用方事务保证整体原子性。
    for (const modelId of modelIds) {
        if (!existingModelIds.has(modelId)) {
            await db("vendor_model").insert({
                vendor_id: vendorId,
                model_id: modelId,
            });
        }
    }

    const removedIds = existing
        .filter((record: any) => !desired.has(String(record.model_id)))
        .map((record: any) => Number(record.id));
    if (removedIds.length > 0) {
        await db("model_upstream")
            .whereIn("vendor_model_id", removedIds)
            .update({ vendor_model_id: null });
        await db("vendor_model").whereIn("id", removedIds).delete();
    }
}


/** 同步模型差异并保留未变化记录的 ID，避免破坏有效的模型路由引用。 */
async function syncByVendor(vendorId: number, modelIds: string[]): Promise<SgVendorModel[]> {
    const knex = ormService.getKnex();

    if (ormService.isWorker) {
        await syncByVendorWithConnection(knex, vendorId, modelIds);
    } else {
        await knex.transaction((transaction: any) =>
            syncByVendorWithConnection(transaction, vendorId, modelIds));
    }

    return await listByVendor(vendorId);
}

/**
 * 新增 vendor model；同 vendor 下 model_id 已存在时抛 409。
 */
async function add(vendorId: number, modelId: string): Promise<SgVendorModel> {
    const existing = await SgVendorModel.query()
        .where("vendor_id", vendorId)
        .where("model_id", modelId)
        .first();

    if (existing) {
        throw new customError.AppError("Model already exists", 409);
    }

    return await SgVendorModel.query().create({
        vendor_id: vendorId,
        model_id: modelId,
    });
}

/**
 * 更新指定 vendor model 的 allowed_formats；记录不存在（或不属于该 vendor）时返回 null。
 */
async function update(
    recordId: number,
    vendorId: number,
    allowedFormatsJson: string | null,
): Promise<SgVendorModel | null> {
    const record = await findVendorModel(recordId, vendorId);
    if (!record) {
        return null;
    }

    await SgVendorModel.query().where("id", recordId).update({ allowed_formats: allowedFormatsJson });

    return await SgVendorModel.query().find(recordId);
}

/**
 * 删除指定 vendor model；记录不存在（或不属于该 vendor）时返回 false。
 */
async function remove(recordId: number, vendorId: number): Promise<boolean> {
    const record = await findVendorModel(recordId, vendorId);
    if (!record) {
        return false;
    }

    await modelUpstreamManager.clearVendorModelReference(recordId);
    await SgVendorModel.query().where("id", recordId).delete();
    return true;
}

async function getByIds(ids: number[]): Promise<SgVendorModel[]> {
    if (ids.length === 0) {
        return [];
    }
    return (await SgVendorModel.query().whereIn("id", ids).get()).all();
}

async function removeByVendor(vendorId: number): Promise<void> {
    const existing = await listByVendor(vendorId);
    for (const record of existing) {
        await modelUpstreamManager.clearVendorModelReference(Number(record.id));
    }
    await SgVendorModel.query().where("vendor_id", vendorId).delete();
}

/**
 * 按 id + vendor_id 查找，确保记录归属该 vendor。
 */
async function findVendorModel(recordId: number, vendorId: number): Promise<SgVendorModel | null> {
    return await SgVendorModel.query()
        .where("id", recordId)
        .where("vendor_id", vendorId)
        .first();
}

export default {
    listByVendor,
    findById,
    findByVendorAndModel,
    create,
    syncByVendor,
    syncByVendorWithConnection,
    add,
    update,
    remove,
    getByIds,
    removeByVendor,
    findVendorModel,
};
