import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFormat, UserStatus, UserType } from "../../../src/constants";

const mocks = vi.hoisted(() => ({
    userService: { isRootToken: vi.fn() },
    userKeyUtil: { hashKey: vi.fn() },
    userKeyManager: { findByHash: vi.fn(), markUsed: vi.fn() },
    userManager: { findById: vi.fn() },
    userGroupManager: { findById: vi.fn() },
}));

vi.mock("../../../src/service/userService", () => ({ default: mocks.userService }));
vi.mock("../../../src/util/userKeyUtil", () => ({ default: mocks.userKeyUtil }));
vi.mock("../../../src/manager/userKeyManager", () => ({ default: mocks.userKeyManager }));
vi.mock("../../../src/manager/userManager", () => ({ default: mocks.userManager }));
vi.mock("../../../src/manager/userGroupManager", () => ({ default: mocks.userGroupManager }));

import authContextService from "../../../src/service/authContextService";

function activeUser(overrides: Record<string, unknown> = {}) {
    return { id: 11, name: "Alice", type: UserType.NORMAL, status: UserStatus.ACTIVE, balance: 0, ...overrides };
}

function activeKey(overrides: Record<string, unknown> = {}) {
    return { id: 22, user_id: 11, group_id: 33, status: "active", expires_at: null, ...overrides };
}

describe("authContextService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.userService.isRootToken.mockResolvedValue(false);
        mocks.userKeyUtil.hashKey.mockResolvedValue("hash");
        mocks.userKeyManager.markUsed.mockResolvedValue(undefined);
        mocks.userGroupManager.findById.mockResolvedValue({ id: 33, status: "active" });
        mocks.userManager.findById.mockResolvedValue(activeUser());
    });

    it("resolves root token without querying a user key", async () => {
        mocks.userService.isRootToken.mockResolvedValue(true);
        const context = await authContextService.resolve("root", "root");

        expect(context?.user.id).toBe(-1);
        expect(context?.user.type).toBe(UserType.ROOT);
        expect(context?.key).toBeNull();
        expect(mocks.userKeyUtil.hashKey).not.toHaveBeenCalled();
    });

    it("resolves a key to user and group and tolerates audit timestamp failures", async () => {
        mocks.userKeyManager.findByHash.mockResolvedValue(activeKey());
        mocks.userKeyManager.markUsed.mockRejectedValue(new Error("eventual consistency"));

        const context = await authContextService.resolve("secret", "root");

        expect(mocks.userKeyUtil.hashKey).toHaveBeenCalledWith("secret");
        expect(mocks.userManager.findById).toHaveBeenCalledWith(11);
        expect(mocks.userGroupManager.findById).toHaveBeenCalledWith(33);
        expect(context?.user.name).toBe("Alice");
        expect(context?.key?.id).toBe(22);
        expect(context?.group?.id).toBe(33);
    });

    it("rejects missing, disabled, expired and stale-group keys", async () => {
        mocks.userKeyManager.findByHash.mockResolvedValueOnce(null);
        expect(await authContextService.resolve("missing")).toBeNull();

        mocks.userKeyManager.findByHash.mockResolvedValueOnce(activeKey({ status: "disabled" }));
        expect(await authContextService.resolve("disabled")).toBeNull();

        mocks.userKeyManager.findByHash.mockResolvedValueOnce(activeKey({ expires_at: new Date(Date.now() - 1000) }));
        expect(await authContextService.resolve("expired")).toBeNull();

        mocks.userKeyManager.findByHash.mockResolvedValueOnce(activeKey());
        mocks.userGroupManager.findById.mockResolvedValueOnce(null);
        expect(await authContextService.resolve("stale-group")).toBeNull();
    });

    it("returns a complete request context and rejects disabled users", async () => {
        mocks.userKeyManager.findByHash.mockResolvedValue(activeKey());
        const result = await authContextService.requireLlm(
            "secret",
            "root",
            ApiFormat.OPENAI,
            "gpt-test",
            "{\"model\":\"gpt-test\"}",
            "127.0.0.1",
        );
        expect(result).toMatchObject({
            clientFormat: ApiFormat.OPENAI,
            modelName: "gpt-test",
            requestBody: "{\"model\":\"gpt-test\"}",
            clientIp: "127.0.0.1",
        });

        mocks.userManager.findById.mockResolvedValue(activeUser({ status: UserStatus.DISABLED }));
        await expect(authContextService.requireLlm(
            "secret",
            "root",
            ApiFormat.ANTHROPIC,
            "m",
            "{}",
            null,
        )).rejects.toMatchObject({ statusCode: 403, code: "authentication_error" });
    });
});
