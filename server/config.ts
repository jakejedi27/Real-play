import path from 'node:path';
import { SqliteStore } from './store/sqlite';
import { SupabaseStore } from './store/supabase';
import type { Store } from './store';

export interface AppConfig {
  port: number;
  dataDir: string;
  schedulerTickMs: number;
  allowedOrigin: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 3000),
    dataDir: path.resolve(env.DATA_DIR ?? path.join(process.cwd(), 'data')),
    schedulerTickMs: Math.max(250, Number(env.SCHEDULER_TICK_MS ?? 1000)),
    allowedOrigin: env.ALLOWED_ORIGIN?.trim() || null,
  };
}

export function createStore(env: NodeJS.ProcessEnv = process.env, dataDir = './data'): Store {
  const kind = (env.DATA_STORE ?? 'sqlite').toLowerCase();
  if (kind === 'supabase') {
    const url = env.SUPABASE_URL ?? '';
    const key = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    return new SupabaseStore(url, key);
  }
  if (kind !== 'sqlite') {
    throw new Error(`Unknown DATA_STORE "${kind}" (expected sqlite or supabase)`);
  }
  return new SqliteStore(path.resolve(dataDir, 'realplay.db'));
}
