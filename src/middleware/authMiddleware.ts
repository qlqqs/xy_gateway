import { Context, MiddlewareHandler } from "hono";
import { UserType, UserStatus } from "../constants";
import authContextService from "../service/authContextService";

const requireAdmin: MiddlewareHandler = async (c, next) => {
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
