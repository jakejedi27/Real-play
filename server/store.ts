import type {
  GameEventRecord,
  GameRecord,
  JobRecord,
  PlayerRecord,
  StoredLocation,
} from '../shared/types';

export interface EventInsertResult {
  event: GameEventRecord;
  inserted: boolean;
}

/**
 * Storage boundary shared by the SQLite (default, verified) and Supabase
 * adapters. All access happens server-side; browsers never touch the database.
 */
export interface Store {
  readonly kind: 'sqlite' | 'supabase';
  init(): Promise<void>;
  close(): Promise<void>;

  createGame(game: GameRecord): Promise<void>;
  getGame(id: string): Promise<GameRecord | null>;
  getGameByCode(code: string): Promise<GameRecord | null>;
  saveGame(game: GameRecord, expectedRevision: number): Promise<boolean>;
  listGamesNeedingTicks(): Promise<GameRecord[]>;
  listRecentGames(limit: number): Promise<GameRecord[]>;

  createPlayer(player: PlayerRecord): Promise<void>;
  getPlayer(id: string): Promise<PlayerRecord | null>;
  listPlayers(gameId: string): Promise<PlayerRecord[]>;
  updatePlayer(player: PlayerRecord): Promise<void>;

  upsertLocation(location: StoredLocation): Promise<void>;
  getLocation(gameId: string, playerId: string): Promise<StoredLocation | null>;
  listLocations(gameId: string): Promise<StoredLocation[]>;

  appendEvent(event: GameEventRecord): Promise<EventInsertResult>;
  listEvents(gameId: string, sinceSeq: number, limit: number): Promise<GameEventRecord[]>;
  latestSeq(gameId: string): Promise<number>;

  enqueueJob(job: JobRecord): Promise<boolean>;
  claimDueJobs(now: number, limit: number): Promise<JobRecord[]>;
  finishJob(id: string, status: 'done' | 'failed'): Promise<void>;
  cancelPendingJobs(gameId: string, kinds: string[]): Promise<void>;
}
