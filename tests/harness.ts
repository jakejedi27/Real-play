import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GameService } from '../server/service';
import { createApi } from '../server/api';
import { createStore } from '../server/config';
import type { Store } from '../server/store';

export interface Harness {
  service: GameService;
  store: Store;
  app: ReturnType<typeof createApi>;
  now: () => number;
  advance: (ms: number) => void;
  close: () => Promise<void>;
}

let counter = 0;

/** Isolated SQLite store in a temp dir + injectable clock so timers are deterministic. */
export async function createHarness(): Promise<Harness> {
  counter += 1;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `realplay-test-${counter}-`));
  const store = createStore({ DATA_STORE: 'sqlite' } as NodeJS.ProcessEnv, dir);
  await store.init();
  let clock = Date.UTC(2025, 4, 1, 12, 0, 0);
  const service = new GameService(store, () => clock);
  const app = createApi({ service, store, allowedOrigin: null });
  return {
    service,
    store,
    app,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
    close: async () => {
      await store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface ApiResult<T = any> {
  status: number;
  body: T;
}

/** Drives the real Hono app so tests exercise routing, auth headers and status codes. */
export async function api<T = any>(
  harness: Harness,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  options: { token?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await harness.app.request(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body: body as T };
}

export interface SeededGame {
  gameId: string;
  code: string;
  hostToken: string;
  hostId: string;
  guestToken: string;
  guestId: string;
}

export const MANHUNT_SETTINGS = {
  mode: 'manhunt',
  maxPlayers: 20,
  durationMinutes: 5,
  countdownSeconds: 0,
  area: { enabled: false, center: null, radiusMeters: 400 },
  locationUpdateSeconds: 10,
  staleAfterSeconds: 60,
  shareTeamLocations: true,
  teamAssignment: 'auto',
  maxTeamSize: 0,
  teams: [
    { key: 'hunters', name: 'Hunters', color: '#ff6b5e' },
    { key: 'runners', name: 'Runners', color: '#b6f25a' },
  ],
  safetyAcknowledged: true,
  headStartSeconds: 0,
  revealIntervalSeconds: 30,
  hunterTransport: 'walk-only',
  tagRadiusMeters: 15,
  runnerPings: true,
  hunterCheckIns: true,
  tieRule: 'runners',
};

/** Creates a game plus one joined, ready guest. */
export async function seedGame(
  harness: Harness,
  mode: 'manhunt' | 'ctf' | 'territory' | 'scavenger',
  settings: Record<string, unknown>,
): Promise<SeededGame> {
  const created = await api(harness, 'POST', '/api/games', {
    body: { mode, name: 'Test match', nickname: 'Host', settings: { ...settings, mode } },
  });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`create failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const gameId: string = created.body.snapshot.game.id;
  const code: string = created.body.snapshot.game.code;
  const hostToken: string = created.body.token;
  const hostId: string = created.body.snapshot.you.id;

  const joined = await api(harness, 'POST', '/api/games/join', {
    body: { code, nickname: 'Guest', consentLocation: true },
  });
  if (joined.status !== 200) throw new Error(`join failed: ${joined.status}`);
  const guestToken: string = joined.body.token;
  const guestId: string = joined.body.playerId;

  const ready = await api(harness, 'POST', `/api/games/${gameId}/ready`, {
    token: guestToken,
    body: { ready: true },
  });
  if (ready.status !== 200) throw new Error(`ready failed: ${ready.status}`);

  return { gameId, code, hostToken, hostId, guestToken, guestId };
}
