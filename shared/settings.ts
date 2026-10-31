import { z } from 'zod';
import type {
  CtfSettings,
  CommonSettings,
  LatLng,
  ManhuntSettings,
  ModeId,
  ModeSettings,
  ScavengerObjectiveConfig,
  ScavengerSettings,
  TeamConfig,
  TerritorySettings,
  TerritoryZoneConfig,
} from './types';

export const TEAM_PALETTE = ['#6fd3ff', '#ff8a5c', '#b6f25a', '#c79bff'];
export const LIMITS = {
  minPlayers: 2,
  maxPlayers: 60,
  minDurationMinutes: 5,
  maxDurationMinutes: 600,
  maxTeams: 4,
  maxTeamSize: 30,
  maxZones: 12,
  maxObjectives: 20,
  minAreaRadius: 50,
  maxAreaRadius: 10000,
  minUpdateSeconds: 5,
  maxUpdateSeconds: 120,
  minStaleSeconds: 20,
  maxStaleSeconds: 600,
  maxCodeLength: 6,
};

export function defaultTeams(count = 2): TeamConfig[] {
  const names = ['Blue', 'Orange', 'Green', 'Purple'];
  return Array.from({ length: Math.min(count, LIMITS.maxTeams) }, (_, i) => ({
    key: ['blue', 'orange', 'green', 'purple'][i],
    name: names[i],
    color: TEAM_PALETTE[i],
  }));
}

const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const teamSchema = z.object({
  key: z.string().min(1).max(24).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(24),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const commonSchema = z.object({
  maxPlayers: z.number().int().min(LIMITS.minPlayers).max(LIMITS.maxPlayers),
  durationMinutes: z
    .number()
    .int()
    .min(LIMITS.minDurationMinutes)
    .max(LIMITS.maxDurationMinutes),
  countdownSeconds: z.number().int().min(0).max(300),
  area: z.object({
    enabled: z.boolean(),
    center: latLngSchema.nullable(),
    radiusMeters: z.number().min(LIMITS.minAreaRadius).max(LIMITS.maxAreaRadius),
  }),
  locationUpdateSeconds: z.number().int().min(LIMITS.minUpdateSeconds).max(LIMITS.maxUpdateSeconds),
  staleAfterSeconds: z.number().int().min(LIMITS.minStaleSeconds).max(LIMITS.maxStaleSeconds),
  shareTeamLocations: z.boolean(),
  teamAssignment: z.enum(['auto', 'host', 'self']),
  maxTeamSize: z.number().int().min(0).max(LIMITS.maxTeamSize),
  teams: z.array(teamSchema).max(LIMITS.maxTeams),
  safetyAcknowledged: z.boolean(),
});

const manhuntSchema = commonSchema.extend({
  mode: z.literal('manhunt'),
  headStartSeconds: z.number().int().min(0).max(1800),
  revealIntervalSeconds: z.number().int().min(30).max(3600),
  hunterTransport: z.enum(['walk-only', 'walk-or-bike', 'any']),
  tagRadiusMeters: z.number().int().min(5).max(60),
  runnerPings: z.boolean(),
  hunterCheckIns: z.boolean(),
  tieRule: z.enum(['runners', 'hunters', 'draw']),
});

const ctfSchema = commonSchema.extend({
  mode: z.literal('ctf'),
  bases: z.record(z.string(), latLngSchema.nullable()),
  baseRadiusMeters: z.number().int().min(10).max(200),
  tagRadiusMeters: z.number().int().min(5).max(60),
  canTag: z.boolean(),
  requireOwnFlagHome: z.boolean(),
  respawnSeconds: z.number().int().min(0).max(300),
  scorePerCapture: z.number().int().min(1).max(10),
  captureCooldownSeconds: z.number().int().min(0).max(600),
  winScore: z.number().int().min(1).max(100),
  tieRule: z.enum(['draw', 'overtime']),
});

const zoneSchema = z.object({
  id: z.string().min(1).max(24),
  name: z.string().min(1).max(30),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(15).max(1000),
  eligibleTeamKeys: z.array(z.string().min(1).max(24)).max(LIMITS.maxTeams),
});

const territorySchema = commonSchema.extend({
  mode: z.literal('territory'),
  zones: z.array(zoneSchema).min(1).max(LIMITS.maxZones),
  neutralizeSeconds: z.number().int().min(0).max(900),
  captureSeconds: z.number().int().min(5).max(900),
  scoreIntervalSeconds: z.number().int().min(10).max(600),
  pointsPerZone: z.number().int().min(1).max(10),
  scoreLimit: z.number().int().min(0).max(1000),
  tieRule: z.enum(['draw', 'overtime']),
});

const objectiveSchema = z.object({
  id: z.string().min(1).max(24),
  title: z.string().min(1).max(80),
  clue: z.string().min(1).max(600),
  description: z.string().max(600),
  verification: z.enum(['gps', 'code']),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  radiusMeters: z.number().int().min(5).max(1000),
  points: z.number().int().min(1).max(100),
  hint: z.string().max(300),
  hintPenalty: z.number().int().min(0).max(100),
  code: z.string().max(40),
});

const scavengerSchema = commonSchema.extend({
  mode: z.literal('scavenger'),
  competition: z.enum(['individual', 'team']),
  orderMode: z.enum(['free', 'sequential']),
  winCondition: z.enum(['highest-points', 'first-to-complete']),
  tieRule: z.enum(['draw', 'earliest-finish']),
  objectiveTimeLimitSeconds: z.number().int().min(0).max(7200),
  objectives: z.array(objectiveSchema).min(1).max(LIMITS.maxObjectives),
});

export const modeSettingsSchemas: Record<ModeId, z.ZodType<ModeSettings>> = {
  manhunt: manhuntSchema,
  ctf: ctfSchema,
  territory: territorySchema,
  scavenger: scavengerSchema,
};

export function defaultCommonSettings(mode: ModeId): CommonSettings {
  return {
    mode,
    maxPlayers: 20,
    durationMinutes: 60,
    countdownSeconds: 10,
    area: { enabled: false, center: null, radiusMeters: 400 },
    locationUpdateSeconds: 15,
    staleAfterSeconds: 90,
    shareTeamLocations: true,
    teamAssignment: 'auto',
    maxTeamSize: 0,
    teams: defaultTeams(2),
    safetyAcknowledged: false,
  };
}

export function defaultSettings(mode: 'manhunt'): ManhuntSettings;
export function defaultSettings(mode: 'ctf'): CtfSettings;
export function defaultSettings(mode: 'territory'): TerritorySettings;
export function defaultSettings(mode: 'scavenger'): ScavengerSettings;
export function defaultSettings(mode: ModeId): ModeSettings;
export function defaultSettings(mode: ModeId): ModeSettings {
  const common = defaultCommonSettings(mode);
  switch (mode) {
    case 'manhunt':
      return {
        ...common,
        mode,
        durationMinutes: 60,
        teams: [
          { key: 'hunters', name: 'Hunters', color: '#ff6b5e' },
          { key: 'runners', name: 'Runners', color: '#b6f25a' },
        ],
        headStartSeconds: 180,
        revealIntervalSeconds: 300,
        hunterTransport: 'walk-only',
        tagRadiusMeters: 15,
        runnerPings: true,
        hunterCheckIns: true,
        tieRule: 'runners',
      };
    case 'ctf':
      return {
        ...common,
        mode,
        durationMinutes: 45,
        teams: defaultTeams(2),
        bases: {},
        baseRadiusMeters: 25,
        tagRadiusMeters: 15,
        canTag: true,
        requireOwnFlagHome: true,
        respawnSeconds: 20,
        scorePerCapture: 1,
        captureCooldownSeconds: 30,
        winScore: 3,
        tieRule: 'draw',
      };
    case 'territory':
      return {
        ...common,
        mode,
        durationMinutes: 60,
        teams: defaultTeams(2),
        zones: [],
        neutralizeSeconds: 20,
        captureSeconds: 45,
        scoreIntervalSeconds: 30,
        pointsPerZone: 1,
        scoreLimit: 0,
        tieRule: 'draw',
      };
    case 'scavenger':
      return {
        ...common,
        mode,
        durationMinutes: 60,
        teams: defaultTeams(2),
        competition: 'individual',
        orderMode: 'free',
        winCondition: 'highest-points',
        tieRule: 'draw',
        objectiveTimeLimitSeconds: 0,
        objectives: [],
      };
  }
}

export function parseSettings(mode: ModeId, raw: unknown):
  | { ok: true; settings: ModeSettings }
  | { ok: false; errors: string[] } {
  const parsed = modeSettingsSchemas[mode].safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return `${path ? `${path}: ` : ''}${issue.message}`;
    });
    return { ok: false, errors };
  }
  return { ok: true, settings: parsed.data as ModeSettings };
}

/** Structural + cross-field validation used by the wizard and the API. */
export function validateSettings(settings: ModeSettings): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = modeSettingsSchemas[settings.mode].safeParse(settings);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join('.') || 'settings'}: ${issue.message}`);
    }
    return { errors, warnings };
  }

  if (!settings.safetyAcknowledged) {
    errors.push('The host must acknowledge the outdoor safety guidance.');
  }
  if (settings.area.enabled && !settings.area.center) {
    errors.push('Play area is enabled but no centre point has been chosen.');
  }
  if (settings.staleAfterSeconds < settings.locationUpdateSeconds * 2) {
    errors.push(
      'Stale location threshold must be at least twice the GPS update interval, otherwise positions appear stale immediately.',
    );
  }
  if (new Set(settings.teams.map((t) => t.key)).size !== settings.teams.length) {
    errors.push('Team keys must be unique.');
  }
  if (
    (settings.mode === 'ctf' || settings.mode === 'territory') &&
    (settings.teams.length < 2 || settings.teams.length > LIMITS.maxTeams)
  ) {
    errors.push('This mode needs between 2 and 4 teams.');
  }
  if (settings.mode === 'scavenger' && settings.competition === 'team') {
    if (settings.teams.length < 2) errors.push('Team competition needs at least two teams.');
  }
  if (settings.maxTeamSize > 0 && settings.teams.length > 0) {
    if (settings.maxTeamSize * settings.teams.length < settings.maxPlayers) {
      errors.push(
        `Max team size ${settings.maxTeamSize} × ${settings.teams.length} teams cannot hold ${settings.maxPlayers} players.`,
      );
    }
  }

  switch (settings.mode) {
    case 'manhunt': {
      const keys = settings.teams.map((t) => t.key).sort();
      if (keys.join(',') !== 'hunters,runners') {
        errors.push('Manhunt uses exactly two teams: Hunters and Runners.');
      }
      const durationSeconds = settings.durationMinutes * 60;
      if (settings.headStartSeconds >= durationSeconds - 60) {
        errors.push('Head start must end at least 60 seconds before the match ends.');
      }
      if (settings.revealIntervalSeconds > durationSeconds) {
        errors.push('Reveal interval is longer than the match — Hunters would never get a location.');
      }
      if (settings.headStartSeconds + settings.revealIntervalSeconds > durationSeconds) {
        errors.push(
          'Head start plus one reveal interval must fit inside the match so at least one reveal happens.',
        );
      }
      if (settings.headStartSeconds >= durationSeconds * 0.5) {
        warnings.push('Head start is more than half of the match length.');
      }
      if (settings.tagRadiusMeters > 40) {
        warnings.push('A large tag radius can make tags possible without real proximity.');
      }
      if (settings.area.enabled && settings.area.radiusMeters < 150) {
        warnings.push('A play area under 150 m will make Manhunt very fast.');
      }
      break;
    }
    case 'ctf': {
      for (const team of settings.teams) {
        if (!settings.bases[team.key]) {
          errors.push(`Set a base for team ${team.name}.`);
        }
      }
      if (settings.baseRadiusMeters < 15) {
        warnings.push('Very small bases may be hard to trigger with normal GPS accuracy.');
      }
      if (settings.tagRadiusMeters >= settings.baseRadiusMeters) {
        warnings.push('Tag radius should be smaller than the base radius.');
      }
      if (settings.captureCooldownSeconds >= settings.durationMinutes * 60) {
        errors.push('Capture cooldown is longer than the match.');
      }
      if (settings.winScore * (settings.captureCooldownSeconds + 30) > settings.durationMinutes * 60) {
        warnings.push('The win score may be hard to reach within the match duration.');
      }
      if (!settings.canTag && settings.requireOwnFlagHome) {
        warnings.push('With tagging off, flags can only be returned by scoring or a host cancel.');
      }
      break;
    }
    case 'territory': {
      if (settings.zones.length === 0) errors.push('Add at least one capture zone.');
      const ids = new Set<string>();
      for (const zone of settings.zones) {
        if (ids.has(zone.id)) errors.push('Zone ids must are duplicated.');
        ids.add(zone.id);
        if (settings.area.enabled && settings.area.center) {
          // Warn rather than reject: hosts may deliberately place a zone near the edge.
          const { distanceMeters } = requireGeo();
          if (
            distanceMeters({ lat: zone.lat, lng: zone.lng }, settings.area.center) + zone.radiusMeters >
            settings.area.radiusMeters
          ) {
            warnings.push(`Zone ${zone.name} extends outside the play area.`);
          }
        }
        if (zone.eligibleTeamKeys.length === 0) {
          errors.push(`Zone ${zone.name} has no eligible teams.`);
        }
        for (const key of zone.eligibleTeamKeys) {
          if (!settings.teams.some((t) => t.key === key)) {
            errors.push(`Zone ${zone.name} lists an unknown team.`);
          }
        }
        if (zone.radiusMeters < settings.area.radiusMeters * 0.03) {
          // no-op guard for nonsensical comparisons
        }
      }
      if (settings.scoreLimit > 0) {
        const maxPerTick = settings.pointsPerZone * settings.zones.length;
        if (settings.scoreLimit > maxPerTick * (settings.durationMinutes * 60) / settings.scoreIntervalSeconds) {
          warnings.push('Score limit may be impossible to reach in time.');
        }
      }
      if (settings.captureSeconds + settings.neutralizeSeconds > settings.durationMinutes * 60) {
        errors.push('Capture plus neutralise time is longer than the match.');
      }
      break;
    }
    case 'scavenger': {
      if (settings.objectives.length === 0) errors.push('Add at least one objective.');
      const ids = new Set<string>();
      for (const objective of settings.objectives) {
        if (ids.has(objective.id)) errors.push('Objective ids must be unique.');
        ids.add(objective.id);
        if (objective.verification === 'gps' && (objective.lat == null || objective.lng == null)) {
          errors.push(`Objective "${objective.title}" needs a checkpoint on the map.`);
        }
        if (objective.verification === 'code' && objective.code.trim().length < 3) {
          errors.push(`Objective "${objective.title}" needs an answer code of at least 3 characters.`);
        }
        if (objective.verification === 'code' && objective.lat != null) {
          warnings.push(`Objective "${objective.title}" uses a code and ignores its map point.`);
        }
        if (settings.area.enabled && settings.area.center && objective.lat != null && objective.lng != null) {
          const { distanceMeters } = requireGeo();
          if (
            distanceMeters({ lat: objective.lat, lng: objective.lng }, settings.area.center) >
            settings.area.radiusMeters + 100
          ) {
            warnings.push(`Objective "${objective.title}" is outside the play area.`);
          }
        }
      }
      if (settings.objectiveTimeLimitSeconds > settings.durationMinutes * 60) {
        errors.push('Objective time limit cannot exceed the match duration.');
      }
      if (settings.orderMode === 'sequential' && settings.objectives.length > 1 && settings.objectiveTimeLimitSeconds === 0) {
        warnings.push('Sequential hunts without objective time limits can stall at one checkpoint.');
      }
      break;
    }
  }

  return { errors, warnings };
}

function requireGeo() {
  // Kept lazy to avoid a cycle with the geo module at import time.
  return require('./geo') as typeof import('./geo');
}

/** Settings safe to send to every participant (no hidden answers or future objectives). */
export function publicSettings(settings: ModeSettings): Record<string, unknown> {
  const common = {
    maxPlayers: settings.maxPlayers,
    durationMinutes: settings.durationMinutes,
    countdownSeconds: settings.countdownSeconds,
    area: settings.area,
    locationUpdateSeconds: settings.locationUpdateSeconds,
    staleAfterSeconds: settings.staleAfterSeconds,
    shareTeamLocations: settings.shareTeamLocations,
    teamAssignment: settings.teamAssignment,
    maxTeamSize: settings.maxTeamSize,
    teams: settings.teams,
    mode: settings.mode,
  };
  switch (settings.mode) {
    case 'manhunt':
      return {
        ...common,
        headStartSeconds: settings.headStartSeconds,
        revealIntervalSeconds: settings.revealIntervalSeconds,
        hunterTransport: settings.hunterTransport,
        tagRadiusMeters: settings.tagRadiusMeters,
        runnerPings: settings.runnerPings,
        hunterCheckIns: settings.hunterCheckIns,
        tieRule: settings.tieRule,
      };
    case 'ctf':
      return {
        ...common,
        bases: settings.bases,
        baseRadiusMeters: settings.baseRadiusMeters,
        tagRadiusMeters: settings.tagRadiusMeters,
        canTag: settings.canTag,
        requireOwnFlagHome: settings.requireOwnFlagHome,
        respawnSeconds: settings.respawnSeconds,
        scorePerCapture: settings.scorePerCapture,
        captureCooldownSeconds: settings.captureCooldownSeconds,
        winScore: settings.winScore,
        tieRule: settings.tieRule,
      };
    case 'territory':
      return {
        ...common,
        zones: settings.zones,
        neutralizeSeconds: settings.neutralizeSeconds,
        captureSeconds: settings.captureSeconds,
        scoreIntervalSeconds: settings.scoreIntervalSeconds,
        pointsPerZone: settings.pointsPerZone,
        scoreLimit: settings.scoreLimit,
        tieRule: settings.tieRule,
      };
    case 'scavenger':
      return {
        ...common,
        competition: settings.competition,
        orderMode: settings.orderMode,
        winCondition: settings.winCondition,
        tieRule: settings.tieRule,
        objectiveTimeLimitSeconds: settings.objectiveTimeLimitSeconds,
        objectiveCount: settings.objectives.length,
        totalPoints: settings.objectives.reduce((sum, o) => sum + o.points, 0),
      };
  }
}

export function defaultObjective(index: number): ScavengerObjectiveConfig {
  return {
    id: `objective-${index + 1}`,
    title: `Checkpoint ${index + 1}`,
    clue: '',
    description: '',
    verification: 'gps',
    lat: null,
    lng: null,
    radiusMeters: 30,
    points: 10,
    hint: '',
    hintPenalty: 3,
    code: '',
  };
}

export function defaultZone(index: number, center: LatLng, radiusMeters: number): TerritoryZoneConfig {
  const angle = (index / 4) * Math.PI * 2;
  const distance = radiusMeters * 0.5;
  return {
    id: `zone-${index + 1}`,
    name: `Zone ${String.fromCharCode(65 + index)}`,
    lat: center.lat + (distance * Math.cos(angle)) / 111_320,
    lng:
      center.lng +
      (distance * Math.sin(angle)) / (111_320 * Math.cos((center.lat * Math.PI) / 180) || 1),
    radiusMeters: 60,
    eligibleTeamKeys: [],
  };
}

export function generatedBases(teams: TeamConfig[], center: LatLng, radiusMeters: number): Record<string, LatLng> {
  const distance = Math.max(30, radiusMeters * 0.45);
  const bases: Record<string, LatLng> = {};
  teams.forEach((team, index) => {
    const angle = (index / teams.length) * Math.PI * 2 - Math.PI / 2;
    bases[team.key] = {
      lat: center.lat + (distance * Math.cos(angle)) / 111_320,
      lng:
        center.lng +
        (distance * Math.sin(angle)) / (111_320 * Math.cos((center.lat * Math.PI) / 180) || 1),
    };
  });
  return bases;
}
