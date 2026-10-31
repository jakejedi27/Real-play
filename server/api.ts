import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'node:fs';
import path from 'node:path';
import { GameService, ServiceError } from './service';
import type { Store } from './store';
import type { GameSummary, ModeId } from '../shared/types';
import { MODE_IDS } from '../shared/modes';

export interface ApiOptions {
  service: GameService;
  store: Store;
  staticDir?: string;
  allowedOrigin?: string | null;
  sseIntervalMs?: number;
}

function bearer(c: { req: { header: (name: string) => string | undefined } }): string | undefined {
  const header = c.req.header('authorization') ?? c.req.header('Authorization');
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1].trim();
  }
  return c.req.header('x-player-token') ?? undefined;
}

async function readJson(c: {
  req: { json: <T = unknown>() => Promise<T> };
}): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json<unknown>();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const SUMMARY_MODES = new Set<string>(MODE_IDS);

function summarize(record: {
  id: string;
  code: string;
  name: string;
  mode: string;
  status: string;
  settings: { maxPlayers: number };
  players: number;
  createdAt: number;
  updatedAt: number;
}): GameSummary {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    mode: (SUMMARY_MODES.has(record.mode) ? record.mode : 'manhunt') as ModeId,
    status: record.status as GameSummary['status'],
    playerCount: record.players,
    maxPlayers: record.settings.maxPlayers,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createApi(options: ApiOptions): Hono {
  const { service, store } = options;
  const staticDir = options.staticDir ?? path.resolve(process.cwd(), 'dist');
  const sseIntervalMs = options.sseIntervalMs ?? 2000;

  const app = new Hono();

  if (options.allowedOrigin) {
    app.use(
      '/api/*',
      cors({
        origin: options.allowedOrigin,
        allowHeaders: ['Authorization', 'Content-Type', 'X-Player-Token'],
        allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        maxAge: 600,
      }),
    );
  }

  app.onError((error, c) => {
    if (error instanceof ServiceError) {
      return c.json(
        { error: error.message, details: error.details, code: error.status },
        error.status as 400 | 401 | 403 | 404 | 409 | 429 | 500,
      );
    }
    console.error('[api] unhandled error', error);
    return c.json({ error: 'Something went wrong on the server.', details: [], code: 500 }, 500);
  });

  app.get('/api/health', async (c) => {
    return c.json({ ok: true, store: store.kind, serverNow: Date.now() });
  });

  /* ------------------------------------------------------------------ */
  /* Creation, preview and join                                          */
  /* ------------------------------------------------------------------ */

  app.post('/api/games', async (c) => {
    const body = await readJson(c);
    const result = await service.createGame({
      mode: typeof body.mode === 'string' ? body.mode : '',
      name: typeof body.name === 'string' ? body.name : undefined,
      nickname: typeof body.nickname === 'string' ? body.nickname : String(body.nickname ?? ''),
      settings: body.settings ?? {},
    });
    return c.json(result, 201);
  });

  app.get('/api/games/preview', async (c) => {
    const preview = await service.previewByCode(c.req.query('code'));
    return c.json(preview);
  });

  app.post('/api/games/join', async (c) => {
    const body = await readJson(c);
    const result = await service.joinGame(body.code, body.nickname, body.consentLocation === true);
    return c.json(result, 201);
  });

  /* ------------------------------------------------------------------ */
  /* Per-game endpoints. Every one of these re-authenticates the token.  */
  /* ------------------------------------------------------------------ */

  app.get('/api/games/:gameId', async (c) => {
    const snapshot = await service.snapshotFor(c.req.param('gameId'), bearer(c));
    return c.json(snapshot);
  });

  app.patch('/api/games/:gameId/settings', async (c) => {
    const body = await readJson(c);
    const snapshot = await service.updateSettings(c.req.param('gameId'), bearer(c), body.settings ?? body);
    return c.json(snapshot);
  });

  app.post('/api/games/:gameId/ready', async (c) => {
    const body = await readJson(c);
    const snapshot = await service.setReady(c.req.param('gameId'), bearer(c), body.ready !== false);
    return c.json(snapshot);
  });

  app.post('/api/games/:gameId/team', async (c) => {
    const body = await readJson(c);
    const snapshot = await service.setTeam(
      c.req.param('gameId'),
      bearer(c),
      body.playerId,
      body.teamKey,
    );
    return c.json(snapshot);
  });

  app.post('/api/games/:gameId/start', async (c) => {
    return c.json(await service.startGame(c.req.param('gameId'), bearer(c)));
  });

  app.post('/api/games/:gameId/pause', async (c) => {
    return c.json(await service.pauseGame(c.req.param('gameId'), bearer(c)));
  });

  app.post('/api/games/:gameId/resume', async (c) => {
    return c.json(await service.resumeGame(c.req.param('gameId'), bearer(c)));
  });

  app.post('/api/games/:gameId/end', async (c) => {
    return c.json(await service.endGame(c.req.param('gameId'), bearer(c)));
  });

  app.post('/api/games/:gameId/cancel', async (c) => {
    return c.json(await service.cancelGame(c.req.param('gameId'), bearer(c)));
  });

  app.post('/api/games/:gameId/announce', async (c) => {
    const body = await readJson(c);
    return c.json(await service.announce(c.req.param('gameId'), bearer(c), body.message));
  });

  app.post('/api/games/:gameId/ping', async (c) => {
    const body = await readJson(c);
    return c.json(await service.pingTeam(c.req.param('gameId'), bearer(c), body.message));
  });

  app.post('/api/games/:gameId/check-in', async (c) => {
    const body = await readJson(c);
    return c.json(await service.checkIn(c.req.param('gameId'), bearer(c), body.status));
  });

  app.post('/api/games/:gameId/location', async (c) => {
    const body = await readJson(c);
    const result = await service.recordLocation(c.req.param('gameId'), bearer(c), body);
    return c.json(result);
  });

  app.post('/api/games/:gameId/scavenger/hint', async (c) => {
    const body = await readJson(c);
    return c.json(
      await service.scavengerHint(c.req.param('gameId'), bearer(c), body.objectiveId),
    );
  });

  app.post('/api/games/:gameId/scavenger/code', async (c) => {
    const body = await readJson(c);
    return c.json(
      await service.scavengerCode(c.req.param('gameId'), bearer(c), body.objectiveId, body.answer),
    );
  });

  /**
   * Server-sent events. Each frame is a freshly built, viewer-filtered
   * snapshot — the same privacy rules as the REST snapshot apply, so Manhunt
   * hunters never receive runner positions outside a scheduled reveal.
   * EventSource cannot set headers, so the token may also arrive as ?token=.
   */
  app.get('/api/games/:gameId/stream', async (c) => {
    const gameId = c.req.param('gameId');
    const token = bearer(c) ?? c.req.query('token');
    // Authenticate up front so an unauthorised subscriber gets a real status.
    await service.snapshotFor(gameId, token);
    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('Content-Type', 'text/event-stream');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      let closed = false;
      stream.onAbort(() => {
        closed = true;
      });
      let lastSeq = -1;
      while (!closed) {
        let payload: unknown = null;
        try {
          payload = await service.snapshotFor(gameId, token);
        } catch (error) {
          if (error instanceof ServiceError && error.status === 401) {
            await stream.writeSSE({ event: 'error', data: 'unauthorised' });
            return;
          }
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({ error: 'snapshot failed' }),
          });
          return;
        }
        const seq = (payload as { eventSeq?: number }).eventSeq ?? 0;
        if (seq !== lastSeq) {
          lastSeq = seq;
          await stream.writeSSE({ event: 'snapshot', data: JSON.stringify(payload) });
        } else {
          await stream.writeSSE({ event: 'heartbeat', data: String(Date.now()) });
        }
        const snapshot = payload as { game?: { status?: string } };
        if (snapshot.game?.status === 'ended' || snapshot.game?.status === 'cancelled') {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, sseIntervalMs));
      }
    });
  });

  /** Recent public games (no tokens, no private data). */
  app.get('/api/history', async (c) => {
    const limitRaw = Number(c.req.query('limit') ?? 12);
    const limit = Number.isFinite(limitRaw) ? Math.min(30, Math.max(1, Math.trunc(limitRaw))) : 12;
    const games = await store.listRecentGames(limit);
    const summaries: GameSummary[] = [];
    for (const game of games) {
      const players = await store.listPlayers(game.id);
      summaries.push(
        summarize({
          id: game.id,
          code: game.code,
          name: game.name,
          mode: game.mode,
          status: game.status,
          settings: game.settings,
          players: players.length,
          createdAt: game.createdAt,
          updatedAt: game.updatedAt,
        }),
      );
    }
    return c.json({ games: summaries });
  });

  /* ------------------------------------------------------------------ */
  /* Static client (Vite build) with SPA fallback                        */
  /* ------------------------------------------------------------------ */

  const hasBuild = fs.existsSync(path.join(staticDir, 'index.html'));
  if (hasBuild) {
    app.use('/assets/*', serveStatic({ root: staticDir }));
    app.use('/favicon.svg', serveStatic({ root: staticDir }));
    app.use('/icon-192.svg', serveStatic({ root: staticDir }));
    app.use('/icon-512.svg', serveStatic({ root: staticDir }));
    app.use('/manifest.webmanifest', serveStatic({ root: staticDir }));
    app.get('*', (c) => {
      if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
      return c.html(fs.readFileSync(path.join(staticDir, 'index.html'), 'utf8'));
    });
  } else {
    app.get('*', (c) => {
      if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
      return c.text('RealPlay server is running. Build the client with `npm run build`.', 200);
    });
  }

  return app;
}
