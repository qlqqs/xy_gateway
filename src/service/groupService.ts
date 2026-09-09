import { SgUserGroup } from "../model/sgUserGroup";
import { SgVendor } from "../model/sgVendor";
import groupManager from "../manager/groupManager";
import customError from "../util/customErrorUtil";
import ormService from "./ormService";

export type InboundProtocol = "openai_chat" | "openai_responses" | "anthropic";
export type GroupStatus = "active" | "disabled";

export interface GroupDraft {
    name: string;
    description: string;
    inboundProtocols: InboundProtocol[];
    customModels: string[];
    whitelistEnabled: boolean;
    rateMultiplier: number;
    status: GroupStatus;
}

export interface GroupDto extends GroupDraft {
    id: number;
    updatedAt: string;
    channelCount?: number;
}

const inboundProtocolValues: InboundProtocol[] = ["openai_chat", "openai_responses", "anthropic"];
const groupStatusValues: GroupStatus[] = ["active", "disabled"];

function asIsoDate(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
    }
    return new Date(0).toISOString();
}

function toDto(group: SgUserGroup, channelCount?: number): GroupDto {
    const id = Number(group.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new customError.AppError("Invalid group ID in database", 500);
    }
    return {
        id,
        name: group.name,
        description: group.description ?? "",
        inboundProtocols: [...(group.inbound_protocols ?? [])] as InboundProtocol[],
        customModels: [...(group.custom_models ?? [])],
        whitelistEnabled: Boolean(group.whitelist_enabled),
        rateMultiplier: Number(group.rate_multiplier),
        status: group.status,
        updatedAt: asIsoDate(group.updated_at),
        ...(channelCount === undefined ? {} : { channelCount }),
    };
}

function parseDraft(input: unknown, partial = false, current?: GroupDraft): GroupDraft {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new customError.AppError("Invalid group payload");
    }
    const body = input as Record<string, unknown>;
    const merged: Record<string, unknown> = {
        name: current?.name,
        description: current?.description ?? "",
        inboundProtocols: current?.inboundProtocols,
        customModels: current?.customModels ?? [],
        whitelistEnabled: current?.whitelistEnabled ?? false,
        rateMultiplier: current?.rateMultiplier ?? 1,
        status: current?.status ?? "active",
    };
    for (const key of [
        "name",
        "description",
        "inboundProtocols",
        "customModels",
        "whitelistEnabled",
        "rateMultiplier",
        "status",
    ]) {
        if (body[key] !== undefined) merged[key] = body[key];
    }

    if (!partial && (typeof merged.name !== "string" || merged.inboundProtocols === undefined)) {
        throw new customError.AppError("name and inboundProtocols are required");
    }
    if (typeof merged.name !== "string" || !merged.name.trim()) {
        throw new customError.AppError("Group name cannot be empty");
    }
    if (typeof merged.description !== "string") {
        throw new customError.AppError("description must be a string");
    }
    if (!Array.isArray(merged.inboundProtocols)) {
        throw new customError.AppError("inboundProtocols must be an array");
    }
    const inboundProtocols = [...new Set(merged.inboundProtocols)];
    if (inboundProtocols.length === 0 || inboundProtocols.some((p) => !inboundProtocolValues.includes(p as InboundProtocol))) {
        throw new customError.AppError("At least one inbound protocol is required");
    }
    if (!Array.isArray(merged.customModels) || merged.customModels.some((model) => typeof model !== "string")) {
        throw new customError.AppError("customModels must be an array of strings");
    }
    if (typeof merged.whitelistEnabled !== "boolean") {
        throw new customError.AppError("whitelistEnabled must be a boolean");
    }
    if (typeof merged.rateMultiplier !== "number") {
        throw new customError.AppError("rateMultiplier must be a number");
    }
    const rateMultiplier = merged.rateMultiplier;
    if (!Number.isFinite(rateMultiplier) || rateMultiplier < 0 || rateMultiplier > 100) {
        throw new customError.AppError("rateMultiplier must be between 0 and 100");
    }
    if (!groupStatusValues.includes(merged.status as GroupStatus)) {
        throw new customError.AppError("status must be active or disabled");
    }

    return {
        name: merged.name.trim(),
        description: merged.description.trim(),
        inboundProtocols: inboundProtocols as InboundProtocol[],
        customModels: [...new Set((merged.customModels as string[]).map((model) => model.trim()).filter(Boolean))],
        whitelistEnabled: merged.whitelistEnabled as boolean,
        rateMultiplier: Number(rateMultiplier.toFixed(2)),
        status: merged.status as GroupStatus,
    };
}

async function ensureUniqueName(name: string, currentId?: number): Promise<void> {
    const knex = ormService.getKnex();
    const duplicate = await knex("user_group")
        .whereRaw("LOWER(name) = LOWER(?)", [name])
        .modify((query: any) => {
            if (currentId !== undefined) query.whereNot("id", currentId);
        })
        .first();
    if (duplicate) {
        throw new customError.AppError("Group name already exists", 409);
    }
}

async function listGroups(options: { keyword?: string; status?: string; pageSize: number; offset: number }) {
    const result = await groupManager.list(options);
    const ids = result.list.map((group) => Number(group.id));
    const counts = new Map<number, number>();
    if (ids.length > 0) {
        const vendors = (await SgVendor.query().get()).all();
        for (const vendor of vendors) {
            const groupIds = vendor.getGroupIds();
            for (const groupId of groupIds) {
                if (ids.includes(Number(groupId))) {
                    counts.set(Number(groupId), (counts.get(Number(groupId)) ?? 0) + 1);
                }
            }
        }
    }
    return {
        list: result.list.map((group) => {
            // MySQL 为保证大数精度时可能把 BIGINT ID hydrate 成字符串；聚合查找和 DTO
            // 统一使用归一化后的键，不依赖 JavaScript 的字符串/数字隐式转换。
            const groupId = Number(group.id);
            return toDto(group, counts.get(groupId) ?? 0);
        }),
        total: result.total,
    };
}

async function getGroup(id: number): Promise<GroupDto | null> {
    const group = await groupManager.findById(id);
    if (!group) return null;
    const vendors = (await SgVendor.query().get()).all();
    const channelCount = vendors.filter((vendor) => vendor.getGroupIds().includes(id)).length;
    return toDto(group, channelCount);
}

async function createGroup(input: unknown): Promise<GroupDto> {
    const draft = parseDraft(input);
    await ensureUniqueName(draft.name);
    const group = await groupManager.create({
        name: draft.name,
        description: draft.description,
        inbound_protocols: draft.inboundProtocols,
        custom_models: draft.customModels,
        whitelist_enabled: draft.whitelistEnabled,
        rate_multiplier: draft.rateMultiplier,
        status: draft.status,
    });
    return toDto(group);
}

async function updateGroup(id: number, input: unknown): Promise<GroupDto | null> {
    const current = await groupManager.findById(id);
    if (!current) return null;
    const existing = toDto(current);
    const draft = parseDraft(input, true, existing);
    await ensureUniqueName(draft.name, id);
    const updated = await groupManager.update(id, {
        name: draft.name,
        description: draft.description,
        inbound_protocols: draft.inboundProtocols,
        custom_models: draft.customModels,
        whitelist_enabled: draft.whitelistEnabled,
        rate_multiplier: draft.rateMultiplier,
        status: draft.status,
    });
    return updated ? await getGroup(id) : null;
}

async function deleteGroup(id: number): Promise<boolean> {
    const knex = ormService.getKnex();
    const clearReferencesAndDelete = async (trx: any): Promise<boolean> => {
        const group = await trx("user_group").where("id", id).first();
        if (!group) return false;
        await trx("user_key").where("group_id", id).update({ group_id: null });
        // 必须使用同一事务连接读取供应商。直接调用 `SgVendor.query()` 会走默认连接，
        // 可能看不到本事务内尚未提交的 Key/分组更新。
        const vendorRows = await trx("vendor").select("*");
        for (const row of vendorRows) {
            const vendor = new SgVendor(row as Record<string, unknown>);
            const groupIds = vendor.getGroupIds();
            if (!groupIds.includes(id) && Number(vendor.group_id) !== id) continue;
            const remainingGroupIds = groupIds.filter(groupId => groupId !== id);
            const config = vendor.config.toJSON();
            await trx("vendor").where("id", vendor.id).update({
                group_id: remainingGroupIds[0] ?? null,
                config: JSON.stringify({
                    ...config,
                    group_id: remainingGroupIds[0] ?? null,
                    group_ids: remainingGroupIds,
                }),
            });
        }
        await trx("user_group").where("id", id).delete();
        return true;
    };

    return await knex.transaction(clearReferencesAndDelete);
}

export default { listGroups, getGroup, createGroup, updateGroup, deleteGroup };
