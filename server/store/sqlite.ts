import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type {
  GameEventRecord,
  GameRecord,
  JobRecord,
  ModeSettings,
  PlayerRecord,
  StoredLocation,
} from '../../shared/types';
import type { EventInsertResult, Store } from '../store';

type Row = Record<string, unknown>;

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Default adapter: a local SQLite file (WAL) that survives restarts. */
export class SqliteStore implements Store {
  readonly kind = 'sqlite' as const;
  private db: Database.Database | null = null;

  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const db = new Database(this.file);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        host_player_id TEXT NOT NULL,
        settings TEXT NOT NULL,
        runtime TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        countdown_ends_at INTEGER,
        duration_ms INTEGER NOT NULL,
        paused_at INTEGER,
        accumulated_pause_ms INTEGER NOT NULL DEFAULT 0,
        winner TEXT,
        ended_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_games_status ON games(status, updated_at);

      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        nickname TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        team_key TEXT,
        is_host INTEGER NOT NULL DEFAULT 0,
        ready INTEGER NOT NULL DEFAULT 0,
        consent_location INTEGER NOT NULL DEFAULT 0,
        last_seen_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_players_nickname
        ON players(game_id, lower(nickname));
      CREATE INDEX IF NOT EXISTS idx_players_game ON players(game_id);

      CREATE TABLE IF NOT EXISTS locations (
        player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
        game_id TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        accuracy_meters REAL NOT NULL,
        recorded_at INTEGER NOT NULL,
        received_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_locations_game ON locations(game_id);

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        audience TEXT NOT NULL,
        team_key TEXT,
        actor_id TEXT,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        dedupe_key TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_seq ON events(game_id, seq);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedupe
        ON events(game_id, dedupe_key);

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        run_key TEXT NOT NULL UNIQUE,
        run_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        claimed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(status, run_at);

      /* ---------------- Accounts, sessions and profiles ---------------- */

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        email_lower TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL,
        username_lower TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS account_sessions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_account ON account_sessions(account_id);

      CREATE TABLE IF NOT EXISTS password_resets (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_resets_account ON password_resets(account_id);

      /* Results are written once per (game, account) from server state only. */
      CREATE TABLE IF NOT EXISTS game_results (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        game_name TEXT NOT NULL,
        game_code TEXT NOT NULL,
        player_count INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        ended_at INTEGER NOT NULL,
        recorded_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_results_game_account
        ON game_results(game_id, account_id);
      CREATE INDEX IF NOT EXISTS idx_results_account ON game_results(account_id, ended_at);

      CREATE TABLE IF NOT EXISTS friendships (
        id TEXT PRIMARY KEY,
        requester_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        addressee_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        responded_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_friendship_pair
        ON friendships(requester_id, addressee_id);
      CREATE INDEX IF NOT EXISTS idx_friendship_addressee ON friendships(addressee_id);

      CREATE TABLE IF NOT EXISTS game_invites (
        id TEXT PRIMARY KEY,
        from_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        to_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        game_id TEXT NOT NULL,
        code TEXT NOT NULL,
        game_name TEXT NOT NULL,
        mode TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_invites_to ON game_invites(to_account_id, created_at);
    `);

    // Older databases predate account-scoped players; add the column in place.
    const playerColumns = db.prepare('PRAGMA table_info(players)').all() as { name: string }[];
    if (!playerColumns.some((column) => column.name === 'account_id')) {
      db.exec('ALTER TABLE players ADD COLUMN account_id TEXT');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_players_account ON players(account_id)');

    this.db = db;
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  private get d(): Database.Database {
    if (!this.db) throw new Error('SqliteStore.init() was not called');
    return this.db;
  }

  async createGame(game: GameRecord): Promise<void> {
    this.d
      .prepare(
        `INSERT INTO games (id, code, name, mode, status, host_player_id, settings, runtime,
          revision, created_at, updated_at, started_at, ended_at, countdown_ends_at,
          duration_ms, paused_at, accumulated_pause_ms, winner, ended_reason)
         VALUES (@id, @code, @name, @mode, @status, @host_player_id, @settings, @runtime,
          @revision, @created_at, @updated_at, @started_at, @ended_at, @countdown_ends_at,
          @duration_ms, @paused_at, @accumulated_pause_ms, @winner, @ended_reason)`,
      )
      .run(gameRow(game));
  }

  async getGame(id: string): Promise<GameRecord | null> {
    const row = this.d.prepare('SELECT * FROM games WHERE id = ?').get(id) as Row | undefined;
    return row ? mapGame(row) : null;
  }

  async getGameByCode(code: string): Promise<GameRecord | null> {
    const row = this.d
      .prepare('SELECT * FROM games WHERE upper(code) = upper(?)')
      .get(code) as Row | undefined;
    return row ? mapGame(row) : null;
  }

  async saveGame(game: GameRecord, expectedRevision: number): Promise<boolean> {
    const result = this.d
      .prepare(
        `UPDATE games SET status=@status, name=@name, settings=@settings, runtime=@runtime,
          revision=@revision, updated_at=@updated_at, started_at=@started_at, ended_at=@ended_at,
          countdown_ends_at=@countdown_ends_at, duration_ms=@duration_ms, paused_at=@paused_at,
          accumulated_pause_ms=@accumulated_pause_ms, winner=@winner, ended_reason=@ended_reason
         WHERE id=@id AND revision=@expected_revision`,
      )
      .run({ ...gameRow(game), expected_revision: expectedRevision });
    return result.changes > 0;
  }

  async listGamesNeedingTicks(): Promise<GameRecord[]> {
    const rows = this.d
      .prepare("SELECT * FROM games WHERE status IN ('active','countdown') ORDER BY updated_at ASC LIMIT 200")
      .all() as Row[];
    return rows.map(mapGame);
  }

  async listRecentGames(limit: number): Promise<GameRecord[]> {
    const rows = this.d
      .prepare('SELECT * FROM games ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as Row[];
    return rows.map(mapGame);
  }

  async createPlayer(player: PlayerRecord): Promise<void> {
    this.d
      .prepare(
        `INSERT INTO players (id, game_id, nickname, token_hash, team_key, is_host, ready,
          consent_location, last_seen_at, created_at)
         VALUES (@id, @game_id, @nickname, @token_hash, @team_key, @is_host, @ready,
          @consent_location, @last_seen_at, @created_at)`,
      )
      .run(playerRow(player));
  }

  async getPlayer(id: string): Promise<PlayerRecord | null> {
    const row = this.d.prepare('SELECT * FROM players WHERE id = ?').get(id) as Row | undefined;
    return row ? mapPlayer(row) : null;
  }

  async listPlayers(gameId: string): Promise<PlayerRecord[]> {
    const rows = this.d
      .prepare('SELECT * FROM players WHERE game_id = ? ORDER BY created_at ASC')
      .all(gameId) as Row[];
    return rows.map(mapPlayer);
  }

  async updatePlayer(player: PlayerRecord): Promise<void> {
    this.d
      .prepare(
        `UPDATE players SET nickname=@nickname, team_key=@team_key, is_host=@is_host,
          ready=@ready, consent_location=@consent_location, last_seen_at=@last_seen_at
         WHERE id=@id`,
      )
      .run(playerRow(player));
  }

  async upsertLocation(location: StoredLocation): Promise<void> {
    this.d
      .prepare(
        `INSERT INTO locations (player_id, game_id, lat, lng, accuracy_meters, recorded_at, received_at)
         VALUES (@player_id, @game_id, @lat, @lng, @accuracy_meters, @recorded_at, @received_at)
         ON CONFLICT(player_id) DO UPDATE SET
           lat=excluded.lat, lng=excluded.lng, accuracy_meters=excluded.accuracy_meters,
           recorded_at=excluded.recorded_at, received_at=excluded.received_at`,
      )
      .run({
        player_id: location.playerId,
        game_id: location.gameId,
        lat: location.lat,
        lng: location.lng,
        accuracy_meters: location.accuracyMeters,
        recorded_at: location.recordedAt,
        received_at: location.receivedAt,
      });
  }

  async getLocation(gameId: string, playerId: string): Promise<StoredLocation | null> {
    const row = this.d
      .prepare('SELECT * FROM locations WHERE game_id = ? AND player_id = ?')
      .get(gameId, playerId) as Row | undefined;
    return row ? mapLocation(row) : null;
  }

  async listLocations(gameId: string): Promise<StoredLocation[]> {
    const rows = this.d
      .prepare('SELECT * FROM locations WHERE game_id = ?')
      .all(gameId) as Row[];
    return rows.map(mapLocation);
  }

  async appendEvent(event: GameEventRecord): Promise<EventInsertResult> {
    const insert = this.d.transaction((e: GameEventRecord): EventInsertResult => {
      if (e.dedupeKey) {
        const existing = this.d
          .prepare('SELECT * FROM events WHERE game_id = ? AND dedupe_key = ?')
          .get(e.gameId, e.dedupeKey) as Row | undefined;
        if (existing) return { event: mapEvent(existing), inserted: false };
      }
      const max = this.d
        .prepare('SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM events WHERE game_id = ?')
        .get(e.gameId) as { maxSeq: number };
      const seq = max.maxSeq + 1;
      this.d
        .prepare(
          `INSERT INTO events (id, game_id, seq, type, audience, team_key, actor_id, payload, created_at, dedupe_key)
           VALUES (@id, @game_id, @seq, @type, @audience, @team_key, @actor_id, @payload, @created_at, @dedupe_key)`,
        )
        .run({ ...eventRow(e), seq });
      return { event: { ...e, seq }, inserted: true };
    });
    return insert(event);
  }

  async listEvents(gameId: string, sinceSeq: number, limit: number): Promise<GameEventRecord[]> {
    const rows = this.d
      .prepare('SELECT * FROM events WHERE game_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?')
      .all(gameId, sinceSeq, limit) as Row[];
    return rows.map(mapEvent);
  }

  async latestSeq(gameId: string): Promise<number> {
    const row = this.d
      .prepare('SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM events WHERE game_id = ?')
      .get(gameId) as { maxSeq: number };
    return row.maxSeq;
  }

  async enqueueJob(job: JobRecord): Promise<boolean> {
    const result = this.d
      .prepare(
        `INSERT OR IGNORE INTO jobs (id, game_id, kind, run_key, run_at, status, attempts, payload, created_at, claimed_at)
         VALUES (@id, @game_id, @kind, @run_key, @run_at, @status, @attempts, @payload, @created_at, @claimed_at)`,
      )
      .run(jobRow(job));
    return result.changes > 0;
  }

  async claimDueJobs(now: number, limit: number): Promise<JobRecord[]> {
    const claim = this.d.transaction((at: number, max: number): JobRecord[] => {
      this.d
        .prepare(
          "UPDATE jobs SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END, claimed_at = NULL " +
            "WHERE status = 'processing' AND claimed_at IS NOT NULL AND claimed_at < ?",
        )
        .run(at - 60_000);
      const due = this.d
        .prepare("SELECT * FROM jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at ASC LIMIT ?")
        .all(at, max) as Row[];
      if (due.length === 0) return [];
      const mark = this.d.prepare(
        "UPDATE jobs SET status = 'processing', claimed_at = ?, attempts = attempts + 1 WHERE id = ? AND status = 'pending'",
      );
      const claimed: JobRecord[] = [];
      for (const row of due) {
        const result = mark.run(at, row.id as string);
        if (result.changes > 0) {
          claimed.push(mapJob({ ...row, status: 'processing', claimed_at: at, attempts: (row.attempts as number) + 1 }));
        }
      }
      return claimed;
    });
    return claim(now, limit);
  }

  async finishJob(id: string, status: 'done' | 'failed'): Promise<void> {
    this.d
      .prepare('UPDATE jobs SET status = ?, claimed_at = NULL WHERE id = ?')
      .run(status, id);
  }

  async cancelPendingJobs(gameId: string, kinds: string[]): Promise<void> {
    if (kinds.length === 0) return;
    const placeholders = kinds.map(() => '?').join(',');
    this.d
      .prepare(
        `UPDATE jobs SET status='done', claimed_at=NULL
         WHERE game_id=? AND status='pending' AND kind IN (${placeholders})`,
      )
      .run(gameId, ...kinds);
  }
}

function gameRow(g: GameRecord) {
  return {
    id: g.id,
    code: g.code,
    name: g.name,
    mode: g.mode,
    status: g.status,
    host_player_id: g.hostPlayerId,
    settings: JSON.stringify(g.settings),
    runtime: JSON.stringify(g.runtime),
    revision: g.revision,
    created_at: g.createdAt,
    updated_at: g.updatedAt,
    started_at: g.startedAt,
    ended_at: g.endedAt,
    countdown_ends_at: g.countdownEndsAt,
    duration_ms: g.durationMs,
    paused_at: g.pausedAt,
    accumulated_pause_ms: g.accumulatedPauseMs,
    winner: g.winner ? JSON.stringify(g.winner) : null,
    ended_reason: g.endedReason,
  };
}

function mapGame(row: Row): GameRecord {
  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    mode: row.mode as GameRecord['mode'],
    status: row.status as GameRecord['status'],
    hostPlayerId: row.host_player_id as string,
    settings: json<ModeSettings>(row.settings, {} as ModeSettings),
    runtime: json(row.runtime, {}) as GameRecord['runtime'],
    revision: row.revision as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    startedAt: (row.started_at as number | null) ?? null,
    endedAt: (row.ended_at as number | null) ?? null,
    countdownEndsAt: (row.countdown_ends_at as number | null) ?? null,
    durationMs: row.duration_ms as number,
    pausedAt: (row.paused_at as number | null) ?? null,
    accumulatedPauseMs: row.accumulated_pause_ms as number,
    winner: json(row.winner, null) as GameRecord['winner'],
    endedReason: (row.ended_reason as string | null) ?? null,
  };
}

function playerRow(p: PlayerRecord) {
  return {
    id: p.id,
    game_id: p.gameId,
    nickname: p.nickname,
    token_hash: p.tokenHash,
    team_key: p.teamKey,
    is_host: p.isHost ? 1 : 0,
    ready: p.ready ? 1 : 0,
    consent_location: p.consentLocation ? 1 : 0,
    last_seen_at: p.lastSeenAt,
    created_at: p.createdAt,
  };
}

function mapPlayer(row: Row): PlayerRecord {
  return {
    id: row.id as string,
    gameId: row.game_id as string,
    nickname: row.nickname as string,
    tokenHash: row.token_hash as string,
    teamKey: (row.team_key as string | null) ?? null,
    isHost: Boolean(row.is_host),
    ready: Boolean(row.ready),
    consentLocation: Boolean(row.consent_location),
    lastSeenAt: row.last_seen_at as number,
    createdAt: row.created_at as number,
  };
}

function mapLocation(row: Row): StoredLocation {
  return {
    playerId: row.player_id as string,
    gameId: row.game_id as string,
    lat: row.lat as number,
    lng: row.lng as number,
    accuracyMeters: row.accuracy_meters as number,
    recordedAt: row.recorded_at as number,
    receivedAt: row.received_at as number,
  };
}

function eventRow(e: GameEventRecord) {
  return {
    id: e.id,
    game_id: e.gameId,
    seq: e.seq,
    type: e.type,
    audience: e.audience,
    team_key: e.teamKey,
    actor_id: e.actorId,
    payload: JSON.stringify(e.payload),
    created_at: e.createdAt,
    dedupe_key: e.dedupeKey,
  };
}

function mapEvent(row: Row): GameEventRecord {
  return {
    id: row.id as string,
    gameId: row.game_id as string,
    seq: row.seq as number,
    type: row.type as string,
    audience: row.audience as GameEventRecord['audience'],
    teamKey: (row.team_key as string | null) ?? null,
    actorId: (row.actor_id as string | null) ?? null,
    payload: json(row.payload, {}),
    createdAt: row.created_at as number,
    dedupeKey: (row.dedupe_key as string | null) ?? null,
  };
}

function jobRow(j: JobRecord) {
  return {
    id: j.id,
    game_id: j.gameId,
    kind: j.kind,
    run_key: j.runKey,
    run_at: j.runAt,
    status: j.status,
    attempts: j.attempts,
    payload: JSON.stringify(j.payload),
    created_at: j.createdAt,
    claimed_at: j.claimedAt,
  };
}

function mapJob(row: Row): JobRecord {
  return {
    id: row.id as string,
    gameId: row.game_id as string,
    kind: row.kind as string,
    runKey: row.run_key as string,
    runAt: row.run_at as number,
    status: row.status as JobRecord['status'],
    attempts: row.attempts as number,
    payload: json(row.payload, {}),
    createdAt: row.created_at as number,
    claimedAt: (row.claimed_at as number | null) ?? null,
  };
}
