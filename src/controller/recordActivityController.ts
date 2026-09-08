import { Context } from "hono";
import recordManager from "../manager/recordManager";
import requestActivityService from "../service/requestActivityService";
import idUtil from "../util/idUtil";


async function getRecordActivity(c: Context) {
    const recordId = idUtil.toPositiveInteger(c.req.param("id"));
    if (recordId === null) {
        return c.json({ error: "Invalid ID format" }, 400);
    }

    const record = await recordManager.findById(recordId);
    if (!record) {
        return c.json({ error: "Record not found" }, 404);
    }

    const activities = await requestActivityService.getByRecordId(recordId);
    return c.json({ record_id: recordId, activities });
}

export default {
    getRecordActivity,
};
