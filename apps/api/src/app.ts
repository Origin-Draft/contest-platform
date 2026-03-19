import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import path from 'node:path';
import { buildSessionConfig, registerAuth } from './auth.js';
import { createDatabaseClient } from './db/client.js';
import type { AppConfig } from './config.js';
import { createMemoryContestStore, createPostgresContestStore } from './modules/contests/store.js';
import { registerContestRoutes } from './modules/contests/routes.js';
import { LocalArtifactStorage } from './storage/local.js';
import type { ArtifactStorage } from './storage/local.js';
import { SupabaseArtifactStorage } from './storage/supabase.js';

export async function buildApp(config: AppConfig) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
  });

  app.register(helmet, {
    contentSecurityPolicy: config.platformMode !== 'production'
      ? false
      : { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"] } },
  });

  app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  const allowedOrigins = config.corsAllowedOrigins ?? ['*'];
  const allowDatabaseFallback =
    config.allowDatabaseFallback ?? config.platformMode !== 'production';

  app.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (
        allowedOrigins.includes('*') ||
        allowedOrigins.includes(origin)
      ) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS policy.`), false);
    },
  });

  app.register(multipart, {
    limits: { fileSize: config.uploadMaxBytes },
  });

  app.register(swagger, {
    openapi: {
      info: {
        title: 'Contest Platform API',
        description: 'Headless API for AI-assisted writing contests.',
        version: '0.1.0',
      },
    },
  });

  if (config.platformMode !== 'production') {
    app.register(swaggerUi, {
      routePrefix: '/docs',
    });
  }

  registerAuth(app, config);

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'contest-platform-api',
    timestamp: new Date().toISOString(),
  }));

  app.get('/api/ready', async (_request, reply) => {
    if (databaseClient) {
      try {
        await databaseClient.pool.query('SELECT 1');
      } catch {
        return reply.status(503).send({ status: 'unavailable', reason: 'database unreachable' });
      }
    }
    return { status: 'ok', database: databaseClient ? 'connected' : 'memory' };
  });

  app.get('/api/session/config', async () => buildSessionConfig(config));

  app.get('/api/session/me', async (request) => ({
    user: request.sessionUser,
  }));

  const databaseClient = await createDatabaseClient(config.databaseUrl, app.log, {
    allowFallback: allowDatabaseFallback,
    ssl: config.databaseSsl,
    devSeed: config.platformMode !== 'production',
  });
  const contestStore = databaseClient
    ? await createPostgresContestStore(databaseClient.pool, { seedDemo: config.platformMode !== 'production' })
    : await createMemoryContestStore();
  const artifactStorage: ArtifactStorage = config.storageProvider === 'supabase'
    ? new SupabaseArtifactStorage(config.supabaseUrl, config.supabaseServiceRoleKey)
    : new LocalArtifactStorage(path.resolve(config.uploadDir));

  if (databaseClient) {
    app.addHook('onClose', async () => {
      await databaseClient.close();
    });
  }

  await registerContestRoutes(app, contestStore, artifactStorage);

  return app;
}
