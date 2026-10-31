import { serve } from '@hono/node-server';
import fs from 'node:fs';
import { loadConfig, createStore } from './config';
import { GameService } from './service';
import { createApi } from './api';

async function main(): Promise<void> {
  const config = loadConfig();
  fs.mkdirSync(config.dataDir, { recursive: true });

  const store = createStore(process.env, config.dataDir);
  await store.init();

  const service = new GameService(store);
  const app = createApi({
    service,
    store,
    allowedOrigin: config.allowedOrigin,
  });

  const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
    console.log(`[realplay] listening on 0.0.0.0:${info.port} (store: ${store.kind})`);
  });

  /**
   * Persistent scheduling: every tick we advance countdowns, run due reveal /
   * territory jobs claimed atomically from the database and sweep active games.
   * This runs server-side, so timers and reveals continue whether or not a host
   * browser stays open. Jobs are claimed by status transition, so a reveal can
   * never be delivered twice.
   */
  let running = false;
  const ticker = setInterval(() => {
    if (running) return;
    running = true;
    (async () => {
      try {
        await service.sweepActiveGames();
        await service.runDueJobs();
      } catch (error) {
        console.error('[scheduler] tick failed', error);
      } finally {
        running = false;
      }
    })();
  }, config.schedulerTickMs);
  ticker.unref?.();

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[realplay] ${signal} received, shutting down`);
    clearInterval(ticker);
    server.close(() => {
      void store
        .close()
        .catch((error) => console.error('[realplay] store close failed', error))
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[realplay] failed to start', error);
  process.exit(1);
});
