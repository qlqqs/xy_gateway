import { ApiFormat, UserStatus } from "../constants";
import { SgModel } from "../model/sgModel";
import { SgUser } from "../model/sgUser";
import { SgUserGroup } from "../model/sgUserGroup";
import { SgUserKey } from "../model/sgUserKey";
import { AuthContext } from "./authContextService";
import configService from "./configService";
import customError from "../util/customErrorUtil";
import usageUtils from "../util/protocol/usageUtil";
import billingUtil from "../util/protocol/billingUtil";

const protocolByFormat: Record<ApiFormat, string> = {
    [ApiFormat.OPENAI]: "openai_chat",
    [ApiFormat.RESPONSES]: "openai_responses",
    [ApiFormat.ANTHROPIC]: "anthropic",
};

function ipv4ToNumber(value: string): number | null {
    const parts = value.split(".");
    if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part))) return null;
    const numbers = parts.map(Number);
    if (numbers.some(part => part < 0 || part > 255)) return null;
    return (((numbers[0] * 256 + numbers[1]) * 256 + numbers[2]) * 256 + numbers[3]) >>> 0;
}

function matchesIpRule(ip: string, rule: string): boolean {
    const normalizedIp = ip.trim().toLowerCase();
    const normalizedRule = rule.trim().toLowerCase();
    if (!normalizedIp || !normalizedRule) return false;
    if (!normalizedRule.includes("/")) return normalizedIp === normalizedRule;

    const [network, prefixText] = normalizedRule.split("/", 2);
    const address = ipv4ToNumber(normalizedIp);
    const networkAddress = ipv4ToNumber(network);
    const prefix = Number(prefixText);
    if (address === null || networkAddress === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
        // IPv6 CIDR support is intentionally conservative: exact matching is
        // still safe, while malformed or unsupported rules never widen access.
        return normalizedIp === network;
    }
    if (prefix === 0) return true;
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    return (address & mask) === (networkAddress & mask);
}

function isIpAllowed(key: SgUserKey, clientIp: string | null): boolean {
    if (!key.ip_restriction_enabled) return true;
    const ip = clientIp?.trim() ?? "";
    const whitelist = key.ip_whitelist ?? [];
    const blacklist = key.ip_blacklist ?? [];
    if (blacklist.some(rule => matchesIpRule(ip, rule))) return false;
    if (whitelist.length === 0) return false;
    return whitelist.some(rule => matchesIpRule(ip, rule));
}

function isModelAllowed(key: SgUserKey | null, group: SgUserGroup | null, modelName: string): boolean {
    const keyAllowed = !key?.model_whitelist_enabled || (key.model_whitelist ?? []).includes(modelName);
    const groupAllowed = !group?.whitelist_enabled || (group.custom_models ?? []).includes(modelName);
    return keyAllowed && groupAllowed;
}

function isFormatAllowed(group: SgUserGroup | null, format: ApiFormat): boolean {
    if (!group) return true;
    return (group.inbound_protocols ?? []).includes(protocolByFormat[format]);
}

function assertBaseAccess(
    context: AuthContext,
    format: ApiFormat,
    modelName: string | null,
    clientIp: string | null,
): void {
    const { user, key, group } = context;
    if (user.id < 0) return;
    if (user.status !== UserStatus.ACTIVE) {
        throw new customError.AppError("User disabled", 403, "authentication_error");
    }
    if (key && key.status !== "active") {
        throw new customError.AppError("API key disabled", 403, "authentication_error");
    }
    if (key?.expires_at && new Date(key.expires_at).getTime() <= Date.now()) {
        throw new customError.AppError("API key expired", 403, "authentication_error");
    }
    if (key && !isIpAllowed(key, clientIp)) {
        throw new customError.AppError("Access denied", 403, "authentication_error");
    }
    if (group?.status !== undefined && group.status !== "active") {
        throw new customError.AppError("Group disabled", 403, "authentication_error");
    }
    if (!isFormatAllowed(group, format)) {
        throw new customError.AppError("Protocol is not allowed for this key group", 403, "authentication_error");
    }
    if (modelName !== null && !isModelAllowed(key, group, modelName)) {
        throw new customError.AppError("Model is not allowed for this API key", 403, "authentication_error");
    }
    if (key && key.quota > 0 && key.quota_used >= key.quota) {
        throw new customError.AppError("API key quota exhausted", 429, "rate_limit_error");
    }
}

function assertModelsAccess(
    context: AuthContext,
    format: ApiFormat,
    clientIp: string | null,
): void {
    // The model catalogue has no single requested model, but all identity,
    // expiry, IP, protocol and quota gates still apply.  Per-model whitelist
    // filtering is performed by visibleModels below.
    assertBaseAccess(context, format, null, clientIp);
}

async function assertLlmAccess(
    context: AuthContext,
    format: ApiFormat,
    modelName: string,
    clientIp: string | null,
    model?: SgModel | null,
): Promise<void> {
    assertBaseAccess(context, format, modelName, clientIp);
    if (!model || context.user.id < 0 || !model.hasBilling()) return;

    // Per-request/image prices are known before forwarding.  Enforce the
    // remaining key quota and balance at the edge; token prices are checked
    // again during settlement once usage is known.
    const knownCost = usageUtils.calculateCost(model, 0, 0);
    const multiplier = Math.max(0, Number(context.group?.rate_multiplier ?? 1));
    const estimatedCost = billingUtil.quantizeAmount(knownCost * multiplier);
    if (context.key && context.key.quota > 0 && estimatedCost > 0
        && context.key.quota_used + estimatedCost > context.key.quota) {
        throw new customError.AppError("API key quota exhausted", 429, "rate_limit_error");
    }
    if (await configService.isModuleBillingEnabled()
        && estimatedCost > 0
        && context.user.balance < billingUtil.toUnits(estimatedCost)) {
        throw new customError.AppError("Insufficient balance", 400, "insufficient_balance");
    }
    if (await configService.isModuleBillingEnabled()
        && estimatedCost === 0
        && multiplier > 0
        && model.prices?.billing_mode !== "per_request"
        && model.prices?.billing_mode !== "image"
        && model.hasBilling()
        && context.user.balance < 0) {
        // Token billing has no reliable upper bound before forwarding; retain
        // the existing qualification gate for an already-overdrawn account.
        // A zero balance is allowed for the first request and is settled
        // against the account afterwards; a zero-rate group is explicitly
        // free and is never blocked here.
        throw new customError.AppError("Insufficient balance", 400, "insufficient_balance");
    }
}

function visibleModels(
    models: SgModel[],
    context: AuthContext,
    format: ApiFormat,
): SgModel[] {
    if (context.user.id < 0) return models;
    if (context.group && !isFormatAllowed(context.group, format)) return [];
    return models.filter(model => isModelAllowed(context.key, context.group, String(model.name)));
}

export default {
    assertLlmAccess,
    assertModelsAccess,
    visibleModels,
    isIpAllowed,
    matchesIpRule,
    isModelAllowed,
};
