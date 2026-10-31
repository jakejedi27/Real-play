import { useMemo } from 'react';
import type {
  CtfSettings,
  LatLng,
  ManhuntSettings,
  ModeSettings,
  ScavengerObjectiveConfig,
  ScavengerSettings,
  TeamConfig,
  TerritorySettings,
  TerritoryZoneConfig,
} from '@shared/types';
import {
  LIMITS,
  TEAM_PALETTE,
  defaultObjective,
  defaultTeams,
  defaultZone,
  generatedBases,
  validateSettings,
} from '@shared/settings';
import { distanceMeters } from '@shared/geo';
import { Field, NumberField, Segmented, TextInput, Toggle, Banner } from './ui';
import { LocationCapture, type CapturedFix } from './LocationCapture';
import { MapView } from './MapView';
import { formatDistance } from '@shared/geo';

interface EditorProps {
  settings: ModeSettings;
  onChange: (next: ModeSettings) => void;
  /** Lobby editing hides the destructive map/objective builders behind toggles. */
  compact?: boolean;
}

function teamColor(index: number): string {
  return TEAM_PALETTE[index % TEAM_PALETTE.length];
}

export function SettingsEditor({ settings, onChange, compact = false }: EditorProps) {
  const validation = useMemo(() => validateSettings(settings), [settings]);
  const [recenter, setRecenter] = useRecenter();

  const mapCenter: LatLng | null = settings.area.center;

  return (
    <div className="settings-editor">
      <div className="card">
        <h3 className="card-title">Players &amp; clock</h3>
        <div className="grid-2">
          <NumberField
            label="Max players"
            value={settings.maxPlayers}
            min={LIMITS.minPlayers}
            max={LIMITS.maxPlayers}
            onChange={(value) => onChange({ ...settings, maxPlayers: value })}
          />
          <NumberField
            label="Duration"
            value={settings.durationMinutes}
            min={LIMITS.minDurationMinutes}
            max={LIMITS.maxDurationMinutes}
            step={5}
            suffix="min"
            onChange={(value) => onChange({ ...settings, durationMinutes: value })}
          />
          <NumberField
            label="Countdown"
            value={settings.countdownSeconds}
            min={0}
            max={300}
            step={5}
            suffix="s"
            hint="0 starts immediately"
            onChange={(value) => onChange({ ...settings, countdownSeconds: value })}
          />
          <NumberField
            label="Max team size"
            value={settings.maxTeamSize}
            min={0}
            max={LIMITS.maxTeamSize}
            hint="0 = no cap"
            onChange={(value) => onChange({ ...settings, maxTeamSize: value })}
          />
        </div>
        {settings.mode !== 'manhunt' ? (
          <TeamEditor
            teams={settings.teams}
            maxTeamSize={settings.maxTeamSize}
            onChange={(teams) => onChange({ ...settings, teams })}
          />
        ) : null}
        {settings.teams.length > 1 ? (
          <Segmented
            label="Team assignment"
            value={settings.teamAssignment}
            options={[
              { value: 'auto', label: 'Auto', hint: 'Balance on join' },
              { value: 'self', label: 'Players', hint: 'Choose team' },
              { value: 'host', label: 'Host', hint: 'Host assigns' },
            ]}
            onChange={(value) => onChange({ ...settings, teamAssignment: value })}
          />
        ) : null}
        <Toggle
          label="Share locations with teammates"
          hint="Teammates see each other live; opponents never do outside scheduled reveals."
          checked={settings.shareTeamLocations}
          onChange={(checked) => onChange({ ...settings, shareTeamLocations: checked })}
        />
        {settings.area.enabled ? (
          <div className="grid-2">
            <NumberField
              label="Location update interval"
              value={settings.locationUpdateSeconds}
              min={LIMITS.minUpdateSeconds}
              max={LIMITS.maxUpdateSeconds}
              step={5}
              suffix="s"
              onChange={(value) => onChange({ ...settings, locationUpdateSeconds: value })}
            />
            <NumberField
              label="Stale after"
              value={settings.staleAfterSeconds}
              min={LIMITS.minStaleSeconds}
              max={LIMITS.maxStaleSeconds}
              step={10}
              suffix="s"
              onChange={(value) => onChange({ ...settings, staleAfterSeconds: value })}
            />
          </div>
        ) : null}
      </div>

      {settings.mode === 'manhunt' ? (
        <ManhuntFields settings={settings} onChange={onChange} />
      ) : null}
      {settings.mode === 'ctf' ? <CtfFields settings={settings} onChange={onChange} /> : null}
      {settings.mode === 'territory' ? (
        <TerritoryFields settings={settings} onChange={onChange} />
      ) : null}
      {settings.mode === 'scavenger' ? (
        <ScavengerFields settings={settings} onChange={onChange} compact={compact} />
      ) : null}

      <div className="card">
        <h3 className="card-title">Play area</h3>
        <Toggle
          label="Limit play to a boundary"
          hint="Players are warned when they leave. Boundaries rely on reported GPS accuracy."
 Toni        />
        <Toggle
          label="Limit play to a boundary"
          hint="Players are warned when they leave the circle."
          checked={settings.area.enabled}
          onChange={(checked) =>
            onChange({ ...settings, area: { ...settings.area, enabled: checked } })
          }
        />
        <div className="stack">
          <LocationCapture
            label={settings.area.center ? 'Re-centre on me' : 'Set centre from my location'}
            value={settings.area.center}
            onCapture={(fix: CapturedFix) => {
              onChange({
                ...settings,
                area: {
                  ...settings.area,
                  enabled: true,
                  center: { lat: fix.lat, lng: fix.lng },
                },
              });
              recenter.bump();
            }}
          />
          <NumberField
            label="Radius"
            value={settings.area.radiusMeters}
            min={LIMITS.minAreaRadius}
            max={LIMITS.maxAreaRadius}
            step={50}
            suffix="m"
            onChange={(value) =>
              onChange({ ...settings, area: { ...settings.area, radiusMeters: value } })
            }
          />
          {mapCenter ? (
            <MapView
              center={mapCenter}
              zoom={15}
              area={settings.area}
              recenterKey={recenter.key}
              className="map map-small"
              pins={[{ id: 'centre', lat: mapCenter.lat, lng: mapCenter.lng, label: 'Play area centre', color: '#b6f25a', radius: 7 }]}
            />
          ) : (
            <Banner tone="info">
              Tap “Set centre from my location” to define the boundary. Real device GPS only — no
              simulated positions.
            </Banner>
          )}
        </div>
      </div>

      {validation.errors.length > 0 ? (
        <Banner tone="danger" title="Fix these before starting">
          <ul className="list-tight">
            {validation.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
      {validation.warnings.length > 0 ? (
        <Banner tone="warn" title="Heads up">
          <ul className="list-tight">
            {validation.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
    </div>
  );
}

function useRecenter() {
  const [key, setKey] = useStateNumber(0);
  return { recenter: { key }, bump: () => setKey((prev) => prev + 1) } as const;
}

/* Local helper so this module stays a pure function component tree. */
function useStateNumber(initial: number): [number, (updater: (prev: number) => number) => void] {
  const [value, setValue] = useStateImpl(initial);
  return [value, setValue];
}

import { useState as useStateImpl } from 'react';

function TeamEditor({
  teams,
  maxTeamSize,
  onChange,
}: {
  teams: TeamConfig[];
  maxTeamSize: number;
  onChange: (teams: TeamConfig[]) => void;
}) {
  const setTeam = (index: number, patch: Partial<TeamConfig>) => {
    onChange(teams.map((team, i) => (i === index ? { ...team, ...patch } : team)));
  };

  const addTeam = () => {
    if (teams.length >= LIMITS.maxTeams) return;
    const used = new Set(teams.map((team) => team.key));
    const candidate = defaultTeams(LIMITS.maxTeams).find((team) => !used.has(team.key));
    if (!candidate) return;
    onChange([...teams, candidate]);
  };

  const removeTeam = (index: number) => {
    if (teams.length <= 2) return;
    onChange(teams.filter((_, i) => i !== index));
  };

  return (
    <div className="subsection">
      <div className="subsection-head">
        <spanclassName className="field-label">
          Teams
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={addTeam}
          disabled={teams.length >= LIMITS.maxTeams}
        >
          + Add team
        </button>
      </div>
      <div className="team-edit-list">
        {teams.map((team, index) => (
          <div className="team-edit-row" key={team.key}>
            <span className="team-dot" style={{ background: teamColor(index) }} aria-hidden="true" />
            <input
              className="input input-inline"
              value={team.name}
              maxLength={24}
              aria-label={`Team ${index + 1} name`}
              onChange={(event) => setTeam(index, { name: event.target.value })}
            />
            {teams.length > 2 ? (
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${team.name}`}
                onClick={() => removeTeam(index)}
              >
                ✕
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {maxTeamSize > 0 ? (
        <p className="field-hint">
          Each team is capped at {maxTeamSize} players by the server when players choose a side.
        </p>
      ) : null}
    </div>
  );
}

function ManhuntFields({
  settings,
  onChange,
}: {
  settings: ManhuntSettings;
  onChange: (next: ModeSettings) => void;
}) {
  return (
    <div className="card">
      <h3 className="card-title">Manhunt rules</h3>
      <div className="grid-2">
        <NumberField
          label="Runner head start"
          value={settings.headStartSeconds}
          min={0}
          max={1800}
          step={30}
          suffix="s"
          onChange={(value) => onChange({ ...settings, headStartSeconds: value })}
        />
        <NumberField
          label="Reveal interval"
          value={settings.revealIntervalSeconds}
          min={30}
          max={3600}
          step={30}
          suffix="s"
          hint="Hunters see the last valid runner fix this often"
          onChange={(value) => onChange({ ...settings, revealIntervalSeconds: value })}
        />
        <NumberField
          label="Tag radius"
          value={settings.tagRadiusMeters}
          min={5}
          max={60}
          suffix="m"
          onChange={(value) => onChange({ ...settings, tagRadiusMeters: value })}
        />
      </div>
      <Segmented
        label="Hunter transport"
        value={settings.hunterTransport}
        options={[
          { value: 'walk-only', label: 'Walk only' },
          { value: 'walk-or-bike', label: 'Walk / bike' },
          { value: 'any', label: 'Any' },
        ]}
        onChange={(value) => onChange({ ...settings, hunterTransport: value })}
        hint="An honour rule shown to hunters. No phone use while driving, ever."
      />
      <Segmented
        label="If time runs out"
        value={settings.tieRule}
        options={[
          { value: 'runners', label: 'Runners win' },
          { value: 'hunters', label: 'Hunters win' },
          { value: 'draw', label: 'Draw' },
        ]}
        onChange={(value) => onChange({ ...settings, tieRule: value })}
      />
      <Toggle
        label="Runner quick-pings"
        hint="Text-only pings. They never reveal a position."
        checked={settings.runnerPings}
        onChange={(checked) => onChange({ ...settings, runnerPings: checked })}
      />
      <Toggle
        label="Hunter check-ins"
        hint="OK / Need help / Regroup check-ins stay inside the hunter team."
        checked={settings.hunterCheckIns}
        onChange={(checked) => onChange({ ...settings, hunterCheckIns: checked })}
      />
    </div>
  );
}

function CtfFields({
  settings,
  onChange,
}: {
  settings: CtfSettings;
  onChange: (next: ModeSettings) => void;
}) {
  const bases = settings.bases ?? {};
  const centre = settings.area.center;
  const allPlaced = settings.teams.every((team) => Boolean(bases[team.key]));

  const autoPlace = () => {
    if (!centre) return;
    onChange({
      ...settings,
      bases: generatedBases(settings.teams, centre, Math.max(settings.area.radiusMeters, 120)),
    });
  };

  return (
    <div className="card">
      <h3 className="card-title">Capture the Flag rules</h3>
      <div className="grid-2">
        <NumberField
          label="Base radius"
          value={settings.baseRadiusMeters}
          min={10}
          max={200}
          suffix="m"
          onChange={(value) => onChange({ ...settings, baseRadiusMeters: value })}
        />
        <NumberField
          label="Tag radius"
          value={settings.tagRadiusMeters}
          min={5}
          max={60}
          suffix="m"
          onChange={(value) => onChange({ ...settings, tagRadiusMeters: value })}
        />
        <NumberField
          label="Score per capture"
          value={settings.scorePerCapture}
          min={1}
          max={10}
          onChange={(value) => onChange({ ...settings, scorePerCapture: value })}
        />
        <NumberField
          label="Win score"
          value={settings.winScore}
          min={1}
          max={100}
          onChange={(value) => onChange({ ...settings, winScore: value })}
        />
        <NumberField
          label="Respawn wait"
          value={settings.respawnSeconds}
          min={0}
          max={300}
          step={5}
          suffix="s"
          onChange={(value) => onChange({ ...settings, respawnSeconds: value })}
        />
        <NumberField
          label="Capture cooldown"
          value={settings.captureCooldownSeconds}
          min={0}
          max={600}
          step={5}
          suffix="s"
          onChange={(value) => onChange({ ...settings, captureCooldownSeconds: value })}
        />
      </div>
      <Toggle
        label="Tags send players back to base"
        checked={settings.canTag}
        onChange={(checked) => onChange({ ...settings, canTag: checked })}
      />
      <Toggle
        label="Flag only capturable when own flag is home"
        checked={settings.requireOwnFlagHome}
        onChange={(checked) => onChange({ ...settings, requireOwnFlagHome: checked })}
      />
      <Segmented
        label="If time runs out"
        value={settings.tieRule}
        options={[
          { value: 'draw', label: 'Draw' },
          { value: 'overtime', label: 'Overtime' },
        ]}
        onChange={(value) => onChange({ ...settings, tieRule: value })}
      />
      <div className="subsection">
        <div className="subsection-head">
          <span className="field-label">Team bases</span>
          {centre ? (
            <button type="button" className="btn btn-ghost btn-small" onClick={autoPlace}>
              Auto-place evenly
            </button>
          ) : null}
        </div>
        {settings.teams.map((team) => (
          <div className="objective-head" key={team.key}>
            <span className="team-dot" style={{ background: team.color }} aria-hidden="true" />
            <strong>{team.name}</strong>
            <LocationCapture
              compact
              disabled={!settings.area.enabled}
              label={bases[team.key] ? 'Replace base' : 'Set base here'}
              value={bases[team.key] ?? null}
              onCapture={(fix) =>
                onChange({ ...settings, bases: { ...bases, [team.key]: { lat: fix.lat, lng: fix.lng } } })
              }
            />
          </div>
        ))}
        {!settings.area.enabled ? (
          <p className="field-hint">Enable the play area first so bases land inside the boundary.</p>
        ) : !allPlaced && !centre ? (
          <p className="field-hint">
            Set the play-area centre to auto-place bases, or capture each base from your location.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TerritoryFields({
  settings,
  onChange,
}: {
  settings: TerritorySettings;
  onChange: (next: ModeSettings) => void;
}) {
  const centre = settings.area.center;

  const updateZone = (index: number, patch: Partial<TerritoryZoneConfig>) => {
    onChange({
      ...settings,
      zones: settings.zones.map((zone, i) => (i === index ? { ...zone, ...patch } : zone)),
    });
  };

  const addZone = () => {
    if (settings.zones.length >= LIMITS.maxZones) return;
    const anchor = centre ?? settings.zones[0] ?? null;
    if (!anchor) return;
    const base = centre
      ? defaultZone(settings.zones.length, centre, Math.max(settings.area.radiusMeters, 150))
      : {
          id: `zone-${settings.zones.length + 1}`,
          name: `Zone ${String.fromCharCode(65 + settings.zones.length)}`,
          lat: settings.zones[0].lat,
          lng: settings.zones[0].lng,
          radiusMeters: 60,
          eligibleTeamKeys: [],
        };
    onChange({ ...settings, zones: [...settings.zones, base] });
  };

  return (
    <div className="card">
      <h3 className="card-title">Territory rules</h3>
      <div className="grid-2">
        <NumberField
          label="Neutralise time"
          value={settings.neutralizeSeconds}
          min={0}
          max={900}
          step={5}
          suffix="s"
          onChange={(value) => onChange({ ...settings, neutralizeSeconds: value })}
        />
        <NumberField
          label="Capture time"
          value={settings.captureSeconds}
          min={5}
          max={900}
          step={5}
          suffix="s"
          onChange={(value) => onChange({ ...settings, captureSeconds: value })}
        />
        <NumberField
          label="Score interval"
          value={settings.scoreIntervalSeconds}
          min={10}
          max={600}
          step={5}
          suffix="s"
          onChange={(value) => onChange({ ...settings, scoreIntervalSeconds: value })}
        />
        <NumberField
          label="Points per zone"
          value={settings.pointsPerZone}
          min={1}
          max={10}
          onChange={(value) => onChange({ ...settings, pointsPerZone: value })}
        />
        <NumberField
          label="Score limit"
          value={settings.scoreLimit}
          min={0}
          max={1000}
          step={5}
          hint="0 = play the full clock"
          onChange={(value) => onChange({ ...settings, scoreLimit: value })}
        />
      </div>
      <Segmented
        label="If time runs out"
        value={settings.tieRule}
        options={[
          { value: 'draw', label: 'Draw' },
          { value: 'overtime', label: 'Overtime' },
        ]}
        onChange={(value) => onChange({ ...settings, tieRule: value })}
      />

      <div className="subsection">
        <div className="subsection-head">
          <span className="field-label">Zones ({settings.zones.length})</span>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={addZone}
            disabled={settings.zones.length >= LIMITS.maxZones || (!centre && settings.zones.length === 0)}
          >
            + Add zone
          </button>
        </div>
        {settings.zones.length === 0 ? (
          <p className="field-hint">
            Set the play-area centre, then add zones. Capture and score ticks are calculated by the
            server, never claimed by a client.
          </p>
        ) : null}
        {settings.zones.map((zone, index) => (
          <div className="objective-card" key={zone.id}>
            <div className="objective-head">
              <span className="zone-badge" aria-hidden="true">
                ⬡
              </span>
              <input
                className="input input-inline"
                value={zone.name}
                maxLength={30}
                aria-label={`Zone ${index + 1} name`}
                onChange={(event) => updateZone(index, { name: event.target.value })}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${zone.name}`}
                onClick={() =>
                  onChange({ ...settings, zones: settings.zones.filter((_, i) => i !== index) })
                }
              >
                ✕
              </button>
            </div>
            <div className="objective-body">
              <NumberField
                label="Zone radius"
                value={zone.radiusMeters}
                min={15}
                max={1000}
                step={5}
                suffix="m"
                onChange={(value) => updateZone(index, { radiusMeters: value })}
              />
              <LocationCapture
                compact
                label="Move zone to me"
                value={{ lat: zone.lat, lng: zone.lng }}
                onCapture={(fix) => updateZone(index, { lat: fix.lat, lng: fix.lng })}
              />
              <div className="chip-row">
                {settings.teams.map((team) => {
                  const eligible =
                    zone.eligibleTeamKeys.length === 0 || zone.eligibleTeamKeys.includes(team.key);
                  return (
                    <button
                      key={team.key}
                      type="button"
                      className={`chip${eligible ? ' is-on' : ''}`}
                      aria-pressed={eligible}
                      onClick={() => {
                        const next = zone.eligibleTeamKeys.includes(team.key)
                          ? zone.eligibleTeamKeys.filter((key) => key !== team.key)
                          : [...zone.eligibleTeamKeys, team.key];
                        updateZone(index, { eligibleTeamKeys: next });
                      }}
                    >
                      <span className="team-dot" style={{ background: team.color }} aria-hidden="true" />
                      {team.name}
                    </button>
                  );
                })}
              </div>
              <p className="field-hint">
                {zone.eligibleTeamKeys.length === 0
                  ? 'All teams may capture this zone.'
                  : 'Only selected teams may capture this zone.'}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScavengerFields({
  settings,
  onChange,
}: {
  settings: ScavengerSettings;
  onChange: (next: ModeSettings) => void;
  compact?: boolean;
}) {
  const updateObjective = (index: number, patch: Partial<ScavengerObjectiveConfig>) => {
    onChange({
      ...settings,
      objectives: settings.objectives.map((objective, i) =>
        i === index ? { ...objective, ...patch } : objective,
      ),
    });
  };

  return (
    <div className="card">
      <h3 className="card-title">Scavenger rules</h3>
      <Segmented
        label="Competition"
        value={settings.competition}
        options={[
          { value: 'individual', label: 'Individual' },
          { value: 'team', label: 'Team' },
        ]}
        onChange={(value) => onChange({ ...settings, competition: value })}
      />
      <Segmented
        label="Objective order"
        value={settings.orderMode}
        options={[
          { value: 'free', label: 'Any order' },
          { value: 'sequential', label: 'Locked order' },
        ]}
        onChange={(value) => onChange({ ...settings, orderMode: value })}
      />
      <Segmented
        label="Win condition"
        value={settings.winCondition}
        options={[
          { value: 'highest-points', label: 'Most points' },
          { value: 'first-to-complete', label: 'First to finish' },
        ]}
        onChange={(value) => onChange({ ...settings, winCondition: value })}
      />
      <div className="grid-2">
        <NumberField
          label="Objective time limit"
          value={settings.objectiveTimeLimitSeconds}
          min={0}
          max={3600}
          step={30}
          suffix="s"
          hint="0 = unlimited"
          onChange={(value) => onChange({ ...settings, objectiveTimeLimitSeconds: value })}
        />
        <Segmented
          label="Tie rule"
          value={settings.tieRule}
          options={[
            { value: 'draw', label: 'Draw' },
            { value: 'earliest-finish', label: 'Earliest finish' },
          ]}
          onChange={(value) => onChange({ ...settings, tieRule: value })}
        />
      </div>

      <div className="subsection">
        <div className="subsection-head">
          <span className="field-label">Objectives ({settings.objectives.length})</span>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={settings.objectives.length >= LIMITS.maxObjectives}
            onClick={() =>
              onChange({
                ...settings,
                objectives: [
                  ...settings.objectives,
                  defaultObjective(settings.objectives.length),
                ],
              })
            }
          >
            + Add objective
          </button>
        </div>
        {settings.objectives.length === 0 ? (
          <p className="field-hint">
            Add at least one objective. GPS objectives need a captured location; code objectives keep
            the answer on the server only.
          </p>
        ) : null}
        {settings.objectives.map((objective, index) => (
          <div className="objective-card" key={objective.id}>
            <div className="objective-head">
              <span className="zone-badge zone-badge-amber" aria-hidden="true">
                {index + 1}
              </span>
              <input
                className="input input-inline"
                value={objective.title}
                maxLength={40}
                aria-label={`Objective ${index + 1} title`}
                onChange={(event) => updateObjective(index, { title: event.target.value })}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${objective.title}`}
                onClick={() =>
                  onChange({
                    ...settings,
                    objectives: settings.objectives.filter((_, i) => i !== index),
                  })
                }
              >
                ✕
              </button>
            </div>
            <div className="objective-body">
              <Field label="Clue">
                <textarea
                  className="input textarea"
                  rows={2}
                  maxLength={240}
                  value={objective.clue}
                  onChange={(event) => updateObjective(index, { clue: event.target.value })}
                  placeholder="Something players read before setting off"
                />
              </Field>
              <Field label="Description">
                <textarea
                  className="input textarea"
                  rows={2}
                  maxLength={400}
                  value={objective.description}
                  onChange={(event) => updateObjective(index, { description: event.target.value })}
                  placeholder="What counts as reaching it"
                />
              </Field>
              <Segmented
                label="Verification"
                value={objective.verification}
                options={[
                  { value: 'gps', label: 'GPS' },
                  { value: 'code', label: 'Answer code' },
                ]}
                onChange={(value) =>
                  updateObjective(index, {
                    verification: value,
                    lat: value === 'code' ? null : objective.lat,
                    lng: value === 'code' ? null : objective.lng,
                  })
                }
              />
              {objective.verification === 'code' ? (
                <div className="grid-2">
                  <Field label="Answer code" hint="Stored server-side, never sent to clients">
                    <TextInput
                      value={objective.code}
                      maxLength={LIMITS.maxCodeLength}
                      autoCapitalize="characters"
                      onChange={(value) => updateObjective(index, { code: value.toUpperCase() })}
                      placeholder="e.g. 4821"
                    />
                  </Field>
                  <NumberField
                    label="Points"
                    value={objective.points}
                    min={1}
                    max={100}
                    onChange={(value) => updateObjective(index, { points: value })}
                  />
                </div>
              ) : (
                <>
                  <LocationCapture
                    compact
                    label={objective.lat ? 'Replace checkpoint' : 'Set checkpoint here'}
                    value={
                      objective.lat !== null && objective.lng !== null
                        ? { lat: objective.lat, lng: objective.lng }
                        : null
                    }
                    onCapture={(fix) =>
                      updateObjective(index, { lat: fix.lat, lng: fix.lng })
                    }
                  />
                  <div className="grid-2">
                    <NumberField
                      label="Checkpoint radius"
                      value={objective.radiusMeters}
                      min={5}
                      max={500}
                      step={5}
                      suffix="m"
                      onChange={(value) => updateObjective(index, { radiusMeters: value })}
                    />
                    <NumberField
                      label="Points"
                      value={objective.points}
                      min={1}
                      max={100}
                      onChange={(value) => updateObjective(index, { points: value })}
                    />
                  </div>
                </>
              )}
              <div className="grid-2">
                <Field label="Hint" hint="Penalty applies when a player opens it">
                  <TextInput
                    value={objective.hint}
                    maxLength={200}
                    onChange={(value) => updateObjective(index, { hint: value })}
                    placeholder="Optional nudge"
                  />
                </Field>
                <NumberField
                  label="Hint penalty"
                  value={objective.hintPenalty}
                  min={0}
                  max={50}
                  onChange={(value) => updateObjective(index, { hintPenalty: value })}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Small read-only summary used by the review step and the lobby. */
export function SettingsSummary({
  settings,
  center,
}: {
  settings: ModeSettings;
  center: LatLng | null;
}) {
  const rows: { label: string; value: string }[] = [
    { label: 'Mode', value: settings.mode },
    { label: 'Duration', value: `${settings.durationMinutes} min` },
    { label: 'Max players', value: String(settings.maxPlayers) },
    { label: 'Countdown', value: settings.countdownSeconds ? `${settings.countdownSeconds}s` : 'None' },
  ];
  if (settings.area.enabled) {
    rows.push({
      label: 'Play area',
      value: `${settings.area.radiusMeters} m radius${center ? '' : ' (centre not set)'}`,
    });
  }
  if (settings.mode === 'manhunt') {
    rows.push(
      { label: 'Head start', value: `${settings.headStartSeconds}s` },
      { label: 'Reveal every', value: `${settings.revealIntervalSeconds}s` },
      { label: 'Hunters', value: settings.hunterTransport },
    );
  }
  if (settings.mode === 'ctf') {
    rows.push(
      { label: 'Bases placed', value: `${Object.values(settings.bases).filter(Boolean).length}/${settings.teams.length}` },
      { label: 'Win score', value: String(settings.winScore) },
    );
  }
  if (settings.mode === 'territory') {
    rows.push(
      { label: 'Zones', value: String(settings.zones.length) },
      { label: 'Score every', value: `${settings.scoreIntervalSeconds}s` },
    );
  }
  if (settings.mode === 'scavenger') {
    rows.push(
      { label: 'Objectives', value: String(settings.objectives.length) },
      { label: 'Order', value: settings.orderMode },
    );
  }
  const radius = settings.area.radiusMeters;
  return (
    <div className="summary">
      <div className="summary-grid">
        {rows.map((row) => (
          <div className="summary-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
      {settings.area.enabled && center ? (
        <p className="field-hint">
          Boundary circle: {formatDistance(radius * 2)} across, drawn from your captured position.
        </p>
      ) : null}
    </div>
  );
}

/** Distance from the viewer to the play-area edge, used for leave warnings. */
export function distanceOutsideArea(
  point: LatLng,
  center: LatLng,
  radiusMeters: number,
): number {
  return Math.round(distanceMeters(point, center) - radiusMeters);
}
