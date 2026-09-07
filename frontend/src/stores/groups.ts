import { ref } from 'vue';
import apiGroups from '@/repositories/apiGroups';
import type { ListResponse } from '@/types';
import type { GroupDraft, GroupRecord, GroupStatus } from '@/types/group';

export type { GroupDraft, GroupRecord, GroupStatus, InboundProtocol } from '@/types/group';

/** 分组的后端快照缓存；持久化由 API 完成。 */
const groups = ref<GroupRecord[]>([]);
let loaded = false;
let loadingPromise: Promise<void> | null = null;

function syncGroup(group: GroupRecord): void {
    const index = groups.value.findIndex(item => item.id === group.id);
    if (index < 0) {
        groups.value.unshift(group);
    } else {
        groups.value.splice(index, 1, group);
    }
}

function syncGroups(nextGroups: GroupRecord[], replace = false): void {
    if (replace) {
        groups.value = nextGroups;
        return;
    }
    const additions: GroupRecord[] = [];
    nextGroups.forEach(group => {
        const index = groups.value.findIndex(item => item.id === group.id);
        if (index < 0) {
            additions.push(group);
        } else {
            groups.value.splice(index, 1, group);
        }
    });
    if (additions.length > 0) groups.value.push(...additions);
}

function removeCachedGroup(id: number): void {
    const index = groups.value.findIndex(group => group.id === id);
    if (index >= 0) groups.value.splice(index, 1);
}

function isUnfilteredFirstPage(query: { page?: number; pageSize?: number; keyword?: string; status?: GroupStatus }): boolean {
    return !query.keyword
        && !query.status
        && (query.page === undefined || query.page === 1)
        && (query.pageSize === undefined || query.pageSize >= 100);
}

async function list(query: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    status?: GroupStatus;
} = {}): Promise<ListResponse<GroupRecord>> {
    const result = await apiGroups.list(query);
    syncGroups(result.list, isUnfilteredFirstPage(query) && result.list.length >= result.total);
    if (isUnfilteredFirstPage(query) && result.list.length >= result.total) loaded = true;
    return result;
}

function get(id: number): GroupRecord | null {
    return groups.value.find(group => group.id === id) ?? null;
}

async function fetch(id: number): Promise<GroupRecord | null> {
    const group = await apiGroups.get(id);
    if (group) {
        syncGroup(group);
    } else {
        removeCachedGroup(id);
    }
    return group;
}

async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
        const pageSize = 100;
        const firstPage = await apiGroups.list({ page: 1, pageSize });
        const allGroups = [...firstPage.list];
        let page = 2;
        while (allGroups.length < firstPage.total) {
            const nextPage = await apiGroups.list({ page, pageSize });
            if (nextPage.list.length === 0) break;
            allGroups.push(...nextPage.list);
            page += 1;
        }
        syncGroups(allGroups, true);
        loaded = allGroups.length >= firstPage.total;
    })().finally(() => {
        loadingPromise = null;
    });

    return loadingPromise;
}

/** 强制重新读取后端快照，供跨资源变更后的缓存校正使用。 */
async function refresh(): Promise<void> {
    loaded = false;
    await ensureLoaded();
}

async function create(data: GroupDraft): Promise<GroupRecord> {
    const group = await apiGroups.create(data);
    syncGroup(group);
    return group;
}

async function update(id: number, data: Partial<GroupDraft>): Promise<GroupRecord | null> {
    const group = await apiGroups.update(id, data);
    if (!group) {
        removeCachedGroup(id);
        return null;
    }
    syncGroup(group);
    return group;
}

async function remove(id: number): Promise<boolean> {
    const removed = await apiGroups.remove(id);
    if (removed) removeCachedGroup(id);
    return removed;
}

export default {
    groups,
    list,
    get,
    fetch,
    ensureLoaded,
    refresh,
    create,
    update,
    remove,
};
