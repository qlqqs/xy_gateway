/**
 * fetch 工具 — 封装 undici Agent 用于 TLS 证书绕过和代理。
 *
 * 背景：Node.js 全局 fetch（底层 undici）默认验证 TLS 证书。
 * 内网自签证书环境下，fetch 会抛出 self-signed certificate in certificate chain。
 * 通过 undici Agent 的 connect.rejectUnauthorized = false 可跳过验证。
 *
 * 同时支持 HTTP/HTTPS 代理和 SOCKS5 代理。
 * 未配置特殊选项时返回 undefined，由调用方使用 Node.js 默认 fetch 行为。
 */


import type { Dispatcher } from "undici";


export interface DispatcherConfig {
    skip_tls_verify?: boolean;
    proxy?: {
        type: "http" | "socks5";
        url: string;
    } | null;
}


// 缓存已创建的 dispatcher 实例，避免重复创建
let cachedDispatcher: Dispatcher | undefined = undefined;
let cachedConfigKey = "";

function buildConfigKey(config?: DispatcherConfig): string {
    if (!config) return "";
    const skipTls = config.skip_tls_verify === true;
    const proxy = config.proxy;
    const proxyType = proxy?.type ?? "";
    const proxyUrl = proxy?.url ?? "";
    if (!skipTls && !proxyUrl) return "";
    return `${skipTls}|${proxyType || "none"}|${proxyUrl}`;
}


/**
 * 根据 vendor config 返回对应的 undici dispatcher。
 *
 * 仅在需要特殊 TLS 或代理配置时动态加载相关模块，避免普通请求初始化
 * 不需要的连接器。
 *
 * @param config - vendor config 对象（含 skip_tls_verify 和 proxy）
 * @returns 对应的 dispatcher；无特殊配置时返回 undefined（走默认行为）
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getDispatcher(config?: DispatcherConfig): Promise<Dispatcher | undefined> {
    const key = buildConfigKey(config);
    if (key === "") return undefined;

    // 命中缓存
    if (cachedDispatcher && cachedConfigKey === key) {
        return cachedDispatcher;
    }

    const { Agent, ProxyAgent } = await import("undici");

    const skipTls = config?.skip_tls_verify ?? false;
    const proxyType = config?.proxy?.type ?? "";
    const proxyUrl = config?.proxy?.url ?? "";

    // 有 HTTP 代理 → ProxyAgent（同时处理 TLS）
    if (proxyType === "http" && proxyUrl) {
        cachedDispatcher = new ProxyAgent({
            uri: proxyUrl,
            requestTls: { rejectUnauthorized: !skipTls },
        });
        cachedConfigKey = key;
        return cachedDispatcher;
    }

    // 有 SOCKS5 代理 → socks + 自定义 connector
    if (proxyType === "socks5" && proxyUrl) {
        const { SocksClient } = await import("socks");
        const nodeTls = await import("node:tls");
        const parsed = new URL(proxyUrl);

        cachedDispatcher = new Agent({
            connect: async (opts: any, callback: any) => {
                try {
                    const isHttps = opts.protocol === "https:";
                    const defaultPort = isHttps ? 443 : 80;
                    const { socket } = await SocksClient.createConnection({
                        proxy: {
                            host: parsed.hostname,
                            port: parseInt(parsed.port, 10) || 1080,
                            type: 5,
                            userId: decodedUsername(parsed),
                            password: decodedPassword(parsed),
                        },
                        command: "connect",
                        destination: {
                            host: opts.hostname ?? opts.host,
                            port: Number(opts.port) || defaultPort,
                        },
                    });

                    if (isHttps) {
                        // HTTPS 目标：在 SOCKS5 隧道上做 TLS 握手
                        const tlsSocket = nodeTls.connect({
                            socket,
                            servername: opts.hostname ?? opts.host,
                            rejectUnauthorized: !skipTls,
                        });
                        callback(null, tlsSocket);
                    } else {
                        // HTTP 目标：直接返回明文 socket
                        callback(null, socket);
                    }
                } catch (err: any) {
                    callback(err);
                }
            },
        });
        cachedConfigKey = key;
        return cachedDispatcher;
    }

    // 仅 TLS 跳过，无代理
    if (skipTls) {
        cachedDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
        cachedConfigKey = key;
        return cachedDispatcher;
    }

    return undefined;
}


function decodedUsername(url: URL): string | undefined {
    return url.username ? decodeURIComponent(url.username) : undefined;
}

function decodedPassword(url: URL): string | undefined {
    return url.password ? decodeURIComponent(url.password) : undefined;
}


export default {
    getDispatcher,
};
