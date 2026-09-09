import { Context } from "hono";
import configService from "../service/configService";
import userManager from "../manager/userManager";
import vendorManager from "../manager/vendorManager";
import modelManager from "../manager/modelManager";
import recordManager from "../manager/recordManager";
import hostService from "../service/hostService";
import versionUtil from "../util/versionUtil";
import { APP_DISPLAY_NAME, ConfigKey } from "../constants";

// 当前实例的启动时间，延迟到首次状态请求时初始化。
let INSTANCE_START_TIME: Date | null = null;

function getEnvironmentName(): string {
    if (globalThis.process?.argv?.includes("--desktop-mode")) return "Desktop App";
    return "Node";
}


function getInstanceStartTime(): Date {
    if (!INSTANCE_START_TIME) {
        INSTANCE_START_TIME = new Date();
    }
    return INSTANCE_START_TIME;
}


function getApiAddress(c: Context): string {
    const hostname = hostService.getLocalHost();
    const port = hostService.getLocalPort();
    return `http://${hostname}:${port}`;
}


function formatUptime(startTime: Date): string {
    const now = new Date();
    const diff = now.getTime() - startTime.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}天 ${hours % 24}小时 ${minutes % 60}分钟 ${seconds % 60}秒`;
    } else if (hours > 0) {
        return `${hours}小时 ${minutes % 60}分钟 ${seconds % 60}秒`;
    } else if (minutes > 0) {
        return `${minutes}分钟 ${seconds % 60}秒`;
    } else {
        return `${seconds}秒`;
    }
}


/**
 * 当前进程 RSS 内存占用（MB，保留 1 位小数）。
 */
function getMemoryUsage(): string | null {
    const usage = globalThis.process?.memoryUsage?.();
    if (!usage) {
        return null;
    }
    return `${(usage.rss / 1024 / 1024).toFixed(1)} MB`;
}


function welcome(c: Context) {
    const message = `Hello, welcome to ${APP_DISPLAY_NAME} (node mode)!`;
    return c.text(message);
}

async function status(c: Context) {
    try {
        const userCount = await userManager.count();
        const vendorCount = await vendorManager.count();
        const modelCount = await modelManager.count();
        const recordCount = await recordManager.count();

        const startTime = getInstanceStartTime();

        const moduleBilling = (await configService.getConfig(ConfigKey.MODULE_BILLING_ENABLED)).getBoolean();
        const moduleApiPlayground = (await configService.getConfig(ConfigKey.MODULE_API_PLAYGROUND_ENABLED)).getBoolean();
        const moduleClientConfig = (await configService.getConfig(ConfigKey.MODULE_CLIENT_CONFIG_ENABLED)).getBoolean();

        return c.json({
            status: "ok",
            user_type: c.get("user_type"),
            statistics: {
                users: userCount,
                vendors: vendorCount,
                models: modelCount,
                records: recordCount,
            },
            system: {
                environment: getEnvironmentName(),
                version: versionUtil.getVersion(c.env),
                apiAddress: getApiAddress(c),
                startTime: startTime.toISOString(),
                uptime: formatUptime(startTime),
                memory: getMemoryUsage(),
            },
            modules: {
                billing: moduleBilling,
                api_playground: moduleApiPlayground,
                client_config: moduleClientConfig,
            },
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        return c.json(
            {
                status: "error",
                message: "Failed to get system status",
                error: String(error),
            },
            500,
        );
    }
}

import updateService from "../service/updateService";

async function checkUpdate(c: Context) {
    const force = c.req.query('force') === '1' || c.req.query('force') === 'true';
    const status = await updateService.checkUpdate(c as any, force);
    return c.json(status);
}

export default {
    welcome,
    status,
    checkUpdate,
};
