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
    if (parts.some(part => part.length > 1 && part.startsWith("0"))) return null;
    const numbers = parts.map(Number);
    if (numbers.some(part => part < 0 || part > 255)) return null;
    return (((numbers[0] * 256 + numbers[1]) * 256 + numbers[2]) * 256 + numbers[3]) >>> 0;
}

function normalizeIpv6(value: string): string | null {
    if (!value.includes(":") || !/^[0-9a-f:.]+$/i.test(value)) return null;
    try {
        // URL 的 IPv6 解析统一压缩、补零及内嵌 IPv4 写法，同时拒绝非法地址。
        const hostname = new URL(`http://[${value}]/`).hostname;
        return hostname.startsWith("[") && hostname.endsWith("]")
            ? hostname.slice(1, -1)
            : hostname;
    } catch {
        return null;
    }
}


interface ParsedIpAddress {
    family: 4 | 6;
    value: bigint;
    ipv4Value?: bigint;
}


function ipv6ToBigInt(value: string): bigint | null {
    const normalized = normalizeIpv6(value);
    if (normalized === null) return null;

    const halves = normalized.split("::");
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
        return null;
    }

    const groups = halves.length === 2
        ? [...left, ...Array(missing).fill("0"), ...right]
        : left;
    if (groups.length !== 8) return null;

    return groups.reduce((result, group) => {
        return (result << 16n) | BigInt(parseInt(group, 16));
    }, 0n);
}


function parseIpAddress(value: string): ParsedIpAddress | null {
    const ipv4 = ipv4ToNumber(value);
    if (ipv4 !== null) {
        const numeric = BigInt(ipv4);
        return { family: 4, value: numeric, ipv4Value: numeric };
    }

    const ipv6 = ipv6ToBigInt(value);
    if (ipv6 === null) return null;
    const ipv4Value = ipv6 >> 32n === 0xffffn
        ? ipv6 & 0xffffffffn
        : undefined;
    return { family: 6, value: ipv6, ipv4Value };
}


function matchesPrefix(address: bigint, network: bigint, prefix: number, width: number): boolean {
    if (prefix === 0) return true;
    const shift = BigInt(width - prefix);
    return address >> shift === network >> shift;
}


function matchesIpRule(ip: string, rule: string): boolean {
    const normalizedIp = ip.trim().toLowerCase();
    const normalizedRule = rule.trim().toLowerCase();
    if (!normalizedIp || !normalizedRule) return false;
    if (!normalizedRule.includes("/")) {
        const address = parseIpAddress(normalizedIp);
        const expected = parseIpAddress(normalizedRule);
        if (!address || !expected) return false;
        if (address.ipv4Value !== undefined && expected.ipv4Value !== undefined) {
            return address.ipv4Value === expected.ipv4Value;
        }
        return address.family === expected.family && address.value === expected.value;
    }

    const parts = normalizedRule.split("/");
    if (parts.length !== 2) return false;
    const [network, prefixText] = parts;
    if (!/^\d+$/.test(prefixText)) return false;
    const prefix = Number(prefixText);
    const address = parseIpAddress(normalizedIp);
    const networkAddress = parseIpAddress(network);
    if (!address || !networkAddress) return false;

    if (networkAddress.family === 4) {
        if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32
            || address.ipv4Value === undefined || networkAddress.ipv4Value === undefined) {
            return false;
        }
        return matchesPrefix(address.ipv4Value, networkAddress.ipv4Value, prefix, 32);
    }

    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
        return false;
    }

    // 对齐 Go net.IPNet.Contains：IPv4-mapped 网络在 /96 及以上按 IPv4
    // 网段比较；普通 IPv6 网段不包含会被 To4() 归一化的 mapped 地址。
    if (networkAddress.ipv4Value !== undefined && prefix >= 96) {
        return address.ipv4Value !== undefined
            && matchesPrefix(address.ipv4Value, networkAddress.ipv4Value, prefix - 96, 32);
    }
    if (address.family !== 6) return false;
    if (address.ipv4Value !== undefined) return false;
    return matchesPrefix(address.value, networkAddress.value, prefix, 128);
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

    // 按次和图片费用在转发前已知，因此在入口校验 Key 剩余额度与用户余额；
    // token 实际费用仅在 usage 完整后结算，允许本次用量越过额度并由下一请求阻断。
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
