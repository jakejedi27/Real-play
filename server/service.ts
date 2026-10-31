/**
 * Game service — the only place that mutates authoritative game state.
 *
 * Every request is authenticated by a per-player bearer token, every rule is
 * checked here (never trusted from the browser), and every snapshot is filtered
 * per viewer. Manhunt runner positions leave the server only through recorded
 * reveals, so a hunter cannot obtain them from any endpoint.
 */
import {
  MODE_IDS,
  type CtfSettings,
  type GameEventRecord,
  type GameRecord,
  type GameSnapshot,
  type GameStatus,
  type JobRecord,
  type LocationView,
  type ManhuntSettings,
  type ModeId,
  type ModeSettings,
  type ObjectiveView,
  type PlayArea,
  type PlayerRecord,
  type PlayerView,
  type RevealView,
  type ResultsView,
  type ScavengerSettings,
  type ScoreLine,
  type StoredLocation,
  type TeamView,
  type TerritorySettings,
  type ZoneView,
} from '../shared/types';
import {
  defaultSettings,
  generatedBases,
  parseSettings,
  publicSettings,
  validateSettings,
} from '../shared/settings';
import { distanceMeters, isValidLatLng } from '../shared/geo';
import type { LocationMap } from './engine';
import * as engine from './engine';
import type { Store } from './store';
import {
  hashToken,
  newGameCode,
  newId,
  newPlayerCredentials,
  normalizeCode,
  normalizeNickname,
  safeEqualHex,
  validateNickname,
} from './auth';

const CONNECTED_WINDOW_MS = 30_000;
const FEED_LIMIT = 250;
const MAX_ACCURACY_METERS = 100_000;
const MAX_CLOCK_SKEW_MS = 60_000;
const MAX_FIX_AGE_MS = 10 * 60_000;
const TIMED_JOB_KINDS = ['reveal', 'territory-tick', 'scavenger-deadline', 'countdown'];

export class ServiceError extends Error {
  readonly status: number;
  readonly details: string[];

  constructor(status: number, message: string, details: string[] = []) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
    this.details = details;
  }
}

/** Declared as a function so TypeScript narrows control flow after it throws. */
function fail(status: number, message: string, details: string[] = []): never {
  throw new ServiceError(status, message, details);
}

interface MutateContext {
  game: GameRecord;
  players: PlayerRecord[];
  locations: LocationMap;
  /** Apply an engine result: finish state is applied and effects are persisted. */
  apply(result: engine.EngineResult): engine.EngineResult;
  /** Mark that the caller mutated the game directly. */
  markChanged(): void;
  touched: boolean;
}

interface Session {
  game: GameRecord;
  player: PlayerRecord;
}

export interface CreateGameInput {
  mode: string;
  name?: string;
  nickname: string;
  settings: unknown;
}

export interface JoinResult {
  token: string;
  playerId: string;
  gameId: string;
  snapshot: GameSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function teamConfigOf(settings: ModeSettings, key: string | null) {
  if (!key) return null;
  return settings.teams.find((team) => team.key === key) ?? null;
}

function finishGame(game: GameRecord, finished: engine.EngineFinished, now: number): void {
  game.status = 'ended';
  game.endedAt = now;
  game.endedReason = finished.reason;
  game.winner = { key: finished.key, label: finished.label, reason: finished.reason };
  game.runtime.winner = game.winner;
  game.runtime.endedReason = finished.reason;
  game.pausedAt = null;
}

export class GameService {
  constructor(
    readonly store: Store,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  private now(): number {
    return this.clock();
  }

  /* ---------------------------------------------------------------- */
  /* Creation and membership                                           */
  /* ---------------------------------------------------------------- */

  async createGame(input: CreateGameInput): Promise<{ token: string; snapshot: GameSnapshot }> {
    const mode = (MODE_IDS as readonly string[]).includes(input.mode)
      ? (input.mode as ModeId)
      : fail(400, 'Choose one of the four supported game modes.');

    const nickname = normalizeNickname(input.nickname);
    const nicknameError = validateNickname(nickname);
    if (nicknameError) fail(400, nicknameError, [nicknameError]);

    const provided = isRecord(input.settings) ? input.settings : {};
    const withMode = isRecord(provided) ? { ...provided, mode } : provided;
    let settings: ModeSettings;
    if (isRecord(withMode) && withMode.mode) {
      const parsed = parseSettings(mode, { ...defaultSettings(mode), ...withMode, mode });
      if (!parsed.ok) fail(400, 'Some settings are not valid.', parsed.errors);
      settings = parsed.settings;
    } else {
      settings = defaultSettings(mode);
    }

    const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 60) : defaultName(mode);
    const now = this.now();

    const game: GameRecord = {
      id: newId(),
      code: await this.uniqueCode(),
      name,
      mode,
      status: 'lobby',
      hostPlayerId: '',
      settings,
      runtime: emptyRuntime(),
      revision: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      endedAt: null,
      countdownEndsAt: null,
      durationMs: settings.durationMinutes * 60_000,
      pausedAt: null,
      accumulatedPauseMs: 0,
      winner: null,
      endedReason: null,
    };

    const credentials = newPlayerCredentials();
    const host: PlayerRecord = {
      id: newId(),
      gameId: game.id,
      nickname,
      tokenHash: credentials.tokenHash,
      teamKey: settings.teams[0]?.key ?? null,
      isHost: true,
      ready: true,
      consentLocation: settings.area.enabled,
      lastSeenAt: now,
      createdAt: now,
    };
    game.hostPlayerId = host.id;

    await this.store.createGame(game);
    await this.store.createPlayer(host);
    await this.store.appendEvent({
      id: newId(),
      gameId: game.id,
      seq: 0,
      type: 'game_created',
      audience: 'all',
      teamKey: null,
      actorId: host.id,
      payload: { nickname: host.nickname, mode, name },
      createdAt: now,
      dedupeKey: null,
    });

    return {
      token: credentials.token,
      snapshot: await this.snapshotFor(game.id, credentials.token),
    };
  }

  private async uniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = newGameCode();
      const existing = await this.store.getGameByCode(code);
      if (!existing) return code;
    }
    return fail(503, 'Could not allocate a game code. Please try again.');
  }

  async previewByCode(rawCode: unknown): Promise<{
    id: string;
    code: string;
    name: string;
    mode: ModeId;
    status: GameStatus;
    playerCount: number;
    maxPlayers: number;
    hostNickname: string;
    requiresConsent: boolean;
  }> {
    const code = normalizeCode(rawCode);
    if (code.length < 4) fail(400, 'Enter the game code the host shared with you.');
    const game = await this.store.getGameByCode(code);
    if (!game) fail(404, 'No game found with that code.');
    const players = await this.store.listPlayers(game.id);
    const host = players.find((p) => p.id === game.hostPlayerId);
    return {
      id: game.id,
      code: game.code,
      name: game.name,
      mode: game.mode,
      status: game.status,
      playerCount: players.length,
      maxPlayers: game.settings.maxPlayers,
      hostNickname: host?.nickname ?? 'Host',
      requiresConsent: true,
    };
  }

  async joinGame(rawCode: unknown, rawNickname: unknown, consentLocation: unknown): Promise<JoinResult> {
    const code = normalizeCode(rawCode);
    const nickname = normalizeNickname(rawNickname);
    const nicknameError = validateNickname(nickname);
    if (nicknameError) fail(400, nicknameError, [nicknameError]);
    if (consentLocation !== true) {
      fail(400, 'Location sharing consent is required to play location-based modes.');
    }
    const game = await this.store.getGameByCode(code);
    if (!game) fail(404, 'No game found with that code.');
    if (game.status === 'ended' || game.status === 'cancelled') {
      fail(409, 'That game is no longer open for new players.');
    }
    const players = await this.store.listPlayers(game.id);
    if (players.length >= game.settings.maxPlayers) fail(409, 'That game is full.');
    if (players.some((p) => p.nickname.toLowerCase() === nickname.toLowerCase())) {
      fail(409, 'That nickname is already taken in this game.');
    }

    const now = this.now();
    const credentials = newPlayerCredentials();
    const player: PlayerRecord = {
      id: newId(),
      gameId: game.id,
      nickname,
      tokenHash: credentials.tokenHash,
      teamKey: this.pickTeam(game, players),
      isHost: false,
      ready: false,
      consentLocation: true,
      lastSeenAt: now,
      createdAt: now,
    };

    await this.store.createPlayer(player);
    await this.mutate(game.id, (ctx) => {
      ctx.markChanged();
      ctx.apply({
        changed: true,
        events: [
          {
            type: 'player_joined',
            audience: 'all',
            payload: { nickname: player.nickname, playerId: player.id },
            dedupeKey: `join:${player.id}`,
          },
        ],
        jobs: [],
        finished: null,
      });
      ctx.game.updatedAt = now;
    });

    return {
      token: credentials.token,
      playerId: player.id,
      gameId: game.id,
      snapshot: await this.snapshotFor(game.id, credentials.token),
    };
  }

  /** Auto-assignment honours the host's rule and keeps teams balanced. */
  private pickTeam(game: GameRecord, players: PlayerRecord[]): string | null {
    const settings = game.settings;
    if (settings.teamAssignment !== 'auto') return null;
    const counts = new Map<string, number>();
    for (const team of settings.teams) counts.set(team.key, 0);
    for (const player of players) {
      if (player.teamKey && counts.has(player.teamKey)) {
        counts.set(player.teamKey, (counts.get(player.teamKey) ?? 0) + 1);
      }
    }
    let best: string | null = null;
    let bestCount = Number.POSITIVE_INFINITY;
    for (const team of settings.teams) {
      const count = counts.get(team.key) ?? 0;
      if (settings.maxTeamSize > 0 && count >= settings.maxTeamSize) continue;
      if (count < bestCount) {
        best = team.key;
        bestCount = count;
      }
    }
    return best;
  }

  async authenticate(gameId: string, token: string | undefined | null): Promise<Session> {
    if (!token) fail(401, 'Sign in to this game first.');
    const game = await this.store.getGame(gameId);
    if (!game) fail(404, 'Game not found.');
    const players = await this.store.listPlayers(gameId);
    const tokenHash = hashToken(token as string);
    const player = players.find((p) => safeEqualHex(p.tokenHash, tokenHash));
    if (!player) fail(401, 'Your game session is no longer valid.');
    return { game, player: player as PlayerRecord };
  }

  private async requireHost(gameId: string, token: string | undefined | null): Promise<Session> {
    const session = await this.authenticate(gameId, token);
    if (!session.player.isHost) fail(403, 'Only the host can do that.');
    return session;
  }

  /** Keeps presence fresh without writing on every single poll. */
  private async touch(session: Session): Promise<void> {
    const now = this.now();
    if (now - session.player.lastSeenAt < 10_000) return;
    const player = { ...session.player, lastSeenAt: now };
    await this.store.updatePlayer(player);
    session.player = player;
  }

  /* ---------------------------------------------------------------- */
  /* Snapshot                                                         */
  /* ---------------------------------------------------------------- */

  async snapshotFor(gameId: string, token: string | undefined | null): Promise<GameSnapshot> {
    const session = await this.authenticate(gameId, token);
    await this.touch(session);
    return this.buildSnapshot(session.game, session.player);
  }

  async buildSnapshot(game: GameRecord, viewer: PlayerRecord): Promise<GameSnapshot> {
    const now = this.now();
    const players = await this.store.listPlayers(game.id);
    const locations = await this.store.listLocations(game.id);
    const events = await this.store.listEvents(game.id, 0, FEED_LIMIT);
    return buildSnapshot(game, viewer, players, locations, events, now);
  }

  /* ---------------------------------------------------------------- */
  /* Mutation plumbing                                                */
  /* ---------------------------------------------------------------- */

  private async mutate<T>(gameId: string, fn: (ctx: MutateContext) => T | Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const now = this.now();
      const game = await this.store.getGame(gameId);
      if (!game) fail(404, 'Game not found.');
      const players = await this.store.listPlayers(gameId);
      const stored = await this.store.listLocations(gameId);
      const locations: LocationMap = new Map(stored.map((location) => [location.playerId, location]));
      const expectedRevision = game.revision;
      const results: engine.EngineResult[] = [];

      const ctx: MutateContext = {
        game,
        players,
        locations,
        touched: false,
        markChanged() {
          this.touched = true;
        },
        apply(result) {
          if (result.finished) finishGame(game, result.finished, now);
          if (result.changed || result.finished || result.events.length || result.jobs.length) {
            results.push(result);
            this.touched = true;
          }
          return result;
        },
      };

      const value = await fn(ctx);

      if (!ctx.touched) return value;

      const saved = await this.store.saveGame(game, expectedRevision);
      if (!saved) continue;

      for (const result of results) {
        await this.commitEffects(game, result, now);
      }
      if (game.status === 'ended' || game.status === 'cancelled') {
        await this.store.cancelPendingJobs(game.id, TIMED_JOB_KINDS);
      }
      return value;
    }
    return fail(409, 'The game changed while saving. Please retry.');
  }

  private async commitEffects(game: GameRecord, result: engine.EngineResult, now: number): Promise<void> {
    for (const event of result.events) {
      await this.store.appendEvent({
        id: newId(),
        gameId: game.id,
        seq: 0,
        type: event.type,
        audience: event.audience,
        teamKey: event.teamKey ?? null,
        actorId: event.actorId ?? null,
        payload: event.payload,
        createdAt: now,
        dedupeKey: event.dedupeKey ?? null,
      });
    }
    for (const job of result.jobs) {
      await this.store.enqueueJob({
        id: newId(),
        gameId: game.id,
        kind: job.kind,
        runKey: job.runKey,
        runAt: job.runAt,
        status: 'pending',
        attempts: 0,
        payload: job.payload,
        createdAt: now,
        claimedAt: null,
      });
    }
  }

  private async recordEvent(
    gameId: string,
    event: {
      type: string;
      audience: 'all' | 'team' | 'host' | 'host-team';
      teamKey?: string | null;
      actorId?: string | null;
      payload?: Record<string, unknown>;
      dedupeKey?: string | null;
    },
  ): Promise<void> {
    await this.store.appendEvent({
      id: newId(),
      gameId,
      seq: 0,
      type: event.type,
      audience: event.audience,
      teamKey: event.teamKey ?? null,
      actorId: event.actorId ?? null,
      payload: event.payload ?? {},
      createdAt: this.now(),
      dedupeKey: event.dedupeKey ?? null,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Lobby actions                                                    */
  /* ---------------------------------------------------------------- */

  async updateSettings(gameId: string, token: string | undefined, rawSettings: unknown): Promise<GameSnapshot> {
    const session = await this.requireHost(gameId, token);
    if (session.game.status !== 'lobby') {
      fail(409, 'Rules are frozen once the game has started. Announcements stay available.');
    }
    const raw = isRecord(rawSettings) ? rawSettings : {};
    const parsed = parseSettings(session.game.mode, { ...session.game.settings, ...raw, mode: session.game.mode });
    if (!parsed.ok) fail(400, 'Some settings are not valid.', parsed.errors);
    const { errors } = validateSettings(parsed.settings);
    if (errors.length > 0) fail(400, 'Fix these settings before saving.', errors);

    await this.mutate(gameId, (ctx) => {
      ctx.game.settings = parsed.settings;
      ctx.game.durationMs = parsed.settings.durationMinutes * 60_000;
      ctx.game.runtime = emptyRuntime();
      ctx.game.updatedAt = this.now();
      ctx.markChanged();
      ctx.apply({
        changed: true,
        events: [
          {
            type: 'settings_updated',
            audience: 'all',
            payload: { nickname: session.player.nickname },
            dedupeKey: null,
          },
        ],
        jobs: [],
        finished: null,
      });
    });
    return this.snapshotFor(gameId, token);
  }

  async setReady(gameId: string, token: string | undefined, ready: unknown): Promise<GameSnapshot> {
    const session = await this.authenticate(gameId, token);
    if (session.game.status !== 'lobby') fail(409, 'The lobby is closed.');
    const nextReady = ready === true;
    await this.mutate(gameId, async (ctx) => {
      const player = ctx.players.find((p) => p.id === session.player.id);
      if (!player) fail(404, 'Player not found.');
      if (player.ready === nextReady) return;
      player.ready = nextReady;
      player.lastSeenAt = this.now();
      await this.store.updatePlayer(player);
      ctx.apply({
        changed: true,
        events: [
          {
            type: 'ready_changed',
            audience: 'all',
            actorId: player.id,
            payload: { nickname: player.nickname, ready: nextReady },
            dedupeKey: `ready:${player.id}:${nextReady}:${Math.floor(this.now() / 1000)}`,
          },
        ],
        jobs: [],
        finished: null,
      });
    });
    return this.snapshotFor(gameId, token);
  }

  async setTeam(gameId: string, token: string | undefined, playerId: unknown, teamKey: unknown): Promise<GameSnapshot> {
    const session = await this.authenticate(gameId, token);
    const game = session.game;
    if (game.status !== 'lobby') fail(409, 'Teams are locked once the game has started.');
    const targetId = typeof playerId === 'string' ? playerId : session.player.id;
    const isSelf = targetId === session.player.id;
    if (!isSelf && !session.player.isHost) fail(403, 'Only the host can move another player.');
    if (!session.player.isHost && game.settings.teamAssignment === 'host') {
      fail(403, 'The host assigns teams for this game.');
    }
    const key = teamKey === null || teamKey === undefined ? null : String(teamKey);
    if (key && !game.settings.teams.some((team) => team.key === key)) {
      fail(400, 'That team does not exist in this game.');
    }
    await this.mutate(gameId, async (ctx) => {
      const target = ctx.players.find((p) => p.id === targetId);
      if (!target) fail(404, 'Player not found.');
      if (target.teamKey === key) return;
      const teammates = ctx.players.filter((p) => p.teamKey === key && p.id !== targetId);
      if (key && ctx.game.settings.maxTeamSize > 0 && teammates.length >= ctx.game.settings.maxTeamSize) {
        fail(409, 'That team is already full.');
      }
      target.teamKey = key;
      await this.store.updatePlayer(target);
      ctx.apply({
        changed: true,
        events: [
          {
            type: 'team_changed',
            audience: 'all',
            actorId: target.id,
            payload: { nickname: target.nickname, teamKey: key, teamName: teamConfigOf(ctx.game.settings, key)?.name ?? 'No team' },
            dedupeKey: `team:${target.id}:${key ?? 'none'}:${this.now()}`,
          },
        ],
        jobs: [],
        finished: null,
      });
    });
    return this.snapshotFor(gameId, token);
  }

  async startGame(gameId: string, token: string | undefined): Promise<GameSnapshot> {
    const session = await this.requireHost(gameId, token);
    const game = session.game;
    if (game.status !== 'lobby') fail(409, 'This game has already started.');
    const players = await this.store.listPlayers(gameId);
    if (players.length < 2) fail(409, 'At least two players are needed to start.');

    const notReady = players.filter((p) => !p.isHost && !p.ready);
    if (notReady.length > 0) {
      fail(
        409,
        `Waiting for ${notReady.map((p) => p.nickname).join(', ')} to be ready.`,
        notReady.map((p) => `${p.nickname} is not ready yet.`),
      );
    }

    const stillMissingTeam = players.filter((p) => p.teamKey === null);
    if (game.settings.mode !== 'scavenger' && stillMissingTeam.length > 0) {
      fail(409, 'Everyone needs a team before the game starts.');
    }

    const settings = this.prepareStartSettings(game, players);
    const { errors } = validateSettings(settings);
    if (errors.length > 0) fail(400, 'Fix these settings before starting.', errors);

    await this.mutate(gameId, (ctx) => {
      ctx.game.settings = settings;
      ctx.game.runtime = emptyRuntime();
      const now = this.now();
      ctx.apply(engine.prepareStart(ctx.game, now));
      ctx.markChanged();
    });
    return this.snapshotFor(gameId, token);
  }

  /** Fills in auto-generated bases so a start never fails on a null base. */
  private prepareStartSettings(game: GameRecord, players: PlayerRecord[]): ModeSettings {
    const settings = game.settings;
    if (settings.mode !== 'ctf') return settings;
    const ctf = settings as CtfSettings;
    const missing = ctf.teams.some((team) => !ctf.bases[team.key]);
    if (!missing) return settings;
    if (!ctf.area.enabled || !ctf.area.center) {
      fail(400, 'Capture the Flag needs a play area centre or explicit team bases.');
    }
    const generated = generatedBases(ctf.teams, ctf.area.center as { lat: number; lng: number }, ctf.area.radiusMeters);
    const bases: CtfSettings['bases'] = { ...ctf.bases };
    for (const team of ctf.teams) {
      if (!bases[team.key]) bases[team.key] = generated[team.key] ?? null;
    }
    void players;
    return { ...ctf, bases };
  }

  async pauseGame(gameId: string, token: string | undefined): Promise<GameSnapshot> {
    await this.requireHost(gameId, token);
    await this.mutate(gameId, (ctx) => {
      const game = ctx.game;
      if (game.status !== 'active' && game.status !== 'countdown') fail(409, 'Only a running game can be paused.');
      const now = this.now();
      game.status = 'paused';
      game.pausedAt = now;
      ctx.apply({
        changed: true,
        events: [
          {
            type: 'game_paused',
            audience: 'all',
            payload: { at: now },
            dedupeKey: `paused:${game.id}:${now}`,
          },
        ],
        jobs: [],
        finished: null,
      });
    });
    return this.snapshotFor(gameId, token);
  }

  async resumeGame(gameId: string, token: string | undefined): Promise<GameSnapshot> {
    await this.requireHost(gameId, token);
    await this.mutate(gameId, (ctx) => {
      const game = ctx.game;
      if (game.status !== 'paused') fail(409, 'This game is not paused.');
      const now = this.now();
      if (game.pausedAt) game.accumulatedPauseMs += Math.max(0, now - game.pausedAt);
      game.pausedAt = null;
      game.status = game.startedAt ? 'active' : 'countdown';
      ctx.apply({
        changed: true,
        events: [
          {
            type: 'game_resumed',
            audience: 'all',
            payload: { at: now },
            dedupeKey: `resumed:${game.id}:${now}`,
          },
        ],
        jobs: [],
        finished: null,
      });
    });
    return this.snapshotFor(gameId, token);
  }

  async endGame(gameId: string, token: string | undefined): Promise<GameSnapshot> {
    await this.requireHost(gameId, token);
    await this.mutate(gameId, (ctx) => {
      const game = ctx.game;
      if (game.status === 'ended' || game.status === 'cancelled') fail(409, 'This game is already closed.');
      const now = this.now();
      ctx.apply(engine.tick(game, ctx.players, ctx.locations, now));
      if (game.status !== 'ended') {
        ctx.apply({
          changed: true,
          events: [],
          jobs: [],
          finished: {
            key: leadingKey(game) ?? 'draw',
            label: leadingLabel(game),
            reason: 'The host ended the match.',
          },
        });
        finishGame(game, game.runtime.winner as engine.EngineFinished, now);
      }
      ctx.markChanged();
      ctx.apply({
        changed: true,
        events: [
          {
            type: 'game_ended',
            audience: 'all',
            payload: { reason: game.endedReason ?? 'The host ended the match.' },
            dedupeKey: `ended:${game.id}`,
          },
        ],
        jobs: [],
        finished: null,
      });
    });
    return this.snapshotFor(gameId, token);
  }

  async cancelGame(gameId: string, token: string | undefined): Promise<GameSnapshot> {
    await this.requireHost(gameId, token);
    await this.mutate(gameId, (ctx) => {
      const game = ctx.game;
      if (game.status === 'ended') fail(409, 'This game has already finished.');
      const now = this.now();
      game.status = 'cancelled';
      game.endedAt = now;
      game.endedReason = 'The host cancelled this game.';
      ctx.markChanged();
      ctx.apply({
        changed: true,
        events: [
          {
            type: 'game_cancelled',
            audience: 'all',
            payload: { reason: game.endedReason },
            dedupeKey: `cancelled:${game.id}`,
          },
        ],
        jobs: [],
        finished: null,
      });
    });
    return this.snapshotFor(gameId, token);
  }

  async announce(gameId: string, token: string | undefined, rawMessage: unknown): Promise<GameSnapshot> {
    const session = await this.requireHost(gameId, token);
    const message = typeof rawMessage === 'string' ? rawMessage.trim().slice(0, 300) : '';
    if (!message) fail(400, 'Write a message before sending it.');
    await this.throttle(`announce:${session.player.id}`, 2_000);
    await this.recordEvent(gameId, {
      type: 'announcement',
      audience: 'all',
      actorId: session.player.id,
      payload: { message, nickname: session.player.nickname },
    });
    return this.snapshotFor(gameId, token);
  }

  async pingTeam(gameId: string, token: string | undefined, rawMessage: unknown): Promise<GameSnapshot> {
    const session = await this.authenticate(gameId, token);
    if (!session.player.teamKey) fail(400, 'Join a team before sending quick messages.');
    if (session.game.status !== 'active' && session.game.status !== 'paused') {
      fail(409, 'Quick messages are only available during a match.');
    }
    const message = typeof rawMessage === 'string' ? rawMessage.trim().slice(0, 160) : '';
    if (!message) fail(400, 'Quick messages cannot be empty.');
    await this.throttle(`ping:${session.player.id}`, 8_000);
    // Team-only text with no coordinates: pings never bypass reveal privacy.
    await this.recordEvent(gameId, {
      type: 'ping',
      audience: 'team',
      teamKey: session.player.teamKey,
      actorId: session.player.id,
      payload: { message, nickname: session.player.nickname },
    });
    return this.snapshotFor(gameId, token);
  }

  async checkIn(gameId: string, token: string | undefined, rawStatus: unknown): Promise<GameSnapshot> {
    const session = await this.authenticate(gameId, token);
    const status = typeof rawStatus === 'string' ? rawStatus : '';
    const allowed = ['ok', 'need-help', 'regroup'] as const;
    if (!(allowed as readonly string[]).includes(status)) fail(400, 'Unknown check-in status.');
    if (!session.player.teamKey) fail(400, 'Join a team before checking in.');
    const settings = session.game.settings;
    if (settings.mode !== 'manhunt' || !(settings as ManhuntSettings).hunterCheckIns) {
      fail(409, 'Check-ins are disabled for this game.');
    }
    await this.throttle(`checkin:${session.player.id}`, 5_000);
    await this.recordEvent(gameId, {
      type: 'check_in',
      audience: 'team',
      teamKey: session.player.teamKey,
      actorId: session.player.id,
      payload: { status, nickname: session.player.nickname },
    });
    return this.snapshotFor(gameId, token);
  }

  private readonly throttles = new Map<string, number>();

  private async throttle(key: string, minimumIntervalMs: number): Promise<void> {
    const now = this.now();
    const last = this.throttles.get(key);
    if (last !== undefined && now - last < minimumIntervalMs) {
      fail(429, 'Slow down a moment before sending that again.');
    }
    this.throttles.set(key, now);
  }

  /* ---------------------------------------------------------------- */
  /* Location ingest                                                  */
  /* ---------------------------------------------------------------- */

  async recordLocation(gameId: string, token: string | undefined, body: unknown): Promise<{ ok: true; recordedAt: number }> {
    const session = await this.authenticate(gameId, token);
    const game = session.game;
    if (!session.player.consentLocation) fail(403, 'Share location consent before reporting your position.');
    if (game.status !== 'active' && game.status !== 'countdown') {
      fail(409, 'Locations are only accepted while a match is running.');
    }
    const payload = isRecord(body) ? body : {};
    const lat = asNumber(payload.lat, Number.NaN);
    const lng = asNumber(payload.lng, Number.NaN);
    if (!isValidLatLng({ lat, lng })) fail(400, 'That GPS position is not valid.');
    const accuracy = Math.min(MAX_ACCURACY_METERS, Math.max(0, asNumber(payload.accuracyMeters, 0)));
    const now = this.now();
    const reportedAt = asNumber(payload.recordedAt, now);
    if (reportedAt > now + MAX_CLOCK_SKEW_MS) fail(400, 'That position is timestamped in the future.');
    if (reportedAt < now - MAX_FIX_AGE_MS) fail(409, 'That position is too old to use. Waiting for a fresh GPS fix.');

    const location: StoredLocation = {
      playerId: session.player.id,
      gameId,
      lat,
      lng,
      accuracyMeters: accuracy,
      recordedAt: reportedAt,
      receivedAt: now,
    };

    await this.mutate(gameId, async (ctx) => {
      const previous = ctx.locations.get(location.playerId);
      if (previous && previous.recordedAt > location.recordedAt) return;
      await this.store.upsertLocation(location);
      ctx.locations.set(location.playerId, location);
      const boundaryEvent = engine.boundaryCheck(ctx.game, session.player, location, previous, now);
      if (boundaryEvent) {
        ctx.apply({ changed: false, events: [boundaryEvent], jobs: [], finished: null });
      }
      ctx.apply(engine.tick(ctx.game, ctx.players, ctx.locations, now));
    });

    return { ok: true, recordedAt: reportedAt };
  }

  /* ---------------------------------------------------------------- */
  /* Scavenger actions                                                */
  /* ---------------------------------------------------------------- */

  async scavengerHint(gameId: string, token: string | undefined, objectiveId: unknown): Promise<GameSnapshot> {
    const session = await this.authenticate(gameId, token);
    if (session.game.settings.mode !== 'scavenger') fail(400, 'Hints are only available in scavenger hunts.');
    if (session.game.status !== 'active') fail(409, 'The hunt is not running.');
    const id = typeof objectiveId === 'string' ? objectiveId : '';
    await this.mutate(gameId, (ctx) => {
      const settings = ctx.game.settings as ScavengerSettings;
      const key = engine.competitorKey(settings, session.player);
      const outcome = engine.requestScavengerHint(ctx.game, key, id, this.now());
      if (!outcome.ok) fail(400, outcome.reason ?? 'That hint is not available.');
      ctx.markChanged();
      ctx.apply({
        changed: true,
        events: [
          {
            type: 'hint_used',
            audience: 'team',
            teamKey: session.player.teamKey,
            actorId: session.player.id,
            payload: { objectiveId: id, nickname: session.player.nickname },
            dedupeKey: `hint:${key}:${id}`,
          },
        ],
        jobs: [],
        finished: null,
      });
    });
    return this.snapshotFor(gameId, token);
  }

  async scavengerCode(
    gameId: string,
    token: string | undefined,
    objectiveId: unknown,
    answer: unknown,
  ): Promise<GameSnapshot> {
    const session = await this.authenticate(gameId, token);
    if (session.game.settings.mode !== 'scavenger') fail(400, 'Codes are only available in scavenger hunts.');
    if (session.game.status !== 'active') fail(409, 'The hunt is not running.');
    const id = typeof objectiveId === 'string' ? objectiveId : '';
    const submitted = typeof answer === 'string' ? answer : '';
    if (!submitted.trim()) fail(400, 'Enter the answer you found.');
    await this.mutate(gameId, (ctx) => {
      const settings = ctx.game.settings as ScavengerSettings;
      const key = engine.competitorKey(settings, session.player);
      const result = engine.noResult();
      const outcome = engine.submitScavengerCode(ctx.game, key, id, submitted, this.now(), result, session.player.id);
      if (!outcome.ok) {
        ctx.apply(result);
        fail(400, outcome.reason ?? 'That answer is not correct.');
      }
      ctx.apply(result);
      ctx.markChanged();
    });
    return this.snapshotFor(gameId, token);
  }

  /* ---------------------------------------------------------------- */
  /* Persistent scheduling                                            */
  /* ---------------------------------------------------------------- */

  /** Called by the server ticker: advances countdowns and reveals reliably. */
  async tickGame(gameId: string): Promise<void> {
    const now = this.now();
    const game = await this.store.getGame(gameId);
    if (!game) return;
    if (game.status === 'countdown') {
      if (game.countdownEndsAt != null && now >= game.countdownEndsAt) {
        await this.mutate(gameId, (ctx) => {
          ctx.apply(engine.activateAfterCountdown(ctx.game, now));
          ctx.apply(engine.tick(ctx.game, ctx.players, ctx.locations, now));
          ctx.markChanged();
        });
      }
      return;
    }
    if (game.status !== 'active') return;
    await this.mutate(gameId, (ctx) => {
      ctx.apply(engine.tick(ctx.game, ctx.players, ctx.locations, now));
    });
  }

  /** Claims and executes due jobs. Claiming is atomic, so jobs never double-fire. */
  async runDueJobs(limit = 25): Promise<number> {
    const now = this.now();
    const jobs = await this.store.claimDueJobs(now, limit);
    for (const job of jobs) {
      try {
        await this.executeJob(job);
        await this.store.finishJob(job.id, 'done');
      } catch {
        await this.store.finishJob(job.id, 'failed');
      }
    }
    return jobs.length;
  }

  private async executeJob(job: JobRecord): Promise<void> {
    if (job.kind === 'countdown' || job.kind === 'reveal' || job.kind === 'territory-tick' || job.kind === 'scavenger-deadline') {
      await this.tickGame(job.gameId);
      return;
    }
    await this.tickGame(job.gameId);
  }

  /** Safety net for games whose jobs were lost; scheduling stays DB-driven. */
  async sweepActiveGames(): Promise<void> {
    const games = await this.store.listGamesNeedingTicks();
    for (const game of games) {
      await this.tickGame(game.id);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Snapshot builder                                                    */
/* ------------------------------------------------------------------ */

export function buildSnapshot(
  game: GameRecord,
  viewer: PlayerRecord,
  players: PlayerRecord[],
  storedLocations: StoredLocation[],
  events: GameEventRecord[],
  now: number,
): GameSnapshot {
  const settings = game.settings;
  const byId = new Map(players.map((player) => [player.id, player]));
  const playerRuntime = (id: string) => game.runtime.players[id] ?? { eliminated: false, eliminatedAt: null, respawnUntil: null };
  const nameOf = (id: string | null): string | null => (id ? byId.get(id)?.nickname ?? null : null);

  const endsAt = engine.gameEndsAt(game, now);
  const remainingMs =
    game.status === 'active' || game.status === 'paused'
      ? endsAt != null
        ? Math.max(0, endsAt - now)
        : null
      : null;

  /* Locations: own + authorized teammates only. Reveals are separate data. */
  const visibleIds = new Set<string>([viewer.id]);
  if (settings.shareTeamLocations && viewer.teamKey) {
    for (const player of players) {
      if (player.teamKey === viewer.teamKey) visibleIds.add(player.id);
    }
  }

  const locations: LocationView[] = storedLocations
    .filter((location) => visibleIds.has(location.playerId))
    .map((location) => {
      const age = Math.max(0, Math.round((now - location.recordedAt) / 1000));
      return {
        playerId: location.playerId,
        nickname: byId.get(location.playerId)?.nickname ?? 'Player',
        teamKey: byId.get(location.playerId)?.teamKey ?? null,
        lat: location.lat,
        lng: location.lng,
        accuracyMeters: location.accuracyMeters,
        recordedAt: location.recordedAt,
        receivedAt: location.receivedAt,
        ageSeconds: age,
        stale: age > settings.staleAfterSeconds || now - location.receivedAt > settings.staleAfterSeconds * 1000,
        source: 'live' as const,
      };
    });

  const playerViews: PlayerView[] = players.map((player) => ({
    id: player.id,
    nickname: player.nickname,
    teamKey: player.teamKey,
    isHost: player.isHost,
    ready: player.ready,
    consentLocation: player.consentLocation,
    connected: player.isHost ? true : now - player.lastSeenAt <= CONNECTED_WINDOW_MS,
    eliminated: playerRuntime(player.id).eliminated,
    respawnUntil: playerRuntime(player.id).respawnUntil,
  }));

  const teams: TeamView[] = settings.teams.map((team) => {
    const runtime = game.runtime.teams[team.key];
    return {
      key: team.key,
      name: team.name,
      color: team.color,
      score: runtime?.score ?? 0,
      base: runtime?.base ?? null,
      flag: runtime?.flag
        ? { status: runtime.flag.status, carrierId: runtime.flag.carrierId, lat: runtime.flag.lat, lng: runtime.flag.lng }
        : null,
      memberCount: players.filter((player) => player.teamKey === team.key).length,
    };
  });

  const revealViews: RevealView[] = (game.runtime.manhunt?.reveals ?? []).map((reveal) => ({
    revealIndex: reveal.revealIndex,
    createdAt: reveal.createdAt,
    runners: reveal.runners.map((runner) => ({
      playerId: runner.playerId,
      nickname: runner.nickname,
      lat: runner.lat,
      lng: runner.lng,
      accuracyMeters: runner.accuracyMeters,
      recordedAt: runner.recordedAt,
      ageSeconds: Math.max(0, Math.round((now - runner.recordedAt) / 1000)),
    })),
    missing: reveal.missing,
  }));

  const feed = events
    .filter((event) => canSeeEvent(event, viewer))
    .slice(-80)
    .map((event) => ({
      id: event.id,
      seq: event.seq,
      type: event.type,
      text: describeEvent(event, nameOf, settings),
      teamKey: event.teamKey,
      actorId: event.actorId,
      actorNickname: nameOf(event.actorId),
      createdAt: event.createdAt,
    }));

  const viewerRuntime = playerRuntime(viewer.id);
  const snapshot: GameSnapshot = {
    serverNow: now,
    game: {
      id: game.id,
      code: game.code,
      name: game.name,
      mode: game.mode,
      status: game.status,
      hostPlayerId: game.hostPlayerId,
      playerCount: players.length,
      maxPlayers: settings.maxPlayers,
      createdAt: game.createdAt,
      startedAt: game.startedAt,
      endsAt,
      countdownEndsAt: game.countdownEndsAt,
      durationMs: game.durationMs,
      remainingMs,
      pausedAt: game.pausedAt,
      area: settings.area,
      settings: publicSettings(settings),
      revision: game.revision,
    },
    you: {
      id: viewer.id,
      nickname: viewer.nickname,
      isHost: viewer.isHost,
      teamKey: viewer.teamKey,
      ready: viewer.ready,
      consentLocation: viewer.consentLocation,
      eliminated: viewerRuntime.eliminated,
      respawnUntil: viewerRuntime.respawnUntil,
      points: viewerPoints(game, viewer),
    },
    players: playerViews,
    teams,
    locations,
    reveals: revealViews,
    feed,
    objectives: settings.mode === 'scavenger' ? buildObjectives(game, viewer, now) : null,
    zones: settings.mode === 'territory' ? buildZones(game, storedLocations, now, players) : null,
    modeState: buildModeState(game, viewer, players, storedLocations, now),
    results: game.status === 'ended' || game.status === 'cancelled' ? buildResults(game, players) : null,
  };
  return snapshot;
}

function canSeeEvent(event: GameEventRecord, viewer: PlayerRecord): boolean {
  switch (event.audience) {
    case 'all':
      return true;
    case 'team':
      return Boolean(viewer.teamKey && event.teamKey === viewer.teamKey);
    case 'host':
      return viewer.isHost;
    case 'host-team':
      return viewer.isHost || Boolean(viewer.teamKey && event.teamKey === viewer.teamKey);
    default:
      return false;
  }
}

function describeEvent(
  event: GameEventRecord,
  nameOf: (id: string | null) => string | null,
  settings: ModeSettings,
): string {
  const payload = event.payload ?? {};
  const text = (key: string): string => (typeof payload[key] === 'string' ? (payload[key] as string) : '');
  const nickname = text('nickname') || nameOf(event.actorId) || 'A player';
  const teamName = text('teamName') || teamConfigOf(settings, typeof payload.teamKey === 'string' ? payload.teamKey : null)?.name || 'Team';

  switch (event.type) {
    case 'game_created':
      return `${nickname} created the game.`;
    case 'player_joined':
      return `${nickname} joined the game.`;
    case 'player_left':
      return `${nickname} left the game.`;
    case 'settings_updated':
      return `${nickname} updated the rules.`;
    case 'ready_changed':
      return payload.ready === true ? `${nickname} is ready.` : `${nickname} is not ready yet.`;
    case 'team_changed':
      return `${nickname} is now on ${teamName}.`;
    case 'game_started':
      return 'The match has started.';
    case 'game_paused':
      return 'The host paused the match.';
    case 'game_resumed':
      return 'The match resumed.';
    case 'game_ended':
      return text('reason') || 'The match has ended.';
    case 'game_cancelled':
      return 'The host cancelled this game.';
    case 'announcement':
      return `Host: ${text('message')}`;
    case 'ping':
      return `${nickname}: ${text('message')}`;
    case 'check_in':
      return `${nickname} checked in: ${text('status')}`;
    case 'area_entered':
      return `${nickname} is back inside the play area.`;
    case 'area_left':
      return `${nickname} left the play area.`;
    case 'tag':
      return `${nickname} tagged a runner.`;
    case 'runner_tagged':
      return `${nickname} was tagged.`;
    case 'reveal':
      return `Location reveal #${String(payload.revealIndex ?? '')} published.`;
    case 'flag_taken':
      return `${nickname} took the ${teamName} flag.`;
    case 'flag_dropped':
      return `${nickname} dropped the flag.`;
    case 'flag_returned':
      return `${teamName} flag returned home.`;
    case 'flag_captured':
      return `${teamName} captured a flag!`;
    case 'zone_neutralized':
      return `${teamName} neutralized a zone.`;
    case 'zone_captured':
      return `${teamName} captured a zone.`;
    case 'zone_contested':
      return `A zone is contested.`;
    case 'score':
      return `${teamName} scored ${String(payload.points ?? '')} points.`;
    case 'objective_complete':
      return `${nickname} completed ${text('title')} (+${String(payload.points ?? 0)}).`;
    case 'objective_expired':
      return `Time ran out on ${text('title')}.`;
    case 'hint_used':
      return `${nickname} used a hint.`;
    case 'overtime':
      return 'Scores are tied — overtime!';
    default:
      return text('message') || event.type.replace(/_/g, ' ');
  }
}

function viewerPoints(game: GameRecord, viewer: PlayerRecord): number {
  const settings = game.settings;
  if (settings.mode === 'scavenger') {
    const key = engine.competitorKey(settings, viewer);
    return game.runtime.scavenger?.competitors[key]?.points ?? 0;
  }
  if (viewer.teamKey) return game.runtime.teams[viewer.teamKey]?.score ?? 0;
  return 0;
}

function buildObjectives(game: GameRecord, viewer: PlayerRecord, now: number): ObjectiveView[] {
  const settings = game.settings as ScavengerSettings;
  const competitor = game.runtime.scavenger?.competitors[engine.competitorKey(settings, viewer)];
  const completed = new Set(competitor?.completedObjectiveIds ?? []);
  const expired = new Set(competitor?.expiredObjectiveIds ?? []);
  const hints = new Set(competitor?.hintsUsed ?? []);
  const nextId =
    settings.orderMode === 'sequential'
      ? settings.objectives.find((objective) => !completed.has(objective.id) && !expired.has(objective.id))?.id ?? null
      : null;

  return settings.objectives.map((objective, index) => ({
    id: objective.id,
    index,
    title: objective.title,
    clue: objective.clue,
    description: objective.description,
    points: objective.points,
    lat: objective.lat,
    lng: objective.lng,
    radiusMeters: objective.radiusMeters,
    verification: objective.verification,
    hintAvailable: Boolean(objective.hint.trim()) && !hints.has(objective.id) && !completed.has(objective.id),
    // Hints are only released after the player asks for one.
    hint: hints.has(objective.id) ? objective.hint : null,
    hintPenalty: objective.hintPenalty,
    completed: completed.has(objective.id),
    locked: settings.orderMode === 'sequential' ? objective.id !== nextId && !completed.has(objective.id) : false,
    deadlineAt: competitor?.deadlines?.[objective.id] ?? null,
  }));
}

function buildZones(
  game: GameRecord,
  locations: StoredLocation[],
  now: number,
  players: PlayerRecord[],
): ZoneView[] {
  const settings = game.settings as TerritorySettings;
  const byId = new Map(players.map((player) => [player.id, player]));
  return settings.zones.map((zone) => {
    const runtime = game.runtime.territory?.zones.find((entry) => entry.id === zone.id);
    const present = new Set<string>();
    for (const stored of locations) {
      const player = byId.get(stored.playerId);
      if (!player?.teamKey) continue;
      if (now - stored.recordedAt > settings.staleAfterSeconds * 1000) continue;
      if (distanceMeters(stored, { lat: zone.lat, lng: zone.lng }) > zone.radiusMeters) continue;
      present.add(player.teamKey);
    }
    const progressMs = runtime?.progressMs ?? 0;
    const needed = runtime?.progressTeamKey && runtime.ownerTeamKey ? settings.captureSeconds : settings.neutralizeSeconds;
    return {
      id: zone.id,
      name: zone.name,
      lat: zone.lat,
      lng: zone.lng,
      radiusMeters: zone.radiusMeters,
      ownerTeamKey: runtime?.ownerTeamKey ?? null,
      progressTeamKey: runtime?.progressTeamKey ?? null,
      progress: needed > 0 ? Math.min(1, Math.round((progressMs / (needed * 1000)) * 100) / 100) : 0,
      captureSeconds: settings.captureSeconds,
      eligibleTeamKeys: zone.eligibleTeamKeys.length ? zone.eligibleTeamKeys : settings.teams.map((team) => team.key),
      presentTeamKeys: [...present],
    };
  });
}

function buildModeState(
  game: GameRecord,
  viewer: PlayerRecord,
  players: PlayerRecord[],
  locations: StoredLocation[],
  now: number,
): Record<string, unknown> {
  const settings = game.settings;
  if (settings.mode === 'manhunt') {
    const manhunt = settings as ManhuntSettings;
    const roles = engine.manhuntRoles(game);
    const state = game.runtime.manhunt;
    return {
      runnerTeamKey: roles.runners,
      hunterTeamKey: roles.hunters,
      yourRole: viewer.teamKey === roles.runners ? 'runner' : viewer.teamKey === roles.hunters ? 'hunter' : 'spectator',
      headStartEndsAt: state?.headStartEndsAt ?? null,
      nextRevealAt: state?.nextRevealAt ?? null,
      revealIndex: state?.revealIndex ?? 0,
      revealIntervalSeconds: manhunt.revealIntervalSeconds,
      tagRadiusMeters: manhunt.tagRadiusMeters,
      hunterTransport: manhunt.hunterTransport,
      runnerPings: manhunt.runnerPings,
      hunterCheckIns: manhunt.hunterCheckIns,
      tieRule: manhunt.tieRule,
      runnersRemaining: players.filter(
        (player) => player.teamKey === roles.runners && !game.runtime.players[player.id]?.eliminated,
      ).length,
    };
  }

  if (settings.mode === 'ctf') {
    const ctf = settings as CtfSettings;
    return {
      scorePerCapture: ctf.scorePerCapture,
      winScore: ctf.winScore,
      baseRadiusMeters: ctf.baseRadiusMeters,
      tagRadiusMeters: ctf.tagRadiusMeters,
      canTag: ctf.canTag,
      requireOwnFlagHome: ctf.requireOwnFlagHome,
      respawnSeconds: ctf.respawnSeconds,
      captureCooldownSeconds: ctf.captureCooldownSeconds,
      overtime: game.runtime.ctf?.overtime ?? false,
    };
  }

  if (settings.mode === 'territory') {
    const territory = settings as TerritorySettings;
    return {
      neutralizeSeconds: territory.neutralizeSeconds,
      captureSeconds: territory.captureSeconds,
      scoreIntervalSeconds: territory.scoreIntervalSeconds,
      pointsPerZone: territory.pointsPerZone,
      scoreLimit: territory.scoreLimit,
      tickIndex: game.runtime.territory?.tickIndex ?? 0,
    };
  }

  const scavenger = settings as ScavengerSettings;
  const key = engine.competitorKey(scavenger, viewer);
  const competitors = game.runtime.scavenger?.competitors ?? {};
  const leaderboard = Object.entries(competitors)
    .map(([competitorKey, runtime]) => ({
      key: competitorKey,
      label: engine.competitorLabel(game, competitorKey),
      points: runtime.points,
      completed: runtime.completedObjectiveIds.length,
      finishedAt: runtime.finishedAt,
    }))
    .sort((a, b) => b.points - a.points || (a.finishedAt ?? Number.MAX_SAFE_INTEGER) - (b.finishedAt ?? Number.MAX_SAFE_INTEGER))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
  return {
    competition: scavenger.competition,
    orderMode: scavenger.orderMode,
    winCondition: scavenger.winCondition,
    objectiveTimeLimitSeconds: scavenger.objectiveTimeLimitSeconds,
    leaderboard,
    yourKey: key,
    completed: competitors[key]?.completedObjectiveIds ?? [],
    totalObjectives: scavenger.objectives.length,
    staleLocationCount: locations.filter(
      (location) => now - location.recordedAt > settings.staleAfterSeconds * 1000,
    ).length,
  };
}

function leadingKey(game: GameRecord): string | null {
  const settings = game.settings;
  if (settings.mode === 'scavenger') {
    const entries = Object.entries(game.runtime.scavenger?.competitors ?? {});
    entries.sort((a, b) => b[1].points - a[1].points);
    return entries[0]?.[0] ?? null;
  }
  const entries = settings.teams.map((team) => ({ key: team.key, score: game.runtime.teams[team.key]?.score ?? 0 }));
  entries.sort((a, b) => b.score - a.score);
  if (entries.length === 0) return null;
  if (entries.length > 1 && entries[0].score === entries[1].score) return 'draw';
  return entries[0].key;
}

function leadingLabel(game: GameRecord): string {
  const key = leadingKey(game);
  if (!key) return 'No winner';
  if (key === 'draw') return 'Draw';
  const team = teamConfigOf(game.settings, key);
  if (team) return team.name;
  return engine.competitorLabel(game, key);
}

function buildResults(game: GameRecord, players: PlayerRecord[]): ResultsView {
  const settings = game.settings;
  const winner = game.runtime.winner ?? game.winner;
  let scores: ScoreLine[] = [];
  const stats: { label: string; value: string }[] = [];

  if (settings.mode === 'scavenger') {
    const entries = Object.entries(game.runtime.scavenger?.competitors ?? {});
    scores = entries
      .map(([key, runtime]) => ({
        key,
        label: engine.competitorLabel(game, key),
        score: runtime.points,
        color: teamConfigOf(settings, key)?.color ?? '#6fd3ff',
      }))
      .sort((a, b) => b.score - a.score);
    stats.push({ label: 'Objectives', value: String(settings.objectives.length) });
  } else if (settings.mode === 'manhunt') {
    const roles = engine.manhuntRoles(game);
    const runnersAlive = players.filter(
      (player) => player.teamKey === roles.runners && !game.runtime.players[player.id]?.eliminated,
    ).length;
    const tagged = players.filter(
      (player) => player.teamKey === roles.runners && game.runtime.players[player.id]?.eliminated,
    ).length;
    scores = [
      {
        key: roles.runners,
        label: teamConfigOf(settings, roles.runners)?.name ?? 'Runners',
        score: runnersAlive,
        color: teamConfigOf(settings, roles.runners)?.color ?? '#6fd3ff',
      },
      {
        key: roles.hunters,
        label: teamConfigOf(settings, roles.hunters)?.name ?? 'Hunters',
        score: tagged,
        color: teamConfigOf(settings, roles.hunters)?.color ?? '#ff8a5c',
      },
    ];
    stats.push({ label: 'Runners at the end', value: String(runnersAlive) });
    stats.push({ label: 'Runners tagged', value: String(tagged) });
    stats.push({ label: 'Reveals', value: String(game.runtime.manhunt?.reveals.length ?? 0) });
  } else {
    scores = settings.teams
      .map((team) => ({
        key: team.key,
        label: team.name,
        score: game.runtime.teams[team.key]?.score ?? 0,
        color: team.color,
      }))
      .sort((a, b) => b.score - a.score);
    stats.push({ label: 'Players', value: String(players.length) });
  }

  return {
    endedAt: game.endedAt,
    reason: game.endedReason ?? 'Match finished.',
    winnerKey: winner?.key ?? null,
    winnerLabel: winner?.label ?? null,
    scores,
    stats,
  };
}

function emptyRuntime(): GameRecord['runtime'] {
  return {
    players: {},
    teams: {},
    winner: null,
    endedReason: null,
  };
}

function defaultName(mode: ModeId): string {
  switch (mode) {
    case 'manhunt':
      return 'Manhunt in the park';
    case 'ctf':
      return 'Capture the Flag';
    case 'territory':
      return 'Territory Control';
    default:
      return 'Scavenger Hunt';
  }
}

export type { PlayArea };
