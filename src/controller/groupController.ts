import { Context } from "hono";
import groupService from "../service/groupService";
import customError from "../util/customErrorUtil";
import { parsePaginationQuery } from "../util/paginationUtil";

function parseId(raw: string): number {
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new customError.AppError("Invalid ID format");
    }
    return id;
}

async function readJson(c: Context): Promise<unknown> {
    try {
        return await c.req.json();
    } catch {
        throw new customError.AppError("Invalid JSON payload");
    }
}

async function listGroups(c: Context) {
    const query = c.req.query();
    const { pageSize, offset } = parsePaginationQuery(query);
    const result = await groupService.listGroups({
        keyword: query.keyword,
        status: query.status,
        pageSize,
        offset,
    });
    return c.json(result);
}

async function createGroup(c: Context) {
    return c.json(await groupService.createGroup(await readJson(c)));
}

async function getGroup(c: Context) {
    const group = await groupService.getGroup(parseId(c.req.param("id")));
    if (!group) {
        throw new customError.NotFoundError("Group not found");
    }
    return c.json(group);
}

async function updateGroup(c: Context) {
    const group = await groupService.updateGroup(parseId(c.req.param("id")), await readJson(c));
    if (!group) {
        throw new customError.NotFoundError("Group not found");
    }
    return c.json(group);
}

async function deleteGroup(c: Context) {
    const deleted = await groupService.deleteGroup(parseId(c.req.param("id")));
    if (!deleted) {
        throw new customError.NotFoundError("Group not found");
    }
    return c.json({ success: true });
}

export default {
    listGroups,
    createGroup,
    getGroup,
    updateGroup,
    deleteGroup,
};
