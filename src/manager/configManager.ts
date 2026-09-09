import { SgConfig } from "../model/sgConfig";

async function get(name: string): Promise<SgConfig | null> {
    return await SgConfig.query().where("name", name).first();
}

/**
 * 按 name 更新或插入配置项，返回最终记录。
 */
async function set(name: string, value: string): Promise<SgConfig> {
    const config = await get(name);

    if (config) {
        await config.update({ value });
        return config;
    }

    try {
        return await SgConfig.query().create({ name, value });
    } catch (error) {
        // 两个首次写入可能同时读到空值；唯一索引会让其中一个 INSERT
        // 失败。重新读取后改写赢家行，让两次请求都完成，最终值仍由
        // 数据库中最后一次成功 UPDATE/INSERT 决定。
        const concurrentConfig = await get(name);
        if (!concurrentConfig) {
            throw error;
        }

        await concurrentConfig.update({ value });
        return concurrentConfig;
    }
}

async function getAll(): Promise<SgConfig[]> {
    return (await SgConfig.query().get()).all();
}


/** 删除指定名称的配置项。 */
async function remove(name: string): Promise<boolean> {
    const existing = await SgConfig.query().where("name", name).first();
    if (!existing) {
        return false;
    }

    await SgConfig.query().where("name", name).delete();
    return true;
}

export default {
    get,
    set,
    getAll,
    remove,
};
