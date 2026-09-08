import { Context } from "hono";
import { SgVendor } from "../model/sgVendor";
import vendorManager from "../manager/vendorManager";
import vendorService from "../service/vendorService";
import vendorDefaultUrls from "../util/vendorDefaultUrlsUtil";
import vendorTestService from "../service/vendorTestService";
import customError from "../util/customErrorUtil";
import idUtil from "../util/idUtil";
import { createListResponse, parsePaginationQuery } from "../util/paginationUtil";


/** 格式化供应商 API 响应，并返回已同步的模型数量。 */
function formatVendor(
    vendor: SgVendor,
    modelCount?: number,
) {
    const availableModels = vendor.config?.available_models ?? vendor.available_models ?? [];
    return {
        id: vendor.id,
        type: vendor.type,
        name: vendor.name,
        token: vendor.token,
        urls: vendor.urls,
        config: {
            ...vendor.config.toJSON(),
            available_models: availableModels,
        },
        model_count: modelCount ?? availableModels.length,
        created_at: vendor.created_at,
        updated_at: vendor.updated_at,
    };
}


async function listVendors(c: Context) {
    const query = c.req.query();
    const { pageSize, offset } = parsePaginationQuery(query);

    const { list: vendors, total, modelCounts } = await vendorManager.list({
        type: query.type,
        keyword: query.keyword,
        pageSize,
        offset,
    });

    const formattedVendors = vendors.map(v => formatVendor(v, modelCounts[v.id] ?? 0));
    return c.json(createListResponse(formattedVendors, total));
}


async function getVendor(c: Context) {
    const vendorId = idUtil.requirePositiveInteger(c.req.param("id"));

    const vendor = await vendorManager.findById(vendorId);

    if (!vendor) {
        throw new customError.NotFoundError("Vendor not found");
    }

    return c.json(formatVendor(vendor));
}

async function getVendorsByIds(c: Context) {
    const body = await c.req.json();
    const ids = body.ids;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return c.json([]);
    }

    const idList = idUtil.normalizePositiveIntegers(ids);
    if (idList.length === 0) {
        return c.json([]);
    }

    const vendors = await vendorManager.getByIds(idList);
    const formattedVendors = vendors.map(formatVendor);
    return c.json(formattedVendors);
}


async function createVendor(c: Context) {
    const body = await c.req.json();
    const normalizedConfig = vendorService.normalizeDomainConfig(body.config);
    const vendor = new SgVendor({ ...body, config: normalizedConfig });

    // Validation - 不验证 urls，允许为空
    if (typeof vendor.type !== "string" || !vendor.type.trim()
        || typeof vendor.name !== "string" || !vendor.name.trim()
        || typeof vendor.token !== "string" || !vendor.token.trim()) {
        throw new customError.AppError("Missing required fields");
    }

    vendor.name = vendor.name.trim();
    vendor.token = vendor.token.trim();
    vendorService.validateProxyConfig(vendor.config);
    vendorService.validateSchedulingConfig(normalizedConfig);
    await vendorService.validateDomainConfig(normalizedConfig);

    const instance = await vendorService.createVendor(vendor);

    return c.json(formatVendor(instance));
}


async function updateVendor(c: Context) {
    const vendorId = idUtil.requirePositiveInteger(c.req.param("id"));

    const body = await c.req.json();
    const { type, name, token, urls, config } = body;

    const updatedVendor = await vendorService.updateVendor(vendorId, {
        type,
        name,
        token,
        urls,
        config,
    });

    if (!updatedVendor) {
        throw new customError.NotFoundError("Vendor not found");
    }

    return c.json(formatVendor(updatedVendor));
}


async function deleteVendor(c: Context) {
    const vendorId = idUtil.requirePositiveInteger(c.req.param("id"));

    const vendor = await vendorManager.findById(vendorId);

    if (!vendor) {
        throw new customError.NotFoundError("Vendor not found");
    }

    const deleted = await vendorService.deleteVendor(vendorId);
    if (!deleted) {
        throw new customError.NotFoundError("Vendor not found");
    }

    return c.json({ success: true });
}

async function testVendor(c: Context) {
    const vendorId = idUtil.requirePositiveInteger(c.req.param("id"));

    const vendor = await vendorManager.findById(vendorId);
    if (!vendor) {
        throw new customError.NotFoundError("Vendor not found");
    }

    const bodyJson = await c.req.json().catch(() => ({}));
    const result = await vendorTestService.testVendorConnectivity(vendor, {
        format: bodyJson.format,
        model: bodyJson.model,
        auto_convert: bodyJson.auto_convert,
    });

    return c.json(result);
}

async function fetchModelsPreview(c: Context) {
    const body = await c.req.json();
    const vendor = new SgVendor({
        type: body.type,
        token: body.token,
        urls: body.urls,
        config: body.config,
    });
    const models = await vendorService.fetchUpstreamModels(vendor);
    return c.json({ models });
}

async function getPresetUrls(c: Context) {
    return c.json(vendorDefaultUrls.getAllUrls());
}


export default {
    listVendors,
    getVendor,
    getVendorsByIds,
    createVendor,
    updateVendor,
    deleteVendor,
    testVendor,
    fetchModelsPreview,
    getPresetUrls,
};
