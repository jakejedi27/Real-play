import type { GameSnapshot, GameSummary, ModeId } from '@shared/types';

export class ApiError extends Error {
  readonly status: number;
  readonly details: string[];

  constructor(message: string, status = 500, details: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

const SESSION_KEY = 'realplay.sessions.v1';

export interface StoredSession {
  gameId: string;
  code: string;
  mode: ModeId;
  name: string;
  token: string;
  playerId: string;
  nickname: string;
  isHost: boolean;
  savedAt: number;
}

type SessionMap = Record<string, StoredSession>;

function readSessions(): SessionMap {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as SessionMap) : {};
  } catch {
    return {};
  }
}

function writeSessions(sessions: SessionMap): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
  } catch {
    /* storage can be unavailable in private mode — the session still lives in memory */
  }
}

export function saveSession(session: Omit<StoredSession, 'savedAt'>): void {
  const sessions = readSessions();
  sessions[session.gameId] = { ...session, savedAt: Date.now() };
  writeSessions(sessions);
}

export function loadSession(gameId: string): StoredSession | null {
  return readSessions()[gameId] ?? null;
}

export function forgetSession(gameId: string): void {
  const sessions = readSessions();
  delete sessions[gameId];
  writeSessions(sessions);
}

export function listSessions(): StoredSession[] {
  return Object.values(readSessions()).sort((a, b) => b.savedAt - a.savedAt);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Cannot reach the game server. Check your connection.', 0);
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let details: string[] = [];
    try {
      const payload = (await response.json()) as { error?: string; details?: unknown };
      if (typeof payload.error === 'string') message = payload.error;
      if (Array.isArray(payload.details)) details = payload.details.map(String);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, response.status, details);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface PreviewResponse {
  id: string;
  code: string;
  name: string;
  mode: ModeId;
  status: string;
  playerCount: number;
  maxPlayers: number;
  hostNickname: string;
  requiresConsent: boolean;
}

export interface JoinResponse {
  token: string;
  playerId: string;
  gameId: string;
  snapshot: GameSnapshot;
}

export const api = {
  createGame: (body: {
    mode: ModeId;
    name: string;
    nickname: string;
    settings: unknown;
  }) => request<{ token: string; snapshot: GameSnapshot }>('/api/games', { method: 'POST', body }),

  preview: (code: string, signal?: AbortSignal) =>
    request<PreviewResponse>(`/api/games/preview?code=${encodeURIComponent(code)}`, { signal }),

  join: (body: { code: string; nickname: string; consentLocation: boolean }) =>
    request<JoinResponse>('/api/games/join', { method: 'POST', body }),

  snapshot: (gameId: string, token: string, signal?: AbortSignal) =>
    request<GameSnapshot>(`/api/games/${gameId}`, { token, signal }),

  updateSettings: (gameId: string, token: string, settings: unknown) =>
    request<GameSnapshot>(`/api/games/${gameId}/settings`, {
      method: 'PATCH',
      token,
      body: { settings },
    }),

  setReady: (gameId: string, token: string, ready: boolean) =>
    request<GameSnapshot>(`/api/games/${gameId}/ready`, { method: 'POST', token, body: { ready } }),

  setTeam: (gameId: string, token: string, playerId: string, teamKey: string | null) =>
    request<GameSnapshot>(`/api/games/${gameId}/team`, {
      method: 'POST',
      token,
      body: { playerId, teamKey },
    }),

  start: (gameId: string, token: string) =>
    request<GameSnapshot>(`/api/games/${gameId}/start`, { method: 'POST', token }),

  pause: (gameId: string, token: string) =>
    request<GameSnapshot>(`/api/games/${gameId}/pause`, { method: 'POST', token }),

  resume: (gameId: string, token: string) =>
    request<GameSnapshot>(`/api/games/${gameId}/resume`, { method: 'POST', token }),

  end: (gameId: string, token: string) =>
    request<GameSnapshot>(`/api/games/${gameId}/end`, { method: 'POST', token }),

  cancel: (gameId: string, token: string) =>
    request<GameSnapshot>(`/api/games/${gameId}/cancel`, { method: 'POST', token }),

  announce: (gameId: string, token: string, message: string) =>
    request<GameSnapshot>(`/api/games/${gameId}/announce`, {
      method: 'POST',
      token,
      body: { message },
    }),

  ping: (gameId: string, token: string, message: string) =>
    request<GameSnapshot>(`/api/games/${gameId}/ping`, { method: 'POST', token, body: { message } }),

  checkIn: (gameId: string, token: string, status: string) =>
    request<GameSnapshot>(`/api/games/${gameId}/check-in`, {
      method: 'POST',
      token,
      body: { status },
    }),

  location: (
    gameId: string,
    token: string,
    fix: { lat: number; lng: number; accuracyMeters: number; recordedAt: number },
  ) =>
    request<{ ok: true; recordedAt: number }>(`/api/games/${gameId}/location`, {
      method: 'POST',
      token,
      body: fix,
    }),

  scavengerHint: (gameId: string, token: string, objectiveId: string) =>
    request<GameSnapshot>(`/api/games/${gameId}/scavenger/hint`, {
      method: 'POST',
      token,
      body: { objectiveId },
    }),

  scavengerCode: (gameId: string, token: string, objectiveId: string, answer: string) =>
    request<GameSnapshot>(`/api/games/${gameId}/scavenger/code`, {
      method: 'POST',
      token,
      body: { objectiveId, answer },
    }),

  history: (limit = 12, signal?: AbortSignal) =>
    request<{ games: GameSummary[] }>(`/api/history?limit=${limit}`, { signal }),

  health: (signal?: AbortSignal) => request<{ ok: boolean; store: string }>('/api/health', { signal }),
};
