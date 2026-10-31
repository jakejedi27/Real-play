import { Link } from 'react-router-dom';
import type { GameSnapshot } from '@shared/types';
import { MODE_META } from '@shared/modes';
import { clockTime, dateTimeText } from '../lib/format';
import { Pill } from './ui';

export function Results({ snapshot }: { snapshot: GameSnapshot }) {
  const RESULTS_LABEL: Record<string, string> = {
    'time-up': 'Time ran out',
    'score-limit': 'Score limit reached',
    'all-runners-caught': 'Every runner was caught',
    completed: 'Every objective completed',
    'host-ended': 'Ended by the host',
    cancelled: 'Cancelled before the end',
    'not-enough-players': 'Not enough players',
  };
  const results = snapshot.results;
  const meta = MODE_META[snapshot.game.mode];
  const cancelled = snapshot.game.status === 'cancelled';

  return (
    <div className="shell narrow results">
      <div className="results-head">
        <Pill tone={cancelled ? 'warn' : 'good'}>{cancelled ? 'Cancelled' : 'Final'}</Pill>
        <h1>{snapshot.game.name}</h1>
        <p className="muted">
          {meta.name} · {results?.reason ? RESULTS_LABEL[results.reason] ?? results.reason : 'Finished'} ·{' '}
          {results?.endedAt ? dateTimeText(results.endedAt) : clockTime(snapshot.game.endedAt)}
        </p>
      </div>

      {results?.winnerLabel ? (
        <div className="winner-card" style={{ '--mode-accent': meta.accent } as React.CSSProperties}>
          <span className="winner-glyph" aria-hidden="true">
            {meta.glyph}
          </span>
          <div>
            <span className="field-label">Winner</span>
            <h2>{results.winnerLabel}</h2>
          </div>
        </div>
      ) : (
        <div className="winner-card">
          <div>
            <span className="field-label">Result</span>
            <h2>No winner</h2>
            <p className="muted">
              {cancelled ? 'The game was cancelled.' : 'Nobody finished ahead before the end conditions.'}
            </p>
          </div>
        </div>
      )}

      {results && results.scores.length > 0 ? (
        <section className="card">
          <h2 className="card-title">Scores</h2>
          <ul className="score-list">
            {[...results.scores]
              .sort((a, b) => b.score - a.score)
              .map((line, index) => (
                <li key={line.key} className="score">
                  <span className="score-rank">#{index + 1}</span>
                  <span className="team-dot" style={{ background: line.color }} aria-hidden="true" />
                  <span className="score-name">{line.label}</span>
                  <strong className="score-value">{line.score}</strong>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {results && results.stats.length > 0 ? (
        <section className="card">
          <h2 className="card-title">Match stats</h2>
          <ul className="detail-list">
            {results.stats.map((stat) => (
              <li key={stat.label}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card">
        <h2 className="card-title">What happened</h2>
        <ul className="feed">
          {snapshot.feed.slice(0, 40).map((item) => (
            <li key={item.id} className="feed-item">
              <span className="feed-text">{item.text}</span>
              <span className="feed-time">{clockTime(item.createdAt)}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="wizard-actions">
        <Link to="/" className="btn btn-ghost">
          Home
        </Link>
        <Link to={`/create/${snapshot.game.mode}`} className="btn btn-primary">
          Run another {meta.name}
        </Link>
      </div>
      <p className="field-hint">
        Results are stored on the server. Only players who joined this game can load this screen.
      </p>
    </div>
  );
}
