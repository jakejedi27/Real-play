import { useMemo, useState } from 'react';
import type { GameSnapshot } from '@shared/types';
import { distanceMeters } from '@shared/geo';
import { useGameSession } from '../lib/GameSession';
import { ageText, accuracyText, clockTime, formatClock } from '../lib/format';
import { Banner, Pill } from './ui';

interface PanelProps {
  snapshot: GameSnapshot;
}

function msUntil(serverNow: number, at: number | null | undefined): number | null {
  if (typeof at !== 'number') return null;
  return Math.max(0, at - serverNow);
}

/* ---------------------------------------------------------------- Manhunt */

const CHECK_IN_STATES = [
  { value: 'ok', label: 'OK' },
  { value: 'need-help', label: 'Need help' },
  { value: 'regroup', label: 'Regroup' },
];

const PING_MESSAGES = ['Spotted a hunter', 'Moving position', 'Area is clear', 'Need backup'];

export function ManhuntPanel({ snapshot }: PanelProps) {
  const session = useGameSession();
  const state = snapshot.modeState as {
    runnerTeamKey?: string;
    hunterTeamKey?: string;
    yourRole?: 'runner' | 'hunter' | 'spectator';
    headStartEndsAt?: number | null;
    nextRevealAt?: number | null;
    revealIndex?: number;
    revealIntervalSeconds?: number;
    tagRadiusMeters?: number;
    hunterTransport?: string;
    runnerPings?: boolean;
    hunterCheckIns?: boolean;
    runnersRemaining?: number;
  };
  const [pingMessage, setPingMessage] = useState('');
  const role = state.yourRole ?? 'spectator';
  const headStartMs = msUntil(snapshot.serverNow, state.headStartEndsAt);
  const nextRevealMs = msUntil(snapshot.serverNow, state.nextRevealAt);
  const latestReveal = snapshot.reveals[0] ?? null;

  const canSeeReveals = role === 'hunter' || snapshot.you.isHost;

  return (
    <div className="mode-panels">
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Your role</h2>
          <Pill tone={role === 'runner' ? 'good' : role === 'hunter' ? 'live' : 'neutral'}>
            {role === 'runner' ? 'Runner' : role === 'hunter' ? 'Hunter' : 'Spectator'}
          </Pill>
        </div>
        <div className="stat-row">
          <div className="stat">
            <span>Runners left</span>
            <strong>{state.runnersRemaining ?? '—'}</strong>
          </div>
          <div className="stat">
            <span>Head start</span>
            <strong>{headStartMs ? formatClock(headStartMs) : 'Over'}</strong>
          </div>
          <div className="stat">
            <span>Next reveal</span>
            <strong>{nextRevealMs !== null ? formatClock(nextRevealMs) : '—'}</strong>
          </div>
        </div>
        <p className="field-hint">
          Hunter transport rule: <strong>{state.hunterTransport ?? 'walk-only'}</strong>. Tag radius{' '}
          {state.tagRadiusMeters ?? 0} m. Reveals are published by the server every{' '}
          {state.revealIntervalSeconds ?? 0}s from the last valid runner fix — never live.
        </p>
        {role === 'runner' && headStartMs ? (
          <Banner tone="info" title="Head start running">
            Hunters stay put until the head start ends. Pick a route that stays inside the play area.
          </Banner>
        ) : null}
        {role === 'runner' && snapshot.you.eliminated ? (
          <Banner tone="warn" title="You were tagged">
            You are out of this round. Stay with a hunter or wait for the host to end the game.
          </Banner>
        ) : null}
        {role === 'runner' && state.hunterTransport === 'walk-only' ? (
          <p className="field-hint">Hunters must stay on foot. Cars, bikes and scooters are out of bounds for them.</p>
        ) : null}
      </section>

      {state.hunterCheckIns ? (
        <section className="card">
          <h2 className="card-title">Hunter check-in</h2>
          <p className="muted">One tap tells the rest of your team where you stand. No coordinates are shared.</p>
          <div className="button-row">
            {CHECK_IN_STATES.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className="btn btn-ghost"
                onClick={() => void session.actions.checkIn(entry.value).catch(() => undefined)}
                disabled={session.busy}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {state.runnerPings ? (
        <section className="card">
          <h2 className="card-title">Quick ping</h2>
          <p className="muted">
            Sends a short message to your team only. Pings never include a position and never bypass
            the reveal schedule.
          </p>
          <div className="chip-row">
            {PING_MESSAGES.map((message) => (
              <button
                key={message}
                type="button"
                className="chip"
                disabled={session.busy}
                onClick={() => void session.actions.ping(message).catch(() => undefined)}
              >
                {message}
              </button>
            ))}
          </div>
          <div className="inline-form">
            <input
              className="input"
              value={pingMessage}
              onChange={(event) => setPingMessage(event.target.value)}
              placeholder="Custom message"
              maxLength={80}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={session.busy || pingMessage.trim().length < 2}
              onClick={() => {
                const message = pingMessage.trim();
                setPingMessage('');
                void session.actions.ping(message).catch(() => undefined);
              }}
            >
              Send
            </button>
          </div>
        </section>
      ) : null}

      {canSeeReveals ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Runner reveals</h2>
            <span className="muted">{snapshot.reveals.length} published</span>
          </div>
          {snapshot.reveals.length === 0 ? (
            <p className="muted">
              No reveals yet. The first one lands after the head start and the reveal interval.
            </p>
          ) : (
            <ul className="reveal-list">
              {snapshot.reveals.map((reveal) => (
                <li key={reveal.revealIndex} className="reveal">
                  <div className="reveal-head">
                    <strong>Reveal #{reveal.revealIndex}</strong>
                    <span className="muted">{clockTime(reveal.createdAt)}</span>
                  </div>
                  {reveal.runners.length === 0 ? (
                    <p className="muted">No runner had a valid fix at this time.</p>
                  ) : (
                    <ul className="reveal-runners">
                      {reveal.runners.map((runner) => (
                        <li key={runner.playerId}>
                          <strong>{runner.nickname}</strong>
                          <span className="muted">
                            {' '}
                            · recorded {clockTime(runner.recordedAt)} · {ageText(runner.ageSeconds)} old ·{' '}
                            {accuracyText(runner.accuracyMeters)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {reveal.missing.length > 0 ? (
                    <p className="field-hint">
                      Missing: {reveal.missing.map((entry) => `${entry.nickname} (${entry.reason})`).join(', ')}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {latestReveal ? (
            <p className="field-hint">
              Every reveal shows the recorded time, how old the fix is now, and the accuracy the
              device reported. Treat it as a search area, not a pinpoint.
            </p>
          ) : null}
        </section>
      ) : (
        <section className="card">
          <h2 className="card-title">Runner privacy</h2>
          <p className="muted">
            Your live position is hidden from hunters. They only see scheduled reveals of your last
            valid fix, with its age and accuracy. Keep your position updates flowing so those
            reveals are accurate.
          </p>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ Capture flag */

export function CtfPanel({ snapshot }: PanelProps) {
  const session = useGameSession();
  const you = snapshot.you;
  const teams = snapshot.teams;
  const yourTeam = teams.find((team) => team.key === you.teamKey) ?? null;
  const respawnMs = msUntil(snapshot.serverNow, you.respawnUntil);
  const state = snapshot.modeState as { winScore?: number; canTag?: boolean; requireOwnFlagHome?: boolean };

  return (
    <div className="mode-panels">
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Scores</h2>
          <span className="muted">First to {state.winScore ?? '—'}</span>
        </div>
        <ul className="score-list">
          {teams.map((team) => (
            <li key={team.key} className={team.key === you.teamKey ? 'score me' : 'score'}>
              <span className="team-dot" style={{ background: team.color }} aria-hidden="true" />
              <span className="score-name">
                {team.name}
                {team.key === you.teamKey ? ' (your team)' : ''}
              </span>
              <span className={`score-flag score-flag-${team.flag?.status ?? 'none'}`}>
                {team.flag?.status === 'carried'
                  ? `Flag taken by ${snapshot.players.find((player) => player.id === team.flag?.carrierId)?.nickname ?? 'someone'}`
                  : team.flag?.status === 'dropped'
                    ? 'Flag dropped'
                    : team.flag?.status === 'home'
                      ? 'Flag home'
                      : 'No flag'}
              </span>
              <strong className="score-value">{team.score}</strong>
            </li>
          ))}
        </ul>
        {you.eliminated || respawnMs ? (
          <Banner tone="warn" title="Waiting to respawn">
            {respawnMs ? `Back in ${formatClock(respawnMs)}.` : 'You are out until the host restarts play.'} Stay
            near your base and let your team know.
          </Banner>
        ) : null}
        {yourTeam ? (
          <p className="field-hint">
            Your base: {yourTeam.base ? `${yourTeam.base.lat.toFixed(5)}, ${yourTeam.base.lng.toFixed(5)}` : 'not placed'}.
            {state.canTag ? ' Tagging is on — a tag sends the carrier back to base.' : ' Tagging is off for this match.'}
            {state.requireOwnFlagHome ? ' Your own flag must be home before a capture counts.' : ''}
          </p>
        ) : (
          <Banner tone="warn" title="No team yet">
            Ask the host to assign you to a team. You cannot capture flags without one.
          </Banner>
        )}
        <p className="field-hint">
          Flags move when the server sees a carrier arrive at the enemy base with a fresh fix. The app
          never sends a capture request on its own.
        </p>
      </section>

      <section className="card">
        <h2 className="card-title">How to capture</h2>
        <ul className="bullets">
          <li>Stand at the enemy flag to pick it up — the server checks your position.</li>
          <li>Carry it back to your own base. Your position updates along the way.</li>
          <li>If you are tagged you drop the flag where you stand; anyone can recover it.</li>
          <li>Returning your own dropped flag sends it home.</li>
        </ul>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------- Territory */

export function TerritoryPanel({ snapshot }: PanelProps) {
  const you = snapshot.you;
  const settings = snapshot.game.settings as { teams?: { key: string; name: string; color: string }[] };
  const teams = settings.teams ?? [];
  const zones = snapshot.zones ?? [];
  const teamFor = (key: string | null) => teams.find((team) => team.key === key) ?? null;
  const yourLocation = snapshot.locations.find((location) => location.playerId === you.id && location.source === 'live');

  const nearby = useMemo(() => {
    if (!yourLocation) return [];
    return zones
      .map((zone) => ({
        zone,
        distance: Math.round(distanceMeters({ lat: yourLocation.lat, lng: yourLocation.lng }, { lat: zone.lat, lng: zone.lng })),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);
  }, [yourLocation, zones]);

  return (
    <div className="mode-panels">
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Zones</h2>
          <span className="muted">
            {zones.filter((zone) => zone.ownerTeamKey).length}/{zones.length} held
          </span>
        </div>
        <ul className="zone-list">
          {zones.map((zone) => {
            const owner = teamFor(zone.ownerTeamKey);
            const progressTeam = teamFor(zone.progressTeamKey);
            return (
              <li key={zone.id} className="zone">
                <div className="zone-head">
                  <strong>{zone.name}</strong>
                  <span className="zone-owner" style={{ color: owner?.color ?? '#8fa39a' }}>
                    {owner ? `${owner.name}` : zone.progressTeamKey ? 'Contested' : 'Neutral'}
                  </span>
                </div>
                <div className="progress-track" aria-hidden="true">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${Math.round(Math.max(0, Math.min(1, zone.progress)) * 100)}%`,
                      background: progressTeam?.color ?? '#8fa39a',
                    }}
                  />
                </div>
                <p className="muted">
                  {zone.progressTeamKey
                    ? `${progressTeam?.name ?? 'Someone'} is capturing — ${Math.round(zone.progress * 100)}%`
                    : 'No capture in progress'}
                  {zone.presentTeamKeys.length > 0 ? ` · present: ${zone.presentTeamKeys.length} team(s)` : ''}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="field-hint">
          Ownership and score ticks are calculated by the server from fresh positions. Standing in a
          zone is the only way to capture it.
        </p>
      </section>

      <section className="card">
        <h2 className="card-title">Closest to you</h2>
        {yourLocation ? (
          <ul className="distance-list">
            {nearby.map((entry) => (
              <li key={entry.zone.id}>
                <span>{entry.zone.name}</span>
                <strong>{entry.distance} m</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Share your location to see how far each zone is.</p>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------- Scavenger */

export function ScavengerPanel({ snapshot }: PanelProps) {
  const session = useGameSession();
  const objectives = snapshot.objectives ?? [];
  const state = snapshot.modeState as {
    orderMode?: string;
    winCondition?: string;
    leaderboard?: { key: string; label: string; points: number; completed: number; rank: number }[];
    completed?: string[];
    totalObjectives?: number;
    objectiveTimeLimitSeconds?: number;
  };
  const yourLocation = snapshot.locations.find(
    (location) => location.playerId === snapshot.you.id && location.source === 'live',
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [openHint, setOpenHint] = useState<string | null>(null);

  return (
    <div className="mode-panels">
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Objectives</h2>
          <span className="muted">
            {(state.completed?.length ?? 0)}/{state.totalObjectives ?? objectives.length} done
          </span>
        </div>
        <ul className="objective-list">
          {objectives.map((objective) => {
            const distance =
              yourLocation && objective.lat !== null && objective.lng !== null
                ? Math.round(
                    distanceMeters(
                      { lat: yourLocation.lat, lng: yourLocation.lng },
                      { lat: objective.lat, lng: objective.lng },
                    ),
                  )
                : null;
            const remaining = msUntil(snapshot.serverNow, objective.deadlineAt);
            return (
              <li
                key={objective.id}
                className={`objective${objective.completed ? ' done' : ''}${objective.locked ? ' locked' : ''}`}
              >
                <div className="objective-head">
                  <span className="objective-index">{objective.completed ? '✓' : objective.index + 1}</span>
                  <div>
                    <strong>{objective.title}</strong>
                    <p className="muted">{objective.clue}</p>
                  </div>
                  <span className="objective-points">{objective.points} pts</span>
                </div>
                {objective.description ? <p className="objective-desc">{objective.description}</p> : null}
                <div className="objective-meta">
                  {objective.verification === 'gps' ? (
                    <Pill>GPS checkpoint</Pill>
                  ) : (
                    <Pill>Answer code</Pill>
                  )}
                  {distance !== null ? <Pill>{distance} m away</Pill> : null}
                  {objective.verification === 'gps' && objective.lat === null ? (
                    <Pill tone="warn">Location not set</Pill>
                  ) : null}
                  {remaining !== null ? <Pill tone="warn">{formatClock(remaining)} left</Pill> : null}
                  {objective.locked ? <Pill tone="warn">Locked — finish earlier clues</Pill> : null}
                </div>

                {!objective.completed && !objective.locked ? (
                  <div className="objective-actions">
                    {objective.verification === 'code' ? (
                      <div className="inline-form">
                        <input
                          className="input"
                          value={answers[objective.id] ?? ''}
                          onChange={(event) =>
                            setAnswers((current) => ({ ...current, [objective.id]: event.target.value }))
                          }
                          placeholder="Answer"
                          maxLength={60}
                        />
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={session.busy || (answers[objective.id] ?? '').trim().length === 0}
                          onClick={() => {
                            const answer = (answers[objective.id] ?? '').trim();
                            void session.actions.code(objective.id, answer).catch(() => undefined);
                          }}
                        >
                          Submit
                        </button>
                      </div>
                    ) : (
                      <p className="field-hint">
                        {distance === null
                          ? 'Share your location so the server can verify you are inside the checkpoint.'
                          : distance <= objective.radiusMeters
                            ? 'You are inside the checkpoint radius — the server will award it on your next position update.'
                            : `Move to within ${objective.radiusMeters} m of the checkpoint.`}
                      </p>
                    )}
                    {objective.hintAvailable ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={session.busy}
                        onClick={() => {
                          if (openHint === objective.id) {
                            setOpenHint(null);
                            return;
                          }
                          setOpenHint(objective.id);
                          void session.actions.hint(objective.id).catch(() => undefined);
                        }}
                      >
                        {openHint === objective.id ? 'Hide hint' : `Show hint (−${objective.hintPenalty} pts)`}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {objective.hint ? <p className="hint-box">Hint: {objective.hint}</p> : null}
              </li>
            );
          })}
        </ul>
        {state.orderMode === 'sequential' ? (
          <p className="field-hint">This hunt is sequential — each clue unlocks the next.</p>
        ) : null}
        {state.winCondition === 'first-to-complete' ? (
          <p className="field-hint">First to finish every objective wins, even with fewer points.</p>
        ) : null}
      </section>

      {state.leaderboard && state.leaderboard.length > 0 ? (
        <section className="card">
          <h2 className="card-title">Leaderboard</h2>
          <ul className="score-list">
            {state.leaderboard.map((entry) => (
              <li key={entry.key} className="score">
                <span className="score-rank">#{entry.rank}</span>
                <span className="score-name">{entry.label}</span>
                <span className="muted">{entry.completed} clues</span>
                <strong className="score-value">{entry.points}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function ModePanel({ snapshot }: PanelProps) {
  switch (snapshot.game.mode) {
    case 'manhunt':
      return <ManhuntPanel snapshot={snapshot} />;
    case 'ctf':
      return <CtfPanel snapshot={snapshot} />;
    case 'territory':
      return <TerritoryPanel snapshot={snapshot} />;
    case 'scavenger':
      return <ScavengerPanel snapshot={snapshot} />;
    default:
      return null;
  }
}
