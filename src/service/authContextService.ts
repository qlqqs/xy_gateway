import { ApiFormat, UserStatus } from "../constants";
import { SgUser } from "../model/sgUser";
import { SgUserGroup } from "../model/sgUserGroup";
import { SgUserKey } from "../model/sgUserKey";
import userKeyManager from "../manager/userKeyManager";
import userGroupManager from "../manager/userGroupManager";
import userManager from "../manager/userManager";
import userService from "./userService";
import customError from "../util/customErrorUtil";
import userKeyUtil from "../util/userKeyUtil";

export interface AuthContext {
    user: SgUser;
    key: SgUserKey | null;
    group: SgUserGroup | null;
}

export interface LlmRequestContext extends AuthContext {
    clientFormat: ApiFormat;
    modelName: string;
    requestBody: string;
    clientIp: string | null;
}

async function resolve(token: string, rootToken?: string): Promise<AuthContext | null> {
    if (!token) return null;
    if (await userService.isRootToken(token, rootToken)) {
        return { user: userService.buildRootUser(), key: null, group: null };
    }

    const keyHash = await userKeyUtil.hashKey(token);
    const key = await userKeyManager.findByHash(keyHash);
    if (!key || key.status !== "active") return null;
    if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) return null;
    const user = await userManager.findById(Number(key.user_id));
    if (!user) return null;
    const group = key.group_id == null ? null : await userGroupManager.findById(Number(key.group_id));
    // A valid FK normally turns a deleted group into NULL.  Treat any stale
    // reference as an authentication miss instead of silently widening the
    // key to the ungrouped vendor pool.
    if (key.group_id != null && !group) return null;
    // Do not make authentication fail solely because the audit timestamp cannot
    // be written.
    await userKeyManager.markUsed(Number(key.id)).catch(() => undefined);
    return { user, key, group };
}

async function requireLlm(
    token: string,
    rootToken: string | undefined,
    format: ApiFormat,
    modelName: string,
    requestBody: string,
    clientIp: string | null,
): Promise<LlmRequestContext> {
    const context = await resolve(token, rootToken);
    if (!context) {
        throw new customError.AppError("Invalid API key", 401, "authentication_error");
    }
    if (context.user.status !== UserStatus.ACTIVE) {
        throw new customError.AppError("User disabled", 403, "authentication_error");
    }
    return { ...context, clientFormat: format, modelName, requestBody, clientIp };
}

export default { resolve, requireLlm };
