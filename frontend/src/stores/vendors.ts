import { reactive } from 'vue';
import type { ListResponse } from '@/types';
import type {
    CreateVendorRequest,
    UpdateVendorRequest,
    Vendor,
    VendorModel,
    VendorQuery,
} from '@/types/vendor';
import repository from '@/repositories/mockVendors';

const vendors = reactive<Vendor[]>(repository.all());

function syncAll(): void {
    vendors.splice(0, vendors.length, ...repository.all());
}

async function list(query: VendorQuery = {}): Promise<ListResponse<Vendor>> {
    const result = await repository.list(query);
    syncAll();
    return result;
}

function get(id: number): Vendor | null {
    const vendor = repository.get(id);
    if (vendor) {
        const index = vendors.findIndex(item => item.id === id);
        if (index < 0) {
            vendors.unshift(vendor);
        } else {
            vendors.splice(index, 1, vendor);
        }
    }
    return vendor;
}

async function create(data: CreateVendorRequest): Promise<Vendor> {
    const vendor = await repository.create(data);
    syncAll();
    return vendor;
}

async function update(id: number, data: UpdateVendorRequest): Promise<Vendor> {
    const vendor = await repository.update(id, data);
    syncAll();
    return vendor;
}

async function remove(id: number): Promise<{ success: boolean }> {
    const result = await repository.remove(id);
    syncAll();
    return result;
}

async function batch(ids: number[]): Promise<Vendor[]> {
    return repository.batch(ids);
}

async function listModels(vendorId: number): Promise<VendorModel[]> {
    return repository.listModels(vendorId);
}

async function batchModels(ids: number[]): Promise<VendorModel[]> {
    return repository.batchModels(ids);
}

async function clearGroupReferences(groupId: number): Promise<number> {
    const changed = await repository.clearGroupReferences(groupId);
    if (changed > 0) {
        syncAll();
    }
    return changed;
}

function previewModels(data: Pick<CreateVendorRequest, 'type' | 'token' | 'urls' | 'config'>): Promise<{ models: string[] }> {
    const configured = data.config?.available_models ?? [];
    return Promise.resolve({ models: configured.length > 0 ? [...configured] : ['gpt-4o-mini', 'claude-3-5-sonnet'] });
}

export default {
    vendors,
    list,
    get,
    create,
    update,
    remove,
    batch,
    listModels,
    batchModels,
    clearGroupReferences,
    previewModels,
};
