import { Context } from "hono";
import { SgVendorModel } from "../model/sgVendorModel";
import vendorManager from "../manager/vendorManager";
import vendorModelManager from "../manager/vendorModelManager";
import vendorService from "../service/vendorService";
import customError from "../util/customErrorUtil";
import idUtil from "../util/idUtil";
import { ApiFormat } from "../constants";


function serializeVendorModel(m: SgVendorModel) {
    return {
        ...m.toData(),
        allowed_formats: m.getAllowedFormats(),
    };
}


async function listVendorModels(c: Context) {
    const vendorId = idUtil.requirePositiveInteger(c.req.param("id"));

    const models = await vendorModelManager.listByVendor(vendorId);

    return c.json(models.map(serializeVendorModel));
}


async function fetchVendorModels(c: Context) {
    const vendorId = idUtil.requirePositiveInteger(c.req.param("id"));

    const vendor = await vendorManager.findById(vendorId);
    if (!vendor) {
        throw new customError.NotFoundError("Vendor not found");
    }

    const models = await vendorService.fetchUpstreamModels(vendor);
    return c.json({ models });
}


async function syncVendorModels(c: Context) {
    const vendorId = idUtil.requirePositiveInteger(c.req.param("id"));
    const body = await c.req.json();
    const updated = await vendorService.syncVendorModels(vendorId, body.model_ids);

    return c.json(updated.map(serializeVendorModel));
}


async function addVendorModel(c: Context) {
    const vendorId = idUtil.requirePositiveInteger(c.req.param("id"));
    const body = await c.req.json();
    const { model_id } = body;

    if (!model_id || typeof model_id !== "string" || !model_id.trim()) {
        throw new customError.AppError("model_id is required");
    }

    const record = await vendorService.addVendorModel(vendorId, model_id);
    if (!record) {
        throw new customError.NotFoundError("Vendor model not found");
    }

    return c.json(serializeVendorModel(record));
}


async function getVendorModelsByIds(c: Context) {
    const body = await c.req.json();
    const ids = body.ids;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return c.json([]);
    }

    const idList = idUtil.normalizePositiveIntegers(ids);
    if (idList.length === 0) {
        return c.json([]);
    }

    const models = await vendorModelManager.getByIds(idList);
    return c.json(models.map(serializeVendorModel));
}


async function updateVendorModel(c: Context) {
    const vendorId = idUtil.requirePositiveInteger(c.req.param("id"));
    const recordId = idUtil.requirePositiveInteger(c.req.param("modelId"));

    const body = await c.req.json();
    const allowed_formats = body?.allowed_formats;

    if (allowed_formats !== null && !Array.isArray(allowed_formats)) {
        throw new customError.AppError("allowed_formats must be null or an array of API formats");
    }

    let allowedFormatsJson: string | null = null;
    if (Array.isArray(allowed_formats)) {
        const validFormats = new Set<string>(Object.values(ApiFormat));
        const normalized: ApiFormat[] = [];
        for (const format of allowed_formats) {
            if (typeof format !== "string" || !validFormats.has(format)) {
                throw new customError.AppError("allowed_formats contains an invalid API format");
            }
            if (!normalized.includes(format as ApiFormat)) {
                normalized.push(format as ApiFormat);
            }
        }
        allowedFormatsJson = JSON.stringify(normalized);
    }

    const updated = await vendorModelManager.update(recordId, vendorId, allowedFormatsJson);
    if (!updated) {
        throw new customError.NotFoundError("Vendor model not found");
    }

    return c.json(serializeVendorModel(updated));
}


async function deleteVendorModel(c: Context) {
    const vendorId = idUtil.requirePositiveInteger(c.req.param("id"));
    const recordId = idUtil.requirePositiveInteger(c.req.param("modelId"));

    const removed = await vendorService.removeVendorModel(vendorId, recordId);
    if (!removed) {
        throw new customError.NotFoundError("Vendor model not found");
    }

    return c.json({ success: true });
}


export default {
    listVendorModels,
    fetchVendorModels,
    syncVendorModels,
    addVendorModel,
    updateVendorModel,
    deleteVendorModel,
    getVendorModelsByIds,
};
