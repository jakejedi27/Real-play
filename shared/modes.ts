import type { ModeId } from './types';

export interface ModeMeta {
  id: ModeId;
  name: string;
  tagline: string;
  description: string;
  glyph: string;
  accent: string;
  location: 'required' | 'optional';
  teamBased: boolean;
  minPlayers: number;
  bullets: string[];
}

export const MODE_META: Record<ModeId, ModeMeta> = {
  manhunt: {
    id: 'manhunt',
    name: 'Manhunt',
    tagline: 'Hide. Move. Survive.',
    description:
      'Runners get a head start and disappear into the neighbourhood. Hunters chase them down with scheduled location reveals and check-ins.',
    glyph: '◎',
    accent: '#b6f25a',
    location: 'required',
    teamBased: true,
    minPlayers: 2,
    bullets: ['Head start timer', 'Scheduled reveals, not live tracking', 'Hunter transport rules'],
  },
  ctf: {
    id: 'ctf',
    name: 'Capture the Flag',
    tagline: 'Grab it. Bring it home.',
    description:
      'Two to four teams defend their base and steal flags. Flags only move when the server sees a real player at a real location.',
    glyph: '⚑',
    accent: '#6fd3ff',
    location: 'required',
    teamBased: true,
    minPlayers: 4,
    bullets: ['2–4 team bases', 'Tag & respawn rules', 'First to the score limit'],
  },
  territory: {
    id: 'territory',
    name: 'Territory Control',
    tagline: 'Hold the ground.',
    description:
      'Capture zones by physically standing in them, then hold them. Zone ownership and score ticks are calculated on the server.',
    glyph: '⬡',
    accent: '#c79bff',
    location: 'required',
    teamBased: true,
    minPlayers: 2,
    bullets: ['Up to 12 zones', 'Capture & neutralise times', 'Score every interval'],
  },
  scavenger: {
    id: 'scavenger',
    name: 'Scavenger Hunt',
    tagline: 'Follow the clues.',
    description:
      'Hosts write clues for checkpoints and hidden codes. Players solve in any order or a locked sequence, with optional hints and penalties.',
    glyph: '✶',
    accent: '#ffb84d',
    location: 'optional',
    teamBased: false,
    minPlayers: 1,
    bullets: ['GPS checkpoints or answer codes', 'Hints with point penalties', 'Solo or team scoring'],
  },
};

export const MODE_LIST = Object.values(MODE_META);
