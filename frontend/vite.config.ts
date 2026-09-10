import { defineConfig, type ViteDevServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { cpSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Components from 'unplugin-vue-components/vite'
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers'

function normalizeSecurityEntrance(value: string | undefined): string {
    const raw = value?.trim() ?? ''
    if (!raw) return ''

    const withoutSlashes = raw.replace(/^\/+|\/+$/g, '')
    if (!withoutSlashes || withoutSlashes.includes('?') || withoutSlashes.includes('#')) {
        return ''
    }

    return `/${withoutSlashes}`
}

function hasAuthCookie(cookieHeader: string | undefined): boolean {
    return cookieHeader?.split(';').some((item) => {
        const value = item.trim()
        return value.startsWith('adminToken=') && value.length > 'adminToken='.length
    }) ?? false
}

function readRootDevVars(frontendRoot: string): Record<string, string> {
    const varsPath = resolve(frontendRoot, '../.dev.vars')
    try {
        return Object.fromEntries(
            readFileSync(varsPath, 'utf-8')
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith('#') && line.includes('='))
                .map((line) => {
                    const separator = line.indexOf('=')
                    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
                }),
        )
    } catch {
        return {}
    }
}

function secureLoginEntryPlugin() {
    return {
        name: 'secure-login-entry',
        // 安全入口是开发服务器的访问门禁，不参与生产构建，也不会被打包进前端代码。
        apply: 'serve' as const,
        configureServer(server: ViteDevServer) {
            const frontendRoot = fileURLToPath(new URL('.', import.meta.url))
            const rootEnv = readRootDevVars(frontendRoot)
            const configuredEntrance = Object.prototype.hasOwnProperty.call(
                process.env,
                'SECURE_LOGIN_ENTRY',
            )
                ? process.env.SECURE_LOGIN_ENTRY
                : rootEnv.SECURE_LOGIN_ENTRY
            const entrance = normalizeSecurityEntrance(configuredEntrance)
            if (!entrance) return

            server.middlewares.use((req, res, next) => {
                const pathname = new URL(req.url || '/', 'http://localhost').pathname
                // Vite 的 HMR 使用根路径 WebSocket，不应被 HTTP 路径门禁拦截。
                if (req.headers.upgrade?.toLowerCase() === 'websocket') {
                    next()
                    return
                }

                const isAuthenticated = hasAuthCookie(req.headers.cookie)
                if (isAuthenticated && (pathname === entrance || pathname === `${entrance}/`)) {
                    res.statusCode = 302
                    res.setHeader('Location', '/')
                    res.end()
                    return
                }

                const isAllowedPath = isAuthenticated
                    || pathname === entrance || pathname === `${entrance}/`
                    || pathname.startsWith('/@')
                    || pathname.startsWith('/src/')
                    || pathname.startsWith('/node_modules/')
                    || pathname.startsWith('/assets/')
                    || pathname.startsWith('/data_viewer/')
                    || pathname.startsWith('/__vite')
                    || pathname === '/favicon.svg'
                    || pathname === '/splash.html'
                    || pathname.startsWith('/api')
                    || pathname.startsWith('/v1')

                if (isAllowedPath) {
                    next()
                    return
                }

                res.statusCode = 404
                res.setHeader('Content-Type', 'text/plain; charset=utf-8')
                res.end('404 Not Found')
            })
        },
    }
}

function dataViewerDistOnlyPlugin() {
    return {
        name: 'data-viewer-dist-only',
        closeBundle() {
            const frontendRoot = fileURLToPath(new URL('.', import.meta.url))
            const outputDataViewerDir = resolve(frontendRoot, 'dist/data_viewer')
            const sourceDataViewerDist = resolve(frontendRoot, 'public/data_viewer/dist')
            const outputDataViewerDist = resolve(outputDataViewerDir, 'dist')

            rmSync(outputDataViewerDir, { recursive: true, force: true })

            if (existsSync(sourceDataViewerDist)) {
                cpSync(sourceDataViewerDist, outputDataViewerDist, { recursive: true })
            }
        },
    }
}

function frontendVersionPlugin() {
    const virtualModuleId = 'virtual:frontend-version'
    const resolvedVirtualModuleId = '\0' + virtualModuleId

    return {
        name: 'frontend-version',
        resolveId(id: string) {
            if (id === virtualModuleId) {
                return resolvedVirtualModuleId
            }
        },
        load(id: string) {
            if (id !== resolvedVirtualModuleId) {
                return
            }

            const frontendRoot = fileURLToPath(new URL('.', import.meta.url))
            const packageJson = JSON.parse(readFileSync(resolve(frontendRoot, 'package.json'), 'utf-8'))
            return `export default ${JSON.stringify(packageJson.version)}`
        },
    }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
    plugins: [
        // 去掉 HTML 中的 crossorigin 属性（Tauri v2 自定义协议兼容）
        {
            name: 'remove-crossorigin',
            closeBundle() {
                const distDir = fileURLToPath(new URL('./dist', import.meta.url));
                for (const file of ['index.html', 'splash.html']) {
                    const path = resolve(distDir, file);
                    try {
                        const html = readFileSync(path, 'utf-8');
                        writeFileSync(path, html.replace(/ crossorigin/g, ''), 'utf-8');
                    } catch (e) {
                        console.warn('remove-crossorigin:', e instanceof Error ? e.message : e);
                    }
                }
            },
        },
        vue(),
        Components({
            resolvers: [
                AntDesignVueResolver({
                    importStyle: false, // Ant Design Vue 4.x uses CSS-in-JS
                }),
            ],
        }),
        dataViewerDistOnlyPlugin(),
        frontendVersionPlugin(),
        ...(command === 'serve' ? [secureLoginEntryPlugin()] : []),
    ],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    server: {
        port: 8721,
        strictPort: true, // 如果 8721 被占用，直接报错退出，不再尝试下一个端口
        host: '0.0.0.0',
        allowedHosts: true,
        proxy: {
            '/api/v1/admin': {
                target: 'http://127.0.0.1:8720',
                changeOrigin: true,
            },
            '/api': {
                target: 'http://127.0.0.1:8720',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ''),
            },
            '/v1': {
                target: 'http://127.0.0.1:8720',
                changeOrigin: true,
            },
        },
    },
    build: {
        rollupOptions: {
            input: {
                main: fileURLToPath(new URL('./index.html', import.meta.url)),
                splash: fileURLToPath(new URL('./splash.html', import.meta.url)),
            },
        },
        // Tauri v2 自定义协议下需要去掉 crossorigin
        modulePreload: false,
    },
}))
