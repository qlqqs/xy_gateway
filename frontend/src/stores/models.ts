import { reactive } from 'vue';
import type { ListResponse } from '@/types';
import type { CreateModelRequest, Model, ModelQuery, UpdateModelRequest } from '@/types/model';
import repository from '@/repositories/mockModels';

const models = reactive<Model[]>(repository.all());

function syncAll(): void {
    models.splice(0, models.length, ...repository.all());
}

async function list(query: ModelQuery = {}): Promise<ListResponse<Model>> {
    const result = await repository.list(query);
    syncAll();
    return result;
}

function get(id: number): Model | null {
    const model = repository.get(id);
    if (model) {
        const index = models.findIndex(item => item.id === id);
        if (index < 0) {
            models.unshift(model);
        } else {
            models.splice(index, 1, model);
        }
    }
    return model;
}

async function create(data: CreateModelRequest): Promise<Model> {
    const model = await repository.create(data);
    syncAll();
    return model;
}

async function update(id: number, data: UpdateModelRequest): Promise<Model> {
    const model = await repository.update(id, data);
    syncAll();
    return model;
}

async function remove(id: number): Promise<{ success: boolean }> {
    const result = await repository.remove(id);
    syncAll();
    return result;
}

async function clearVendorReferences(vendorId: number): Promise<number> {
    const changed = await repository.clearVendorReferences(vendorId);
    if (changed > 0) {
        syncAll();
    }
    return changed;
}

async function clearVendorModelReferences(vendorId: number, validVendorModelIds: number[]): Promise<number> {
    const changed = await repository.clearVendorModelReferences(vendorId, validVendorModelIds);
    if (changed > 0) {
        syncAll();
    }
    return changed;
}

export default {
    models,
    list,
    get,
    create,
    update,
    remove,
    clearVendorReferences,
    clearVendorModelReferences,
    batch: repository.batch,
};
