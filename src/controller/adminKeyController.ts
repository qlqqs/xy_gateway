import { Context } from "hono";
import adminKeyService from "../service/adminKeyService";


async function status(c: Context) {
    return c.json({ exists: await adminKeyService.exists() });
}


async function regenerate(c: Context) {
    const key = await adminKeyService.regenerate();
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
