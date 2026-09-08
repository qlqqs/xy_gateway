import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFormat, UserStatus, UserType } from "../../../src/constants";
import { SgModel } from "../../../src/model/sgModel";
import { SgUser } from "../../../src/model/sgUser";
import { SgUserGroup } from "../../../src/model/sgUserGroup";
import { SgUserKey } from "../../../src/model/sgUserKey";

const configMock = vi.hoisted(() => ({
    isModuleBillingEnabled: vi.fn(),
}));

vi.mock("../../../src/service/configService", () => ({ default: configMock }));

import accessPolicyService from "../../../src/service/accessPolicyService";

function makeUser(overrides: Partial<SgUser> = {}): SgUser {
    const user = new SgUser();
    Object.assign(user, {
        id: 1,
        name: "test-user",
        type: UserType.NORMAL,
        status: UserStatus.ACTIVE,
        balance: 10_000_000,
        ...overrides,
    });
    return user;
}

function makeKey(overrides: Record<string, unknown> = {}): SgUserKey {
    return new SgUserKey({
        id: 2,
        user_id: 1,
        ...overrides,
    });
}

function makeGroup(overrides: Record<string, unknown> = {}): SgUserGroup {
    return new SgUserGroup({
        id: 3,
        // Keep the helper usable for policy tests that are not about protocol
        // filtering.  An explicitly supplied list still exercises that gate.
        inbound_protocols: ["openai_chat", "openai_responses", "anthropic"],
        ...overrides,
    });
}

function makeContext(overrides: {
    user?: Partial<SgUser>;
    key?: Record<string, unknown> | null;
    group?: Record<string, unknown> | null;
} = {}) {
    return {
        user: makeUser(overrides.user),
        key: overrides.key === null ? null : makeKey(overrides.key),
        group: overrides.group === null ? null : makeGroup(overrides.group),
    };
}

describe("accessPolicyService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configMock.isModuleBillingEnabled.mockResolvedValue(false);
    });

    it("matches exact IPv4, CIDR and /0 without widening malformed rules", () => {
        expect(accessPolicyService.matchesIpRule("192.168.1.8", "192.168.1.8")).toBe(true);
        expect(accessPolicyService.matchesIpRule("192.168.1.8", "192.168.1.0/24")).toBe(true);
        expect(accessPolicyService.matchesIpRule("192.168.2.8", "192.168.1.0/24")).toBe(false);
        expect(accessPolicyService.matchesIpRule("10.0.0.1", "0.0.0.0/0")).toBe(true);
        expect(accessPolicyService.matchesIpRule("2001:db8::1", "2001:db8::1")).toBe(true);
        expect(accessPolicyService.matchesIpRule("2001:db8::1", "2001:db8::1/128")).toBe(true);
        expect(accessPolicyService.matchesIpRule("2001:db8::1", "2001:db8::/64")).toBe(true);
        expect(accessPolicyService.matchesIpRule("2001:db9::1", "2001:db8::/64")).toBe(false);
    });

    it.each([
        "10.0.0.0/33",
        "10.0.0.0/-1",
        "10.0.0.0/not-a-prefix",
        "10.0.0.0/1e1",
        "10.0.0.0/24.0",
        "10.0.0.0/8/extra",
        "010.0.0.0/8",
    ])("rejects malformed IPv4 CIDR rule %s even when the IP equals its network text", (rule) => {
        expect(accessPolicyService.matchesIpRule("10.0.0.0", rule)).toBe(false);
    });

    it("拒绝带前导零的 IPv4 精确规则和客户端地址", () => {
        expect(accessPolicyService.matchesIpRule("10.0.0.1", "010.0.0.1")).toBe(false);
        expect(accessPolicyService.matchesIpRule("010.0.0.1", "10.0.0.1")).toBe(false);
        expect(accessPolicyService.matchesIpRule("0.0.0.0", "0.0.0.0")).toBe(true);
    });

    it.each([
        "2001:db8::1/129",
        "2001:db8::1/not-a-prefix",
        "2001:db8::1/128/extra",
    ])("rejects malformed IPv6 CIDR rule %s", (rule) => {
        expect(accessPolicyService.matchesIpRule("2001:db8::1", rule)).toBe(false);
    });

    it("IPv6 CIDR 与精确规则按地址匹配，黑名单不能被等价写法绕过", () => {
        expect(accessPolicyService.matchesIpRule("2001:db8::1", "2001:0db8:0:0:0:0:0:1/128")).toBe(true);
        expect(accessPolicyService.matchesIpRule("2001:0db8:0:0:0:0:0:1", "2001:db8::1")).toBe(true);
        expect(accessPolicyService.matchesIpRule("2001:db8::2", "2001:db8::1/128")).toBe(false);
        expect(accessPolicyService.matchesIpRule("invalid::ip", "invalid::ip/128")).toBe(false);
        expect(accessPolicyService.isIpAllowed(makeKey({
            ip_restriction_enabled: true,
            ip_whitelist: ["2001:db8::1/128"],
            ip_blacklist: ["2001:db8::/64"],
        }), "2001:db8::1")).toBe(false);
    });

    it("支持 IPv6 非整字节前缀与边界前缀", () => {
        expect(accessPolicyService.matchesIpRule("2001:db8::1", "::/0")).toBe(true);
        expect(accessPolicyService.matchesIpRule("2001:db8:0:0:7fff::1", "2001:db8::/65")).toBe(true);
        expect(accessPolicyService.matchesIpRule("2001:db8:0:0:8000::1", "2001:db8::/65")).toBe(false);
        expect(accessPolicyService.matchesIpRule("2001:db8::", "2001:db8::/127")).toBe(true);
        expect(accessPolicyService.matchesIpRule("2001:db8::1", "2001:db8::/127")).toBe(true);
        expect(accessPolicyService.matchesIpRule("2001:db8::2", "2001:db8::/127")).toBe(false);
        expect(accessPolicyService.matchesIpRule("2001:db8::1", "2001:db8::1/128")).toBe(true);
        expect(accessPolicyService.matchesIpRule("2001:db8::2", "2001:db8::1/128")).toBe(false);
    });


    it("将 IPv4 映射的 IPv6 socket 地址按 IPv4 白名单匹配", () => {
        expect(accessPolicyService.matchesIpRule("::ffff:192.0.2.5", "192.0.2.5")).toBe(true);
        expect(accessPolicyService.matchesIpRule("::ffff:192.0.2.5", "192.0.2.0/24")).toBe(true);
        expect(accessPolicyService.matchesIpRule("::ffff:192.0.3.5", "192.0.2.0/24")).toBe(false);
        expect(accessPolicyService.matchesIpRule("::ffff:c000:205", "192.0.2.5")).toBe(true);
        expect(accessPolicyService.matchesIpRule("::192.0.2.5", "192.0.2.0/24")).toBe(false);
        expect(accessPolicyService.matchesIpRule("2001:db8::1", "192.0.2.0/24")).toBe(false);
        expect(accessPolicyService.matchesIpRule("::ffff:192.0.2.5", "::/0")).toBe(false);
        expect(accessPolicyService.matchesIpRule("2001:db8::1", "::/0")).toBe(true);
        expect(accessPolicyService.matchesIpRule("192.0.2.5", "::ffff:192.0.2.0/120")).toBe(true);
        expect(accessPolicyService.matchesIpRule("::ffff:192.0.2.5", "::ffff:192.0.2.0/120")).toBe(true);
        expect(accessPolicyService.matchesIpRule("192.0.3.5", "::ffff:192.0.2.0/120")).toBe(false);
        expect(accessPolicyService.matchesIpRule("::ffff:192.0.2.5", "::ffff:0:0/95")).toBe(false);
        expect(accessPolicyService.isIpAllowed(makeKey({
            ip_restriction_enabled: true,
            ip_whitelist: ["192.0.2.0/24"],
        }), "::ffff:192.0.2.5")).toBe(true);
        expect(accessPolicyService.isIpAllowed(makeKey({
            ip_restriction_enabled: true,
            ip_whitelist: ["192.0.2.0/24"],
            ip_blacklist: ["192.0.2.5"],
        }), "::ffff:192.0.2.5")).toBe(false);
    });


    it("requires a whitelist when IP restriction is enabled and gives blacklist precedence", () => {
        expect(accessPolicyService.isIpAllowed(makeKey({ ip_restriction_enabled: false }), null)).toBe(true);
        expect(accessPolicyService.isIpAllowed(makeKey({
            ip_restriction_enabled: true,
            ip_whitelist: ["10.0.0.0/8"],
        }), "10.2.3.4")).toBe(true);
        expect(accessPolicyService.isIpAllowed(makeKey({
            ip_restriction_enabled: true,
            ip_whitelist: ["10.0.0.0/8"],
            ip_blacklist: ["10.2.0.0/16"],
        }), "10.2.3.4")).toBe(false);
        expect(accessPolicyService.isIpAllowed(makeKey({
            ip_restriction_enabled: true,
            ip_whitelist: [],
        }), "10.2.3.4")).toBe(false);
        expect(accessPolicyService.isIpAllowed(makeKey({
            ip_restriction_enabled: true,
            ip_whitelist: ["10.0.0.0/8"],
        }), null)).toBe(false);
        expect(accessPolicyService.isIpAllowed(makeKey({
            ip_restriction_enabled: true,
            ip_whitelist: ["10.0.0.0/33"],
        }), "10.0.0.0")).toBe(false);
        expect(accessPolicyService.isIpAllowed(makeKey({
            ip_restriction_enabled: true,
            ip_whitelist: ["10.0.0.0/8"],
            ip_blacklist: ["10.0.0.0/33"],
        }), "10.2.3.4")).toBe(true);
    });

    it("takes the intersection of enabled key and group model whitelists", () => {
        const key = makeKey({ model_whitelist_enabled: true, model_whitelist: ["m1", "m2"] });
        const group = makeGroup({ whitelist_enabled: true, custom_models: ["m2", "m3"] });

        expect(accessPolicyService.isModelAllowed(key, group, "m1")).toBe(false);
        expect(accessPolicyService.isModelAllowed(key, group, "m2")).toBe(true);
        expect(accessPolicyService.isModelAllowed(key, group, "m3")).toBe(false);
        expect(accessPolicyService.isModelAllowed(
            makeKey({ model_whitelist_enabled: false }),
            makeGroup({ whitelist_enabled: false }),
            "any-model",
        )).toBe(true);
    });

    it("rejects disabled, expired, protocol, model and quota policies before routing", async () => {
        await expect(accessPolicyService.assertLlmAccess(
            makeContext({ user: { status: UserStatus.DISABLED } }),
            ApiFormat.OPENAI,
            "m1",
            null,
        )).rejects.toMatchObject({ statusCode: 403, code: "authentication_error" });

        await expect(accessPolicyService.assertLlmAccess(
            makeContext({ key: { expires_at: new Date(Date.now() - 1000) } }),
            ApiFormat.OPENAI,
            "m1",
            null,
        )).rejects.toMatchObject({ statusCode: 403, code: "authentication_error" });

        await expect(accessPolicyService.assertLlmAccess(
            makeContext({ group: { inbound_protocols: ["anthropic"] } }),
            ApiFormat.OPENAI,
            "m1",
            null,
        )).rejects.toMatchObject({ statusCode: 403, code: "authentication_error" });

        await expect(accessPolicyService.assertLlmAccess(
            makeContext({ key: { model_whitelist_enabled: true, model_whitelist: ["m2"] } }),
            ApiFormat.OPENAI,
            "m1",
            null,
        )).rejects.toMatchObject({ statusCode: 403, code: "authentication_error" });

        await expect(accessPolicyService.assertLlmAccess(
            makeContext({ key: { quota: 1, quota_used: 1 } }),
            ApiFormat.OPENAI,
            "m1",
            null,
        )).rejects.toMatchObject({ statusCode: 429, code: "rate_limit_error" });
    });

    it("filters visible models consistently with the inbound protocol and root bypass", () => {
        const models = [new SgModel({ name: "m1" }), new SgModel({ name: "m2" })];
        const context = makeContext({
            key: { model_whitelist_enabled: true, model_whitelist: ["m2"] },
            group: { inbound_protocols: ["openai_chat"], whitelist_enabled: false },
        });

        expect(accessPolicyService.visibleModels(models, context, ApiFormat.OPENAI).map(model => model.name)).toEqual(["m2"]);
        expect(accessPolicyService.visibleModels(models, context, ApiFormat.ANTHROPIC)).toEqual([]);

        const root = makeContext({ user: { id: -1, type: UserType.ROOT } });
        expect(accessPolicyService.visibleModels(models, root, ApiFormat.ANTHROPIC)).toEqual(models);
    });

    it("applies known per-request balance and quota estimates while allowing unknown token estimates", async () => {
        configMock.isModuleBillingEnabled.mockResolvedValue(true);
        const model = new SgModel({
            name: "paid",
            prices: { billing_mode: "per_request", per_request: 1 },
        });
        const context = makeContext({
            user: { balance: 500_000 },
            key: { quota: 10, quota_used: 0 },
            group: { rate_multiplier: 2 },
        });

        await expect(accessPolicyService.assertLlmAccess(
            context,
            ApiFormat.OPENAI,
            "paid",
            null,
            model,
        )).rejects.toMatchObject({ statusCode: 400, code: "insufficient_balance" });

        const tokenModel = new SgModel({ name: "token", prices: { input: 1, output: 1 } });
        const overdrawn = makeContext({ user: { balance: -1 } });
        await expect(accessPolicyService.assertLlmAccess(
            overdrawn,
            ApiFormat.OPENAI,
            "token",
            null,
            tokenModel,
        )).rejects.toMatchObject({ statusCode: 400, code: "insufficient_balance" });
    });
});
