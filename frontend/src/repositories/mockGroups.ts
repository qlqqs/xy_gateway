import type { GroupDraft, GroupRecord, GroupStatus, InboundProtocol } from '@/types/group';
import storage from './storage';

const STORAGE_KEY = 'xy-gateway:mock-groups:v1';
const protocolValues: InboundProtocol[] = ['openai_chat', 'openai_responses', 'anthropic'];

const seedGroups: GroupRecord[] = [
    {
        id: 1,
        name: '默认分组',
        description: '系统默认访问范围',
        inboundProtocols: ['openai_responses'],
        customModels: [],
        whitelistEnabled: false,
        rateMultiplier: 1,
        status: 'active',
        updatedAt: '—',
    },
];

const groupStatuses: GroupRecord['status'][] = ['active', 'disabled'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseGroups(value: unknown): GroupRecord[] {
    if (!Array.isArray(value)) {
        throw new Error('分组存储格式无效');
    }

    return value.map(item => {
        if (!isRecord(item)
            || typeof item.id !== 'number'
            || !Number.isSafeInteger(item.id)
            || item.id <= 0
            || typeof item.name !== 'string'
            || !item.name.trim()
            || typeof item.description !== 'string'
            || !Array.isArray(item.inboundProtocols)
            || !item.inboundProtocols.every(protocol => protocolValues.includes(protocol as InboundProtocol))
            || !Array.isArray(item.customModels)
            || !item.customModels.every(model => typeof model === 'string')
            || typeof item.whitelistEnabled !== 'boolean'
            || typeof item.rateMultiplier !== 'number'
            || !Number.isFinite(item.rateMultiplier)
            || item.rateMultiplier < 0
            || item.rateMultiplier > 100
            || !groupStatuses.includes(item.status as GroupRecord['status'])
            || typeof item.updatedAt !== 'string') {
            throw new Error('分组存储包含无效记录');
        }

        const protocols = [...new Set(item.inboundProtocols)] as InboundProtocol[];
        if (protocols.length === 0) {
            throw new Error('分组存储缺少入站协议');
        }

        return {
            id: item.id,
            name: item.name.trim(),
            description: item.description.trim(),
            inboundProtocols: protocols,
            customModels: [...new Set(item.customModels.map(model => model.trim()).filter(Boolean))] as string[],
            whitelistEnabled: item.whitelistEnabled,
            rateMultiplier: item.rateMultiplier,
            status: item.status as GroupStatus,
            updatedAt: item.updatedAt,
        } satisfies GroupRecord;
    });
}

let state = storage.load(STORAGE_KEY, seedGroups, parseGroups);

function clone(group: GroupRecord): GroupRecord {
    return {
        ...group,
        inboundProtocols: [...group.inboundProtocols],
        customModels: [...group.customModels],
    };
}

function persist(next: GroupRecord[]): void {
    state = next.map(clone);
    storage.save(STORAGE_KEY, state);
}

function normalizeDraft(data: GroupDraft): GroupDraft {
    if (typeof data.name !== 'string'
        || !Array.isArray(data.inboundProtocols)
        || !Array.isArray(data.customModels)
        || typeof data.description !== 'string'
        || typeof data.whitelistEnabled !== 'boolean'
        || !groupStatuses.includes(data.status)) {
        throw new Error('分组字段无效');
    }
    const name = data.name.trim();
    if (!name) {
        throw new Error('分组名称不能为空');
    }
    const inboundProtocols = [...new Set(data.inboundProtocols)];
    if (inboundProtocols.length === 0 || inboundProtocols.some(protocol => !protocolValues.includes(protocol))) {
        throw new Error('至少选择一种入站协议');
    }
    if (!Number.isFinite(data.rateMultiplier) || data.rateMultiplier < 0 || data.rateMultiplier > 100) {
        throw new Error('计费倍率必须是非负数');
    }

    return {
        whitelistEnabled: Boolean(data.whitelistEnabled),
        status: data.status,
        name,
        description: data.description.trim(),
        inboundProtocols,
        customModels: [...new Set(data.customModels.map(model => model.trim()).filter(Boolean))],
        rateMultiplier: Number(data.rateMultiplier.toFixed(2)),
    };
}

function assertUniqueName(name: string, currentId?: number): void {
    if (state.some(group => group.id !== currentId && group.name.toLowerCase() === name.toLowerCase())) {
        throw new Error('分组名称不能重复');
    }
}

function all(): GroupRecord[] {
    return state.map(clone);
}

function get(id: number): GroupRecord | null {
    const group = state.find(item => item.id === id);
    return group ? clone(group) : null;
}

function create(data: GroupDraft): GroupRecord {
    const draft = normalizeDraft(data);
    assertUniqueName(draft.name);
    const now = new Date().toISOString();
    const group: GroupRecord = {
        ...draft,
        id: Math.max(0, ...state.map(item => item.id)) + 1,
        updatedAt: now,
    };
    persist([group, ...state]);
    return clone(group);
}

function update(id: number, data: Partial<GroupDraft>): GroupRecord | null {
    const current = state.find(group => group.id === id);
    if (!current) {
        return null;
    }

    const merged: GroupDraft = {
        name: data.name ?? current.name,
        description: data.description ?? current.description,
        inboundProtocols: data.inboundProtocols ?? current.inboundProtocols,
        customModels: data.customModels ?? current.customModels,
        whitelistEnabled: data.whitelistEnabled ?? current.whitelistEnabled,
        rateMultiplier: data.rateMultiplier ?? current.rateMultiplier,
        status: data.status ?? current.status,
    };
    const draft = normalizeDraft(merged);
    assertUniqueName(draft.name, id);
    const updated: GroupRecord = {
        ...current,
        ...draft,
        updatedAt: new Date().toISOString(),
    };
    persist(state.map(group => group.id === id ? updated : group));
    return clone(updated);
}

function remove(id: number): boolean {
    if (!state.some(group => group.id === id)) {
        return false;
    }
    persist(state.filter(group => group.id !== id));
    return true;
}

function clearModelReferences(modelName: string): number {
    let changed = 0;
    const next = state.map(group => {
        if (!group.customModels.includes(modelName)) {
            return group;
        }
        changed += 1;
        return {
            ...group,
            customModels: group.customModels.filter(model => model !== modelName),
            updatedAt: new Date().toISOString(),
        };
    });
    if (changed > 0) {
        persist(next);
    }
    return changed;
}

export default {
    all,
    get,
    create,
    update,
    remove,
    clearModelReferences,
};
