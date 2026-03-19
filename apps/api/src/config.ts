import 'dotenv/config';

export type PlatformMode = 'demo' | 'development' | 'production';
export type AuthProvider = 'keycloak' | 'supabase';
export type StorageProvider = 'local' | 'supabase';

export interface AppConfig {
  platformMode: PlatformMode;
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  databaseSsl: boolean;
  uploadDir: string;
  uploadMaxBytes: number;
  corsAllowedOrigins: string[];
  allowDatabaseFallback: boolean;
  authDevBypass: boolean;
  authProvider: AuthProvider;
  storageProvider: StorageProvider;
  webOrigin: string;
  // Keycloak (used when authProvider === 'keycloak')
  keycloakIssuerUrl: string;
  keycloakRealm: string;
  keycloakClientId: string;
  keycloakClientPublic: boolean;
  keycloakClientSecret: string;
  // Supabase (used when authProvider === 'supabase' or storageProvider === 'supabase')
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  supabaseJwtSecret: string;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function normalizePlatformMode(value: string | undefined): PlatformMode {
  if (value === 'demo' || value === 'production') {
    return value;
  }

  return 'development';
}

function splitCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function hasPlaceholderValue(value: string): boolean {
  return ['change-me', 'replace-with-real-secret', 'example.com'].some((placeholder) =>
    value.toLowerCase().includes(placeholder),
  );
}

function assertProductionValue(name: string, value: string) {
  if (!value.trim()) {
    throw new Error(`Missing required production configuration: ${name}`);
  }

  if (hasPlaceholderValue(value)) {
    throw new Error(`Production configuration ${name} still contains a placeholder value.`);
  }
}

export function getConfig(): AppConfig {
  const platformMode = normalizePlatformMode(process.env.PLATFORM_MODE ?? process.env.VITE_PLATFORM_MODE);
  const databaseUrl =
    process.env.DATABASE_URL ?? 'postgres://contest_user:change-me@localhost:5432/contest_platform';
  const databaseSsl = readBoolean(process.env.DATABASE_SSL, false);
  const uploadDir = process.env.UPLOAD_DIR ?? 'infra/uploads';
  const authDevBypass = readBoolean(process.env.AUTH_DEV_BYPASS, false);
  const authProvider = (process.env.AUTH_PROVIDER === 'supabase' ? 'supabase' : 'keycloak') as AuthProvider;
  const storageProvider = (process.env.STORAGE_PROVIDER === 'supabase' ? 'supabase' : 'local') as StorageProvider;
  const webOrigin = process.env.WEB_ORIGIN ?? process.env.KEYCLOAK_WEB_ORIGIN ?? 'http://localhost:5173';

  // Keycloak fields
  const keycloakIssuerUrl =
    process.env.KEYCLOAK_ISSUER_URL ?? 'http://localhost:8080/realms/contest-platform';
  const keycloakRealm = process.env.KEYCLOAK_REALM ?? 'contest-platform';
  const keycloakClientId = process.env.KEYCLOAK_CLIENT_ID ?? 'contest-platform-web';
  const keycloakClientPublic = readBoolean(process.env.KEYCLOAK_CLIENT_PUBLIC, true);
  const keycloakClientSecret = process.env.KEYCLOAK_CLIENT_SECRET ?? 'replace-with-real-secret';

  // Supabase fields
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? '';
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET ?? '';

  const corsAllowedOrigins = splitCsv(process.env.CORS_ALLOWED_ORIGINS ?? webOrigin);

  if (platformMode === 'production') {
    if (authDevBypass) {
      throw new Error('AUTH_DEV_BYPASS must be false when PLATFORM_MODE=production.');
    }

    if (corsAllowedOrigins.length === 0) {
      throw new Error('CORS_ALLOWED_ORIGINS must contain at least one origin in production.');
    }

    assertProductionValue('DATABASE_URL', databaseUrl);
    assertProductionValue('UPLOAD_DIR', uploadDir);
    assertProductionValue('WEB_ORIGIN', webOrigin);

    if (authProvider === 'keycloak') {
      assertProductionValue('KEYCLOAK_ISSUER_URL', keycloakIssuerUrl);
      assertProductionValue('KEYCLOAK_REALM', keycloakRealm);
      assertProductionValue('KEYCLOAK_CLIENT_ID', keycloakClientId);

      if (!keycloakClientPublic) {
        assertProductionValue('KEYCLOAK_CLIENT_SECRET', keycloakClientSecret);
      }
    }

    if (authProvider === 'supabase' || storageProvider === 'supabase') {
      assertProductionValue('SUPABASE_URL', supabaseUrl);
      assertProductionValue('SUPABASE_ANON_KEY', supabaseAnonKey);
    }

    if (authProvider === 'supabase') {
      assertProductionValue('SUPABASE_JWT_SECRET', supabaseJwtSecret);
    }

    if (storageProvider === 'supabase') {
      assertProductionValue('SUPABASE_SERVICE_ROLE_KEY', supabaseServiceRoleKey);
    }
  }

  return {
    platformMode,
    host: process.env.API_HOST ?? '0.0.0.0',
    port: Number(process.env.API_PORT ?? 4000),
    logLevel: process.env.LOG_LEVEL ?? (platformMode === 'production' ? 'info' : 'debug'),
    databaseUrl,
    databaseSsl,
    uploadDir,
    uploadMaxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 50 * 1024 * 1024),
    corsAllowedOrigins,
    allowDatabaseFallback: platformMode !== 'production',
    authDevBypass,
    authProvider,
    storageProvider,
    webOrigin,
    keycloakIssuerUrl,
    keycloakRealm,
    keycloakClientId,
    keycloakClientPublic,
    keycloakClientSecret,
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    supabaseJwtSecret,
  };
}
