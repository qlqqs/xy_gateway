import { ref } from 'vue';
import repository from '@/repositories/mockGroups';
import type { GroupDraft, GroupRecord } from '@/types/group';

export type { GroupDraft, GroupRecord, GroupStatus, InboundProtocol } from '@/types/group';

const groups = ref<GroupRecord[]>(repository.all());

function syncAll(): void {
    groups.value = repository.all();
}

function get(id: number): GroupRecord | null {
    const group = repository.get(id);
    if (group) {
        const index = groups.value.findIndex(item => item.id === id);
        if (index < 0) {
            groups.value.unshift(group);
        } else {
            groups.value.splice(index, 1, group);
        }
    }
    return group;
}

function create(data: GroupDraft): GroupRecord {
    const group = repository.create(data);
    syncAll();
    return group;
}

function update(id: number, data: Partial<GroupDraft>): GroupRecord | null {
    const group = repository.update(id, data);
    if (group) {
        syncAll();
    }
    return group;
}

function remove(id: number): boolean {
    const removed = repository.remove(id);
    if (removed) {
        syncAll();
    }
    return removed;
}

function clearModelReferences(modelName: string): number {
    const changed = repository.clearModelReferences(modelName);
    if (changed > 0) {
        syncAll();
    }
    return changed;
}

export default {
    groups,
    get,
    create,
    update,
    remove,
    clearModelReferences,
};
