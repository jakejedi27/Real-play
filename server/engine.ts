import { distanceMeters, isInsideArea, isValidLatLng } from '../shared/geo';
import type {
  CompetitorRuntime,
  CtfSettings,
  GameRecord,
  ManhuntSettings,
  ModeSettings,
  PlayerRecord,
  RevealRecord,
  ScavengerSettings,
  StoredLocation,
  TeamRuntime,
  TerritorySettings,
} from '../shared/types';

export interface EngineEvent {
  type: string;
  audience: 'all' | 'team' | 'host' | 'host-team';
  teamKey?: string | null;
  actorId?: string | null;
  payload: Record<string, unknown>;
  dedupeKey?: string | null;
}

export interface EngineJob {
  kind: 'reveal' | 'territory-tick' | 'scavenger-deadline';
  runKey: string;
  runAt: number;
  payload?: Record<string, unknown>;
}

export interface EngineFinished {
  key: string;
  label: string;
  reason: string;
}

export interface EngineResult {
  changed: boolean;
  events: EngineEvent[];
  jobs: EngineJob[];
  finished: EngineFinished | null;
}

export const noResult = (): EngineResult => ({ changed: false, events: [], jobs: [], finished: null });

export type LocationMap = Map<string, StoredLocation>;

export function freshLocation(
  settings: ModeSettings,
  location: StoredLocation | undefined,
  now: number,
): StoredLocation | null {
  if (!location) return null;
  if (now - location.recordedAt > settings.staleAfterSeconds * 1000) return null;
  return location;
}

export function teamOf(player: PlayerRecord) {
  return player.teamKey;
}

/* ------------------------------------------------------------------ */
/* Runtime bootstrap                                                   */
/* ------------------------------------------------------------------ */

export function initRuntime(game: GameRecord, players: PlayerRecord[]): void {
  const runtime = game.runtime;
  runtime.players = runtime.players ?? {};
  runtime.teams = runtime.teams ?? {};
  runtime.winner = runtime.winner ?? null;
  runtime.endedReason = runtime.endedReason ?? null;
  for (const team of game.settings.teams) {
    const existing = runtime.teams[team.key];
    runtime.teams[team.key] = {
      score: existing?.score ?? 0,
      base: existing?.base ?? null,
      flag: existing?.flag ?? null,
    };
  }
  for (const key of Object.keys(runtime.teams)) {
    if (!game.settings.teams.some((team) => team.key === key)) delete runtime.teams[key];
  }
  for (const player of players) {
    runtime.players[player.id] = {
      eliminated: runtime.players[player.id]?.eliminated ?? false,
      eliminatedAt: runtime.players[player.id]?.eliminatedAt ?? null,
      respawnUntil: runtime.players[player.id]?.respawnUntil ?? null,
    };
  }

  if (game.settings.mode === 'ctf') {
    const settings = game.settings;
    for (const team of settings.teams) {
      const base = runtime.teams[team.key]?.base ?? settings.bases[team.key] ?? null;
      runtime.teams[team.key].base = base;
      runtime.teams[team.key].flag = { status: 'home', carrierId: null, lat: base?.lat ?? null, lng: base?.lng ?? null };
    }
    runtime.ctf = runtime.ctf ?? { lastCaptureAt: {}, overtime: false };
  }

  if (game.settings.mode === 'territory') {
    const settings = game.settings;
    const existing = new Map((runtime.territory?.zones ?? []).map((zone) => [zone.id, zone]));
    runtime.territory = {
      zones: settings.zones.map((zone) => {
        const prior = existing.get(zone.id);
        return {
          id: zone.id,
          ownerTeamKey: prior?.ownerTeamKey ?? null,
          progressTeamKey: prior?.progressTeamKey ?? null,
          progressMs: prior?.progressMs ?? 0,
          lastScoredAt: prior?.lastScoredAt ?? null,
        };
      }),
      tickIndex: runtime.territory?.tickIndex ?? 0,
      lastTickAt: runtime.territory?.lastTickAt ?? null,
    };
  }

  if (game.settings.mode === 'scavenger') {
    const settings = game.settings;
    const competitors: Record<string, CompetitorRuntime> = runtime.scavenger?.competitors ?? {};
    runtime.scavenger = {
      competitors,
      order: runtime.scavenger?.order ?? {},
    };
    for (const player of players) {
      const key = competitorKey(settings, player);
      const store = runtime.scavenger.competitors;
      store[key] = store[key] ?? {
        points: 0,
        completedObjectiveIds: [],
        hintsUsed: [],
        expiredObjectiveIds: [],
        startedAt: null,
        finishedAt: null,
        deadlines: {},
      };
    }
  }
}

export function competitorKey(settings: ScavengerSettings, player: PlayerRecord): string {
  if (settings.competition === 'team') return `team:${player.teamKey ?? 'unassigned'}`;
  return `player:${player.id}`;
}

export function competitorLabel(game: GameRecord, key: string): string {
  if (key.startsWith('team:')) {
    const teamKey = key.slice(5);
    const team = game.settings.teams.find((t) => t.key === teamKey);
    return team?.name ?? 'Unassigned team';
  }
  return key.slice(7, 15);
}

/* ------------------------------------------------------------------ */
/* Start / countdown                                                   */
/* ------------------------------------------------------------------ */

export function prepareStart(game: GameRecord, now: number): EngineResult {
  const result = noResult();
  const settings = game.settings;
  game.durationMs = settings.durationMinutes * 60_000;
  game.countdownEndsAt = settings.countdownSeconds > 0 ? now + settings.countdownSeconds * 1000 : null;
  game.status = settings.countdownSeconds > 0 ? 'countdown' : 'active';
  game.startedAt = game.status === 'active' ? now : null;
  game.pausedAt = null;
  game.accumulatedPauseMs = 0;
  game.winner = null;
  game.endedReason = null;
  game.runtime.winner = null;
  game.runtime.endedReason = null;
  result.changed = true;

  if (settings.mode === 'manhunt') {
    const headStartEndsAt = now + settings.headStartSeconds * 1000;
    game.runtime.manhunt = {
      revealIndex: 0,
      nextRevealAt: headStartEndsAt + settings.revealIntervalSeconds * 1000,
      headStartEndsAt,
      reveals: [],
    };
    const durationEnd = game.startedAt! + game.durationMs;
    let revealAt = game.runtime.manhunt.nextRevealAt!;
    while (revealAt < durationEnd) {
      result.jobs.push({
        kind: 'reveal',
        runKey: `reveal:${game.id}:${game.runtime.manhunt.revealIndex + result.jobs.length}`,
        runAt: revealAt,
        payload: {},
      });
      revealAt += settings.revealIntervalSeconds * 1000;
    }
    result.events.push({
      type: 'head_start',
      audience: 'all',
      payload: { headStartEndsAt, seconds: settings.headStartSeconds },
      dedupeKey: `head-start:${game.id}`,
    });
  }

  if (settings.mode === 'territory') {
    if (game.runtime.territory) game.runtime.territory.lastTickAt = now;
  }

  if (settings.mode === 'scavenger') {
    const settingsS = settings;
    for (const [key, competitor] of Object.entries(game.runtime.scavenger?.competitors ?? {})) {
      competitor.startedAt = now;
      competitor.finishedAt = null;
      if (settingsS.objectiveTimeLimitSeconds > 0 && settingsS.orderMode === 'sequential') {
        const first = settingsS.objectives[0];
        if (first) competitor.deadlines[first.id] = now + settingsS.objectiveTimeLimitSeconds * 1000;
      }
    }
  }

  result.events.push({
    type: 'game_started',
    audience: 'all',
    payload: {
      status: game.status,
      startsAt: game.status === 'active' ? now : game.countdownEndsAt,
      durationMs: game.durationMs,
    },
    dedupeKey: `started:${game.id}:${now}`,
  });
  return result;
}

/** Called when the countdown elapses: flips the authoritative clock on. */
export function activateAfterCountdown(game: GameRecord, now: number): EngineResult {
  const result = noResult();
  game.status = 'active';
  game.startedAt = now;
  game.countdownEndsAt = null;
  game.durationMs = game.settings.durationMinutes * 60_000;
  if (game.settings.mode === 'manhunt' && game.runtime.manhunt) {
    game.runtime.manhunt.headStartEndsAt = now + game.settings.headStartSeconds * 1000;
    game.runtime.manhunt.nextRevealAt =
      game.runtime.manhunt.headStartEndsAt + game.settings.revealIntervalSeconds * 1000;
  }
  if (game.settings.mode === 'scavenger' && game.runtime.scavenger) {
    for (const competitor of Object.values(game.runtime.scavenger.competitors)) {
      competitor.startedAt = now;
    }
  }
  if (game.runtime.territory) game.runtime.territory.lastTickAt = now;
  result.changed = true;
  result.events.push({
    type: 'game_active',
    audience: 'all',
    payload: { startedAt: now, durationMs: game.durationMs },
    dedupeKey: `active:${game.id}`,
  });
  return result;
}

/* ------------------------------------------------------------------ */
/* Main tick                                                           */
/* ------------------------------------------------------------------ */

export function tick(game: GameRecord, players: PlayerRecord[], locations: LocationMap, now: number): EngineResult {
  const result = noResult();
  if (game.status !== 'active') return result;

  switch (game.settings.mode) {
    case 'manhunt':
      tickManhunt(game, players, locations, now, result);
      break;
    case 'ctf':
      tickCtf(game, players, locations, now, result);
      break;
    case 'territory':
      tickTerritory(game, players, locations, now, result);
      break;
    case 'scavenger':
      tickScavenger(game, players, locations, now, result);
      break;
  }

  if (!result.finished) {
    const timerEnd = (game.startedAt ?? now) + game.durationMs;
    if (now >= timerEnd) {
      applyExpiry(game, players, now, result);
    }
  }
  if (result.changed) game.updatedAt = now;
  return result;
}

function applyExpiry(game: GameRecord, players: PlayerRecord[], now: number, result: EngineResult): void {
  const settings = game.settings;
  if (settings.mode === 'manhunt') {
    const s = settings;
    const runnerTeam = manhuntRoles(game).runners;
    const runnersAlive = players.filter((p) => p.teamKey === runnerTeam && !game.runtime.players[p.id]?.eliminated);
    if (runnersAlive.length > 0) {
      result.finished = { key: 'runners', label: 'Runners', reason: 'At least one runner survived until the end of the match.' };
    } else if (s.tieRule === 'hunters') {
      result.finished = { key: 'hunters', label: 'Hunters', reason: 'Every runner was tagged before time ran out.' };
    } else if (s.tieRule === 'draw') {
      result.finished = { key: 'draw', label: 'Draw', reason: 'The clock expired as the last runner was tagged.' };
    } else {
      result.finished = { key: 'runners', label: 'Runners', reason: 'Tie rule: runners win when the clock expires.' };
    }
    return;
  }

  if (settings.mode === 'ctf' || settings.mode === 'territory') {
    const s = settings;
    const scores = s.teams.map((team) => ({ team, score: game.runtime.teams[team.key]?.score ?? 0 }));
    scores.sort((a, b) => b.score - a.score);
    if (scores.length === 0) {
      result.finished = { key: 'draw', label: 'Draw', reason: 'Time expired with no teams.' };
      return;
    }
    const top = scores[0];
    const tied = scores.filter((line) => line.score === top.score);
    if (tied.length > 1) {
      const overtimeFlag = settings.mode === 'ctf' ? game.runtime.ctf?.overtime : game.runtime.territory && false;
      const alreadyOvertime = settings.mode === 'ctf' ? Boolean(game.runtime.ctf?.overtime) : hasOvertimeExpired(game);
      if (s.tieRule === 'overtime' && !alreadyOvertime) {
        game.durationMs += 120_000;
        if (settings.mode === 'ctf' && game.runtime.ctf) game.runtime.ctf.overtime = true;
        if (settings.mode === 'territory') game.endedReason = 'overtime';
        result.changed = true;
        result.events.push({
          type: 'overtime',
          audience: 'all',
          payload: { extraSeconds: 120 },
          dedupeKey: `overtime:${game.id}`,
        });
        void overtimeFlag;
        return;
      }
      result.finished = { key: 'draw', label: 'Draw', reason: `Time expired with a tied score (${top.score}).` };
      return;
    }
    result.finished = {
      key: top.team.key,
      label: top.team.name,
      reason: `Highest score when the clock expired (${top.score}).`,
    };
    return;
  }

  if (settings.mode === 'scavenger') {
    const s = settings;
    const lines = Object.entries(game.runtime.scavenger?.competitors ?? {}).map(([key, competitor]) => ({
      key,
      points: competitor.points,
      finishedAt: competitor.finishedAt,
    }));
    lines.sort((a, b) => b.points - a.points || (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity));
    const top = lines[0];
    if (!top) {
      result.finished = { key: 'draw', label: 'Draw', reason: 'Time expired with no competitors.' };
      return;
    }
    const tied = lines.filter((line) => line.points === top.points);
    if (tied.length > 1) {
      if (s.tieRule === 'earliest-finish') {
        const finishers = tied.filter((line) => line.finishedAt != null);
        if (finishers.length > 0) {
          finishers.sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
          result.finished = {
            key: finishers[0].key,
            label: competitorLabel(game, finishers[0].key),
            reason: 'Tied on points; earliest finish wins.',
          };
          return;
        }
      }
      result.finished = { key: 'draw', label: 'Draw', reason: `Time expired with a tied score (${top.points}).` };
      return;
    }
    result.finished = {
      key: top.key,
      label: competitorLabel(game, top.key),
      reason: `Highest score when the clock expired (${top.points}).`,
    };
  }
}

function hasOvertimeExpired(game: GameRecord): boolean {
  return game.endedReason === 'overtime';
}

/* ------------------------------------------------------------------ */
/* Manhunt                                                             */
/* ------------------------------------------------------------------ */

export function manhuntRoles(game: GameRecord): { runners: string; hunters: string } {
  const teams = game.settings.teams;
  const runners = teams.find((team) => /runner/i.test(`${team.key} ${team.name}`)) ?? teams[0];
  const hunters = teams.find((team) => team.key !== runners.key) ?? teams[1] ?? teams[0];
  return { runners: runners?.key ?? 'runners', hunters: hunters?.key ?? 'hunters' };
}

function tickManhunt(
  game: GameRecord,
  players: PlayerRecord[],
  locations: LocationMap,
  now: number,
  result: EngineResult,
): void {
  const settings = game.settings as ManhuntSettings;
  const roles = manhuntRoles(game);
  const runtime = game.runtime;

  // Fallback reveal path: guarantees a reveal even if the job row was lost.
  const state = runtime.manhunt;
  if (state?.nextRevealAt != null && now >= state.nextRevealAt) {
    performReveal(game, players, locations, now, result);
  }

  const runners = players.filter((p) => p.teamKey === roles.runners && !runtime.players[p.id]?.eliminated);
  const hunters = players.filter((p) => p.teamKey === roles.hunters);

  for (const hunter of hunters) {
    const hunterLoc = freshLocation(settings, locations.get(hunter.id), now);
    if (!hunterLoc) continue;
    for (const runner of runners) {
      if (runtime.players[runner.id]?.eliminated) continue;
      const runnerLoc = freshLocation(settings, locations.get(runner.id), now);
      if (!runnerLoc) continue;
      if (distanceMeters(hunterLoc, runnerLoc) <= settings.tagRadiusMeters) {
        runtime.players[runner.id].eliminated = true;
        runtime.players[runner.id].eliminatedAt = now;
        result.changed = true;
        result.events.push({
          type: 'runner_tagged',
          audience: 'all',
          actorId: hunter.id,
          payload: { runnerId: runner.id, runnerNickname: runner.nickname, hunterNickname: hunter.nickname },
          dedupeKey: `tag:${game.id}:${runner.id}`,
        });
      }
    }
  }

  const remaining = players.filter(
    (p) => p.teamKey === roles.runners && !runtime.players[p.id]?.eliminated,
  );
  if (remaining.length === 0 && players.some((p) => p.teamKey === roles.runners)) {
    result.finished = {
      key: roles.hunters,
      label: game.settings.teams.find((t) => t.key === roles.hunters)?.name ?? 'Hunters',
      reason: 'Every runner was tagged.',
    };
  }
}

export function performReveal(
  game: GameRecord,
  players: PlayerRecord[],
  locations: LocationMap,
  now: number,
  result: EngineResult,
): void {
  const settings = game.settings as ManhuntSettings;
  const state = game.runtime.manhunt;
  if (!state) return;
  if (state.nextRevealAt == null || now < state.nextRevealAt) return;
  const roles = manhuntRoles(game);
  const revealIndex = state.revealIndex + 1;
  const record: RevealRecord = { revealIndex, createdAt: now, runners: [], missing: [] };
  for (const player of players) {
    if (player.teamKey !== roles.runners) continue;
    const location = locations.get(player.id);
    if (!location) {
      record.missing.push({ playerId: player.id, nickname: player.nickname, reason: 'No location reported yet.' });
      continue;
    }
    if (now - location.recordedAt > settings.staleAfterSeconds * 1000) {
      record.missing.push({
        playerId: player.id,
        nickname: player.nickname,
        reason: `Last fix is ${Math.round((now - location.recordedAt) / 1000)}s old (stale).`,
      });
      continue;
    }
    if (game.runtime.players[player.id]?.eliminated) continue;
    record.runners.push({
      playerId: player.id,
      nickname: player.nickname,
      lat: location.lat,
      lng: location.lng,
      accuracyMeters: location.accuracyMeters,
      recordedAt: location.recordedAt,
    });
  }
  state.reveals = [...(state.reveals ?? []), record];
  state.revealIndex = revealIndex;
  const intervalMs = settings.revealIntervalSeconds * 1000;
  const next = state.nextRevealAt + intervalMs;
  const endsAt = (game.startedAt ?? now) + game.durationMs;
  state.nextRevealAt = next < endsAt ? next : null;
  result.changed = true;
  result.events.push({
    type: 'reveal',
    audience: 'all',
    payload: {
      revealIndex,
      createdAt: now,
      runners: record.runners,
      missing: record.missing,
    },
    dedupeKey: `reveal:${game.id}:${revealIndex}`,
  });
}

/* ------------------------------------------------------------------ */
/* Capture the Flag                                                    */
/* ------------------------------------------------------------------ */

function tickCtf(
  game: GameRecord,
  players: PlayerRecord[],
  locations: LocationMap,
  now: number,
  result: EngineResult,
): void {
  const settings = game.settings as CtfSettings;
  const runtime = game.runtime;

  for (const player of players) {
    const state = runtime.players[player.id];
    if (state?.respawnUntil && now >= state.respawnUntil) {
      state.respawnUntil = null;
      result.changed = true;
      result.events.push({
        type: 'respawned',
        audience: 'all',
        actorId: player.id,
        payload: { nickname: player.nickname },
        dedupeKey: `respawn:${game.id}:${player.id}:${state.respawnUntil}`,
      });
    }
  }

  const alive = (player: PlayerRecord) => (runtime.players[player.id]?.respawnUntil ?? 0) <= now;

  for (const teamConfig of settings.teams) {
    const team = runtime.teams[teamConfig.key];
    const flag = team?.flag;
    if (!team || !flag) continue;

    if (flag.status === 'dropped') {
      const owner = players.find(
        (p) =>
          p.teamKey === teamConfig.key &&
          alive(p) &&
          isNear(settings, locations.get(p.id), flag.lat, flag.lng, now),
      );
      if (owner) {
        flag.status = 'home';
        flag.carrierId = null;
        flag.lat = team.base?.lat ?? null;
        flag.lng = team.base?.lng ?? null;
        result.changed = true;
        result.events.push({
          type: 'flag_returned',
          audience: 'all',
          actorId: owner.id,
          payload: { teamKey: teamConfig.key, teamName: teamConfig.name, nickname: owner.nickname },
          dedupeKey: `flag-return:${game.id}:${teamConfig.key}:${now}`,
        });
        continue;
      }
    }

    if (flag.status === 'home' || flag.status === 'dropped') {
      const pickupRadius = Math.max(8, settings.baseRadiusMeters * 0.5);
      const candidates = players
        .filter((p) => p.teamKey && p.teamKey !== teamConfig.key && alive(p))
        .map((p) => ({ player: p, location: freshLocation(settings, locations.get(p.id), now) }))
        .filter((entry) => entry.location && isNear(settings, entry.location, flag.lat, flag.lng, now, pickupRadius));
      const taker = candidates[0];
      if (taker?.location) {
        flag.status = 'carried';
        flag.carrierId = taker.player.id;
        flag.lat = taker.location.lat;
        flag.lng = taker.location.lng;
        result.changed = true;
        result.events.push({
          type: 'flag_taken',
          audience: 'all',
          actorId: taker.player.id,
          payload: { teamKey: teamConfig.key, teamName: teamConfig.name, nickname: taker.player.nickname },
          dedupeKey: `flag-take:${game.id}:${teamConfig.key}:${now}`,
        });
      }
      continue;
    }

    // Flag is carried.
    const carrier = players.find((p) => p.id === flag.carrierId);
    if (!carrier) {
      flag.status = 'dropped';
      flag.carrierId = null;
      result.changed = true;
      continue;
    }
    const carrierLoc = freshLocation(settings, locations.get(carrier.id), now);
    if (carrierLoc) {
      flag.lat = carrierLoc.lat;
      flag.lng = carrierLoc.lng;
    }

    const ownTeam = carrier.teamKey ? runtime.teams[carrier.teamKey] : null;
    const ownTeamConfig = settings.teams.find((t) => t.key === carrier.teamKey);
    if (ownTeam?.base && ownTeamConfig && carrierLoc) {
      const atOwnBase = distanceMeters(carrierLoc, ownTeam.base) <= settings.baseRadiusMeters;
      const cooldownOk = now - (runtime.ctf?.lastCaptureAt[carrier.teamKey!] ?? 0) >= settings.captureCooldownSeconds * 1000;
      const ownFlagHome = !settings.requireOwnFlagHome || ownTeam.flag?.status === 'home';
      if (atOwnBase && cooldownOk && ownFlagHome) {
        ownTeam.score += settings.scorePerCapture;
        flag.status = 'home';
        flag.carrierId = null;
        flag.lat = ownTeam.base.lat;
        flag.lng = ownTeam.base.lng;
        if (runtime.ctf) runtime.ctf.lastCaptureAt[carrier.teamKey!] = now;
        result.changed = true;
        result.events.push({
          type: 'capture',
          audience: 'all',
          actorId: carrier.id,
          payload: {
            teamKey: ownTeamConfig.key,
            teamName: ownTeamConfig.name,
            nickname: carrier.nickname,
            score: ownTeam.score,
          },
          dedupeKey: `capture:${game.id}:${ownTeamConfig.key}:${ownTeam.score}`,
        });
        if (settings.winScore > 0 && ownTeam.score >= settings.winScore) {
          result.finished = {
            key: ownTeamConfig.key,
            label: ownTeamConfig.name,
            reason: `Reached the win score of ${settings.winScore}.`,
          };
        }
        continue;
      }
    }

    if (settings.canTag && carrierLoc) {
      const tagger = players
        .filter((p) => p.teamKey && p.teamKey !== carrier.teamKey && alive(p))
        .map((p) => ({ player: p, location: freshLocation(settings, locations.get(p.id), now) }))
        .find((entry) => entry.location && distanceMeters(entry.location, carrierLoc) <= settings.tagRadiusMeters);
      if (tagger?.location) {
        flag.status = 'dropped';
        flag.carrierId = null;
        flag.lat = carrierLoc.lat;
        flag.lng = carrierLoc.lng;
        runtime.players[carrier.id].respawnUntil = now + settings.respawnSeconds * 1000;
        result.changed = true;
        result.events.push({
          type: 'carrier_tagged',
          audience: 'all',
          actorId: tagger.player.id,
          payload: {
            carrierId: carrier.id,
            carrierNickname: carrier.nickname,
            taggerNickname: tagger.player.nickname,
            respawnSeconds: settings.respawnSeconds,
          },
          dedupeKey: `carrier-tag:${game.id}:${carrier.id}:${now}`,
        });
      }
    }
  }
}

function isNear(
  settings: ModeSettings,
  location: StoredLocation | undefined,
  lat: number | null,
  lng: number | null,
  now: number,
  radiusOverride?: number,
): boolean {
  const fresh = freshLocation(settings, location, now);
  if (!fresh || lat == null || lng == null) return false;
  const radius = radiusOverride ?? settings.area.radiusMeters;
  return distanceMeters(fresh, { lat, lng }) <= radius;
}

/* ------------------------------------------------------------------ */
/* Territory Control                                                   */
/* ------------------------------------------------------------------ */

function tickTerritory(
  game: GameRecord,
  players: PlayerRecord[],
  locations: LocationMap,
  now: number,
  result: EngineResult,
): void {
  const settings = game.settings as TerritorySettings;
  const state = game.runtime.territory;
  if (!state) return;
  const last = state.lastTickAt ?? now;
  const delta = Math.min(5000, Math.max(0, now - last));
  state.lastTickAt = now;
  state.tickIndex += 1;
  if (delta === 0) return;

  for (const zoneConfig of settings.zones) {
    const zone = state.zones.find((z) => z.id === zoneConfig.id);
    if (!zone) continue;
    const present = new Set<string>();
    for (const player of players) {
      if (!player.teamKey) continue;
      if (!zoneConfig.eligibleTeamKeys.includes(player.teamKey)) continue;
      const location = freshLocation(settings, locations.get(player.id), now);
      if (!location) continue;
      if (distanceMeters(location, { lat: zoneConfig.lat, lng: zoneConfig.lng }) <= zoneConfig.radiusMeters) {
        present.add(player.teamKey);
      }
    }

    if (present.size === 1) {
      const [teamKey] = Array.from(present);
      if (zone.progressTeamKey !== teamKey) {
        zone.progressTeamKey = teamKey;
        zone.progressMs = 0;
        result.changed = true;
      }
      if (zone.ownerTeamKey === teamKey) {
        zone.progressMs = 0;
      } else {
        zone.progressMs += delta;
        if (zone.ownerTeamKey && zone.progressMs >= settings.neutralizeSeconds * 1000) {
          zone.ownerTeamKey = null;
          zone.progressMs = 0;
          result.changed = true;
          result.events.push({
            type: 'zone_neutralized',
            audience: 'all',
            payload: { zoneId: zone.id, zoneName: zoneConfig.name, teamKey },
            dedupeKey: `neutralize:${game.id}:${zone.id}:${now}`,
          });
        } else if (!zone.ownerTeamKey && zone.progressMs >= settings.captureSeconds * 1000) {
          zone.ownerTeamKey = teamKey;
          zone.progressMs = 0;
          zone.lastScoredAt = now;
          result.changed = true;
          result.events.push({
            type: 'zone_captured',
            audience: 'all',
            payload: { zoneId: zone.id, zoneName: zoneConfig.name, teamKey },
            dedupeKey: `capture-zone:${game.id}:${zone.id}:${now}`,
          });
        }
      }
    } else if (present.size === 0) {
      zone.progressMs = Math.max(0, zone.progressMs - delta);
      if (zone.progressMs === 0) zone.progressTeamKey = null;
    } else {
      // Contested: progress freezes.
      result.changed = true;
    }

    if (zone.ownerTeamKey) {
      const ownerTeam = game.runtime.teams[zone.ownerTeamKey];
      const due =
        zone.lastScoredAt == null || now - zone.lastScoredAt >= settings.scoreIntervalSeconds * 1000;
      if (ownerTeam && due) {
        ownerTeam.score += settings.pointsPerZone;
        zone.lastScoredAt = now;
        result.changed = true;
        result.events.push({
          type: 'zone_scored',
          audience: 'all',
          payload: {
            zoneId: zone.id,
            zoneName: zoneConfig.name,
            teamKey: zone.ownerTeamKey,
            score: ownerTeam.score,
          },
          dedupeKey: `zone-score:${game.id}:${zone.id}:${Math.floor(now / (settings.scoreIntervalSeconds * 1000))}`,
        });
        if (settings.scoreLimit > 0 && ownerTeam.score >= settings.scoreLimit) {
          const teamConfig = settings.teams.find((t) => t.key === zone.ownerTeamKey);
          result.finished = {
            key: zone.ownerTeamKey,
            label: teamConfig?.name ?? zone.ownerTeamKey,
            reason: `Reached the score limit of ${settings.scoreLimit}.`,
          };
          break;
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Scavenger Hunt                                                      */
/* ------------------------------------------------------------------ */

function tickScavenger(game: GameRecord, players: PlayerRecord[], now: number, result: EngineResult): void {
  void players;
  const settings = game.settings as ScavengerSettings;
  const state = game.runtime.scavenger;
  if (!state) return;

  for (const [key, competitor] of Object.entries(state.competitors)) {
    if (competitor.finishedAt) continue;
    for (const [objectiveId, deadline] of Object.entries(competitor.deadlines)) {
      if (deadline != null && now >= deadline && !competitor.completedObjectiveIds.includes(objectiveId)) {
        competitor.expiredObjectiveIds.push(objectiveId);
        delete competitor.deadlines[objectiveId];
        result.changed = true;
        result.events.push({
          type: 'objective_expired',
          audience: 'team',
          teamKey: key.startsWith('team:') ? key.slice(5) : null,
          payload: { competitorKey: key, objectiveId },
          dedupeKey: `expired:${game.id}:${key}:${objectiveId}`,
        });
        advanceSequential(game, competitor, key, now, result);
      }
    }
  }
}

function advanceSequential(
  game: GameRecord,
  competitor: { deadlines: Record<string, number | null>; completedObjectiveIds: string[]; expiredObjectiveIds: string[] },
  competitorKeyValue: string,
  now: number,
  result: EngineResult,
): void {
  const settings = game.settings as ScavengerSettings;
  if (settings.orderMode !== 'sequential') return;
  const next = settings.objectives.find(
    (o) => !competitor.completedObjectiveIds.includes(o.id) && !competitor.expiredObjectiveIds.includes(o.id),
  );
  if (!next) return;
  if (settings.objectiveTimeLimitSeconds > 0) {
    competitor.deadlines[next.id] = now + settings.objectiveTimeLimitSeconds * 1000;
    result.changed = true;
    result.events.push({
      type: 'objective_unlocked',
      audience: 'team',
      teamKey: competitorKeyValue.startsWith('team:') ? competitorKeyValue.slice(5) : null,
      payload: { competitorKey: competitorKeyValue, objectiveId: next.id, deadline: competitor.deadlines[next.id] },
      dedupeKey: `unlock:${game.id}:${competitorKeyValue}:${next.id}`,
    });
  }
}

/** GPS checkpoint completion, called from the tick with fresh positions. */
export function scavengerGpsCheck(
  game: GameRecord,
  players: PlayerRecord[],
  locations: LocationMap,
  now: number,
  result: EngineResult,
): void {
  const settings = game.settings as ScavengerSettings;
  const state = game.runtime.scavenger;
  if (!state) return;
  for (const player of players) {
    const key = competitorKey(settings, player);
    const competitor = state.competitors[key];
    if (!competitor || competitor.finishedAt) continue;
    for (const objective of settings.objectives) {
      if (objective.verification !== 'gps') continue;
      if (objective.lat == null || objective.lng == null) continue;
      if (competitor.completedObjectiveIds.includes(objective.id)) continue;
      if (competitor.expiredObjectiveIds.includes(objective.id)) continue;
      if (settings.orderMode === 'sequential') {
        const next = settings.objectives.find(
          (o) => !competitor.completedObjectiveIds.includes(o.id) && !competitor.expiredObjectiveIds.includes(o.id),
        );
        if (!next || next.id !== objective.id) continue;
      }
      const location = freshLocation(settings, locations.get(player.id), now);
      if (!location) continue;
      if (distanceMeters(location, { lat: objective.lat, lng: objective.lng }) <= objective.radiusMeters) {
        completeObjective(game, key, objective.id, now, result, player.id);
      }
    }
  }
}

/** Shared server-side completion (GPS or code). Never trusts client points. */
export function completeObjective(
  game: GameRecord,
  key: string,
  objectiveId: string,
  now: number,
  result: EngineResult,
  actorId?: string,
): boolean {
  const settings = game.settings as ScavengerSettings;
  const state = game.runtime.scavenger;
  const competitor = state?.competitors[key];
  const objective = settings.objectives.find((o) => o.id === objectiveId);
  if (!state || !competitor || !objective) return false;
  if (competitor.completedObjectiveIds.includes(objectiveId)) return false;
  const hinted = competitor.hintsUsed.includes(objectiveId);
  const points = Math.max(0, objective.points - (hinted ? objective.hintPenalty : 0));
  competitor.points += points;
  competitor.completedObjectiveIds.push(objectiveId);
  delete competitor.deadlines[objectiveId];
  result.changed = true;
  result.events.push({
    type: 'objective_complete',
    audience: 'all',
    actorId: actorId ?? null,
    payload: {
      competitorKey: key,
      objectiveId,
      title: objective.title,
      points,
      totalPoints: competitor.points,
    },
    dedupeKey: `complete:${game.id}:${key}:${objectiveId}`,
  });

  const allDone = settings.objectives.every((o) =>
    competitor.completedObjectiveIds.includes(o.id) || competitor.expiredObjectiveIds.includes(o.id),
  );
  if (allDone) {
    competitor.finishedAt = now;
    if (settings.winCondition === 'first-to-complete') {
      result.finished = {
        key,
        label: competitorLabel(game, key),
        reason: 'Completed every objective first.',
      };
    }
  } else {
    advanceSequential(game, competitor, key, now, result);
  }
  return true;
}

export function requestScavengerHint(
  game: GameRecord,
  key: string,
  objectiveId: string,
  now: number,
): { ok: boolean; reason?: string } {
  const settings = game.settings as ScavengerSettings;
  const state = game.runtime.scavenger;
  const competitor = state?.competitors[key];
  const objective = settings.objectives.find((o) => o.id === objectiveId);
  if (!state || !competitor || !objective) return { ok: false, reason: 'Objective not found.' };
  if (!objective.hint.trim()) return { ok: false, reason: 'This objective has no hint.' };
  if (competitor.completedObjectiveIds.includes(objective.id)) return { ok: false, reason: 'Already completed.' };
  if (competitor.hintsUsed.includes(objective.id)) return { ok: true };
  competitor.hintsUsed.push(objective.id);
  void now;
  return { ok: true };
}

export function submitScavengerCode(
  game: GameRecord,
  key: string,
  objectiveId: string,
  answer: string,
  now: number,
  result: EngineResult,
  actorId: string,
): { ok: boolean; reason?: string } {
  const settings = game.settings as ScavengerSettings;
  const objective = settings.objectives.find((o) => o.id === objectiveId);
  if (!objective || objective.verification !== 'code') return { ok: false, reason: 'Objective not found.' };
  const state = game.runtime.scavenger;
  const competitor = state?.competitors[key];
  if (!competitor) return { ok: false, reason: 'You are not competing in this hunt.' };
  if (competitor.completedObjectiveIds.includes(objectiveId)) return { ok: false, reason: 'Already completed.' };
  if (settings.orderMode === 'sequential') {
    const next = settings.objectives.find(
      (o) => !competitor.completedObjectiveIds.includes(o.id) && !competitor.expiredObjectiveIds.includes(o.id),
    );
    if (!next || next.id !== objectiveId) return { ok: false, reason: 'Complete the earlier objectives first.' };
  }
  const expected = objective.code.trim().toLowerCase();
  if (!expected) return { ok: false, reason: 'This objective has no answer configured.' };
  if (answer.trim().toLowerCase() !== expected) return { ok: false, reason: 'That answer is not correct.' };
  completeObjective(game, key, objectiveId, now, result, actorId);
  return { ok: true };
}

/* Area boundary events are shared by every location-based mode. */
export function boundaryCheck(
  game: GameRecord,
  player: PlayerRecord,
  location: StoredLocation,
  previous: StoredLocation | undefined,
  now: number,
): EngineEvent | null {
  const area = game.settings.area;
  if (!area.enabled || !area.center || !isValidLatLng(location)) return null;
  const inside = isInsideArea(area, location);
  const wasInside = previous ? isInsideArea(area, previous) : null;
  if (wasInside === inside) return null;
  if (wasInside == null && inside) return null;
  return {
    type: inside ? 'area_entered' : 'area_left',
    audience: 'team',
    teamKey: player.teamKey,
    actorId: player.id,
    payload: { nickname: player.nickname, distanceFromCentre: Math.round(distanceMeters(location, area.center)) },
    dedupeKey: `area:${game.id}:${player.id}:${inside ? 'in' : 'out'}:${Math.floor(now / 30000)}`,
  };
}

export function announceTeamRuntime(game: GameRecord, teamKey: string): TeamRuntime {
  return game.runtime.teams[teamKey];
}
