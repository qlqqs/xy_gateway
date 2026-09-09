import { SgUser } from "../model/sgUser";
import { ROOT_USER_ID, UserType, BALANCE_SCALE } from "../constants";
import userManager from "../manager/userManager";
import userKeyManager from "../manager/userKeyManager";
import rechargeRecordManager from "../manager/rechargeRecordManager";
import configService from "./configService";
import customError from "../util/customErrorUtil";

// 元 → 整数微元（DB 余额存整数微元，避免浮点）
function toUnits(yuan: number): number {
    return Math.round(yuan * BALANCE_SCALE);
}

// 恒定时间比较：先 SHA-256 到固定长度（32 字节），再逐字节 XOR-OR，
// 避免字符串 === 在首个差异字节处提前返回导致的时序侧信道。
function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false;
    }
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a[i] ^ b[i];
    }
    return result === 0;
}

async function sha256(input: string): Promise<Uint8Array> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return new Uint8Array(digest);
}

async function isRootToken(token: string, rootToken?: string): Promise<boolean> {
    if (!rootToken) {
        return false;
    }
    const [tokenHash, rootHash] = await Promise.all([sha256(token), sha256(rootToken)]);
    return constantTimeEqualBytes(tokenHash, rootHash);
}

async function getUserByApiKey(apiKey: string, rootToken?: string): Promise<SgUser | null> {
    if (await isRootToken(apiKey, rootToken)) {
        const user = new SgUser();
        user.id = ROOT_USER_ID;
        user.name = "Root";
        user.type = UserType.ROOT;
        user.balance = Number.MAX_SAFE_INTEGER; // Root has unlimited balance
        return user;
    }

    if (!apiKey) return null;
    const digest = await sha256(apiKey);
    const keyHash = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
    const key = await userKeyManager.findByHash(keyHash);
    if (!key) return null;
    return await userManager.findById(Number(key.user_id));
}

async function adjustBalance(
    userId: number,
    amount: number,
    type: string,
    remark: string | null = null,
    operator: string | null = null,
): Promise<SgUser> {
    const user = await userManager.findById(userId);
    if (!user) {
        throw new customError.NotFoundError("User not found");
    }

    // amount 为元，换算成整数微元后做整数加减，避免浮点。
    // 系统允许负余额（复用 deductBalance 的透支语义），故不做「不能扣成负」守卫；
    // 余额的扣减门槛统一由请求发起时的 checkBalance 预检负责。
    const amountUnits = toUnits(amount);
    await userManager.incrementBalance(userId, amountUnits);

    // 余额更新与充值记录写入沿用现有 manager 边界；充值记录写入失败时，
    // 余额可能已经更新，调用方会通过错误日志进行补偿处理。
    // Create recharge record（amount 仍以"元"记录）
    await rechargeRecordManager.create({
        user_id: userId,
        amount: amount,
        type: type,
        remark: remark,
        operator: operator,
    });

    // 返回更新后的用户（incrementBalance 走 query-builder，不回写内存实例，需重新读取）
    return (await userManager.findById(userId))!;
}

async function deductBalance(userId: number, amount: number): Promise<void> {
    // 全局计费开关关闭时不扣费（module_billing_enabled）
    if (!(await configService.isModuleBillingEnabled())) {
        return;
    }
    // 允许余额为负（透支）：请求完成时正常扣减，余额不足的拦截在请求发起前由预检负责
    // 扣费 amount 为元，换算成整数微元做整数减法；余额本就是整数微元，无浮点漂移
    // 原子增量扣减，由数据库执行 balance = balance - delta，避免高并发热路径的丢更新
    const amountUnits = toUnits(amount);
    await userManager.incrementBalance(userId, -amountUnits);
}

async function checkBalance(userId: number, requiredAmount: number): Promise<boolean> {
    const user = await userManager.findById(userId);
    if (!user) {
        return false;
    }

    // `SgUser.balance` is exposed by the model in persisted micro-yuan
    // units (the same representation used by the management API).  Compare
    // like-for-like after converting the requested amount once.
    return Number(user.balance) >= toUnits(requiredAmount);
}

export default {
    isRootToken,
    getUserByApiKey,
    adjustBalance,
    deductBalance,
    checkBalance,
};
