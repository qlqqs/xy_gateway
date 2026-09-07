import type { Context } from "hono";
import { ApiFormat, UserType } from "../../constants";
import { SgModel } from "../../model/sgModel";
import vendorManager from "../../manager/vendorManager";
import vendorModelManager from "../../manager/vendorModelManager";
import customError from "../../util/customErrorUtil";
import protocolUtils from "../../util/protocol/protocolUtil";
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

function vendorGroupId(vendor: any): number | null {
    const value = vendor.group_id !== undefined ? vendor.group_id : vendor.config?.group_id;
    return value == null ? null : Number(value);
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
        if (vendorModelId !== null) {
            const vendorModel = await vendorModelManager.findById(vendorModelId);
            if (!vendorModel || Number(vendorModel.vendor_id) !== Number(upstream.vendor_id)) {
                throw new customError.AppError("Vendor model does not belong to the selected vendor");
            }
        }
        const key = `${upstream.vendor_id}:${vendorModelId ?? model.name}`;
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
    for (const upstream of getMappings(model)) {
        if (upstream.enabled === false) continue;
        const vendor = await vendorManager.findById(Number(upstream.vendor_id));
        if (!vendor || vendorStatus(vendor) !== "active") continue;
        // `undefined` is an explicit wildcard used by root/diagnostic calls;
        // a normal key with no group passes null and is isolated from grouped
        // vendors.
        if (groupId !== undefined && vendorGroupId(vendor) !== groupId) continue;

        let vendorModel = upstream.vendor_model_id == null
            ? await vendorModelManager.findByVendorAndModel(Number(upstream.vendor_id), String(model.name))
            : await vendorModelManager.findById(Number(upstream.vendor_model_id));
        if (vendorModel && Number(vendorModel.vendor_id) !== Number(upstream.vendor_id)) continue;

        let supportedFormats: ApiFormat[];
        let upstreamFormat: ApiFormat;
        try {
            supportedFormats = vendorModel?.getSupportedFormats() ?? vendor.getSupportedFormats();
            upstreamFormat = protocolUtils.resolveUpstreamFormat(clientFormat, supportedFormats);
            if (vendor.getUrlByFormat(upstreamFormat) === null) continue;
        } catch {
            continue;
        }

        const vendorModelName = vendorModel?.model_id ?? String(model.name);
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
    // A stable seed is useful for clients that retry the same request.  The
    // simple integer mixer avoids introducing a second random dependency.
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
    const hasAuthContext = Boolean(authContext);
    const isRoot = Number(authContext?.user?.id) < 0;
    // Management route diagnostics are deliberately outside the LLM policy
    // boundary.  The endpoint is already protected by requireAdmin, and its
    // purpose is to inspect the configured route pool even when the admin
    // account's own key has no group.  Keep the bypass scoped to the marker
    // set by modelController and an authenticated admin/root context; normal
    // LLM requests can never opt into it.
    const inspectAdmin = Boolean(c?.get("inspectUpstream"))
        && (authContext?.user?.type === UserType.ADMIN || authContext?.user?.type === UserType.ROOT);
    const groupId = !hasAuthContext || isRoot || inspectAdmin
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
    // Sampling must happen per request.  Seeding with the user id would pin
    // every request from one user to the same vendor, defeating the configured
    // load-factor distribution and creating avoidable hot spots.
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
