/**
 * RealPlay shared domain types.
 *
 * These types are used by both the browser client and the server. The server is
 * the only writer of authoritative state; clients receive filtered snapshots.
 */

export const MODE_IDS = ['manhunt', 'ctf', 'territory', 'scavenger'] as const;
export type ModeId = (typeof MODE_IDS)[number];

export const GAME_STATUSES = ['lobby', 'countdown', 'active', 'paused', 'ended', 'cancelled'] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export type TeamAssignmentRule = 'auto' | 'host' | 'self';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PlayArea {
  enabled: boolean;
  /** Null until the host picks the play area from a real map/location fix. */
  center: LatLng | null;
  radiusMeters: number;
}

export interface TeamConfig {
  key: string;
  name: string;
  color: string;
}

export interface CommonSettings {
  mode: ModeId;
  maxPlayers: number;
  durationMinutes: number;
  countdownSeconds: number;
  area: PlayArea;
  /** Minimum seconds between automatic location uploads (battery / data saving). */
  locationUpdateSeconds: number;
  /** A fix older than this is shown as stale and not used for scoring. */
  staleAfterSeconds: number;
  shareTeamLocations: boolean;
  teamAssignment: TeamAssignmentRule;
  /** 0 = no per-team size cap. */
  maxTeamSize: number;
  teams: TeamConfig[];
  safetyAcknowledged: boolean;
}

export type HunterTransport = 'walk-only' | 'walk-or-bike' | 'any';

export interface ManhuntSettings extends CommonSettings {
  mode: 'manhunt';
  headStartSeconds: number;
  revealIntervalSeconds: number;
  hunterTransport: HunterTransport;
  tagRadiusMeters: number;
  runnerPings: boolean;
  hunterCheckIns: boolean;
  tieRule: 'runners' | 'hunters' | 'draw';
}

export interface CtfSettings extends CommonSettings {
  mode: 'ctf';
  /** Base location per team key. Null means "auto-place at game creation". */
  bases: Record<string, LatLng | null>;
  baseRadiusMeters: number;
  tagRadiusMeters: number;
  canTag: boolean;
  requireOwnFlagHome: boolean;
  respawnSeconds: number;
  scorePerCapture: number;
  captureCooldownSeconds: number;
  winScore: number;
  tieRule: 'draw' | 'overtime';
}

export interface TerritoryZoneConfig {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  eligibleTeamKeys: string[];
}

export interface TerritorySettings extends CommonSettings {
  mode: 'territory';
  zones: TerritoryZoneConfig[];
  neutralizeSeconds: number;
  captureSeconds: number;
  scoreIntervalSeconds: number;
  pointsPerZone: number;
  /** 0 = no score cap. */
  scoreLimit: number;
  tieRule: 'draw' | 'overtime';
}

export type ObjectiveVerification = 'gps' | 'code';

export interface ScavengerObjectiveConfig {
  id: string;
  title: string;
  clue: string;
  description: string;
  verification: ObjectiveVerification;
  lat: number | null;
  lng: number | null;
  radiusMeters: number;
  points: number;
  hint: string;
  hintPenalty: number;
  /** Secret answer for `code` objectives. Never returned to clients. */
  code: string;
}

export interface ScavengerSettings extends CommonSettings {
  mode: 'scavenger';
  competition: 'individual' | 'team';
  orderMode: 'free' | 'sequential';
  winCondition: 'highest-points' | 'first-to-complete';
  tieRule: 'draw' | 'earliest-finish';
  /** 0 = no per-objective time limit. */
  objectiveTimeLimitSeconds: number;
  objectives: ScavengerObjectiveConfig[];
}

export type ModeSettings = ManhuntSettings | CtfSettings | TerritorySettings | ScavengerSettings;

/* ------------------------------------------------------------------ */
/* Runtime state (JSON document owned by the server)                   */
/* ------------------------------------------------------------------ */

export interface FlagRuntime {
  status: 'home' | 'carried' | 'dropped';
  carrierId: string | null;
  lat: number | null;
  lng: number | null;
}

export interface TeamRuntime {
  score: number;
  base: LatLng | null;
  flag: FlagRuntime | null;
}

export interface PlayerRuntime {
  eliminated: boolean;
  eliminatedAt: number | null;
  respawnUntil: number | null;
}

export interface ZoneRuntime {
  id: string;
  ownerTeamKey: string | null;
  progressTeamKey: string | null;
  progressMs: number;
  lastScoredAt: number | null;
}

export interface CompetitorRuntime {
  points: number;
  completedObjectiveIds: string[];
  hintsUsed: string[];
  startedAt: number | null;
  finishedAt: number | null;
  /** Objective id -> ms timestamp when its completion window closes. */
  deadlines: Record<string, number | null>;
}

export interface GameRuntime {
  players: Record<string, PlayerRuntime>;
  teams: Record<string, TeamRuntime>;
  manhunt?: {
    revealIndex: number;
    nextRevealAt: number | null;
    headStartEndsAt: number;
  };
  ctf?: {
    lastCaptureAt: Record<string, number>;
    overtime: boolean;
  };
  territory?: {
    zones: ZoneRuntime[];
    tickIndex: number;
    lastTickAt: number | null;
  };
  scavenger?: {
    competitors: Record<string, CompetitorRuntime>;
    order: Record<string, string[]>;
  };
  winner: { key: string; label: string; reason: string } | null;
  endedReason: string | null;
}

/* ------------------------------------------------------------------ */
/* Persisted records                                                   */
/* ------------------------------------------------------------------ */

export interface GameRecord {
  id: string;
  code: string;
  name: string;
  mode: ModeId;
  status: GameStatus;
  hostPlayerId: string;
  settings: ModeSettings;
  runtime: GameRuntime;
  revision: number;
  createdAt: number;
  updatedAt: number;
  /** Milliseconds timestamp when the match clock started. */
  startedAt: number | null;
  endedAt: number | null;
  countdownEndsAt: number | null;
  durationMs: number;
  pausedAt: number | null;
  accumulatedPauseMs: number;
  winner: { key: string; label: string; reason: string } | null;
  endedReason: string | null;
}

export interface PlayerRecord {
  id: string;
  gameId: string;
  nickname: string;
  tokenHash: string;
  teamKey: string | null;
  isHost: boolean;
  ready: boolean;
  consentLocation: boolean;
  lastSeenAt: number;
  createdAt: number;
}

export interface StoredLocation {
  playerId: string;
  gameId: string;
  lat: number;
  lng: number;
  accuracyMeters: number;
  /** Device-reported fix timestamp (ms). */
  recordedAt: number;
  receivedAt: number;
}

export type EventAudience = 'all' | 'team' | 'host' | 'host-team';

export interface GameEventRecord {
  id: string;
  gameId: string;
  seq: number;
  type: string;
  audience: EventAudience;
  teamKey: string | null;
  actorId: string | null;
  payload: Record<string, unknown>;
  createdAt: number;
  dedupeKey: string | null;
}

export interface JobRecord {
  id: string;
  gameId: string;
  kind: string;
  runKey: string;
  runAt: number;
  status: 'pending' | 'processing' | 'done' | 'failed';
  attempts: number;
  payload: Record<string, unknown>;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* Client-facing views                                                 */
/* ------------------------------------------------------------------ */

export interface PlayerView {
  id: string;
  nickname: string;
  teamKey: string | null;
  isHost: boolean;
  ready: boolean;
  consentLocation: boolean;
  connected: boolean;
  eliminated: boolean;
  respawnUntil: number | null;
}

export interface TeamView {
  key: string;
  name: string;
  color: string;
  score: number;
  base: LatLng | null;
  flag: { status: 'home' | 'carried' | 'dropped'; carrierId: string | null; lat: number | null; lng: number | null } | null;
  memberCount: number;
}

export interface LocationView {
  playerId: string;
  nickname: string;
  teamKey: string | null;
  lat: number;
  lng: number;
  accuracyMeters: number;
  recordedAt: number;
  receivedAt: number;
  ageSeconds: number;
  stale: boolean;
  /** live = the player's own or an authorized teammate position. */
  source: 'live' | 'revealed';
  revealIndex?: number;
  revealAt?: number;
}

export interface RevealRunner {
  playerId: string;
  nickname: string;
  lat: number;
  lng: number;
  accuracyMeters: number;
  recordedAt: number;
  ageSeconds: number;
}

export interface RevealView {
  revealIndex: number;
  createdAt: number;
  runners: RevealRunner[];
  missing: { playerId: string; nickname: string; reason: string }[];
}

export interface FeedItem {
  id: string;
  seq: number;
  type: string;
  text: string;
  teamKey: string | null;
  actorId: string | null;
  actorNickname: string | null;
  createdAt: number;
}

export interface ObjectiveView {
  id: string;
  index: number;
  title: string;
  clue: string;
  description: string;
  points: number;
  lat: number | null;
  lng: number | null;
  radiusMeters: number;
  verification: ObjectiveVerification;
  hintAvailable: boolean;
  hint: string | null;
  hintPenalty: number;
  completed: boolean;
  locked: boolean;
  deadlineAt: number | null;
}

export interface ZoneView {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  ownerTeamKey: string | null;
  progressTeamKey: string | null;
  progress: number;
  captureSeconds: number;
  eligibleTeamKeys: string[];
  presentTeamKeys: string[];
}

export interface ScoreLine {
  key: string;
  label: string;
  score: number;
  color: string;
}

export interface ResultsView {
  endedAt: number | null;
  reason: string;
  winnerKey: string | null;
  winnerLabel: string | null;
  scores: ScoreLine[];
  stats: { label: string; value: string }[];
}

export interface GameSummary {
  id: string;
  code: string;
  name: string;
  mode: ModeId;
  status: GameStatus;
  playerCount: number;
  maxPlayers: number;
  createdAt: number;
  updatedAt: number;
}

export interface GameSnapshot {
  serverNow: number;
  game: {
    id: string;
    code: string;
    name: string;
    mode: ModeId;
    status: GameStatus;
    hostPlayerId: string;
    playerCount: number;
    maxPlayers: number;
    createdAt: number;
    startedAt: number | null;
    endsAt: number | null;
    countdownEndsAt: number | null;
    durationMs: number;
    remainingMs: number | null;
    pausedAt: number | null;
    area: PlayArea;
    settings: Record<string, unknown>;
    revision: number;
  };
  you: {
    id: string;
    nickname: string;
    isHost: boolean;
    teamKey: string | null;
    ready: boolean;
    consentLocation: boolean;
    eliminated: boolean;
    respawnUntil: number | null;
    points: number;
  };
  players: PlayerView[];
  teams: TeamView[];
  locations: LocationView[];
  reveals: RevealView[];
  feed: FeedItem[];
  objectives: ObjectiveView[] | null;
  zones: ZoneView[] | null;
  modeState: Record<string, unknown>;
  results: ResultsView | null;
}

export interface ApiError {
  error: string;
  details?: string[];
}
