import { reactive } from 'vue';
import type { ListResponse } from '@/types';
import type {
    CreateVendorRequest,
    UpdateVendorRequest,
    Vendor,
    VendorModel,
    VendorQuery,
} from '@/types/vendor';
import apiVendors from '@/repositories/apiVendors';

/** 供应商后端快照缓存。所有持久化操作都由 API repository 负责。 */
const vendors = reactive<Vendor[]>([]);
let loaded = false;
let loadingPromise: Promise<void> | null = null;

function syncVendor(vendor: Vendor): void {
    const index = vendors.findIndex(item => item.id === vendor.id);
    if (index < 0) {
        vendors.unshift(vendor);
    } else {
        vendors.splice(index, 1, vendor);
    }
}

function syncVendors(nextVendors: Vendor[], replace = false): void {
    if (replace) {
        vendors.splice(0, vendors.length, ...nextVendors);
        return;
    }
    const additions: Vendor[] = [];
    nextVendors.forEach(vendor => {
        const index = vendors.findIndex(item => item.id === vendor.id);
        if (index < 0) {
            additions.push(vendor);
        } else {
            vendors.splice(index, 1, vendor);
        }
    });
    if (additions.length > 0) vendors.push(...additions);
}

function removeCachedVendor(id: number): void {
    const index = vendors.findIndex(vendor => vendor.id === id);
    if (index >= 0) vendors.splice(index, 1);
}

function isUnfilteredFirstPage(query: VendorQuery): boolean {
    return !query.keyword
        && !query.type
        && (query.page === undefined || query.page === 1)
        && (query.pageSize === undefined || query.pageSize >= 100);
}

async function list(query: VendorQuery = {}): Promise<ListResponse<Vendor>> {
    const result = await apiVendors.list(query);
    syncVendors(result.list, isUnfilteredFirstPage(query) && result.list.length >= result.total);
    if (isUnfilteredFirstPage(query) && result.list.length >= result.total) loaded = true;
    return result;
}

function get(id: number): Vendor | null {
    return vendors.find(vendor => vendor.id === id) ?? null;
}

async function fetch(id: number): Promise<Vendor | null> {
    const vendor = await apiVendors.get(id);
    if (vendor) {
        syncVendor(vendor);
    } else {
        removeCachedVendor(id);
    }
    return vendor;
}

async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
        const pageSize = 100;
        const firstPage = await apiVendors.list({ page: 1, pageSize });
        const allVendors = [...firstPage.list];
        let page = 2;
        while (allVendors.length < firstPage.total) {
            const nextPage = await apiVendors.list({ page, pageSize });
            if (nextPage.list.length === 0) break;
            allVendors.push(...nextPage.list);
            page += 1;
        }
        syncVendors(allVendors, true);
        loaded = allVendors.length >= firstPage.total;
    })().finally(() => {
        loadingPromise = null;
    });

    return loadingPromise;
}

/** 强制重新读取后端快照，供供应商/分组关联变更后的缓存校正使用。 */
async function refresh(): Promise<void> {
    loaded = false;
    await ensureLoaded();
}

async function create(data: CreateVendorRequest): Promise<Vendor> {
    const vendor = await apiVendors.create(data);
    syncVendor(vendor);
    return vendor;
}

async function update(id: number, data: UpdateVendorRequest): Promise<Vendor> {
    const vendor = await apiVendors.update(id, data);
    syncVendor(vendor);
    return vendor;
}

async function remove(id: number): Promise<{ success: boolean }> {
    const result = await apiVendors.remove(id);
    if (result.success) removeCachedVendor(id);
    return result;
}

async function batch(ids: number[]): Promise<Vendor[]> {
    const result = await apiVendors.batch(ids);
    syncVendors(result);
    return result;
}

async function listModels(vendorId: number): Promise<VendorModel[]> {
    return apiVendors.listModels(vendorId);
}

async function batchModels(ids: number[]): Promise<VendorModel[]> {
    return apiVendors.batchModels(ids);
}

function previewModels(data: Pick<CreateVendorRequest, 'type' | 'token' | 'urls' | 'config'>): Promise<{ models: string[] }> {
    return apiVendors.previewModels(data);
}

export default {
    vendors,
    list,
    get,
    fetch,
    ensureLoaded,
    refresh,
    create,
    update,
    remove,
    batch,
    listModels,
    batchModels,
    previewModels,
};
