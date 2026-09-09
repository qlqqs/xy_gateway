import { Context } from "hono";
import adminKeyService from "../service/adminKeyService";
import ormService from "../service/ormService";


function nodeOnly(c: Context): Response | null {
    if (!ormService.isNode) {
        return c.json({ error: "Not found" }, 404);
    }
    return null;
}


async function status(c: Context) {
    const unsupported = nodeOnly(c);
    if (unsupported) return unsupported;

    return c.json({ exists: await adminKeyService.exists() });
}


async function regenerate(c: Context) {
    const unsupported = nodeOnly(c);
    if (unsupported) return unsupported;

    const key = await adminKeyService.regenerate();
    return c.json({ key });
}


async function remove(c: Context) {
    const unsupported = nodeOnly(c);
    if (unsupported) return unsupported;

    await adminKeyService.remove();
    return c.json({ success: true });
}


export default {
    status,
    regenerate,
    remove,
};
