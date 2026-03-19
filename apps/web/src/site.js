const modeLabels = {
    demo: 'Demo mode',
    development: 'Development mode',
    production: 'Production mode',
};
const modeDescriptions = {
    demo: 'Safe for demos: seeded data, local services, and dev-session controls for role switching.',
    development: 'Local development with real Keycloak sign-in and the full API surface wired in.',
    production: 'Production-style branding and auth wiring with no local bypass shortcuts.',
};
function normalizeMode(value) {
    if (value === 'demo' || value === 'production') {
        return value;
    }
    return 'development';
}
function normalizeApiBaseUrl(value) {
    if (!value) {
        return '/api';
    }
    return value.endsWith('/') ? value.slice(0, -1) : value;
}
export const siteMode = normalizeMode(import.meta.env.VITE_PLATFORM_MODE);
export const siteModeConfig = {
    mode: siteMode,
    label: modeLabels[siteMode],
    description: modeDescriptions[siteMode],
    apiBaseUrl: normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL),
};
export function apiUrl(path) {
    if (/^https?:\/\//.test(path)) {
        return path;
    }
    const normalizedPath = path.startsWith('/api')
        ? path.slice('/api'.length) || '/'
        : path.startsWith('/')
            ? path
            : `/${path}`;
    return `${siteModeConfig.apiBaseUrl}${normalizedPath}`;
}
