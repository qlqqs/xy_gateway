import { Context, MiddlewareHandler } from "hono";
import { UserType, UserStatus } from "../constants";
import authContextService from "../service/authContextService";
import adminKeyService from "../service/adminKeyService";
import userService from "../service/userService";

const requireAdmin: MiddlewareHandler = async (c, next) => {
    // x-api-key 仅供 Node Admin API 使用。按 Header 是否存在而不是值的
    // truthiness 选择分支，空值或畸形值不能悄悄回退到有效 Bearer Token。
    const headerValue = c.req.header("x-api-key");
    const hasAdminKeyHeader = c.req.raw?.headers?.has("x-api-key") ?? headerValue !== undefined;
    if (hasAdminKeyHeader) {
        const presentedKey = headerValue ?? "";
        let valid = false;
        try {
            valid = await adminKeyService.verify(presentedKey);
        } catch {
            return c.json(
                { error: "Admin authentication unavailable", code: "admin_auth_unavailable" },
                503,
            );
        }

        if (!valid) {
            return c.json({ error: "Invalid admin API key", code: "invalid_admin_key" }, 401);
        }

        let identity;
        try {
            identity = await userService.resolveAdminKeyIdentity();
        } catch {
            return c.json(
                { error: "Admin identity unavailable", code: "admin_identity_unavailable" },
                503,
            );
        }

        if (!identity) {
            return c.json(
                { error: "Admin identity unavailable", code: "admin_identity_unavailable" },
                503,
            );
        }

        c.set("user_type", identity.type);
        c.set("user", identity);
        c.set("authContext", { user: identity, key: null, group: null });
        await next();
        return;
    }

    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ error: "Authorization header is missing or invalid" }, 401);
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
        return c.json({ error: "Authorization header is missing or invalid" }, 401);
    }
    const authContext = await authContextService.resolve(token, c.env.ROOT_TOKEN);
    const user = authContext?.user;

    if (!user) {
        return c.json({ error: "Invalid token" }, 401);
    }

    if (user.status === UserStatus.DISABLED) {
        return c.json({ error: "User disabled" }, 403);
    }

    c.set("user_type", user.type);
    c.set("user", user);
    c.set("authContext", authContext);

    if (user.type !== UserType.ADMIN && user.type !== UserType.ROOT) {
        return c.json({ error: "Admin access required" }, 403);
    }

    await next();
};

export default { requireAdmin };
