import type { Builder } from "sutando";
import { SgModel, ModelUpstreamConfig } from "../model/sgModel";
import modelUpstreamManager from "./modelUpstreamManager";
import ormService from "../service/ormService";

interface ModelListOptions {
    vendorId?: number;
    keyword?: string;
    pageSize: number;
    offset: number;
}


function filterByVendor(query: Builder<SgModel>, vendorId: number): void {
    // Mapping rows are the canonical routing source.  Keeping the filter in a
    // relational subquery works on SQLite/D1 and MySQL without JSON-specific
    // functions or driver branches.
    query.whereRaw("EXISTS (SELECT 1 FROM model_upstream mu WHERE mu.model_id = model.id AND mu.vendor_id = ?)", [vendorId]);
}

async function hydrateMapping(model: SgModel): Promise<SgModel> {
    const rows = await modelUpstreamManager.listByModel(Number(model.id));
    model.mapping = {
        upstreams: rows.map(row => new ModelUpstreamConfig({
            vendor_id: Number(row.vendor_id),
            ...(row.vendor_model_id == null ? {} : { vendor_model_id: Number(row.vendor_model_id) }),
            enabled: Boolean(row.enabled),
            sort_order: Number(row.sort_order ?? 0),
        })),
    };
    return model;
}


async function getModel(modelName: string, enable?: boolean): Promise<SgModel | null> {
    if (modelName == null) return null;

    const query = SgModel.query().where("name", modelName);

    // 如果 enable 参数非空，则按 enable 过滤
    if (enable !== undefined) {
        query.where("enable", enable);
    }

    const model = await query.first();
    return model ? hydrateMapping(model) : null;
}


async function findById(modelId: number): Promise<SgModel | null> {
    const model = await SgModel.query().find(modelId);
    return model ? hydrateMapping(model) : null;
}


async function getByIds(ids: number[]): Promise<SgModel[]> {
    if (ids.length === 0) {
        return [];
    }
    return Promise.all((await SgModel.query().whereIn("id", ids).get()).all().map(hydrateMapping));
}


async function listModels(options: ModelListOptions) {
    const query = SgModel.query().orderBy("id", "desc");
    if (options.vendorId) {
        filterByVendor(query, options.vendorId);
    }
    if (options.keyword) {
        query.where("name", "like", `%${options.keyword}%`);
    }

    const total = Number(await query.clone().count() || 0);
    const models = await query.limit(options.pageSize).offset(options.offset).get();
    const list = await Promise.all(models.all().map(hydrateMapping));
    return {
        list,
        total,
    };
}


async function hasModelsUsingVendor(vendorId: number): Promise<boolean> {
    const row = await ormService.getKnex()("model_upstream").where("vendor_id", vendorId).first();
    return !!row;
}

async function disableWithoutUpstreams(modelIds: number[]): Promise<void> {
    for (const modelId of modelIds) {
        const remaining = await modelUpstreamManager.listByModel(modelId);
        if (!remaining.some(mapping => Boolean(mapping.enabled))) {
            await SgModel.query().where("id", modelId).update({ enable: 0 });
        }
    }
}


async function listEnabledModels() {
    const models = await SgModel.query()
        .where("enable", 1)
        .orderBy("id", "asc")
        .get();

    return models.all().map(model => ({
        id: model.name,
        object: "model",
        created: Math.floor(new Date(model.created_at).getTime() / 1000),
        owned_by: "gateway",
    }));
}

async function listEnabledModelEntities(): Promise<SgModel[]> {
    const models = await SgModel.query()
        .where("enable", 1)
        .orderBy("id", "asc")
        .get();
    return Promise.all(models.all().map(hydrateMapping));
}


async function checkDuplicateModel(
    name: string,
    excludeId?: number,
): Promise<boolean> {
    const query = SgModel.query().where("name", name);
    if (excludeId) {
        query.where("id", "!=", excludeId);
    }
    const existing = await query.first();
    return !!existing;
}


async function count(): Promise<number> {
    return Number(await SgModel.query().count() || 0);
}


async function deleteModel(modelId: number): Promise<boolean> {
    const model = await SgModel.query().find(modelId);

    if (!model) {
        return false;
    }

    await modelUpstreamManager.removeByModel(modelId);
    await SgModel.query().where("id", modelId).delete();
    return true;
}


async function save(model: SgModel): Promise<SgModel> {
    await model.save();
    return model;
}

export default {
    getModel,
    findById,
    getByIds,
    listModels,
    hasModelsUsingVendor,
    disableWithoutUpstreams,
    listEnabledModels,
    listEnabledModelEntities,
    checkDuplicateModel,
    deleteModel,
    filterByVendor,
    count,
    save,
};
