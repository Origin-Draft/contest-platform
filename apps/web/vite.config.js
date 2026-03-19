import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
function getProxyTarget(apiBaseUrl) {
    try {
        return new URL(apiBaseUrl).origin;
    }
    catch {
        return undefined;
    }
}
export default defineConfig(({ mode }) => {
    const envDir = path.resolve(__dirname, '../..');
    const env = loadEnv(mode, envDir, '');
    const webPort = Number(env.WEB_PORT ?? 5173);
    const apiBaseUrl = env.VITE_API_BASE_URL ?? 'http://localhost:4000/api';
    const proxyTarget = getProxyTarget(apiBaseUrl);
    return {
        envDir,
        plugins: [react()],
        server: {
            host: '0.0.0.0',
            port: webPort,
            proxy: proxyTarget
                ? {
                    '/api': {
                        target: proxyTarget,
                        changeOrigin: true,
                    },
                }
                : undefined,
        },
        preview: {
            host: '0.0.0.0',
            port: webPort,
        },
    };
});
