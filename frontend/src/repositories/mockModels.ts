import type { ListResponse } from '@/types';
import type {
    CreateModelRequest,
    Model,
    ModelPrices,
    ModelMapping,
    ModelQuery,
    ModelUpstreamConfig,
    UpdateModelRequest,
} from '@/types/model';
import storage from './storage';

const STORAGE_KEY = 'xy-gateway:mock-models:v2';
const billingModes: NonNullable<ModelPrices['billing_mode']>[] = ['token', 'per_request', 'image'];

function isBillingMode(value: unknown): value is NonNullable<ModelPrices['billing_mode']> {
    return billingModes.includes(value as NonNullable<ModelPrices['billing_mode']>);
}

const seedModels: Model[] = [
    {
        id: 1,
        name: 'gpt-4o-mini',
        mapping: {
            upstreams: [{ vendor_id: 1, enabled: true }],
        },
        enable: true,
        prices: {
            billing_mode: 'token',
            input: 0.15,
            output: 0.6,
        },
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
    },
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toDate(value: unknown, fallback: Date): Date {
    const date = new Date(typeof value === 'string' || typeof value === 'number' ? value : NaN);
    return Number.isNaN(date.getTime()) ? fallback : date;
}

function parseUpstream(value: unknown): ModelUpstreamConfig {
    if (!isRecord(value)
        || typeof value.vendor_id !== 'number'
        || !Number.isSafeInteger(value.vendor_id)
        || value.vendor_id <= 0
        || (value.vendor_model_id !== undefined
            && (typeof value.vendor_model_id !== 'number'
                || !Number.isSafeInteger(value.vendor_model_id)
                || value.vendor_model_id <= 0))) {
        throw new Error('模型上游配置无效');
    }

    return {
        vendor_id: value.vendor_id,
        ...(typeof value.vendor_model_id === 'number'
            ? { vendor_model_id: value.vendor_model_id }
            : {}),
        enabled: value.enabled !== false,
    };
}

function parseMapping(value: unknown): ModelMapping {
    if (!isRecord(value) || !Array.isArray(value.upstreams)) {
        throw new Error('模型映射配置无效');
    }

    return {
        upstreams: value.upstreams.map(parseUpstream),
    };
}

function parsePrices(value: unknown): ModelPrices | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (!isRecord(value)) {
        throw new Error('模型价格配置无效');
    }

    const priceKeys: Array<keyof ModelPrices> = [
        'input',
        'output',
        'cache_write',
        'cache_read',
        'image_input',
        'image_output',
        'per_request',
    ];
    if (value.billing_mode !== undefined && !isBillingMode(value.billing_mode)) {
        throw new Error('模型计费模式无效');
    }
    const prices: ModelPrices = {
        billing_mode: value.billing_mode === undefined ? 'token' : value.billing_mode,
    };
    for (const key of priceKeys) {
        const price = value[key];
        if (typeof price === 'number' && Number.isFinite(price) && price >= 0) {
            Object.assign(prices, { [key]: price });
        } else if (price !== undefined && price !== null) {
            throw new Error('模型价格必须是非负数');
        }
    }
    return prices;
}

function parseModels(value: unknown): Model[] {
    if (!Array.isArray(value)) {
        throw new Error('模型存储格式无效');
    }

    return value.map((item: unknown) => {
        if (!isRecord(item)
            || typeof item.id !== 'number'
            || !Number.isSafeInteger(item.id)
            || item.id <= 0
            || typeof item.name !== 'string'
            || !item.name.trim()
            || !isRecord(item.mapping)
            || typeof item.enable !== 'boolean') {
            throw new Error('模型存储包含无效记录');
        }

        return {
            id: item.id,
            name: item.name.trim(),
            mapping: parseMapping(item.mapping),
            enable: item.enable,
            prices: parsePrices(item.prices),
            created_at: toDate(item.created_at, new Date()),
            updated_at: toDate(item.updated_at, new Date()),
        } satisfies Model;
    });
}

let state = storage.load(STORAGE_KEY, seedModels, parseModels);

function clonePrices(prices: ModelPrices | null | undefined): ModelPrices | null {
    return normalizePrices(prices);
}

function normalizePrices(prices: ModelPrices | null | undefined): ModelPrices | null {
    if (prices == null) {
        return null;
    }

    if (prices.billing_mode !== undefined && !isBillingMode(prices.billing_mode)) {
        throw new Error('模型计费模式无效');
    }

    const normalized: ModelPrices = {
        billing_mode: isBillingMode(prices.billing_mode)
            ? prices.billing_mode
            : 'token',
    };
    const priceKeys: Array<keyof Omit<ModelPrices, 'billing_mode'>> = [
        'input',
        'output',
        'cache_write',
        'cache_read',
        'image_input',
        'image_output',
        'per_request',
    ];
    for (const key of priceKeys) {
        const value = prices[key];
        if (value !== undefined && value !== null) {
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
                throw new Error('模型价格必须是非负数');
            }
            normalized[key] = value;
        }
    }
    return normalized;
}

function cloneModel(model: Model): Model {
    return {
        ...model,
        mapping: cloneMapping(model.mapping),
        prices: clonePrices(model.prices),
        created_at: new Date(model.created_at),
        updated_at: new Date(model.updated_at),
    };
}

function persist(next: Model[]): void {
    state = next.map(cloneModel);
    storage.save(STORAGE_KEY, state);
}

function cloneMapping(mapping: ModelMapping): ModelMapping {
    return {
        upstreams: mapping.upstreams.map(upstream => {
            if (!Number.isSafeInteger(upstream.vendor_id) || upstream.vendor_id <= 0) {
                throw new Error('模型上游供应商无效');
            }
            if (upstream.vendor_model_id !== undefined
                && (!Number.isSafeInteger(upstream.vendor_model_id) || upstream.vendor_model_id <= 0)) {
                throw new Error('模型上游模型无效');
            }
            return {
                vendor_id: upstream.vendor_id,
                ...(upstream.vendor_model_id === undefined ? {} : { vendor_model_id: upstream.vendor_model_id }),
                enabled: upstream.enabled !== false,
            };
        }),
    };
}

function normalizeRequest(data: CreateModelRequest | UpdateModelRequest): CreateModelRequest {
    if (typeof data.name !== 'string'
        || typeof data.enable !== 'boolean'
        || !data.mapping
        || !Array.isArray(data.mapping.upstreams)) {
        throw new Error('模型字段无效');
    }
    const request = {
        name: data.name.trim(),
        enable: data.enable,
        mapping: cloneMapping(data.mapping),
        prices: normalizePrices(data.prices),
    };
    if (!request.name) {
        throw new Error('模型名称不能为空');
    }
    if (request.enable && request.mapping.upstreams.length === 0) {
        throw new Error('至少需要配置一个上游');
    }
    const enabledCount = request.mapping.upstreams.filter(upstream => upstream.enabled).length;
    if (request.enable && enabledCount === 0) {
        throw new Error('至少需要启用一个上游');
    }
    return request;
}

function assertUniqueName(name: string, currentId?: number): void {
    if (state.some(model => model.id !== currentId && model.name.toLowerCase() === name.toLowerCase())) {
        throw new Error('模型名称不能重复');
    }
}

async function list(query: ModelQuery = {}): Promise<ListResponse<Model>> {
    const keyword = query.keyword?.trim().toLowerCase();
    const filtered = state.filter(model => (
        (!keyword || model.name.toLowerCase().includes(keyword))
        && (!query.vendor_id
            || model.mapping.upstreams.some(upstream => upstream.vendor_id === query.vendor_id))
    ));
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, query.pageSize ?? 10);
    const start = (page - 1) * pageSize;

    return {
        list: filtered.slice(start, start + pageSize).map(cloneModel),
        total: filtered.length,
    };
}

async function create(data: CreateModelRequest): Promise<Model> {
    const request = normalizeRequest(data);
    assertUniqueName(request.name);

    const now = new Date();
    const model: Model = {
        name: request.name,
        enable: request.enable,
        prices: request.prices,
        mapping: cloneMapping(request.mapping),
        id: Math.max(0, ...state.map(item => item.id)) + 1,
        created_at: now,
        updated_at: now,
    };
    persist([model, ...state]);
    return cloneModel(model);
}

async function update(id: number, data: UpdateModelRequest): Promise<Model> {
    const current = state.find(model => model.id === id);
    if (!current) {
        throw new Error('模型不存在');
    }

    const request = normalizeRequest(data);
    assertUniqueName(request.name, id);
    const next: Model = {
        ...current,
        name: request.name,
        enable: request.enable,
        prices: request.prices,
        mapping: cloneMapping(request.mapping),
        updated_at: new Date(),
    };
    persist(state.map(model => model.id === id ? next : model));
    return cloneModel(next);
}

async function remove(id: number): Promise<{ success: boolean }> {
    if (!state.some(model => model.id === id)) {
        throw new Error('模型不存在');
    }
    persist(state.filter(model => model.id !== id));
    return { success: true };
}

async function clearVendorReferences(vendorId: number): Promise<number> {
    const affected = state.filter(model => model.mapping.upstreams.some(upstream => upstream.vendor_id === vendorId));
    if (affected.length === 0) {
        return 0;
    }

    const next = state.map(model => {
        if (!model.mapping.upstreams.some(upstream => upstream.vendor_id === vendorId)) {
            return model;
        }
        const upstreams = model.mapping.upstreams.filter(upstream => upstream.vendor_id !== vendorId);
        const hasEnabledUpstream = upstreams.some(upstream => upstream.enabled);
        return {
            ...model,
            enable: hasEnabledUpstream ? model.enable : false,
            mapping: { upstreams },
            updated_at: new Date(),
        };
    });
    persist(next);
    return affected.length;
}

async function clearVendorModelReferences(vendorId: number, validVendorModelIds: number[]): Promise<number> {
    const validIds = new Set(validVendorModelIds);
    let changed = 0;
    const next = state.map(model => {
        let modelChanged = false;
        const upstreams = model.mapping.upstreams.map(upstream => {
            if (upstream.vendor_id !== vendorId
                || upstream.vendor_model_id === undefined
                || validIds.has(upstream.vendor_model_id)) {
                return upstream;
            }
            modelChanged = true;
            return { ...upstream, vendor_model_id: undefined };
        });
        if (!modelChanged) {
            return model;
        }
        changed += 1;
        return {
            ...model,
            mapping: { upstreams },
            updated_at: new Date(),
        };
    });
    if (changed > 0) {
        persist(next);
    }
    return changed;
}

function get(id: number): Model | null {
    const model = state.find(item => item.id === id);
    return model ? cloneModel(model) : null;
}

function all(): Model[] {
    return state.map(cloneModel);
}

function batch(ids: number[]): Promise<Model[]> {
    const idSet = new Set(ids);
    return Promise.resolve(state.filter(model => idSet.has(model.id)).map(cloneModel));
}

export default {
    list,
    create,
    update,
    remove,
    clearVendorReferences,
    clearVendorModelReferences,
    get,
    all,
    batch,
};
