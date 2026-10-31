import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { GameSnapshot } from '@shared/types';
import { ApiError, api, forgetSession, loadSession, type StoredSession } from './api';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

interface GameSessionValue {
  gameId: string;
  session: StoredSession | null;
  snapshot: GameSnapshot | null;
  connection: ConnectionState;
  loading: boolean;
  error: string | null;
  actionError: string | null;
  busy: boolean;
  /** Authoritative server time, adjusted for clock skew. */
  serverNow: () => number;
  refresh: () => Promise<void>;
  clearError: () => void;
  leave: () => void;
  actions: {
    updateSettings: (settings: unknown) => Promise<void>;
    setReady: (ready: boolean) => Promise<void>;
    setTeam: (playerId: string, teamKey: string | null) => Promise<void>;
    start: () => Promise<void>;
    pause: () => Promise<void>;
    resume: () => Promise<void>;
    end: () => Promise<void>;
    cancel: () => Promise<void>;
    announce: (message: string) => Promise<void>;
    ping: (message: string) => Promise<void>;
    checkIn: (status: string) => Promise<void>;
    hint: (objectiveId: string) => Promise<void>;
    code: (objectiveId: string, answer: string) => Promise<void>;
  };
}

const GameSessionContext = createContext<GameSessionValue | null>(null);

export function useGameSession(): GameSessionValue {
  const value = useContext(GameSessionContext);
  if (!value) throw new Error('useGameSession must be used inside <GameSessionProvider>');
  return value;
}

export function GameSessionProvider({
  gameId,
  children,
  onSessionLost,
}: {
  gameId: string;
  children: ReactNode;
  onSessionLost?: () => void;
}) {
  const [session, setSession] = useState<StoredSession | null>(() => loadSession(gameId));
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const offsetRef = useRef(0);
  const revisionRef = useRef(-1);

  const token = session?.token ?? null;

  const applySnapshot = useCallback((next: GameSnapshot) => {
    const revision = next.game.revision;
    if (revision < revisionRef.current) return;
    revisionRef.current = revision;
    offsetRef.current = next.serverNow - Date.now();
    setSnapshot(next);
    setLoading(false);
    setConnection('live');
  }, []);

  const refresh = useCallback(async () => {
    if (!token) {
      setError('This device does not hold a session for that game. Rejoin with the game code.');
      setLoading(false);
      return;
    }
    try {
      const next = await api.snapshot(gameId, token);
      applySnapshot(next);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 401 || caught.status === 404) {
          forgetSession(gameId);
          setSession(null);
          setError(caught.message);
          onSessionLost?.();
          return;
        }
        if (caught.status === 0) {
          setConnection('offline');
          setError(caught.message);
          return;
        }
        setError(caught.message);
      } else {
        setError('Could not load the game.');
      }
      setLoading(false);
    }
  }, [applySnapshot, gameId, onSessionLost, token]);

  /* Authoritative state arrives over SSE; polling is the fallback path when
     the stream cannot be established (proxy, backgrounded tab, offline). */
  useEffect(() => {
    setSession(loadSession(gameId));
  }, [gameId]);

  useEffect(() => {
    if (!token) return;
    let closed = false;
    let source: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (poll !== null) return;
      poll = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        void refresh();
      }, 4000);
    };

    const stopPolling = () => {
      if (poll !== null) {
        clearInterval(poll);
        poll = null;
      }
    };

    void refresh().then(() => {
      if (closed) return;
      const url = `/api/games/${encodeURIComponent(gameId)}/stream?token=${encodeURIComponent(token)}`;
      source = new EventSource(url);
      source.addEventListener('snapshot', (event) => {
        try {
          const parsed = JSON.parse((event as MessageEvent<string>).data) as GameSnapshot;
          applySnapshot(parsed);
          setError(null);
          stopPolling();
        } catch {
          /* ignore malformed frame */
        }
      });
      source.addEventListener('open', () => {
        setConnection('live');
        stopPolling();
      });
      source.addEventListener('error', () => {
        if (closed) return;
        setConnection((prev) => (prev === 'offline' ? 'offline' : 'reconnecting'));
        startPolling();
      });
    });

    const onOnline = () => void refresh();
    const onOffline = () => setConnection('offline');
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      closed = true;
      source?.close();
      stopPolling();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [applySnapshot, gameId, refresh, token]);

  const run = useCallback(
    async (task: (token: string) => Promise<GameSnapshot>) => {
      if (!token) throw new ApiError('You are not signed in to this game.', 401);
      setBusy(true);
      setActionError(null);
      try {
        const next = await task(token);
        applySnapshot(next);
      } catch (caught) {
        const message =
          caught instanceof ApiError ? caught.message : 'That action could not be completed.';
        setActionError(message);
        throw caught;
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot, token],
  );

  const actions = useMemo(
    () => ({
      updateSettings: (settings: unknown) => run((t) => api.updateSettings(gameId, t, settings)),
      setReady: (ready: boolean) => run((t) => api.setReady(gameId, t, ready)),
      setTeam: (playerId: string, teamKey: string | null) =>
        run((t) => api.setTeam(gameId, t, playerId, teamKey)),
      start: () => run((t) => api.start(gameId, t)),
      pause: () => run((t) => api.pause(gameId, t)),
      resume: () => run((t) => api.resume(gameId, t)),
      end: () => run((t) => api.end(gameId, t)),
      cancel: () => run((t) => api.cancel(gameId, t)),
      announce: (message: string) => run((t) => api.announce(gameId, t, message)),
      ping: (message: string) => run((t) => api.ping(gameId, t, message)),
      checkIn: (status: string) => run((t) => api.checkIn(gameId, t, status)),
      hint: (objectiveId: string) => run((t) => api.scavengerHint(gameId, t, objectiveId)),
      code: (objectiveId: string, answer: string) =>
        run((t) => api.scavengerCode(gameId, t, objectiveId, answer)),
    }),
    [gameId, run],
  );

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  const leave = useCallback(() => {
    forgetSession(gameId);
    setSession(null);
  }, [gameId]);

  const value = useMemo<GameSessionValue>(
    () => ({
      gameId,
      session,
      snapshot,
      connection,
      loading,
      error,
      actionError,
      busy,
      serverNow,
      refresh,
      clearError: () => setActionError(null),
      leave,
      actions,
    }),
    [
      actionError,
      actions,
      busy,
      connection,
      error,
      gameId,
      leave,
      loading,
      refresh,
      serverNow,
      session,
      snapshot,
    ],
  );

  return <GameSessionContext.Provider value={value}>{children}</GameSessionContext.Provider>;
}
