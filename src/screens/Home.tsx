import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MODE_LIST, MODE_META } from '@shared/modes';
import type { GameSummary, ModeId } from '@shared/types';
import { api, listSessions, type StoredSession } from '../lib/api';
import { dateText, normaliseCode } from '../lib/format';
import { TextInput, Pill } from '../components/ui';

export function Home() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [code, setCode] = useState('');
  const [recent, setRecent] = useState<GameSummary[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setSessions(listSessions().slice(0, 4));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api
      .history(4, controller.signal)
      .then((response) => setRecent(response.games))
      .catch(() => setHistoryError('Recent games could not be loaded.'));
    return () => controller.abort();
  }, []);

  const openCode = async () => {
    const cleaned = normaliseCode(code);
    if (cleaned.length < 4) {
      setCodeError('Game codes are 6 characters. Ask the host for the full code.');
      return;
    }
    setChecking(true);
    setCodeError(null);
    try {
      const preview = await api.preview(cleaned);
      navigate(`/join?code=${preview.code}`);
    } catch (error) {
      setCodeError(error instanceof Error ? error.message : 'No game found with that code.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="shell">
      <header className="hero">
        <div className="hero-top">
          <Link to="/" className="brand" aria-label="RealPlay home">
            <span className="brand-mark" aria-hidden="true">
              ◎
            </span>
            <span>
              RealPlay
              <em>Real life. Real teams.</em>
            </span>
          </Link>
          <nav className="hero-nav">
            <Link to="/history">History</Link>
            <Link to="/safety">Safety</Link>
          </nav>
        </div>
        <h1>
          Four outdoor games.
          <br />
          One code to join.
        </h1>
        <p className="hero-sub">
          Set the rules, share a code, and let the server referee. Positions come from real device
          GPS — never simulated.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href="#modes">
            Choose a mode
          </a>
          <Link className="btn btn-ghost" to="/join">
            Join with a code
          </Link>
        </div>
      </header>

      <main className="home-main">
        <section className="card join-quick">
          <div>
            <h2>Got a code?</h2>
            <p className="muted">Six characters from your host. No account needed.</p>
          </div>
          <div className="join-quick-form">
            <TextInput
              value={code}
              onChange={(value) => {
                setCode(normaliseCode(value));
                setCodeError(null);
              }}
              placeholder="AB12CD"
              inputMode="text"
              autoCapitalize="characters"
              maxLength={6}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void openCode()}
              disabled={checking || code.length < 4}
            >
              {checking ? 'Checking…' : 'Join'}
            </button>
          </div>
          {codeError ? (
            <p className="field-hint field-hint-error" role="alert">
              {codeError}
            </p>
          ) : null}
        </section>

        {sessions.length > 0 ? (
          <section className="resume">
            <h2>Pick up where you left off</h2>
            <div className="resume-list">
              {sessions.map((session) => (
                <Link key={session.gameId} to={`/game/${session.gameId}`} className="resume-card">
                  <span className="resume-glyph" aria-hidden="true">
                    {MODE_META[session.mode]?.glyph ?? '◎'}
                  </span>
                  <span className="resume-body">
                    <strong>{session.name}</strong>
                    <em>
                      {MODE_META[session.mode]?.name ?? session.mode} · code {session.code}
                      {session.isHost ? ' · host' : ''}
                    </em>
                  </span>
                  <span aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section id="modes" className="modes">
          <h2>Pick a game</h2>
          <p className="muted">
            Every mode has its own setup wizard — only the rules that matter to that game.
          </p>
          <div className="mode-grid">
            {MODE_LIST.map((mode) => (
              <article
                key={mode.id}
                className="mode-card"
                style={{ '--mode-accent': mode.accent } as React.CSSProperties}
              >
                <div className="mode-glyph" aria-hidden="true">
                  {mode.glyph}
                </div>
                <h3>{mode.name}</h3>
                <p className="mode-tagline">{mode.tagline}</p>
                <p className="mode-desc">{mode.description}</p>
                <ul className="mode-bullets">
                  {mode.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
                <div className="mode-meta">
                  <Pill>{mode.minPlayers}+ players</Pill>
                  <Pill>{mode.location === 'required' ? 'GPS' : 'Optional GPS'}</Pill>
                  <Pill>{mode.teamBased ? 'Teams' : 'Solo / teams'}</Pill>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  onClick={() => navigate(`/create/${mode.id as ModeId}`)}
                >
                  Set up {mode.name}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="recent">
          <div className="section-head">
            <h2>Recently created</h2>
            <Link to="/history" className="link-more">
              All games
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="muted">{historyError ?? 'No games on this server yet. Create the first one.'}</p>
          ) : (
            <ul className="recent-list">
              {recent.map((game) => (
                <li key={game.id}>
                  <span className="recent-mode">{MODE_META[game.mode]?.glyph}</span>
                  <span className="recent-body">
                    <strong>{game.name}</strong>
                    <em>
                      {MODE_META[game.mode]?.name} · {dateText(game.createdAt)} · {game.playerCount}{' '}
                      players
                    </em>
                  </span>
                  <Pill tone={game.status === 'lobby' ? 'live' : 'neutral'}>{game.status}</Pill>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="safety-strip">
          <h2>Play it safe out there</h2>
          <ul>
            <li>Agree on boundaries and off-limits areas before anyone moves.</li>
            <li>No trespassing, no roads, no chases that put people or traffic at risk.</li>
            <li>Never look at a phone while driving. Hunter transport rules are honour rules.</li>
            <li>Stop play immediately if anyone feels unsafe.</li>
          </ul>
          <Link to="/safety" className="link-more">
            Full safety guidance →
          </Link>
        </section>
      </main>

      <footer className="footer">
        <span>RealPlay</span>
        <span className="muted">
          Maps © OpenStreetMap contributors · Locations stay on the server that runs your game
        </span>
      </footer>
    </div>
  );
}
