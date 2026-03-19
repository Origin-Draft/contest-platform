import type { ReactNode } from 'react';
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ContestRole } from '@origin-draft/shared';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiUrl } from './site';

export interface KeycloakSessionConfig {
  authProvider: 'keycloak';
  mode: 'development-bypass' | 'keycloak';
  devBypassEnabled: boolean;
  keycloakIssuerUrl: string;
  keycloakClientId: string;
  keycloakRedirectUri: string;
  keycloakPostLogoutRedirectUri: string;
  keycloakScopes: string;
}

export interface SupabaseSessionConfig {
  authProvider: 'supabase';
  mode: 'development-bypass' | 'supabase';
  devBypassEnabled: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
}

export type SessionConfig = KeycloakSessionConfig | SupabaseSessionConfig;

export interface SessionUser {
  id: string;
  displayName: string;
  email: string | null;
  roles: ContestRole[] | string[];
  authSource: 'keycloak' | 'supabase' | 'dev-bypass';
}

export interface SessionResponse {
  user: SessionUser | null;
}

export interface DevSessionState {
  enabled: boolean;
  displayName: string;
  email: string;
  roles: string[];
}

interface StoredAuthSession {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  tokenType: string;
  scope: string;
  expiresAt: number;
}

interface PkceSession {
  state: string;
  verifier: string;
  returnTo: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  scope?: string;
  expires_in: number;
}

export interface AuthContextValue {
  config: SessionConfig | null;
  user: SessionUser | null;
  isLoading: boolean;
  error: string | null;
  devSession: DevSessionState;
  accessToken: string | null;
  reload: () => Promise<void>;
  updateDevSession: (session: DevSessionState) => void;
  signOutDevSession: () => void;
  signIn: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const devStorageKey = 'contest-platform-dev-session';
const authStorageKey = 'contest-platform-auth-session';
const pkceStorageKey = 'contest-platform-auth-pkce';
const callbackPath = '/auth/callback';
const refreshLeewayMs = 60_000;

const AuthContext = createContext<AuthContextValue | null>(null);

function defaultDevSession(): DevSessionState {
  return {
    enabled: false,
    displayName: 'Dev Organizer',
    email: 'dev@origin-draft.test',
    roles: ['organizer'],
  };
}

function readStorage(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(storage: Storage | undefined, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {
    // ignore storage failures and keep the session in memory only
  }
}

function removeStorage(storage: Storage | undefined, key: string) {
  try {
    storage?.removeItem(key);
  } catch {
    // ignore storage failures
  }
}

export function readDevSession(): DevSessionState {
  const raw = readStorage(globalThis.localStorage, devStorageKey);
  if (!raw) {
    return defaultDevSession();
  }

  try {
    return JSON.parse(raw) as DevSessionState;
  } catch {
    return defaultDevSession();
  }
}

export function writeDevSession(session: DevSessionState) {
  writeStorage(globalThis.localStorage, devStorageKey, JSON.stringify(session));
}

export function clearDevSession() {
  removeStorage(globalThis.localStorage, devStorageKey);
}

function readStoredAuthSession(): StoredAuthSession | null {
  const raw = readStorage(globalThis.localStorage, authStorageKey);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as StoredAuthSession;
  } catch {
    return null;
  }
}

function writeStoredAuthSession(session: StoredAuthSession) {
  writeStorage(globalThis.localStorage, authStorageKey, JSON.stringify(session));
}

function clearStoredAuthSession() {
  removeStorage(globalThis.localStorage, authStorageKey);
}

function writePkceSession(session: PkceSession) {
  writeStorage(globalThis.sessionStorage, pkceStorageKey, JSON.stringify(session));
}

function readPkceSession(): PkceSession | null {
  const raw = readStorage(globalThis.sessionStorage, pkceStorageKey);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as PkceSession;
  } catch {
    return null;
  }
}

function clearPkceSession() {
  removeStorage(globalThis.sessionStorage, pkceStorageKey);
}

function toBase64Url(input: Uint8Array): string {
  const encoded = globalThis.btoa(String.fromCharCode(...input));
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function createRandomString(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return toBase64Url(new Uint8Array(digest));
}

function buildTokenEndpoint(config: SessionConfig): string {
  if (config.authProvider === 'supabase') {
    return `${config.supabaseUrl}/auth/v1/token`;
  }

  return `${config.keycloakIssuerUrl}/protocol/openid-connect/token`;
}

function buildLogoutEndpoint(config: SessionConfig): string {
  if (config.authProvider === 'supabase') {
    return `${config.supabaseUrl}/auth/v1/logout`;
  }

  return `${config.keycloakIssuerUrl}/protocol/openid-connect/logout`;
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = (await response.json()) as T | { message?: string; error_description?: string };

  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string'
        ? data.message
        : typeof data === 'object' && data !== null && 'error_description' in data && typeof data.error_description === 'string'
          ? data.error_description
          : `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

async function fetchSessionConfig(): Promise<SessionConfig> {
  return fetchJson<SessionConfig>(apiUrl('/api/session/config'));
}

async function fetchSessionUser(
  devSession: DevSessionState,
  accessToken: string | null,
): Promise<SessionResponse> {
  return fetchJson<SessionResponse>(apiUrl('/api/session/me'), {
    headers: buildAuthHeaders(devSession, accessToken),
  });
}

function isExpired(session: StoredAuthSession, leewayMs = 0): boolean {
  return Date.now() >= session.expiresAt - leewayMs;
}

function normalizeTokenResponse(response: TokenResponse, fallbackRefreshToken?: string | null): StoredAuthSession {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? fallbackRefreshToken ?? null,
    idToken: response.id_token ?? null,
    tokenType: response.token_type ?? 'Bearer',
    scope: response.scope ?? 'openid profile email offline_access',
    expiresAt: Date.now() + response.expires_in * 1000,
  };
}

async function exchangeToken(
  config: SessionConfig,
  parameters: URLSearchParams,
  fallbackRefreshToken?: string | null,
): Promise<StoredAuthSession> {
  const tokenUrl = buildTokenEndpoint(config);
  const url = config.authProvider === 'supabase'
    ? `${tokenUrl}?grant_type=${parameters.get('grant_type')}`
    : tokenUrl;

  const headers: Record<string, string> = {
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

  const data = (await response.json()) as TokenResponse | { error_description?: string };
  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error_description' in data && typeof data.error_description === 'string'
        ? data.error_description
        : `Token exchange failed with ${response.status}`;
    throw new Error(message);
  }

  const session = normalizeTokenResponse(data as TokenResponse, fallbackRefreshToken);
  writeStoredAuthSession(session);
  return session;
}

async function supabasePasswordAuth(
  config: SupabaseSessionConfig,
  email: string,
  password: string,
): Promise<StoredAuthSession> {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': config.supabaseAnonKey,
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json() as TokenResponse & { error_description?: string; msg?: string };
  if (!response.ok) {
    const message = data.error_description ?? data.msg ?? `Sign-in failed with ${response.status}`;
    throw new Error(message);
  }

  const session = normalizeTokenResponse(data);
  writeStoredAuthSession(session);
  return session;
}

async function supabaseSignUp(
  config: SupabaseSessionConfig,
  email: string,
  password: string,
): Promise<void> {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': config.supabaseAnonKey,
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const message =
      typeof data.msg === 'string' ? data.msg
        : typeof data.error_description === 'string' ? data.error_description
          : `Sign-up failed with ${response.status}`;
    throw new Error(message);
  }
}

async function beginLogin(config: SessionConfig, returnTo: string): Promise<void> {
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

async function completeLogin(
  config: SessionConfig,
  search: string,
): Promise<{ session: StoredAuthSession; returnTo: string }> {
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

  let body: URLSearchParams;
  if (config.authProvider === 'supabase') {
    body = new URLSearchParams({
      grant_type: 'pkce',
      auth_code: code,
      code_verifier: pkceSession.verifier,
    });
  } else {
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

async function refreshSession(
  config: SessionConfig,
  session: StoredAuthSession,
): Promise<StoredAuthSession | null> {
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
  } catch {
    clearStoredAuthSession();
    return null;
  }
}

function buildLogoutUrl(config: SessionConfig, session: StoredAuthSession | null): string | null {
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

async function supabaseLogout(config: SupabaseSessionConfig, accessToken: string | null): Promise<void> {
  if (!accessToken) return;

  try {
    await fetch(buildLogoutEndpoint(config), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'apikey': config.supabaseAnonKey,
      },
    });
  } catch {
    // Best-effort logout — token will expire on its own
  }
}

export function buildAuthHeaders(
  devSession?: DevSessionState,
  accessToken?: string | null,
): HeadersInit {
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const handledCallbackRef = useRef<string | null>(null);
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [devSession, setDevSession] = useState<DevSessionState>(() => readDevSession());
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const loadAuth = useCallback(
    async (nextDevSession: DevSessionState) => {
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
        let returnTo: string | null = null;

        if (location.pathname === callbackPath) {
          const callbackSignature = `${location.pathname}${location.search}`;
          if (handledCallbackRef.current !== callbackSignature) {
            handledCallbackRef.current = callbackSignature;
            const callbackResult = await completeLogin(nextConfig, location.search);
            session = callbackResult.session;
            returnTo = callbackResult.returnTo;
          } else {
            session = readStoredAuthSession();
          }
        } else if (session && isExpired(session, refreshLeewayMs)) {
          handledCallbackRef.current = null;
          session = await refreshSession(nextConfig, session);
        } else {
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
      } catch (loadError) {
        clearPkceSession();
        clearStoredAuthSession();
        setAccessToken(null);
        setUser(null);
        setError(loadError instanceof Error ? loadError.message : 'Unknown auth error');
        setIsLoading(false);
      }
    },
    [location.pathname, location.search, navigate],
  );

  useEffect(() => {
    void loadAuth(devSession);
  }, [devSession, loadAuth]);

  const reload = useCallback(async () => {
    await loadAuth(devSession);
  }, [devSession, loadAuth]);

  const updateDevSession = useCallback((nextSession: DevSessionState) => {
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

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    if (!config || config.authProvider !== 'supabase') return;
    setIsLoading(true);
    setError(null);
    try {
      const session = await supabasePasswordAuth(config, email, password);
      const me = await fetchSessionUser(devSession, session.accessToken);
      setAccessToken(session.accessToken);
      setUser(me.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [config, devSession]);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    if (!config || config.authProvider !== 'supabase') return;
    setIsLoading(true);
    setError(null);
    try {
      await supabaseSignUp(config, email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-up failed');
      throw err;
    } finally {
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
    } else if (config.authProvider === 'supabase') {
      await supabaseLogout(config, currentAccessToken);
      globalThis.location.assign(config.postLogoutRedirectUri);
    }
  }, [config, signOutDevSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
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
    }),
    [accessToken, config, devSession, error, isLoading, reload, signIn, signInWithEmail, signUpWithEmail, signOut, signOutDevSession, updateDevSession, user],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return context;
}