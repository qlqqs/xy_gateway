import { Context } from "hono";
import { UserType } from "../constants";
import userManager from "../manager/userManager";
import userService from "../service/userService";
import userKeyService, { type UserKeyInput } from "../service/userKeyService";
import userKeyManager from "../manager/userKeyManager";
import userKeyUtil from "../util/userKeyUtil";
import customError from "../util/customErrorUtil";
import { createListResponse, parsePaginationQuery } from "../util/paginationUtil";
import ormService from "../service/ormService";

interface UserDto {
    id: number;
    name: string;
    keys: Awaited<ReturnType<typeof userKeyService.listForUser>>;
    type: UserType;
    balance: number;
    status: string;
    created_at: Date;
    updated_at: Date;
}

function encryptionSecret(c: Context): string {
    const secret = userKeyUtil.resolveEncryptionSecret(undefined, c.env?.KEY_ENCRYPTION_SECRET);
    if (!secret) {
        throw new customError.AppError("Key encryption is not configured", 500);
    }
    return secret;
}

async function toDto(c: Context, user: any): Promise<UserDto> {
    const userKeys = await userKeyManager.listByUser(Number(user.id));
    // A user without keys can still be listed/edited before the deployment
    // operator configures KEY_ENCRYPTION_SECRET.  The secret is mandatory as
    // soon as an encrypted key must be created or returned.
    const secret = userKeys.length > 0 ? encryptionSecret(c) : "";
    return {
        id: Number(user.id),
        name: user.name,
        keys: await userKeyService.listForUser(Number(user.id), secret),
        type: user.type,
        balance: Number(user.balance ?? 0),
        status: user.status,
        created_at: user.created_at,
        updated_at: user.updated_at,
    };
}

function parseUserType(value: unknown): UserType {
    if (value === undefined) return UserType.NORMAL;
    if (value !== UserType.NORMAL && value !== UserType.ADMIN) {
        throw new customError.AppError("type must be normal or admin");
    }
    return value;
}

function parseId(raw: string): number {
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new customError.AppError("Invalid ID format");
    }
    return id;
}

async function parseBody(c: Context): Promise<Record<string, unknown>> {
    try {
        const body = await c.req.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            throw new Error("object required");
        }
        return body as Record<string, unknown>;
    } catch {
        throw new customError.AppError("Invalid JSON payload");
    }
}

async function listUsers(c: Context) {
    const query = c.req.query();
    const { pageSize, offset } = parsePaginationQuery(query);
    const result = await userManager.list({
        type: query.type,
        keyword: query.keyword,
        pageSize,
        offset,
    });
    const users = await Promise.all(result.list.map(user => toDto(c, user)));
    return c.json(createListResponse(users, result.total));
}

async function getUser(c: Context) {
    const user = await userManager.findById(parseId(c.req.param("id")));
    if (!user) throw new customError.NotFoundError("User not found");
    return c.json(await toDto(c, user));
}

async function getUsersByIds(c: Context) {
    const body = await parseBody(c);
    const ids = body.ids;
    if (!Array.isArray(ids)) return c.json([]);
    const idList = ids.map(id => Number(id)).filter(id => Number.isSafeInteger(id) && id > 0);
    if (idList.length === 0) return c.json([]);
    const users = await userManager.getByIds(idList);
    return c.json(await Promise.all(users.map(user => toDto(c, user))));
}

async function createUser(c: Context) {
    const body = await parseBody(c);
    if (Object.prototype.hasOwnProperty.call(body, "token")) {
        throw new customError.AppError("token is no longer a user field; create a key in keys");
    }
    if (typeof body.name !== "string" || !body.name.trim()) {
        throw new customError.AppError("name is required");
    }
    const name = body.name.trim();
    if (await userManager.findByName(name)) {
        throw new customError.AppError("User name already exists", 409);
    }
    const type = parseUserType(body.type);
    const keys = body.keys;
    if (keys !== undefined && !Array.isArray(keys)) {
        throw new customError.AppError("keys must be an array");
    }
    const keyInputs = (keys ?? []) as UserKeyInput[];
    const secret = keyInputs.length > 0 ? encryptionSecret(c) : "";
    // Perform all cross-row validation before opening the user transaction;
    // SQLite/MySQL pools cannot service an independent Sutando query while a
    // write transaction is holding their only connection.
    const preparedKeys = body.keys !== undefined
        ? await userKeyService.prepareManyForUser(keyInputs, secret)
        : [];
    const knex = ormService.getKnex();

    // User creation and the initial key set form one aggregate.  Node/MySQL
    // use one transaction so a malformed/duplicate key cannot leave an
    // orphaned user; Worker/D1 executes the same order and performs a
    // compensating delete because the current adapter has no transaction API.
    let insertedUserId: number | null = null;
    const persist = async (trx: any): Promise<number> => {
        const result = await trx("user").insert({
            name,
            type,
            balance: 0,
            status: "active",
        });
        const rawId = Array.isArray(result) ? result[0] : result;
        const userId = Number(rawId);
        if (!Number.isSafeInteger(userId) || userId <= 0) {
            throw new customError.AppError("Failed to create user", 500);
        }
        insertedUserId = userId;
        if (body.keys !== undefined) {
            await userKeyService.insertPreparedKeys(userId, preparedKeys, trx);
        }
        return userId;
    };

    let userId: number;
    try {
        userId = ormService.isWorker ? await persist(knex) : await knex.transaction(persist);
    } catch (error) {
        // On D1 the insert may have committed before key validation failed.
        // Foreign-key cascade removes any keys written before the failure.
        if (ormService.isWorker && insertedUserId !== null) {
            await userManager.deleteById(insertedUserId).catch(() => undefined);
        }
        throw error;
    }

    const created = await userManager.findById(userId);
    if (!created) throw new customError.NotFoundError("User not found");
    return c.json(await toDto(c, created!));
}

async function updateUser(c: Context) {
    const userId = parseId(c.req.param("id"));
    const current = await userManager.findById(userId);
    if (!current) throw new customError.NotFoundError("User not found");
    const body = await parseBody(c);
    if (Object.prototype.hasOwnProperty.call(body, "token")) {
        throw new customError.AppError("token is no longer a user field; update keys instead");
    }
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) {
        if (typeof body.name !== "string" || !body.name.trim()) throw new customError.AppError("name cannot be empty");
        const duplicate = await userManager.findByName(body.name.trim());
        if (duplicate && Number(duplicate.id) !== userId) {
            throw new customError.AppError("User name already exists", 409);
        }
        updateData.name = body.name.trim();
    }
    if (body.status !== undefined) {
        if (body.status !== "active" && body.status !== "disabled") throw new customError.AppError("Invalid status");
        updateData.status = body.status;
    }
    let replacementKeys: UserKeyInput[] | null = null;
    let replacementSecret = "";
    if (body.keys !== undefined) {
        if (!Array.isArray(body.keys)) throw new customError.AppError("keys must be an array");
        replacementKeys = body.keys as UserKeyInput[];
        replacementSecret = replacementKeys.length > 0 ? encryptionSecret(c) : "";
    }

    // Profile and key changes share one transaction on Node/MySQL.  The key
    // service validates the replacement before opening its transaction, then
    // invokes beforeCommit on the same handle so a failed profile update
    // cannot leave a half-replaced key set.  D1 keeps the documented
    // best-effort sequence because its current adapter has no transaction API.
    if (replacementKeys !== null) {
        await userKeyService.replaceForUser(userId, replacementKeys, replacementSecret, {
            beforeCommit: async (trx) => {
                if (Object.keys(updateData).length > 0) {
                    await trx("user").where("id", userId).update(updateData);
                }
            },
        });
    } else if (Object.keys(updateData).length > 0) {
        const knex = ormService.getKnex();
        const persistProfile = async (trx: any): Promise<void> => {
            await trx("user").where("id", userId).update(updateData);
        };
        if (ormService.isWorker) await persistProfile(knex);
        else await knex.transaction(persistProfile);
    }
    const updated = await userManager.findById(userId);
    return c.json(await toDto(c, updated!));
}

async function updateKeys(c: Context) {
    const userId = parseId(c.req.param("id"));
    if (!await userManager.findById(userId)) throw new customError.NotFoundError("User not found");
    const body = await parseBody(c);
    if (!Array.isArray(body.keys)) throw new customError.AppError("keys must be an array");
    const secret = body.keys.length > 0 ? encryptionSecret(c) : "";
    await userKeyService.replaceForUser(userId, body.keys as UserKeyInput[], secret);
    return c.json(await toDto(c, (await userManager.findById(userId))!));
}

async function listKeys(c: Context) {
    const userId = parseId(c.req.param("id"));
    const user = await userManager.findById(userId);
    if (!user) throw new customError.NotFoundError("User not found");

    const keys = await userKeyManager.listByUser(userId);
    const secret = keys.length > 0 ? encryptionSecret(c) : "";
    return c.json(await userKeyService.listForUser(userId, secret));
}

async function createKey(c: Context) {
    const userId = parseId(c.req.param("id"));
    if (!await userManager.findById(userId)) throw new customError.NotFoundError("User not found");

    const body = await parseBody(c);
    const secret = encryptionSecret(c);
    return c.json(await userKeyService.createForUser(userId, body as UserKeyInput, secret));
}

async function getKey(c: Context) {
    const userId = parseId(c.req.param("id"));
    const keyId = parseId(c.req.param("keyId"));
    if (!await userManager.findById(userId)) throw new customError.NotFoundError("User not found");

    const secret = encryptionSecret(c);
    const key = await userKeyService.getForUser(userId, keyId, secret);
    if (!key) throw new customError.NotFoundError("API key not found");
    return c.json(key);
}

async function updateKey(c: Context) {
    const userId = parseId(c.req.param("id"));
    const keyId = parseId(c.req.param("keyId"));
    if (!await userManager.findById(userId)) throw new customError.NotFoundError("User not found");

    const body = await parseBody(c);
    const key = await userKeyService.updateForUser(
        userId,
        keyId,
        body as UserKeyInput,
        encryptionSecret(c),
    );
    if (!key) throw new customError.NotFoundError("API key not found");
    return c.json(key);
}

async function deleteKey(c: Context) {
    const userId = parseId(c.req.param("id"));
    const keyId = parseId(c.req.param("keyId"));
    if (!await userManager.findById(userId)) throw new customError.NotFoundError("User not found");

    const deleted = await userKeyService.deleteForUser(userId, keyId);
    if (!deleted) throw new customError.NotFoundError("API key not found");
    return c.json({ success: true });
}

async function adjustBalance(c: Context) {
    const userId = parseId(c.req.param("id"));
    const body = await parseBody(c);
    if (typeof body.amount !== "number" || !Number.isFinite(body.amount)) {
        throw new customError.AppError("Invalid amount");
    }
    if (body.type !== "recharge" && body.type !== "adjustment") {
        throw new customError.AppError("Invalid type, must be 'recharge' or 'adjustment'");
    }
    const updated = await userService.adjustBalance(
        userId,
        body.amount,
        body.type,
        typeof body.remark === "string" ? body.remark : null,
    );
    return c.json(await toDto(c, updated));
}

export default {
    listUsers,
    getUser,
    getUsersByIds,
    createUser,
    updateUser,
    updateKeys,
    listKeys,
    createKey,
    getKey,
    updateKey,
    deleteKey,
    adjustBalance,
};
