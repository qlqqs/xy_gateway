import type { Context } from "hono";
import { ApiFormat, UserType } from "../../constants";
import { SgModel } from "../../model/sgModel";
import { normalizeVendorGroupIds } from "../../model/sgVendor";
import vendorManager from "../../manager/vendorManager";
import vendorModelManager from "../../manager/vendorModelManager";
import customError from "../../util/customErrorUtil";
import protocolUtils from "../../util/protocol/protocolUtil";
import concurrencyService from "../concurrencyService";
import RoutingContext from "./routingContext";
import { ModelRoutingResult } from "./types";
import upstreamHealthService, { UpstreamHealthState } from "../upstreamHealthService";

interface MappingLike {
    vendor_id: number;
    vendor_model_id?: number | null;
    enabled?: boolean;
    sort_order?: number;
}

function getMappings(model: SgModel): MappingLike[] {
    const mapping = model.getMapping ? model.getMapping() : (model as any).mapping;
    return Array.isArray(mapping?.upstreams) ? mapping.upstreams as MappingLike[] : [];
}

function vendorStatus(vendor: any): string {
    return vendor.status !== undefined ? vendor.status : (vendor.config?.status ?? "active");
}

function vendorGroupIds(vendor: any): number[] {
    if (typeof vendor.getGroupIds === "function") {
        return normalizeVendorGroupIds(vendor.getGroupIds());
    }
    const configured = vendor.config?.group_ids;
    const value = vendor.group_id !== undefined ? vendor.group_id : vendor.config?.group_id;
    return normalizeVendorGroupIds(configured, value);
}


function vendorMatchesGroup(vendor: any, groupId: number | null | undefined): boolean {
    if (groupId === undefined) return true;
    const groupIds = vendorGroupIds(vendor);
    if (groupId === null) return groupIds.length === 0;
    return Number.isSafeInteger(groupId) && groupId > 0 && groupIds.includes(groupId);
}

function vendorPriority(vendor: any): number {
    const value = vendor.priority !== undefined ? vendor.priority : (vendor.config?.priority ?? 1);
    return Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 1;
}

function vendorWeight(vendor: any): number {
    if (typeof vendor.getEffectiveWeight === "function") return vendor.getEffectiveWeight();
    const explicit = vendor.load_factor !== undefined ? vendor.load_factor : vendor.config?.load_factor;
    const concurrency = vendor.concurrency !== undefined ? vendor.concurrency : (vendor.config?.concurrency ?? 1);
    const weight = explicit ?? concurrency;
    return Number.isFinite(Number(weight)) && Number(weight) > 0 ? Number(weight) : 1;
}


function vendorConcurrency(vendor: any): number {
    const value = vendor.concurrency !== undefined
        ? vendor.concurrency
        : (vendor.config?.concurrency ?? 0);
    const limit = Number(value);
    return Number.isFinite(limit) && limit > 0 ? limit : 0;
}


function vendorHasCapacity(vendor: any): boolean {
    const limit = vendorConcurrency(vendor);
    return limit <= 0 || concurrencyService.current("vendor", Number(vendor.id)) < limit;
}


async function validateConfig(model: SgModel): Promise<void> {
    if (typeof model.name !== "string" || !model.name.trim()) {
        throw new customError.AppError("Model name is required");
    }
    const upstreams = getMappings(model);
    if (model.enable !== false && upstreams.filter(item => item.enabled !== false).length === 0) {
        throw new customError.AppError("At least one upstream must be enabled");
    }
    const seen = new Set<string>();
    for (const upstream of upstreams) {
        if (!Number.isSafeInteger(Number(upstream.vendor_id)) || Number(upstream.vendor_id) <= 0) {
            throw new customError.AppError("Each upstream must specify a valid vendor_id");
        }
        const vendor = await vendorManager.findById(Number(upstream.vendor_id));
        if (!vendor) throw new customError.NotFoundError("Vendor not found");
        const vendorModelId = upstream.vendor_model_id == null ? null : Number(upstream.vendor_model_id);
        let resolvedModelName = String(model.name);
        if (vendorModelId !== null) {
            const vendorModel = await vendorModelManager.findById(vendorModelId);
            if (!vendorModel || Number(vendorModel.vendor_id) !== Number(upstream.vendor_id)) {
                throw new customError.AppError("Vendor model does not belong to the selected vendor");
            }
            resolvedModelName = String(vendorModel.model_id);
        }
        const key = `${upstream.vendor_id}:${resolvedModelName}`;
        if (seen.has(key)) throw new customError.AppError("Duplicate upstream mapping");
        seen.add(key);
    }
}

async function resolveAvailableCandidates(
    model: SgModel,
    clientFormat: ApiFormat,
    groupId?: number | null,
): Promise<ModelRoutingResult[]> {
    const candidates: ModelRoutingResult[] = [];
    const resolvedRoutes = new Set<string>();
    for (const upstream of getMappings(model)) {
        if (upstream.enabled === false) continue;
        const vendor = await vendorManager.findById(Number(upstream.vendor_id));
        if (!vendor || vendorStatus(vendor) !== "active") continue;
        // `undefined` 是 root/诊断调用使用的显式通配符；普通 Key 未分组时传入 null，
        // 与已分组供应商隔离。
        if (!vendorMatchesGroup(vendor, groupId)) continue;
        // 这里只做无副作用快照过滤；sender 的 acquire 仍是处理选择后竞态的最终防线。
        if (!vendorHasCapacity(vendor)) continue;

        const hasExplicitVendorModel = upstream.vendor_model_id != null;
        const vendorModel = !hasExplicitVendorModel
            ? await vendorModelManager.findByVendorAndModel(Number(upstream.vendor_id), String(model.name))
            : await vendorModelManager.findById(Number(upstream.vendor_model_id));
        // 删除供应商模型的正常路径会先将映射置为 NULL，表示显式回退到自动模型名。
        // 非空外键却查不到记录属于损坏数据，必须失败关闭。
        if (hasExplicitVendorModel && !vendorModel) continue;
        if (vendorModel && Number(vendorModel.vendor_id) !== Number(upstream.vendor_id)) continue;

        let supportedFormats: ApiFormat[];
        let upstreamFormat: ApiFormat;
        try {
            const vendorFormats = vendor.getSupportedFormats();
            const modelFormats = vendorModel?.getSupportedFormats();
            supportedFormats = modelFormats == null
                ? vendorFormats
                : vendorFormats.filter(format => modelFormats.includes(format));
            upstreamFormat = protocolUtils.resolveUpstreamFormat(clientFormat, supportedFormats);
            // resolveUpstreamFormat 为历史兼容会在无转换路径时回退客户端协议，
            // 候选层必须再次校验硬白名单，避免空列表或不兼容列表被绕过。
            if (!supportedFormats.includes(upstreamFormat)) continue;
            if (vendor.getUrlByFormat(upstreamFormat) === null) continue;
        } catch {
            continue;
        }

        const vendorModelName = vendorModel?.model_id ?? String(model.name);
        const routeKey = JSON.stringify([
            Number(vendor.id),
            vendorModelName,
            upstreamFormat,
        ]);
        if (resolvedRoutes.has(routeKey)) continue;
        resolvedRoutes.add(routeKey);
        candidates.push(new ModelRoutingResult(
            vendor,
            vendorModelName,
            upstreamFormat,
            vendorPriority(vendor),
            vendorWeight(vendor),
            Number(upstream.sort_order ?? candidates.length),
            upstream.vendor_model_id == null ? null : Number(upstream.vendor_model_id),
        ));
    }
    return candidates;
}

function weightedSelect(candidates: ModelRoutingResult[], seed?: number): ModelRoutingResult {
    if (candidates.length === 0) return ModelRoutingResult.none();
    const ordered = [...candidates].sort((a, b) => a.sortOrder - b.sortOrder || Number(a.vendor!.id) - Number(b.vendor!.id));
    const total = ordered.reduce((sum, candidate) => sum + Math.max(0, candidate.weight), 0);
    if (total <= 0) return ordered[0];
    // 稳定 seed 便于客户端重试同一请求；简单整数混合避免引入第二个随机依赖。
    let random = Math.random();
    if (seed !== undefined) {
        const value = Math.sin(seed * 12.9898 + ordered.length * 78.233) * 43758.5453;
        random = value - Math.floor(value);
    }
    let cursor = random * total;
    for (const candidate of ordered) {
        cursor -= Math.max(0, candidate.weight);
        if (cursor < 0) return candidate;
    }
    return ordered[ordered.length - 1];
}

async function selectUpstream(
    model: SgModel,
    clientFormat: ApiFormat,
    routingContext: RoutingContext,
    c?: Context,
): Promise<ModelRoutingResult> {
    const authContext = c?.get("authContext") as {
        group?: { id?: number | null };
        user?: { id?: number; type?: UserType | string };
    } | undefined;
    if (!authContext) return ModelRoutingResult.none();
    const isRoot = Number(authContext.user?.id) < 0;
    // 管理路由诊断有意位于 LLM 策略边界之外。该端点已由 requireAdmin 保护，目的是即使
    // 管理员账号的 Key 未分组也能检查已配置路由池。绕过仅限 modelController 设置的标记
    // 与已认证的 admin/root 上下文，普通 LLM 请求无法开启。
    const inspectAdmin = Boolean(c?.get("inspectUpstream"))
        && (authContext?.user?.type === UserType.ADMIN || authContext?.user?.type === UserType.ROOT);
    const groupId = isRoot || inspectAdmin
        ? undefined
        : (authContext?.group?.id == null ? null : Number(authContext.group.id));
    const candidates = await resolveAvailableCandidates(model, clientFormat, groupId);
    const available = candidates.filter(candidate =>
        candidate.hasUpstream()
        && !routingContext.hasTried(candidate.vendor.id, candidate.vendorModelName, candidate.upstreamFormat)
        && upstreamHealthService.getHealthStatus(
            candidate.vendor.id,
            candidate.vendorModelName,
            candidate.upstreamFormat,
        ).state !== UpstreamHealthState.DOWN,
    );
    if (available.length === 0) return ModelRoutingResult.none();

    const minPriority = Math.min(...available.map(candidate => candidate.priority));
    const tier = available.filter(candidate => candidate.priority === minPriority);
    // 必须按请求采样。使用用户 ID 作为 seed 会把同一用户的所有请求固定到一个供应商，
    // 破坏已配置的负载因子分布并造成可避免的热点。
    const selected = weightedSelect(tier);
    if (selected.hasUpstream()) {
        routingContext.markTried(selected.vendor.id, selected.vendorModelName, selected.upstreamFormat);
    }
    return selected;
}

export { ModelRoutingResult, resolveAvailableCandidates };
export default {
    validateConfig,
    resolveAvailableCandidates,
    selectUpstream,
};
