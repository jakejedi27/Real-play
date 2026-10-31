import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameSnapshot, ModeSettings } from '@shared/types';
import { MODE_META } from '@shared/modes';
import { distanceMeters } from '@shared/geo';
import { useGameSession } from '../lib/GameSession';
import { useLocationUplink } from '../lib/useLocationUplink';
import { MapView, type MapPin, type MapRing } from './MapView';
import { ModePanel } from './ModePanels';
import { Banner, Pill } from './ui';
import { ageText, accuracyText, clockTime, formatClock } from '../lib/format';
import { distanceOutsideArea } from './SettingsEditor';

function settingsOf(snapshot: GameSnapshot): ModeSettings {
  return snapshot.game.settings as unknown as ModeSettings;
}

/** Server-anchored clock so the countdown never drifts with device time. */
function useServerClock(serverNow: number): number {
  const anchor = useRef({ server: serverNow, client: Date.now() });
  anchor.current = { server: serverNow, client: anchor.current.client };
  const [, force] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => force((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, []);
  return anchor.current.server + (Date.now() - anchor.current.client);
}

export function LiveGame({ snapshot }: { snapshot: GameSnapshot }) {
  const session = useGameSession();
  const settings = settingsOf(snapshot);
  const token = session.session?.token ?? null;
  const teams = snapshot.teams;
  const meta = MODE_META[snapshot.game.mode];
  const you = snapshot.you;
  const [recenterKey, setRecenterKey] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const now = useServerClock(snapshot.serverNow);
  const paused = snapshot.game.status === 'paused';
  const countdownLeft =
    snapshot.game.status === 'countdown' && snapshot.game.countdownEndsAt
      ? Math.max(0, snapshot.game.countdownEndsAt - now)
      : null;

  const uplink = useLocationUplink({
    gameId: snapshot.game.id,
    token,
    enabled: !paused && you.consentLocation,
    minIntervalSeconds: settings.locationUpdateSeconds,
    staleAfterSeconds: settings.staleAfterSeconds,
    onSent: () => session.refresh(),
  });
  const fix = uplink.geo.fix;

  const yourLocation = snapshot.locations.find(
    (location) => location.playerId === you.id && location.source === 'live',
  );

  const center = useMemo(() => {
    if (fix) return { lat: fix.lat, lng: fix.lng };
    if (settings.area.center) return settings.area.center;
    if (yourLocation) return { lat: yourLocation.lat, lng: yourLocation.lng };
    return null;
  }, [fix, settings.area.center, yourLocation]);

  const outsideBy =
    fix && settings.area.enabled && settings.area.center
      ? distanceOutsideArea(
          { lat: fix.lat, lng: fix.lng },
          settings.area.center,
          settings.area.radiusMeters,
        )
      : null;

  const teamById = (key: string | null) => teams.find((team) => team.key === key) ?? null;

  const pins: MapPin[] = [];
  if (settings.area.center) {
    for (const team of teams) {
      if (team.base) {
        pins.push({
          id: `base-${team.key}`,
          lat: team.base.lat,
          lng: team.base.lng,
          label: team.name,
          sublabel: `${team.score} pts`,
          color: team.color,
        });
      }
    }
  }
  if (snapshot.zones) {
    for (const zone of snapshot.zones) {
      const owner = teamById(zone.ownerTeamKey);
      pins.push({
        id: `zone-${zone.id}`,
        lat: zone.lat,
        lng: zone.lng,
        label: zone.name,
        sublabel: owner ? owner.name : 'Neutral',
        color: owner?.color ?? '#7d8f87',
      });
    }
  }
  if (snapshot.objectives) {
    for (const objective of snapshot.objectives) {
      if (objective.lat === null || objective.lng === null) continue;
      pins.push({
        id: `objective-${objective.id}`,
        lat: objective.lat,
        lng: objective.lng,
        label: String(objective.index + 1),
        sublabel: objective.completed ? 'Done' : objective.title,
        color: objective.completed ? '#4d7c3a' : meta.accent,
      });
    }
  }
  for (const location of snapshot.locations) {
    const team = teamById(location.teamKey);
    pins.push({
      id: `player-${location.playerId}`,
      lat: location.lat,
      lng: location.lng,
      label: location.playerId === you.id ? 'You' : location.nickname,
      sublabel:
        location.source === 'revealed'
          ? `Reveal · ${ageText(location.ageSeconds)} old · ${accuracyText(location.accuracyMeters)}`
          : `${accuracyText(location.accuracyMeters)} · ${ageText(location.ageSeconds)} old`,
      color: location.playerId === you.id ? '#ffffff' : team?.color ?? '#c9d6ce',
      fill: location.source === 'live' && !location.stale,
    });
  }

  const rings: MapRing[] = [];
  if (settings.mode === 'territory') {
    for (const zone of snapshot.zones ?? []) {
      rings.push({
        id: `zone-ring-${zone.id}`,
        lat: zone.lat,
        lng: zone.lng,
        radiusMeters: zone.radiusMeters,
        color: teamById(zone.ownerTeamKey)?.color ?? '#8fa39a',
      });
    }
  }
  if (settings.mode === 'scavenger') {
    for (const objective of snapshot.objectives ?? []) {
      if (objective.lat === null || objective.lng === null) continue;
      rings.push({
        id: `objective-ring-${objective.id}`,
        lat: objective.lat,
        lng: objective.lng,
        radiusMeters: objective.radiusMeters,
        color: meta.accent,
      });
    }
  }

  const scoreboard = snapshot.teams.filter((team) => team.memberCount > 0 || team.base);
  const recentFeed = snapshot.feed.slice(0, 12);
  const transportWarning =
    settings.mode === 'manhunt' && settings.hunterTransport === 'walk-only'
      ? 'Hunters: on foot only.'
      : null;

  return (
    <div className="live">
      <header className="live-head">
        <div className="live-head-main">
          <div className="live-title">
            <Pill tone={paused ? 'warn' : 'live'}>{paused ? 'Paused' : meta.name}</Pill>
            <h1>{snapshot.game.name}</h1>
          </div>
          <div className="live-clock">
            <span className="field-label">{countdownLeft !== null ? 'Countdown' : 'Time left'}</span>
            <strong className={paused ? 'clock paused' : 'clock'}>
              {countdownLeft !== null
                ? formatClock(countdownLeft)
                : snapshot.game.remainingMs !== null
                  ? formatClock(snapshot.game.remainingMs)
                  : '—'}
            </strong>
            <span className="muted">
              {paused ? `Paused ${formatClock(snapshot.serverNow - (snapshot.game.pausedAt ?? snapshot.serverNow))} ago` : 'Server clock'}
            </span>
          </div>
        </div>
        <div className="live-strip">
          <span className="muted">Code {snapshot.game.code}</span>
          {transportWarning ? <Pill tone="warn">{transportWarning}</Pill> : null}
          {scoreboard.map((team) => (
            <span key={team.key} className="strip-team">
              <span className="team-dot" style={{ background: team.color }} aria-hidden="true" />
              {team.name} <strong>{team.score}</strong>
            </span>
          ))}
          {snapshot.game.mode === 'scavenger'
            ? (() => {
                const state = snapshot.modeState as { yourKey?: string; leaderboard?: { key: string; points: number; label: string }[] };
                const mine = state.leaderboard?.find((entry) => entry.key === state.yourKey);
                return mine ? <span className="strip-team">{mine.label} <strong>{mine.points}</strong></span> : null;
              })()
            : null}
        </div>
      </header>

      {paused ? (
        <Banner tone="warn" title="Match paused by the host">
          Timers and scoring are frozen on the server. Location uploads are paused on this device too.
        </Banner>
      ) : null}

      {countdownLeft !== null ? (
        <Banner tone="info" title="Get to your start position">
          The match begins in {formatClock(countdownLeft)}. Rules are locked.
        </Banner>
      ) : null}

      {session.connection === 'offline' ? (
        <Banner tone="danger" title="Offline">
          Live updates stopped. Your last known state is shown. Reconnect to keep playing — the
          server keeps the clock running.
        </Banner>
      ) : null}
      {session.actionError ? (
        <Banner tone="danger" title="Action rejected">
          {session.actionError}
        </Banner>
      ) : null}

      <div className="live-grid">
        <section className="live-map card">
          <div className="map-toolbar">
            <div className="gps-status">
              <span className={`gps-dot gps-${uplink.geo.status}`} aria-hidden="true" />
              <div>
                <strong>
                  {uplink.geo.status === 'watching'
                    ? 'Live GPS'
                    : uplink.geo.status === 'requesting'
                      ? 'Requesting GPS…'
                      : uplink.geo.status === 'denied'
                        ? 'Location blocked'
                        : uplink.geo.status === 'unavailable'
                          ? 'Location unavailable'
                          : uplink.geo.status === 'error'
                            ? 'GPS error'
                            : 'GPS idle'}
                </strong>
                <span className="muted">
                  {fix
                    ? `${accuracyText(fix.accuracyMeters)} · recorded ${clockTime(fix.recordedAt)} · ${ageText(
                        Math.max(0, Math.round((Date.now() - fix.recordedAt) / 1000)),
                      )} old`
                    : uplink.geo.message || 'No fix yet'}
                </span>
              </div>
            </div>
            <div className="map-actions">
              {uplink.geo.status === 'idle' || uplink.geo.status === 'denied' ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={uplink.geo.request}>
                  Enable GPS
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setRecenterKey((value) => value + 1)}
                disabled={!center}
              >
                Recenter
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={uplink.sendNow}
                disabled={!fix || uplink.sending}
              >
                {uplink.sending ? 'Sending…' : 'Send position'}
              </button>
            </div>
          </div>

          {uplink.geo.status === 'denied' ? (
            <Banner tone="danger" title="Location permission needed">
              RealPlay cannot show your position or verify checkpoints without location. Enable
              location for this site in your browser settings, then reload. Safari: Settings → Safari
              → Location → Allow.
            </Banner>
          ) : null}
          {uplink.geo.status === 'unavailable' || uplink.geo.status === 'error' ? (
            <Banner tone="warn" title="No position yet">
              {uplink.geo.message || 'The device did not return a fix.'} Move outdoors, wait a moment
              and try again. RealPlay never invents a location.
            </Banner>
          ) : null}
          {uplink.sendError ? (
            <Banner tone="warn" title="Position not saved">
              {uplink.sendError}
            </Banner>
          ) : null}
          {uplink.throttledUntil ? (
            <Banner tone="warn" title="Fix too old to score">
              Your last fix is older than {settings.staleAfterSeconds}s, so it was not sent. Waiting
              for a fresh one.
            </Banner>
          ) : null}
          {outsideBy !== null && outsideBy > 0 ? (
            <Banner tone="warn" title="You are outside the play area">
              About {outsideBy} m past the boundary. Come back in — actions outside the area do not
              count.
            </Banner>
          ) : null}
          {!you.consentLocation ? (
            <Banner tone="warn" title="Location sharing is off">
              You joined without location consent, so you cannot send positions. The host can still
              run the game, but you will not appear on the map or score location objectives.
            </Banner>
          ) : null}

          <MapView
            center={center}
            zoom={center ? 17 : 3}
            accuracyMeters={fix?.accuracyMeters ?? null}
            area={settings.area}
            pins={pins}
            rings={rings}
            recenterKey={recenterKey}
            className="live-map-canvas"
          />
          <p className="map-legend muted">
            Map data © OpenStreetMap contributors. Revealed positions are drawn hollow — they show
            where a player was last fixed, not where they are now.
          </p>
        </section>

        <div className="live-side">
          <ModePanel snapshot={snapshot} />

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Players</h2>
              <span className="muted">{snapshot.players.length} in game</span>
            </div>
            <ul className="player-strip">
              {snapshot.players.map((player) => {
                const team = teamById(player.teamKey);
                return (
                  <li key={player.id} className={player.id === you.id ? 'me' : ''}>
                    <span className="team-dot" style={{ background: team?.color ?? '#4d5b55' }} aria-hidden="true" />
                    <span>{player.nickname}</span>
                    {player.id === snapshot.game.hostPlayerId ? <Pill>Host</Pill> : null}
                    {player.eliminated ? <Pill tone="danger">Out</Pill> : null}
                    {!player.connected ? <Pill tone="warn">Offline</Pill> : null}
                    {player.respawnUntil && player.respawnUntil > now ? (
                      <Pill tone="warn">{formatClock(player.respawnUntil - now)}</Pill>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Activity</h2>
            </div>
            {recentFeed.length === 0 ? (
              <p className="muted">Nothing has happened yet.</p>
            ) : (
              <ul className="feed">
                {recentFeed.map((item) => (
                  <li key={item.id} className={`feed-item feed-${item.type}`}>
                    <span className="feed-text">{item.text}</span>
                    <span className="feed-time">{clockTime(item.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {you.isHost ? (
            <section className="card host-card">
              <div className="card-head">
                <h2 className="card-title">Host controls</h2>
                <Pill tone="live">Host</Pill>
              </div>
              <div className="button-row">
                {paused ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={session.busy}
                    onClick={() => void session.actions.resume().catch(() => undefined)}
                  >
                    Resume
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={session.busy}
                    onClick={() => void session.actions.pause().catch(() => undefined)}
                  >
                    Pause
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={session.busy}
                  onClick={() => {
                    if (window.confirm('End the game now and publish results?')) {
                      void session.actions.end().catch(() => undefined);
                    }
                  }}
                >
                  End game
                </button>
              </div>
              <div className="inline-form">
                <input
                  className="input"
                  value={announcement}
                  onChange={(event) => setAnnouncement(event.target.value)}
                  placeholder="Announce to all players"
                  maxLength={140}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={session.busy || announcement.trim().length < 3}
                  onClick={() => {
                    const message = announcement.trim();
                    setAnnouncement('');
                    void session.actions.announce(message).catch(() => undefined);
                  }}
                >
                  Send
                </button>
              </div>
              <p className="field-hint">
                Ending publishes results to every player. Rules are frozen while the match runs.
              </p>
            </section>
          ) : null}

          <section className="card">
            <h2 className="card-title">Game details</h2>
            <ul className="detail-list">
              <li>
                <span>Mode</span>
                <strong>{meta.name}</strong>
              </li>
              <li>
                <span>Started</span>
                <strong>{clockTime(snapshot.game.startedAt)}</strong>
              </li>
              <li>
                <span>Location updates</span>
                <strong>at most every {settings.locationUpdateSeconds}s</strong>
              </li>
              <li>
                <span>Stale after</span>
                <strong>{settings.staleAfterSeconds}s</strong>
              </li>
              <li>
                <span>Play area</span>
                <strong>
                  {settings.area.enabled ? `${settings.area.radiusMeters} m radius` : 'Not enforced'}
                </strong>
              </li>
            </ul>
            <button
              type="button"
              className="btn btn-ghost btn-block btn-sm"
              onClick={session.leave}
            >
              Leave this game on this device
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
