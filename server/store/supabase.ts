import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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

/** Supabase/Postgres adapter. Only ever constructed on the server. */
export class SupabaseStore implements Store {
  readonly kind = 'supabase' as const;
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    if (!url || !serviceRoleKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for DATA_STORE=supabase');
    }
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async init(): Promise<void> {
    const { error } = await this.client.from('games').select('id', { count: 'exact', head: true });
    if (error) {
      throw new Error(
        `Supabase is not ready (${error.message}). Run supabase/migrations/0001_init.sql on the project and retry.`,
      );
    }
  }

  async close(): Promise<void> {
    // The REST client keeps no socket that needs closing.
  }

  async createGame(game: GameRecord): Promise<void> {
    const { error } = await this.client.from('games').insert(gameRow(game));
    if (error) throw new Error(`createGame failed: ${error.message}`);
  }

  async getGame(id: string): Promise<GameRecord | null> {
    const { data, error } = await this.client.from('games').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`getGame failed: ${error.message}`);
    return data ? mapGame(data as Row) : null;
  }

  async getGameByCode(code: string): Promise<GameRecord | null> {
    const { data, error } = await this.client
      .from('games')
      .select('*')
      .ilike('code', code)
      .maybeSingle();
    if (error) throw new Error(`getGameByCode failed: ${error.message}`);
    return data ? mapGame(data as Row) : null;
  }

  async saveGame(game: GameRecord, expectedRevision: number): Promise<boolean> {
    const row = gameRow(game);
    const { data, error } = await this.client
      .from('games')
      .update({
        status: row.status,
        name: row.name,
        settings: row.settings,
        runtime: row.runtime,
        revision: row.revision,
        updated_at: row.updated_at,
        started_at: row.started_at,
        ended_at: row.ended_at,
        countdown_ends_at: row.countdown_ends_at,
        duration_ms: row.duration_ms,
        paused_at: row.paused_at,
        accumulated_pause_ms: row.accumulated_pause_ms,
        winner: row.winner,
        ended_reason: row.ended_reason,
      })
      .eq('id', game.id)
      .eq('revision', expectedRevision)
      .select('id');
    if (error) throw new Error(`saveGame failed: ${error.message}`);
    return Array.isArray(data) && data.length > 0;
  }

  async listGamesNeedingTicks(): Promise<GameRecord[]> {
    const { data, error } = await this.client
      .from('games')
      .select('*')
      .in('status', ['active', 'countdown'])
      .order('updated_at', { ascending: true })
      .limit(200);
    if (error) throw new Error(`listGamesNeedingTicks failed: ${error.message}`);
    return (data ?? []).map((row) => mapGame(row as Row));
  }

  async listRecentGames(limit: number): Promise<GameRecord[]> {
    const { data, error } = await this.client
      .from('games')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`listRecentGames failed: ${error.message}`);
    return (data ?? []).map((row) => mapGame(row as Row));
  }

  async createPlayer(player: PlayerRecord): Promise<void> {
    const { error } = await this.client.from('players').insert(playerRow(player));
    if (error) throw new Error(`createPlayer failed: ${error.message}`);
  }

  async getPlayer(id: string): Promise<PlayerRecord | null> {
    const { data, error } = await this.client.from('players').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`getPlayer failed: ${error.message}`);
    return data ? mapPlayer(data as Row) : null;
  }

  async listPlayers(gameId: string): Promise<PlayerRecord[]> {
    const { data, error } = await this.client
      .from('players')
      .select('*')
      .eq('game_id', gameId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`listPlayers failed: ${error.message}`);
    return (data ?? []).map((row) => mapPlayer(row as Row));
  }

  async listPlayersByAccount(accountId: string): Promise<PlayerRecord[]> {
    const { data, error } = await this.client
      .from('players')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(`listPlayersByAccount failed: ${error.message}`);
    return (data ?? []).map((row) => mapPlayer(row as Row));
  }

  async updatePlayer(player: PlayerRecord): Promise<void> {
    const { error } = await this.client
      .from('players')
      .update({
        nickname: player.nickname,
        team_key: player.teamKey,
        is_host: player.isHost,
        ready: player.ready,
        consent_location: player.consentLocation,
        account_id: player.accountId,
        last_seen_at: player.lastSeenAt,
      })
      .eq('id', player.id);
    if (error) throw new Error(`updatePlayer failed: ${error.message}`);
  }

  async upsertLocation(location: StoredLocation): Promise<void> {
    const { error } = await this.client.from('locations').upsert(
      {
        player_id: location.playerId,
        game_id: location.gameId,
        lat: location.lat,
        lng: location.lng,
        accuracy_meters: location.accuracyMeters,
        recorded_at: location.recordedAt,
        received_at: location.receivedAt,
      },
      { onConflict: 'player_id' },
    );
    if (error) throw new Error(`upsertLocation failed: ${error.message}`);
  }

  async getLocation(gameId: string, playerId: string): Promise<StoredLocation | null> {
    const { data, error } = await this.client
      .from('locations')
      .select('*')
      .eq('game_id', gameId)
      .eq('player_id', playerId)
      .maybeSingle();
    if (error) throw new Error(`getLocation failed: ${error.message}`);
    return data ? mapLocation(data as Row) : null;
  }

  async listLocations(gameId: string): Promise<StoredLocation[]> {
    const { data, error } = await this.client.from('locations').select('*').eq('game_id', gameId);
    if (error) throw new Error(`listLocations failed: ${error.message}`);
    return (data ?? []).map((row) => mapLocation(row as Row));
  }

  async appendEvent(event: GameEventRecord): Promise<EventInsertResult> {
    if (event.dedupeKey) {
      const { data: existing, error: readError } = await this.client
        .from('events')
        .select('*')
        .eq('game_id', event.gameId)
        .eq('dedupe_key', event.dedupeKey)
        .maybeSingle();
      if (readError) throw new Error(`appendEvent failed: ${readError.message}`);
      if (existing) return { event: mapEvent(existing as Row), inserted: false };
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data, error } = await this.client
        .from('events')
        .insert({
          id: event.id,
          game_id: event.gameId,
          type: event.type,
          audience: event.audience,
          team_key: event.teamKey,
          actor_id: event.actorId,
          payload: event.payload,
          created_at: event.createdAt,
          dedupe_key: event.dedupeKey,
        })
        .select('*')
        .single();
      if (!error && data) return { event: mapEvent(data as Row), inserted: true };
      if (error && !error.message.toLowerCase().includes('duplicate')) {
        throw new Error(`appendEvent failed: ${error.message}`);
      }
      if (event.dedupeKey) {
        const { data: existing } = await this.client
          .from('events')
          .select('*')
          .eq('game_id', event.gameId)
          .eq('dedupe_key', event.dedupeKey)
          .maybeSingle();
        if (existing) return { event: mapEvent(existing as Row), inserted: false };
      }
    }
    throw new Error('appendEvent failed after retries');
  }

  async listEvents(gameId: string, sinceSeq: number, limit: number): Promise<GameEventRecord[]> {
    const { data, error } = await this.client
      .from('events')
      .select('*')
      .eq('game_id', gameId)
      .gt('seq', sinceSeq)
      .order('seq', { ascending: true })
      .limit(limit);
    if (error) throw new Error(`listEvents failed: ${error.message}`);
    return (data ?? []).map((row) => mapEvent(row as Row));
  }

  async latestSeq(gameId: string): Promise<number> {
    const { data, error } = await this.client
      .from('events')
      .select('seq')
      .eq('game_id', gameId)
      .order('seq', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`latestSeq failed: ${error.message}`);
    return data ? Number((data as Row).seq) : 0;
  }

  async enqueueJob(job: JobRecord): Promise<boolean> {
    const { error } = await this.client.from('jobs').insert(jobRow(job));
    if (!error) return true;
    if (error.message.toLowerCase().includes('duplicate')) return false;
    throw new Error(`enqueueJob failed: ${error.message}`);
  }

  async claimDueJobs(now: number, limit: number): Promise<JobRecord[]> {
    await this.client
      .from('jobs')
      .update({ status: 'pending', claimed_at: null })
      .eq('status', 'processing')
      .lt('claimed_at', now - 60_000);
    const { data: due, error } = await this.client
      .from('jobs')
      .select('*')
      .eq('status', 'pending')
      .lte('run_at', now)
      .order('run_at', { ascending: true })
      .limit(limit);
    if (error) throw new Error(`claimDueJobs failed: ${error.message}`);
    if (!due || due.length === 0) return [];
    const ids = due.map((row) => (row as Row).id as string);
    const { data: claimed, error: claimError } = await this.client
      .from('jobs')
      .update({ status: 'processing', claimed_at: now })
      .in('id', ids)
      .eq('status', 'pending')
      .select('*');
    if (claimError) throw new Error(`claimDueJobs failed: ${claimError.message}`);
    return (claimed ?? []).map((row) => mapJob(row as Row));
  }

  async finishJob(id: string, status: 'done' | 'failed'): Promise<void> {
    const { error } = await this.client
      .from('jobs')
      .update({ status, claimed_at: null })
      .eq('id', id);
    if (error) throw new Error(`finishJob failed: ${error.message}`);
  }

  async cancelPendingJobs(gameId: string, kinds: string[]): Promise<void> {
    if (kinds.length === 0) return;
    const { error } = await this.client
      .from('jobs')
      .update({ status: 'done', claimed_at: null })
      .eq('game_id', gameId)
      .eq('status', 'pending')
      .in('kind', kinds);
    if (error) throw new Error(`cancelPendingJobs failed: ${error.message}`);
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
    settings: g.settings,
    runtime: g.runtime,
    revision: g.revision,
    created_at: g.createdAt,
    updated_at: g.updatedAt,
    started_at: g.startedAt,
    ended_at: g.endedAt,
    countdown_ends_at: g.countdownEndsAt,
    duration_ms: g.durationMs,
    paused_at: g.pausedAt,
    accumulated_pause_ms: g.accumulatedPauseMs,
    winner: g.winner,
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
    settings: (row.settings ?? {}) as ModeSettings,
    runtime: (row.runtime ?? {}) as GameRecord['runtime'],
    revision: Number(row.revision),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    startedAt: row.started_at == null ? null : Number(row.started_at),
    endedAt: row.ended_at == null ? null : Number(row.ended_at),
    countdownEndsAt: row.countdown_ends_at == null ? null : Number(row.countdown_ends_at),
    durationMs: Number(row.duration_ms),
    pausedAt: row.paused_at == null ? null : Number(row.paused_at),
    accumulatedPauseMs: Number(row.accumulated_pause_ms ?? 0),
    winner: (row.winner ?? null) as GameRecord['winner'],
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
    is_host: p.isHost,
    ready: p.ready,
    consent_location: p.consentLocation,
    account_id: p.accountId,
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
    lastSeenAt: Number(row.last_seen_at),
    createdAt: Number(row.created_at),
  };
}

function mapLocation(row: Row): StoredLocation {
  return {
    playerId: row.player_id as string,
    gameId: row.game_id as string,
    lat: Number(row.lat),
    lng: Number(row.lng),
    accuracyMeters: Number(row.accuracy_meters),
    recordedAt: Number(row.recorded_at),
    receivedAt: Number(row.received_at),
  };
}

function mapEvent(row: Row): GameEventRecord {
  return {
    id: row.id as string,
    gameId: row.game_id as string,
    seq: Number(row.seq),
    type: row.type as string,
    audience: row.audience as GameEventRecord['audience'],
    teamKey: (row.team_key as string | null) ?? null,
    actorId: (row.actor_id as string | null) ?? null,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: Number(row.created_at),
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
    payload: j.payload,
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
    runAt: Number(row.run_at),
    status: row.status as JobRecord['status'],
    attempts: Number(row.attempts),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: Number(row.created_at),
    claimedAt: row.claimed_at == null ? null : Number(row.claimed_at),
  };
}
