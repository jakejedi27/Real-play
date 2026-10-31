import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MODE_META } from '@shared/modes';
import type { GameSummary } from '@shared/types';
import { api, listSessions, type StoredSession } from '../lib/api';
import { dateTimeText } from '../lib/format';
import { Banner, EmptyState, Pill, Spinner } from '../components/ui';

const STATUS_LABEL: Record<string, string> = {
  lobby: 'In lobby',
  countdown: 'Starting',
  active: 'In play',
  paused: 'Paused',
  ended: 'Ended',
  cancelled: 'Cancelled',
};

function statusTone(status: string): 'neutral' | 'live' | 'warn' | 'good' {
  if (status === 'active' || status === 'countdown') return 'live';
  if (status === 'paused') return 'warn';
  if (status === 'ended') return 'good';
  return 'neutral';
}

export function History() {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<StoredSession[]>([]);

  useEffect(() => {
    setSessions(listSessions());
    const controller = new AbortController();
    api
      .history(30, controller.signal)
      .then((response) => setGames(response.games))
      .catch(() => setError('Could not load game history. Check the server and try again.'));
    return () => controller.abort();
  }, []);

  const sessionFor = (gameId: string) => sessions.find((session) => session.gameId === gameId);

  return (
    <div className="shell narrow">
      <header className="screen-head">
        <Link to="/" className="back-link">
          ← Home
        </Link>
        <h1>Game history</h1>
        <p className="muted">
          Games hosted on this server. Only games you joined are resumable from this device.
        </p>
      </header>

      {error ? (
        <Banner tone="danger" title="History unavailable">
          {error}
        </Banner>
      ) : null}

      {!games && !error ? <Spinner label="Loading games…" /> : null}

      {games && games.length === 0 ? (
        <EmptyState
          glyph="◎"
          title="No games yet"
          action={
            <Link to="/" className="btn btn-primary">
              Create the first game
            </Link>
          }
        >
          Once someone creates a game on this server it will appear here.
        </EmptyState>
      ) : null}

      {games && games.length > 0 ? (
        <ul className="history-list">
          {games.map((game) => {
            const session = sessionFor(game.id);
            const meta = MODE_META[game.mode];
            return (
              <li key={game.id} className="history-item" style={{ '--mode-accent': meta.accent } as React.CSSProperties}>
                <div className="history-glyph" aria-hidden="true">
                  {meta.glyph}
                </div>
                <div className="history-body">
                  <div className="history-title">
                    <strong>{game.name}</strong>
                    <Pill tone={statusTone(game.status)}>{STATUS_LABEL[game.status] ?? game.status}</Pill>
                  </div>
                  <p className="muted">
                    {meta.name} · code {game.code} · {game.playerCount}/{game.maxPlayers} players
                  </p>
                  <p className="history-time">Created {dateTimeText(game.createdAt)}</p>
                </div>
                {session ? (
                  <Link to={`/game/${game.id}`} className="btn btn-ghost btn-sm">
                    Open
                  </Link>
                ) : (
                  <Link to={`/join?code=${game.code}`} className="btn btn-ghost btn-sm">
                    Join
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
