import { buildApp } from './app.js';
import { getConfig } from './config.js';

async function start() {
  const config = getConfig();
  const app = await buildApp(config);

  try {
    await app.listen({
      host: config.host,
      port: config.port,
    });

    app.log.info(
      {
        platformMode: config.platformMode,
        port: config.port,
        logLevel: config.logLevel,
        keycloakIssuerUrl: config.keycloakIssuerUrl,
        keycloakRealm: config.keycloakRealm,
        keycloakClientId: config.keycloakClientId,
      },
      'Contest platform API listening',
    );

    const shutdown = () => {
      app.log.info('Received shutdown signal, closing gracefully…');
      void app.close().then(() => process.exit(0));
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    app.log.error(error, 'Failed to start contest platform API');
    process.exit(1);
  }
}

void start();
