import { useMemo, useState } from 'react';
import type { GameSnapshot, ModeSettings } from '@shared/types';
import { MODE_META } from '@shared/modes';
import { validateSettings } from '@shared/settings';
import { useGameSession } from '../lib/GameSession';
import { SettingsEditor, SettingsSummary } from './SettingsEditor';
import { Banner, Pill } from './ui';
import { ageText, clockTime } from '../lib/format';

function ShareRow({ code, name }: { code: string; name: string }) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const copy = async (value: string, kind: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  };

  const link = `${window.location.origin}/join?code=${code}`;

  const share = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `${name} on RealPlay`, text: `Join ${name}. Code: ${code}`, url: link });
        return;
      } catch {
        /* user dismissed the sheet */
      }
    }
    void copy(link, 'link');
  };

  return (
    <div className="share-card">
      <div>
        <span className="field-label">Game code</span>
        <div className="share-code" aria-label={`Game code ${code}`}>
          {code.split('').map((character, index) => (
            <span key={`${character}-${index}`}>{character}</span>
          ))}
        </div>
        <p className="muted">Share this code or the join link. Players do not need an account.</p>
      </div>
      <div className="share-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy(code, 'code')}>
          {copied === 'code' ? 'Copied' : 'Copy code'}
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void share()}>
          Share link
        </button>
      </div>
    </div>
  );
}

export function Lobby({ snapshot }: { snapshot: GameSnapshot }) {
  const session = useGameSession();
  const { actions, busy } = session;
  const you = snapshot.you;
  const settings = snapshot.game.settings as unknown as ModeSettings;
  const meta = MODE_META[snapshot.game.mode];
  const [draft, setDraft] = useState<ModeSettings>(settings);
  const [editing, setEditing] = useState(false);

  const validation = useMemo(() => validateSettings(draft), [draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const players = snapshot.players;
  const readyCount = players.filter((player) => player.ready).length;
  const unassigned = players.filter((player) => !player.teamKey).length;
  const canEditTeam = (playerId: string) => {
    if (you.isHost) return true;
    return settings.teamAssignment === 'self' && playerId === you.id;
  };

  const startBlockers: string[] = [];
  if (players.length < meta.minPlayers) startBlockers.push(`${meta.name} needs at least ${meta.minPlayers} players.`);
  if (readyCount < players.length) startBlockers.push('Every player must be ready before the countdown starts.');
  if (meta.teamBased && players.some((player) => !player.teamKey)) {
    startBlockers.push('Assign every player to a team first.');
  }
  if (validation.errors.length > 0) startBlockers.push('The saved rules have conflicts — fix them before starting.');

  const teamLabel = (key: string | null) => settings.teams.find((team) => team.key === key)?.name ?? 'No team';

  return (
    <div className="lobby">
      <div className="lobby-head">
        <div>
          <Pill tone="live">Lobby</Pill>
          <h1>{snapshot.game.name}</h1>
          <p className="muted">
            {meta.name} · {players.length}/{snapshot.game.maxPlayers} players · starts when the host
            says go
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void session.refresh()}
          disabled={busy}
        >
          Refresh
        </button>
      </div>

      <ShareRow code={snapshot.game.code} name={snapshot.game.name} />

      <div className="lobby-grid">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Players</h2>
            <span className="muted">
              {readyCount}/{players.length} ready
            </span>
          </div>
          <ul className="player-list">
            {players.map((player) => {
              const team = settings.teams.find((entry) => entry.key === player.teamKey);
              const editable = canEditTeam(player.id);
              return (
                <li key={player.id} className={player.id === you.id ? 'player me' : 'player'}>
                  <span
                    className="team-dot"
                    style={{ background: team?.color ?? '#4d5b55' }}
                    aria-hidden="true"
                  />
                  <span className="player-name">
                    <strong>
                      {player.nickname}
                      {player.id === you.id ? ' (you)' : ''}
                    </strong>
                    <em>
                      {teamLabel(player.teamKey)}
                      {player.isHost ? ' · host' : ''}
                      {player.consentLocation ? ' · location shared' : ''}
                    </em>
                  </span>
                  <span className="player-tags">
                    {player.ready ? <Pill tone="good">Ready</Pill> : <Pill>Not ready</Pill>}
                    {!player.connected ? <Pill tone="warn">Offline</Pill> : null}
                  </span>
                  {editable && settings.teams.length > 0 ? (
                    <select
                      className="team-select"
                      value={player.teamKey ?? ''}
                      disabled={busy || snapshot.game.status !== 'lobby'}
                      onChange={(event) =>
                        void actions.setTeam(player.id, event.target.value || null).catch(() => undefined)
                      }
                      aria-label={`Team for ${player.nickname}`}
                    >
                      <option value="">No team</option>
                      {settings.teams.map((entry) => (
                        <option key={entry.key} value={entry.key}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            className={`btn ${you.ready ? 'btn-ghost' : 'btn-primary'} btn-block`}
            disabled={busy}
            onClick={() => void actions.setReady(!you.ready).catch(() => undefined)}
          >
            {you.ready ? 'I am not ready' : 'I am ready'}
          </button>
        </section>

        <section className="card">
          <h2 className="card-title">Rules</h2>
          <SettingsSummary settings={settings} center={settings.area.center} />
          {you.isHost ? (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-block btn-sm"
                onClick={() => setEditing((value) => !value)}
              >
                {editing ? 'Hide rule editor' : 'Edit rules before the start'}
              </button>
              {editing ? (
                <div className="lobby-editor">
                  <Banner tone="warn" title="Rules are locked once play starts">
                    Changes are saved to the server immediately and apply to everyone.
                  </Banner>
                  {validation.errors.length > 0 ? (
                    <Banner tone="danger" title="Conflicting rules">
                      <ul className="banner-list">
                        {validation.errors.map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    </Banner>
                  ) : null}
                  <SettingsEditor settings={draft} onChange={setDraft} compact />
                  <div className="wizard-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setDraft(settings)}
                      disabled={!dirty || busy}
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!dirty || busy || validation.errors.length > 0}
                      onClick={() =>
                        void actions.updateSettings(draft).catch(() => undefined)
                      }
                    >
                      Save rules
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      </div>

      <section className="card start-card">
        <div>
          <h2 className="card-title">Start the game</h2>
          {players.length === 0 ? null : startBlockers.length === 0 ? (
            <p className="muted">Everyone is ready. Starting freezes the rules and begins the countdown.</p>
          ) : (
            <ul className="start-blockers">
              {startBlockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
          {unassigned > 0 && !meta.teamBased ? (
            <p className="field-hint">{unassigned} player(s) are not on a team — they play solo.</p>
          ) : null}
        </div>
        {you.isHost ? (
          <div className="start-actions">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={busy || startBlockers.length > 0}
              onClick={() => void actions.start().catch(() => undefined)}
            >
              {busy ? 'Starting…' : 'Start game'}
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Cancel this game for everyone? This cannot be undone.')) {
                  void actions.cancel().catch(() => undefined);
                }
              }}
            >
              Cancel game
            </button>
          </div>
        ) : (
          <p className="muted">The host starts the game when everyone is ready.</p>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Before you start</h2>
        <ul className="bullets">
          <li>Walk the boundary so nobody has to guess where the play area ends.</li>
          <li>Agree what is out of bounds: private gardens, building sites, roads.</li>
          <li>Keep phones charged and enable location permission for this site.</li>
          <li>Any player can call a stop. Safety beats the score.</li>
        </ul>
        <p className="field-hint">
          Game created {clockTime(snapshot.game.createdAt)} · last update{' '}
          {ageText(Math.max(0, Math.round((snapshot.serverNow - snapshot.game.createdAt) / 1000)))}{' '}
          after creation
        </p>
      </section>
    </div>
  );
}
