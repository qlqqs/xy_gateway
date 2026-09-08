import { reactive } from 'vue';
import type { ListResponse } from '@/types';
import type { CreateModelRequest, Model, ModelQuery, UpdateModelRequest } from '@/types/model';
import apiModels from '@/repositories/apiModels';

/** 模型后端快照缓存；模型映射的增删改由后端事务统一维护。 */
const models = reactive<Model[]>([]);
let loaded = false;
let loadingPromise: Promise<void> | null = null;

function syncModel(model: Model): void {
    const index = models.findIndex(item => item.id === model.id);
    if (index < 0) {
        models.unshift(model);
    } else {
        models.splice(index, 1, model);
    }
}

function syncModels(nextModels: Model[], replace = false): void {
    if (replace) {
        models.splice(0, models.length, ...nextModels);
        return;
    }
    const additions: Model[] = [];
    nextModels.forEach(model => {
        const index = models.findIndex(item => item.id === model.id);
        if (index < 0) {
            additions.push(model);
        } else {
            models.splice(index, 1, model);
        }
    });
    if (additions.length > 0) models.push(...additions);
}

function removeCachedModel(id: number): void {
    const index = models.findIndex(model => model.id === id);
    if (index >= 0) models.splice(index, 1);
}

function isUnfilteredFirstPage(query: ModelQuery): boolean {
    return !query.keyword
        && !query.vendor_id
        && (query.page === undefined || query.page === 1)
        && (query.pageSize === undefined || query.pageSize >= 100);
}

async function list(query: ModelQuery = {}): Promise<ListResponse<Model>> {
    const result = await apiModels.list(query);
    syncModels(result.list, isUnfilteredFirstPage(query) && result.list.length >= result.total);
    if (isUnfilteredFirstPage(query) && result.list.length >= result.total) loaded = true;
    return result;
}

function get(id: number): Model | null {
    return models.find(model => model.id === id) ?? null;
}

async function fetch(id: number): Promise<Model | null> {
    const model = await apiModels.get(id);
    if (model) {
        syncModel(model);
    } else {
        removeCachedModel(id);
    }
    return model;
}

async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
        const pageSize = 100;
        const firstPage = await apiModels.list({ page: 1, pageSize });
        const allModels = [...firstPage.list];
        let page = 2;
        while (allModels.length < firstPage.total) {
            const nextPage = await apiModels.list({ page, pageSize });
            if (nextPage.list.length === 0) break;
            allModels.push(...nextPage.list);
            page += 1;
        }
        syncModels(allModels, true);
        loaded = allModels.length >= firstPage.total;
    })().finally(() => {
        loadingPromise = null;
    });

    return loadingPromise;
}

/** 强制重新读取后端快照，供供应商删除或模型映射变更后的缓存校正使用。 */
async function refresh(): Promise<void> {
    if (loadingPromise) {
        try {
            await loadingPromise;
        } catch {
            // refresh 仍需发起自己的强制请求，由该请求的结果决定调用是否成功。
        }
    }
    loaded = false;
    await ensureLoaded();
}

async function create(data: CreateModelRequest): Promise<Model> {
    const model = await apiModels.create(data);
    syncModel(model);
    return model;
}

async function update(id: number, data: UpdateModelRequest): Promise<Model> {
    const model = await apiModels.update(id, data);
    syncModel(model);
    return model;
}

async function remove(id: number): Promise<{ success: boolean }> {
    const result = await apiModels.remove(id);
    if (result.success) removeCachedModel(id);
    return result;
}

async function batch(ids: number[]): Promise<Model[]> {
    const result = await apiModels.batch(ids);
    syncModels(result);
    return result;
}

export default {
    models,
    list,
    get,
    fetch,
    ensureLoaded,
    refresh,
    create,
    update,
    remove,
    batch,
};
