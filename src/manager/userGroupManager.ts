import { SgUserGroup } from "../model/sgUserGroup";

interface GroupListOptions {
    keyword?: string;
    status?: string;
    pageSize: number;
    offset: number;
}

async function findById(id: number): Promise<SgUserGroup | null> {
    return await SgUserGroup.query().find(id);
}

async function findByName(name: string): Promise<SgUserGroup | null> {
    if (!name) return null;
    return await SgUserGroup.query().where("name", name).first();
}

async function list(options: GroupListOptions = { pageSize: 100, offset: 0 }) {
    const query = SgUserGroup.query().orderBy("id", "desc");
    if (options.keyword) query.where("name", "like", `%${options.keyword}%`);
    if (options.status) query.where("status", options.status);
    const total = Number(await query.clone().count() || 0);
    const rows = await query.limit(options.pageSize).offset(options.offset).get();
    return { list: rows.all(), total };
}

async function create(data: Record<string, unknown>): Promise<SgUserGroup> {
    return await SgUserGroup.query().create(data);
}

async function update(id: number, data: Record<string, unknown>): Promise<SgUserGroup | null> {
    const updateData = { ...data };
    for (const field of ["inbound_protocols", "custom_models"]) {
        if (Array.isArray(updateData[field])) updateData[field] = JSON.stringify(updateData[field]);
    }
    if (typeof updateData.whitelist_enabled === "boolean") {
        updateData.whitelist_enabled = updateData.whitelist_enabled ? 1 : 0;
    }
    await SgUserGroup.query().where("id", id).update(updateData);
    return await findById(id);
}

async function remove(id: number): Promise<boolean> {
    const group = await findById(id);
    if (!group) return false;
    await SgUserGroup.query().where("id", id).delete();
    return true;
}

async function count(): Promise<number> {
    return Number(await SgUserGroup.query().count() || 0);
}

async function deleteById(id: number): Promise<boolean> {
    return await remove(id);
}

async function removeModelReference(modelName: string): Promise<number> {
    const groups = (await SgUserGroup.query().get()).all();
    let changed = 0;
    for (const group of groups) {
        const models = group.custom_models ?? [];
        const next = models.filter(model => model !== modelName);
        if (next.length !== models.length) {
            await update(Number(group.id), { custom_models: next });
            changed += 1;
        }
    }
    return changed;
}

async function renameModelReference(oldName: string, newName: string): Promise<number> {
    if (oldName === newName) return 0;
    const groups = (await SgUserGroup.query().get()).all();
    let changed = 0;
    for (const group of groups) {
        const models = group.custom_models ?? [];
        if (!models.includes(oldName)) continue;
        const next = [...new Set(models.map(model => model === oldName ? newName : model))];
        await update(Number(group.id), { custom_models: next });
        changed += 1;
    }
    return changed;
}

export default {
    findById,
    findByName,
    list,
    listGroups: list,
    create,
    createGroup: create,
    update,
    updateGroup: update,
    remove,
    deleteById,
    count,
    removeModelReference,
    renameModelReference,
};
