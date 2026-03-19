import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiUrl } from './site';
const devStorageKey = 'contest-platform-dev-session';
const authStorageKey = 'contest-platform-auth-session';
const pkceStorageKey = 'contest-platform-auth-pkce';
const callbackPath = '/auth/callback';
const refreshLeewayMs = 60_000;
const AuthContext = createContext(null);
function defaultDevSession() {
    return {
        enabled: false,
        displayName: 'Dev Organizer',
        email: 'dev@origin-draft.test',
        roles: ['organizer'],
    };
}
function readStorage(storage, key) {
    try {
        return storage?.getItem(key) ?? null;
    }
    catch {
        return null;
    }
}
function writeStorage(storage, key, value) {
    try {
        storage?.setItem(key, value);
    }
    catch {
        // ignore storage failures and keep the session in memory only
    }
}
function removeStorage(storage, key) {
    try {
        storage?.removeItem(key);
    }
    catch {
        // ignore storage failures
    }
}
export function readDevSession() {
    const raw = readStorage(globalThis.localStorage, devStorageKey);
    if (!raw) {
        return defaultDevSession();
    }
    try {
        return JSON.parse(raw);
    }
    catch {
        return defaultDevSession();
    }
}
export function writeDevSession(session) {
    writeStorage(globalThis.localStorage, devStorageKey, JSON.stringify(session));
}
export function clearDevSession() {
    removeStorage(globalThis.localStorage, devStorageKey);
}
function readStoredAuthSession() {
    const raw = readStorage(globalThis.localStorage, authStorageKey);
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function writeStoredAuthSession(session) {
    writeStorage(globalThis.localStorage, authStorageKey, JSON.stringify(session));
}
function clearStoredAuthSession() {
    removeStorage(globalThis.localStorage, authStorageKey);
}
function writePkceSession(session) {
    writeStorage(globalThis.sessionStorage, pkceStorageKey, JSON.stringify(session));
}
function readPkceSession() {
    const raw = readStorage(globalThis.sessionStorage, pkceStorageKey);
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function clearPkceSession() {
    removeStorage(globalThis.sessionStorage, pkceStorageKey);
}
function toBase64Url(input) {
    const encoded = globalThis.btoa(String.fromCharCode(...input));
    return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function createRandomString(byteLength = 32) {
    const bytes = new Uint8Array(byteLength);
    globalThis.crypto.getRandomValues(bytes);
    return toBase64Url(bytes);
}
async function createCodeChallenge(verifier) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return toBase64Url(new Uint8Array(digest));
}
function buildTokenEndpoint(config) {
    if (config.authProvider === 'supabase') {
        return `${config.supabaseUrl}/auth/v1/token`;
    }
    return `${config.keycloakIssuerUrl}/protocol/openid-connect/token`;
}
function buildLogoutEndpoint(config) {
    if (config.authProvider === 'supabase') {
        return `${config.supabaseUrl}/auth/v1/logout`;
    }
    return `${config.keycloakIssuerUrl}/protocol/openid-connect/logout`;
}
async function fetchJson(input, init) {
    const response = await fetch(input, init);
    const data = (await response.json());
    if (!response.ok) {
        const message = typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string'
            ? data.message
            : typeof data === 'object' && data !== null && 'error_description' in data && typeof data.error_description === 'string'
                ? data.error_description
                : `Request failed with ${response.status}`;
        throw new Error(message);
    }
    return data;
}
async function fetchSessionConfig() {
    return fetchJson(apiUrl('/api/session/config'));
}
async function fetchSessionUser(devSession, accessToken) {
    return fetchJson(apiUrl('/api/session/me'), {
        headers: buildAuthHeaders(devSession, accessToken),
    });
}
function isExpired(session, leewayMs = 0) {
    return Date.now() >= session.expiresAt - leewayMs;
}
function normalizeTokenResponse(response, fallbackRefreshToken) {
    return {
        accessToken: response.access_token,
        refreshToken: response.refresh_token ?? fallbackRefreshToken ?? null,
        idToken: response.id_token ?? null,
        tokenType: response.token_type ?? 'Bearer',
        scope: response.scope ?? 'openid profile email offline_access',
        expiresAt: Date.now() + response.expires_in * 1000,
    };
}
async function exchangeToken(config, parameters, fallbackRefreshToken) {
    const tokenUrl = buildTokenEndpoint(config);
    const url = config.authProvider === 'supabase'
        ? `${tokenUrl}?grant_type=${parameters.get('grant_type')}`
        : tokenUrl;
    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (config.authProvider === 'supabase') {
        headers['apikey'] = config.supabaseAnonKey;
    }
    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: parameters.toString(),
    });
    const data = (await response.json());
    if (!response.ok) {
        const message = typeof data === 'object' && data !== null && 'error_description' in data && typeof data.error_description === 'string'
            ? data.error_description
            : `Token exchange failed with ${response.status}`;
        throw new Error(message);
    }
    const session = normalizeTokenResponse(data, fallbackRefreshToken);
    writeStoredAuthSession(session);
    return session;
}
async function supabasePasswordAuth(config, email, password) {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': config.supabaseAnonKey,
        },
        body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (!response.ok) {
        const message = data.error_description ?? data.msg ?? `Sign-in failed with ${response.status}`;
        throw new Error(message);
    }
    const session = normalizeTokenResponse(data);
    writeStoredAuthSession(session);
    return session;
}
async function supabaseSignUp(config, email, password) {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/signup`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': config.supabaseAnonKey,
        },
        body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (!response.ok) {
        const message = typeof data.msg === 'string' ? data.msg
            : typeof data.error_description === 'string' ? data.error_description
                : `Sign-up failed with ${response.status}`;
        throw new Error(message);
    }
}
async function beginLogin(config, returnTo) {
    const state = createRandomString(24);
    const verifier = createRandomString(48);
    const challenge = await createCodeChallenge(verifier);
    writePkceSession({ state, verifier, returnTo });
    if (config.authProvider === 'supabase') {
        const authorizeUrl = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
        authorizeUrl.searchParams.set('redirect_to', config.redirectUri);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('code_challenge', challenge);
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');
        authorizeUrl.searchParams.set('state', state);
        globalThis.location.assign(authorizeUrl.toString());
        return;
    }
    const authorizeUrl = new URL(`${config.keycloakIssuerUrl}/protocol/openid-connect/auth`);
    authorizeUrl.searchParams.set('client_id', config.keycloakClientId);
    authorizeUrl.searchParams.set('redirect_uri', config.keycloakRedirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', config.keycloakScopes);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    globalThis.location.assign(authorizeUrl.toString());
}
async function completeLogin(config, search) {
    const params = new URLSearchParams(search);
    const error = params.get('error');
    if (error) {
        throw new Error(params.get('error_description') ?? error);
    }
    const code = params.get('code');
    const state = params.get('state');
    const pkceSession = readPkceSession();
    if (!code || !state || !pkceSession) {
        throw new Error('Missing OIDC callback state. Please sign in again.');
    }
    if (pkceSession.state !== state) {
        clearPkceSession();
        throw new Error('OIDC state validation failed. Please sign in again.');
    }
    let body;
    if (config.authProvider === 'supabase') {
        body = new URLSearchParams({
            grant_type: 'pkce',
            auth_code: code,
            code_verifier: pkceSession.verifier,
        });
    }
    else {
        body = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: config.keycloakClientId,
            code,
            code_verifier: pkceSession.verifier,
            redirect_uri: config.keycloakRedirectUri,
        });
    }
    const session = await exchangeToken(config, body);
    clearPkceSession();
    return {
        session,
        returnTo: pkceSession.returnTo || '/',
    };
}
async function refreshSession(config, session) {
    if (!session.refreshToken) {
        clearStoredAuthSession();
        return null;
    }
    try {
        const body = config.authProvider === 'supabase'
            ? new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: session.refreshToken,
            })
            : new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: config.keycloakClientId,
                refresh_token: session.refreshToken,
            });
        return await exchangeToken(config, body, session.refreshToken);
    }
    catch {
        clearStoredAuthSession();
        return null;
    }
}
function buildLogoutUrl(config, session) {
    if (config.authProvider === 'supabase') {
        // Supabase logout is a POST with access token; handled separately
        return null;
    }
    const logoutUrl = new URL(buildLogoutEndpoint(config));
    logoutUrl.searchParams.set('client_id', config.keycloakClientId);
    logoutUrl.searchParams.set('post_logout_redirect_uri', config.keycloakPostLogoutRedirectUri);
    if (session?.idToken) {
        logoutUrl.searchParams.set('id_token_hint', session.idToken);
    }
    return logoutUrl.toString();
}
async function supabaseLogout(config, accessToken) {
    if (!accessToken)
        return;
    try {
        await fetch(buildLogoutEndpoint(config), {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'apikey': config.supabaseAnonKey,
            },
        });
    }
    catch {
        // Best-effort logout — token will expire on its own
    }
}
export function buildAuthHeaders(devSession, accessToken) {
    if (accessToken) {
        return {
            Authorization: `Bearer ${accessToken}`,
        };
    }
    if (!devSession?.enabled || devSession.roles.length === 0) {
        return {};
    }
    return {
        'x-dev-user': devSession.displayName,
        'x-dev-email': devSession.email,
        'x-dev-roles': devSession.roles.join(','),
    };
}
export function AuthProvider({ children }) {
    const location = useLocation();
    const navigate = useNavigate();
    const handledCallbackRef = useRef(null);
    const [config, setConfig] = useState(null);
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [devSession, setDevSession] = useState(() => readDevSession());
    const [accessToken, setAccessToken] = useState(null);
    const loadAuth = useCallback(async (nextDevSession) => {
        setIsLoading(true);
        setError(null);
        try {
            const nextConfig = await fetchSessionConfig();
            setConfig(nextConfig);
            if (nextConfig.devBypassEnabled) {
                const me = nextDevSession.enabled
                    ? await fetchSessionUser(nextDevSession, null)
                    : { user: null };
                setAccessToken(null);
                setUser(me.user);
                setIsLoading(false);
                return;
            }
            let session = readStoredAuthSession();
            let returnTo = null;
            if (location.pathname === callbackPath) {
                const callbackSignature = `${location.pathname}${location.search}`;
                if (handledCallbackRef.current !== callbackSignature) {
                    handledCallbackRef.current = callbackSignature;
                    const callbackResult = await completeLogin(nextConfig, location.search);
                    session = callbackResult.session;
                    returnTo = callbackResult.returnTo;
                }
                else {
                    session = readStoredAuthSession();
                }
            }
            else if (session && isExpired(session, refreshLeewayMs)) {
                handledCallbackRef.current = null;
                session = await refreshSession(nextConfig, session);
            }
            else {
                handledCallbackRef.current = null;
            }
            if (session && isExpired(session)) {
                clearStoredAuthSession();
                session = null;
            }
            const me = session ? await fetchSessionUser(nextDevSession, session.accessToken) : { user: null };
            if (session && !me.user) {
                clearStoredAuthSession();
            }
            setAccessToken(me.user && session ? session.accessToken : null);
            setUser(me.user);
            setIsLoading(false);
            if (returnTo) {
                navigate(returnTo, { replace: true });
            }
        }
        catch (loadError) {
            clearPkceSession();
            clearStoredAuthSession();
            setAccessToken(null);
            setUser(null);
            setError(loadError instanceof Error ? loadError.message : 'Unknown auth error');
            setIsLoading(false);
        }
    }, [location.pathname, location.search, navigate]);
    useEffect(() => {
        void loadAuth(devSession);
    }, [devSession, loadAuth]);
    const reload = useCallback(async () => {
        await loadAuth(devSession);
    }, [devSession, loadAuth]);
    const updateDevSession = useCallback((nextSession) => {
        writeDevSession(nextSession);
        setDevSession(nextSession);
    }, []);
    const signOutDevSession = useCallback(() => {
        clearDevSession();
        setDevSession(readDevSession());
        setUser(null);
        setAccessToken(null);
    }, []);
    const signIn = useCallback(async () => {
        if (!config || config.devBypassEnabled) {
            return;
        }
        if (config.authProvider === 'supabase') {
            const returnTo = `${location.pathname}${location.search}${location.hash}`;
            navigate(`/login?returnTo=${encodeURIComponent(returnTo || '/')}`, { replace: true });
            return;
        }
        const returnTo = `${location.pathname}${location.search}${location.hash}`;
        await beginLogin(config, returnTo || '/');
    }, [config, location.hash, location.pathname, location.search, navigate]);
    const signInWithEmail = useCallback(async (email, password) => {
        if (!config || config.authProvider !== 'supabase')
            return;
        setIsLoading(true);
        setError(null);
        try {
            const session = await supabasePasswordAuth(config, email, password);
            const me = await fetchSessionUser(devSession, session.accessToken);
            setAccessToken(session.accessToken);
            setUser(me.user);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Sign-in failed');
            throw err;
        }
        finally {
            setIsLoading(false);
        }
    }, [config, devSession]);
    const signUpWithEmail = useCallback(async (email, password) => {
        if (!config || config.authProvider !== 'supabase')
            return;
        setIsLoading(true);
        setError(null);
        try {
            await supabaseSignUp(config, email, password);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Sign-up failed');
            throw err;
        }
        finally {
            setIsLoading(false);
        }
    }, [config]);
    const signOut = useCallback(async () => {
        if (!config) {
            return;
        }
        if (config.devBypassEnabled) {
            signOutDevSession();
            return;
        }
        const session = readStoredAuthSession();
        const currentAccessToken = session?.accessToken ?? null;
        clearStoredAuthSession();
        setAccessToken(null);
        setUser(null);
        const logoutUrl = buildLogoutUrl(config, session);
        if (logoutUrl) {
            globalThis.location.assign(logoutUrl);
        }
        else if (config.authProvider === 'supabase') {
            await supabaseLogout(config, currentAccessToken);
            globalThis.location.assign(config.postLogoutRedirectUri);
        }
    }, [config, signOutDevSession]);
    const value = useMemo(() => ({
        config,
        user,
        isLoading,
        error,
        devSession,
        accessToken,
        reload,
        updateDevSession,
        signOutDevSession,
        signIn,
        signInWithEmail,
        signUpWithEmail,
        signOut,
    }), [accessToken, config, devSession, error, isLoading, reload, signIn, signInWithEmail, signUpWithEmail, signOut, signOutDevSession, updateDevSession, user]);
    return createElement(AuthContext.Provider, { value }, children);
}
export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used inside AuthProvider.');
    }
    return context;
}
