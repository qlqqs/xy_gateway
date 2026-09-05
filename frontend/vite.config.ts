import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { cpSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Components from 'unplugin-vue-components/vite'
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers'

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

// https://vite.dev/config/
export default defineConfig({
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
            '/api': {
                target: 'http://127.0.0.1:8720',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ''),
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
})
