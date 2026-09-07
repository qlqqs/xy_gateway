import { SgModelUpstream } from "../model/sgModelUpstream";

async function findById(id: number): Promise<SgModelUpstream | null> {
    return await SgModelUpstream.query().find(id);
}

async function listByModel(modelId: number): Promise<SgModelUpstream[]> {
    return (await SgModelUpstream.query().where("model_id", modelId).orderBy("sort_order", "asc").orderBy("id", "asc").get()).all();
}

async function listByVendor(vendorId: number): Promise<SgModelUpstream[]> {
    return (await SgModelUpstream.query().where("vendor_id", vendorId).orderBy("model_id", "asc").orderBy("sort_order", "asc").get()).all();
}

async function create(data: Record<string, unknown>): Promise<SgModelUpstream> {
    return await SgModelUpstream.query().create(data);
}

/** Replace ordered upstream mappings for one model. Callers should provide a transaction. */
async function replaceForModel(
    modelId: number,
    upstreams: Array<Record<string, unknown>>,
    transaction?: any,
): Promise<SgModelUpstream[]> {
    // The aggregate write path passes a Knex transaction handle.  Sutando's
    // model helpers otherwise acquire a separate connection for every call,
    // which would leave a model row and its normalized mappings partially
    // committed if the second statement fails.
    if (transaction) {
        await transaction("model_upstream").where("model_id", modelId).delete();
        for (let index = 0; index < upstreams.length; index += 1) {
            const upstream = upstreams[index];
            await transaction("model_upstream").insert({
                model_id: modelId,
                vendor_id: upstream.vendor_id,
                vendor_model_id: upstream.vendor_model_id ?? null,
                enabled: upstream.enabled === false ? 0 : 1,
                sort_order: upstream.sort_order ?? index,
            });
        }
        return (await transaction("model_upstream")
            .where("model_id", modelId)
            .orderBy("sort_order", "asc")
            .orderBy("id", "asc")) as SgModelUpstream[];
    }

    await SgModelUpstream.query().where("model_id", modelId).delete();
    for (let index = 0; index < upstreams.length; index += 1) {
        await create({ ...upstreams[index], model_id: modelId, sort_order: upstreams[index].sort_order ?? index });
    }
    return await listByModel(modelId);
}

async function removeByModel(modelId: number): Promise<void> {
    await SgModelUpstream.query().where("model_id", modelId).delete();
}

async function removeByVendor(vendorId: number): Promise<void> {
    await SgModelUpstream.query().where("vendor_id", vendorId).delete();
}

/**
 * A vendor-model row can disappear independently of its vendor.  Clear the
 * optional relation explicitly so databases running without FK enforcement
 * (SQLite/D1) cannot leave a dangling vendor_model_id in the canonical model
 * mapping.  The routing layer then intentionally falls back to the gateway
 * model name.
 */
async function clearVendorModelReference(vendorModelId: number): Promise<void> {
    await SgModelUpstream.query()
        .where("vendor_model_id", vendorModelId)
        .update({ vendor_model_id: null });
}

export default {
    findById,
    listByModel,
    listByModelId: listByModel,
    listByVendor,
    create,
    replaceForModel,
    syncByModel: replaceForModel,
    removeByModel,
    removeByModelId: removeByModel,
    removeByVendor,
    clearVendorModelReference,
};
