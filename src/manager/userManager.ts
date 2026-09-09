import { SgUser } from "../model/sgUser";
import { UserStatus, UserType } from "../constants";

interface UserListOptions {
    type?: string;
    keyword?: string;
    pageSize: number;
    offset: number;
}

async function findById(userId: number): Promise<SgUser | null> {
    return await SgUser.query().find(userId);
}

async function findByName(name: string): Promise<SgUser | null> {
    if (!name) return null;
    return await SgUser.query().whereRaw("LOWER(name) = LOWER(?)", [name]).first();
}


/**
 * 返回可承载 Admin API 请求上下文的第一个真实管理员。
 *
 * 机器凭证不能构造虚拟用户，且管理员选择必须稳定：先过滤 active
 * 状态，再按数据库 ID 升序取第一条。
 */
async function findFirstActiveAdmin(): Promise<SgUser | null> {
    return await SgUser.query()
        .where("type", UserType.ADMIN)
        .where("status", UserStatus.ACTIVE)
        .orderBy("id", "asc")
        .first();
}

async function getByIds(ids: number[]): Promise<SgUser[]> {
    if (ids.length === 0) {
        return [];
    }
    return (await SgUser.query().whereIn("id", ids).get()).all();
}

async function list(options: UserListOptions) {
    const dbQuery = SgUser.query().orderBy("id", "desc");

    if (options.type) {
        dbQuery.where("type", options.type);
    }

    if (options.keyword) {
        dbQuery.where("name", "like", `%${options.keyword}%`);
    }

    const total = Number(await dbQuery.clone().count() || 0);
    const users = await dbQuery.limit(options.pageSize).offset(options.offset).get();
    return {
        list: users.all(),
        total,
    };
}

async function create(data: Pick<SgUser, "name" | "type">) {
    return await SgUser.query().create({
        ...data,
        balance: 0,                    // 新用户余额固定 0，由 manager 兜底
        status: UserStatus.ACTIVE,     // 新用户状态固定 ACTIVE，由 manager 兜底
    });
}

async function update(userId: number, data: Record<string, unknown>): Promise<SgUser | null> {
    await SgUser.query().where("id", userId).update(data);
    return await SgUser.query().find(userId);
}

// 原子增量更新：由数据库执行 balance = balance + delta，避免「先读后写」的并发丢更新
async function incrementBalance(userId: number, delta: number): Promise<void> {
    await SgUser.query().where("id", userId).increment("balance", delta);
}

async function count(): Promise<number> {
    return Number(await SgUser.query().count() || 0);
}

async function deleteById(userId: number): Promise<boolean> {
    const user = await findById(userId);
    if (!user) return false;
    await SgUser.query().where("id", userId).delete();
    return true;
}

export default {
    findById,
    findByName,
    findFirstActiveAdmin,
    getByIds,
    list,
    create,
    update,
    incrementBalance,
    count,
    deleteById,
};
