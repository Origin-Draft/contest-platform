import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from './config.js';

export interface SessionUser {
  id: string;
  displayName: string;
  email: string | null;
  roles: string[];
  authSource: 'keycloak' | 'supabase' | 'dev-bypass';
}

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

export type SessionConfigResponse = KeycloakSessionConfig | SupabaseSessionConfig;

declare module 'fastify' {
  interface FastifyRequest {
    sessionUser: SessionUser | null;
  }
}

function uniqueRoles(roles: string[]): string[] {
  return [...new Set(roles.filter(Boolean))];
}

function parseKeycloakRoles(payload: Record<string, unknown>): string[] {
  const realmAccess = payload.realm_access as { roles?: string[] } | undefined;
  const clientAccess = payload.resource_access as Record<string, { roles?: string[] }> | undefined;

  return uniqueRoles([
    ...(realmAccess?.roles ?? []),
    ...Object.values(clientAccess ?? {}).flatMap((entry) => entry.roles ?? []),
  ]);
}

function parseSupabaseRoles(payload: Record<string, unknown>): string[] {
  const appMetadata = payload.app_metadata as { roles?: string[] } | undefined;
  return uniqueRoles(appMetadata?.roles ?? []);
}

function tokenMatchesClient(payload: Record<string, unknown>, clientId: string): boolean {
  const audienceClaim = payload.aud;
  const audienceMatches =
    audienceClaim === clientId ||
    (Array.isArray(audienceClaim) && audienceClaim.includes(clientId));
  const authorizedPartyMatches = payload.azp === clientId;

  return audienceMatches || authorizedPartyMatches;
}

function normalizeWebOrigin(origin: string): string {
  return origin.endsWith('/') ? origin.slice(0, -1) : origin;
}

export function buildSessionConfig(config: AppConfig): SessionConfigResponse {
  const normalizedWebOrigin = normalizeWebOrigin(config.webOrigin);

  if (config.authProvider === 'supabase') {
    return {
      authProvider: 'supabase',
      mode: config.authDevBypass ? 'development-bypass' : 'supabase',
      devBypassEnabled: config.authDevBypass,
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey,
      redirectUri: `${normalizedWebOrigin}/auth/callback`,
      postLogoutRedirectUri: `${normalizedWebOrigin}/`,
    };
  }

  return {
    authProvider: 'keycloak',
    mode: config.authDevBypass ? 'development-bypass' : 'keycloak',
    devBypassEnabled: config.authDevBypass,
    keycloakIssuerUrl: config.keycloakIssuerUrl,
    keycloakClientId: config.keycloakClientId,
    keycloakRedirectUri: `${normalizedWebOrigin}/auth/callback`,
    keycloakPostLogoutRedirectUri: `${normalizedWebOrigin}/`,
    keycloakScopes: 'openid profile email offline_access',
  };
}

type JwtVerifier = (token: string) => Promise<SessionUser | null>;

function createKeycloakVerifier(config: AppConfig): JwtVerifier {
  const jwks = createRemoteJWKSet(
    new URL(`${config.keycloakIssuerUrl}/protocol/openid-connect/certs`),
  );

  return async (token) => {
    const verification = await jwtVerify(token, jwks, {
      issuer: config.keycloakIssuerUrl,
    });

    const payload = verification.payload as Record<string, unknown>;

    if (!tokenMatchesClient(payload, config.keycloakClientId)) {
      return null;
    }

    return {
      id: String(payload.sub ?? 'unknown'),
      displayName: String(payload.name ?? payload.preferred_username ?? 'Keycloak User'),
      email: typeof payload.email === 'string' ? payload.email : null,
      roles: parseKeycloakRoles(payload),
      authSource: 'keycloak',
    };
  };
}

function createSupabaseVerifier(config: AppConfig): JwtVerifier {
  const secret = new TextEncoder().encode(config.supabaseJwtSecret);

  return async (token) => {
    const verification = await jwtVerify(token, secret, {
      issuer: `${config.supabaseUrl}/auth/v1`,
    });

    const payload = verification.payload as Record<string, unknown>;

    return {
      id: String(payload.sub ?? 'unknown'),
      displayName: String(payload.user_metadata && typeof payload.user_metadata === 'object' && 'full_name' in payload.user_metadata ? payload.user_metadata.full_name : payload.email ?? 'Supabase User'),
      email: typeof payload.email === 'string' ? payload.email : null,
      roles: parseSupabaseRoles(payload),
      authSource: 'supabase',
    };
  };
}

export function registerAuth(app: FastifyInstance, config: AppConfig) {
  const verifyToken = config.authProvider === 'supabase'
    ? createSupabaseVerifier(config)
    : createKeycloakVerifier(config);

  app.decorateRequest('sessionUser', null);

  app.addHook('onRequest', async (request) => {
    request.sessionUser = await resolveSessionUser(request, config, verifyToken);
  });
}

async function resolveSessionUser(
  request: FastifyRequest,
  config: AppConfig,
  verifyToken: JwtVerifier,
): Promise<SessionUser | null> {
  const authHeader = request.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  if (token) {
    try {
      return await verifyToken(token);
    } catch {
      return null;
    }
  }

  if (config.authDevBypass) {
    const headerValue = request.headers['x-dev-roles'];
    const roleHeader = Array.isArray(headerValue) ? headerValue.join(',') : headerValue;
    const roles = roleHeader ? roleHeader.split(',').map((role) => role.trim()).filter(Boolean) : [];

    if (roles.length > 0) {
      const userHeader = request.headers['x-dev-user'];
      const emailHeader = request.headers['x-dev-email'];
      const userValue = Array.isArray(userHeader) ? userHeader[0] : userHeader;
      const emailValue = Array.isArray(emailHeader) ? emailHeader[0] : emailHeader;

      return {
        id: `dev-${userValue ?? 'user'}`,
        displayName: userValue ?? 'Dev User',
        email: emailValue ?? null,
        roles,
        authSource: 'dev-bypass',
      };
    }
  }

  return null;
}

export function requireRoles(...roles: string[]) {
  return async function authorizationGuard(request: FastifyRequest, reply: FastifyReply) {
    const user = request.sessionUser;
    if (!user) {
      return reply.code(401).send({
        message: 'Authentication required.',
      });
    }

    const authorized = roles.some((role) => user.roles.includes(role));
    if (!authorized) {
      return reply.code(403).send({
        message: `One of these roles is required: ${roles.join(', ')}.`,
      });
    }

    return undefined;
  };
}