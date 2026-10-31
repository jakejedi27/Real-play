import type { ModeId } from './types';

/**
 * Account, profile, stats and friends contracts shared by the server and the
 * client. Nothing here ever contains a password hash, session token or GPS
 * coordinate — profiles are public-safe by construction.
 */

export type GameOutcome = 'win' | 'loss' | 'draw' | 'played';

export interface ModeStat {
  mode: ModeId;
  played: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface RecentGameEntry {
  gameId: string;
  code: string;
  name: string;
  mode: ModeId;
  outcome: GameOutcome;
  endedAt: number;
  playerCount: number;
}

export interface AccountStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  byMode: ModeStat[];
}

export interface FriendView {
  accountId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  since: number;
}

export interface FriendRequestView {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: number;
  direction: 'incoming' | 'outgoing';
}

export interface GameInviteView {
  id: string;
  fromUsername: string;
  fromDisplayName: string;
  fromAvatarUrl: string | null;
  gameId: string;
  code: string;
  gameName: string;
  mode: ModeId;
  createdAt: number;
}

export interface PublicProfile {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: number;
  stats: AccountStats;
  recentGames: RecentGameEntry[];
}

export interface AccountView {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: number;
}

export interface OwnProfile extends PublicProfile {
  id: string;
  email: string;
  friends: FriendView[];
  incomingRequests: FriendRequestView[];
  outgoingRequests: FriendRequestView[];
}

export interface AccountSessionResponse {
  token: string;
  account: AccountView;
}

/** Active game membership, used to restore lobby/game state after a refresh. */
export interface ActiveGameView {
  gameId: string;
  code: string;
  name: string;
  mode: ModeId;
  status: 'lobby' | 'countdown' | 'active' | 'ended' | 'cancelled';
  playerId: string;
  isHost: boolean;
  playerCount: number;
}

/* ------------------------------------------------------------------ */
/* Persistence records (server-side only)                              */
/* ------------------------------------------------------------------ */

export interface AccountRecord {
  id: string;
  /** Original casing, shown back to the user. */
  email: string;
  emailLower: string;
  username: string;
  usernameLower: string;
  displayName: string;
  avatarUrl: string | null;
  /** scrypt hash — never leaves the store. */
  passwordHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionRecord {
  id: string;
  accountId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
}

export interface PasswordResetRecord {
  id: string;
  accountId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

export interface GameResultRecord {
  id: string;
  gameId: string;
  accountId: string;
  playerId: string;
  mode: ModeId;
  gameName: string;
  gameCode: string;
  playerCount: number;
  outcome: GameOutcome;
  endedAt: number;
  recordedAt: number;
}

export interface FriendshipRecord {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: 'pending' | 'accepted';
  createdAt: number;
  respondedAt: number | null;
}

export interface GameInviteRecord {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  gameId: string;
  code: string;
  gameName: string;
  mode: ModeId;
  createdAt: number;
}
