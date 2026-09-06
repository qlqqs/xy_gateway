import type { ListResponse } from '@/types';
import type {
    CreateVendorRequest,
    UpdateVendorRequest,
    Vendor,
    VendorConfig,
    VendorModel,
    VendorQuery,
    VendorType,
    VendorUrls,
} from '@/types/vendor';
import storage from './storage';

const STORAGE_KEY = 'xy-gateway:mock-vendors:v1';

const seedVendors: Vendor[] = [
    {
        id: 1,
        name: '本地 OpenAI',
        type: 'openai',
        token: 'local-token',
        urls: {
            openai: 'https://api.openai.com/v1/chat/completions',
        },
        config: {
            supplier_name: '本地供应商',
            channel_code: 'local',
            group_id: 1,
            concurrency: 10,
            load_factor: 1,
            priority: 1,
            available_models: ['gpt-4o-mini'],
            status: 'active',
            remark: '本地模拟供应商',
            api_type: 'openai',
            openai_protocol: 'chat_completions',
            auth_mode: 'api_key',
        },
        model_count: 1,
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
    },
];

const vendorTypes: VendorType[] = [
    'openai',
    'anthropic',
    'google',
    'aliyun',
    'aliyun_coding',
    'volcengine_coding',
    'deepseek',
    'mimo',
    'mimo_token_plan',
    'opencode_go',
    'other',
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toDate(value: unknown, fallback: Date): Date {
    const date = new Date(typeof value === 'string' || typeof value === 'number' ? value : NaN);
    return Number.isNaN(date.getTime()) ? fallback : date;
}

function toConfig(value: unknown): VendorConfig {
    if (!isRecord(value)) {
        return {};
    }

    const config: VendorConfig = {};
    if (value.auth_mode === 'api_key' || value.auth_mode === 'bearer_token') {
        config.auth_mode = value.auth_mode;
    }
    if (typeof value.skip_tls_verify === 'boolean') {
        config.skip_tls_verify = value.skip_tls_verify;
    }
    if (typeof value.supplier_name === 'string') {
        config.supplier_name = value.supplier_name.trim();
    }
    if (typeof value.channel_code === 'string') {
        config.channel_code = value.channel_code.trim();
    }
    if (value.api_type === 'openai' || value.api_type === 'anthropic') {
        config.api_type = value.api_type;
    }
    if (value.openai_protocol === 'chat_completions' || value.openai_protocol === 'responses') {
        config.openai_protocol = value.openai_protocol;
    }
    if (value.status === 'active' || value.status === 'disabled') {
        config.status = value.status;
    }
    if (typeof value.remark === 'string') {
        config.remark = value.remark.trim();
    }
    if (Array.isArray(value.available_models)) {
        config.available_models = normalizeModels(value.available_models.filter(
            (model): model is string => typeof model === 'string',
        ));
    }
    if (typeof value.concurrency === 'number' && Number.isFinite(value.concurrency)) {
        config.concurrency = value.concurrency;
    }
    if (value.load_factor === null
        || (typeof value.load_factor === 'number' && Number.isFinite(value.load_factor))) {
        config.load_factor = value.load_factor;
    }
    if (typeof value.priority === 'number' && Number.isFinite(value.priority)) {
        config.priority = value.priority;
    }
    if (value.group_id === null || (typeof value.group_id === 'number' && Number.isInteger(value.group_id))) {
        config.group_id = value.group_id;
    }
    if (value.proxy && isRecord(value.proxy)
        && (value.proxy.type === 'http' || value.proxy.type === 'socks5')
        && typeof value.proxy.url === 'string'
        && value.proxy.url.trim()) {
        config.proxy = {
            type: value.proxy.type,
            url: value.proxy.url.trim(),
        };
    } else if (value.proxy === null) {
        config.proxy = null;
    }

    return config;
}

function parseVendors(value: unknown): Vendor[] {
    if (!Array.isArray(value)) {
        throw new Error('供应商存储格式无效');
    }

    return value.map((item: unknown) => {
        if (!isRecord(item)
            || typeof item.id !== 'number'
            || !Number.isSafeInteger(item.id)
            || item.id <= 0
            || typeof item.name !== 'string'
            || !item.name.trim()
            || !vendorTypes.includes(item.type as VendorType)
            || typeof item.token !== 'string'
            || !isRecord(item.urls)) {
            throw new Error('供应商存储包含无效记录');
        }

        const config = toConfig(item.config);
        const models = config.available_models ?? [];
        const urls = normalizeUrls(item.urls);

        return {
            id: item.id,
            name: item.name.trim(),
            type: item.type as VendorType,
            token: item.token.trim(),
            urls,
            config,
            model_count: models.length,
            created_at: toDate(item.created_at, new Date()),
            updated_at: toDate(item.updated_at, new Date()),
        } satisfies Vendor;
    });
}

let state = storage.load(STORAGE_KEY, seedVendors, parseVendors);

function normalizeUrls(value: unknown): VendorUrls {
    if (!isRecord(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1].trim())
            .map(([key, url]) => [key, url.trim()]),
    );
}

function cloneConfig(config: VendorConfig): VendorConfig {
    return toConfig(config);
}

function cloneVendor(vendor: Vendor): Vendor {
    return {
        ...vendor,
        urls: normalizeUrls(vendor.urls),
        config: cloneConfig(vendor.config),
        model_count: vendor.config.available_models?.length ?? 0,
        created_at: new Date(vendor.created_at),
        updated_at: new Date(vendor.updated_at),
    };
}

function persist(next: Vendor[]): void {
    state = next.map(cloneVendor);
    storage.save(STORAGE_KEY, state);
}

function normalizeModels(models: string[] | undefined): string[] {
    return [...new Set((models ?? []).map(model => model.trim()).filter(Boolean))];
}

function assertUniqueFields(name: string, channelCode: string | undefined, currentId?: number): void {
    const duplicateName = state.some(vendor => vendor.id !== currentId
        && vendor.name.toLowerCase() === name.toLowerCase());
    if (duplicateName) {
        throw new Error('供应商名称不能重复');
    }
    if (channelCode && state.some(vendor => vendor.id !== currentId
        && vendor.config.channel_code?.toLowerCase() === channelCode.toLowerCase())) {
        throw new Error('通道编码不能重复');
    }
}

async function list(query: VendorQuery = {}): Promise<ListResponse<Vendor>> {
    const keyword = query.keyword?.trim().toLowerCase();
    const filtered = state.filter(vendor => (
        (!keyword || vendor.name.toLowerCase().includes(keyword))
        && (!query.type || vendor.type === query.type)
    ));
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, query.pageSize ?? 10);
    const start = (page - 1) * pageSize;

    return {
        list: filtered.slice(start, start + pageSize).map(cloneVendor),
        total: filtered.length,
    };
}

async function create(data: CreateVendorRequest): Promise<Vendor> {
    if (!vendorTypes.includes(data.type)) {
        throw new Error('供应商类型无效');
    }
    const name = data.name.trim();
    if (!name) {
        throw new Error('供应商名称不能为空');
    }
    if (!data.token.trim()) {
        throw new Error('供应商凭证不能为空');
    }

    const config = toConfig({
        ...(data.config ?? {}),
        available_models: normalizeModels(data.config?.available_models),
    });
    const channelCode = config.channel_code?.trim();
    if (channelCode !== undefined) {
        config.channel_code = channelCode;
    }
    assertUniqueFields(name, channelCode);
    const now = new Date();
    const vendor: Vendor = {
        id: Math.max(0, ...state.map(item => item.id)) + 1,
        type: data.type,
        name,
        token: data.token.trim(),
        urls: normalizeUrls(data.urls),
        config,
        model_count: config.available_models?.length ?? 0,
        created_at: now,
        updated_at: now,
    };

    persist([vendor, ...state]);
    return cloneVendor(vendor);
}

async function update(id: number, data: UpdateVendorRequest): Promise<Vendor> {
    const current = state.find(vendor => vendor.id === id);
    if (!current) {
        throw new Error('供应商不存在');
    }

    if (data.type !== undefined && !vendorTypes.includes(data.type)) {
        throw new Error('供应商类型无效');
    }
    if (data.token !== undefined && !data.token.trim()) {
        throw new Error('供应商凭证不能为空');
    }

    const config = toConfig({
        ...current.config,
        ...(data.config ?? {}),
    });
    if (data.config?.available_models !== undefined) {
        config.available_models = normalizeModels(data.config.available_models);
    }
    if (config.channel_code !== undefined) {
        config.channel_code = config.channel_code.trim();
    }

    const next: Vendor = {
        ...current,
        ...(data.type === undefined ? {} : { type: data.type }),
        ...(data.name === undefined ? {} : { name: data.name.trim() }),
        ...(data.token === undefined ? {} : { token: data.token.trim() }),
        ...(data.urls === undefined ? {} : { urls: normalizeUrls(data.urls) }),
        config,
        model_count: config.available_models?.length ?? current.model_count,
        updated_at: new Date(),
    };

    if (!next.name) {
        throw new Error('供应商名称不能为空');
    }
    assertUniqueFields(next.name, config.channel_code, id);

    persist(state.map(vendor => vendor.id === id ? next : vendor));
    return cloneVendor(next);
}

async function remove(id: number): Promise<{ success: boolean }> {
    if (!state.some(vendor => vendor.id === id)) {
        throw new Error('供应商不存在');
    }

    persist(state.filter(vendor => vendor.id !== id));
    return { success: true };
}

async function clearGroupReferences(groupId: number): Promise<number> {
    const affected = state.filter(vendor => vendor.config.group_id === groupId);
    if (affected.length === 0) {
        return 0;
    }

    const next = state.map(vendor => vendor.config.group_id === groupId
        ? {
            ...vendor,
            config: { ...vendor.config, group_id: null },
            updated_at: new Date(),
        }
        : vendor);
    persist(next);
    return affected.length;
}

function get(id: number): Vendor | null {
    const vendor = state.find(item => item.id === id);
    return vendor ? cloneVendor(vendor) : null;
}

function all(): Vendor[] {
    return state.map(cloneVendor);
}

function batch(ids: number[]): Promise<Vendor[]> {
    const idSet = new Set(ids);
    return Promise.resolve(state.filter(vendor => idSet.has(vendor.id)).map(cloneVendor));
}

function getVendorModelId(vendorId: number, modelId: string): number {
    // 供应商模型 ID 必须由名称稳定派生，避免修改模型顺序后路由引用漂移。
    let hash = 2166136261;
    for (const character of `${vendorId}:${modelId}`) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0) || 1;
}

function listModels(vendorId: number): Promise<VendorModel[]> {
    const vendor = state.find(item => item.id === vendorId);
    if (!vendor) {
        return Promise.resolve([]);
    }

    const now = new Date().toISOString();
    return Promise.resolve((vendor.config.available_models ?? []).map(modelId => ({
        id: getVendorModelId(vendorId, modelId),
        vendor_id: vendorId,
        model_id: modelId,
        allowed_formats: null,
        created_at: vendor.created_at.toISOString(),
        updated_at: now,
    })));
}

async function batchModels(ids: number[]): Promise<VendorModel[]> {
    const wanted = new Set(ids);
    const models: VendorModel[] = [];
    for (const vendor of state) {
        const vendorModels = await listModels(vendor.id);
        models.push(...vendorModels.filter(model => wanted.has(model.id)));
    }
    return models;
}

export default {
    list,
    create,
    update,
    remove,
    clearGroupReferences,
    get,
    all,
    batch,
    listModels,
    batchModels,
};
