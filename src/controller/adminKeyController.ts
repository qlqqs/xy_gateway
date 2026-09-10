import { Context } from "hono";
import adminKeyService from "../service/adminKeyService";
import customError from "../util/customErrorUtil";


async function status(c: Context) {
    return c.json({ exists: await adminKeyService.exists() });
}


async function regenerate(c: Context) {
    const user = c.get("user");
    if (!user) {
        throw new customError.AppError("Admin identity unavailable", 503, "admin_identity_unavailable");
    }
    const key = await adminKeyService.regenerate(user);
    return c.json({ key });
}


async function remove(c: Context) {
    await adminKeyService.remove();
    return c.json({ success: true });
}


export default {
    status,
    regenerate,
    remove,
};
