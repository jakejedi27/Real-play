import type {
  AccountRecord,
  FriendshipRecord,
  GameInviteRecord,
  GameResultRecord,
  PasswordResetRecord,
  SessionRecord,
} from '../shared/accounts';
import type {
  GameEventRecord,
  GameRecord,
  JobRecord,
  PlayerRecord,
  StoredLocation,
} from '../shared/types';

export interface EventInsertResult {
  event: GameEventRecord;
  inserted: boolean;
}

/**
 * Storage boundary shared by the SQLite (default, verified) and Supabase
 * adapters. All access happens server-side; browsers never touch the database.
 */
export interface Store {
  readonly kind: 'sqlite' | 'supabase';
  init(): Promise<void>;
  close(): Promise<void>;

  createGame(game: GameRecord): Promise<void>;
  getGame(id: string): Promise<GameRecord | null>;
  getGameByCode(code: string): Promise<GameRecord | null>;
  saveGame(game: GameRecord, expectedRevision: number): Promise<boolean>;
  listGamesNeedingTicks(): Promise<GameRecord[]>;
  listRecentGames(limit: number): Promise<GameRecord[]>;

  createPlayer(player: PlayerRecord): Promise<void>;
  getPlayer(id: string): Promise<PlayerRecord | null>;
  listPlayers(gameId: string): Promise<PlayerRecord[]>;
  listPlayersByAccount(accountId: string): Promise<PlayerRecord[]>;
  updatePlayer(player: PlayerRecord): Promise<void>;

  upsertLocation(location: StoredLocation): Promise<void>;
  getLocation(gameId: string, playerId: string): Promise<StoredLocation | null>;
  listLocations(gameId: string): Promise<StoredLocation[]>;

  appendEvent(event: GameEventRecord): Promise<EventInsertResult>;
  listEvents(gameId: string, sinceSeq: number, limit: number): Promise<GameEventRecord[]>;
  latestSeq(gameId: string): Promise<number>;

  enqueueJob(job: JobRecord): Promise<boolean>;
  claimDueJobs(now: number, limit: number): Promise<JobRecord[]>;
  finishJob(id: string, status: 'done' | 'failed'): Promise<void>;
  cancelPendingJobs(gameId: string, kinds: string[]): Promise<void>;

  /* Accounts and sessions ------------------------------------------- */

  createAccount(account: AccountRecord): Promise<void>;
  getAccount(id: string): Promise<AccountRecord | null>;
  getAccountByEmail(emailLower: string): Promise<AccountRecord | null>;
  getAccountByUsername(usernameLower: string): Promise<AccountRecord | null>;
  updateAccount(account: AccountRecord): Promise<void>;

  createSession(session: SessionRecord): Promise<void>;
  getSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  touchSession(id: string, lastSeenAt: number): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteAccountSessions(accountId: string): Promise<void>;

  createPasswordReset(reset: PasswordResetRecord): Promise<void>;
  getPasswordResetByTokenHash(tokenHash: string): Promise<PasswordResetRecord | null>;
  markPasswordResetUsed(id: string, usedAt: number): Promise<void>;
  deleteExpiredPasswordResets(before: number): Promise<void>;

  /* Results, friends and invites ----------------------------------- */

  /** Idempotent: one row per (game, account). Returns false when already stored. */
  recordGameResult(result: GameResultRecord): Promise<boolean>;
  listGameResults(accountId: string, limit: number): Promise<GameResultRecord[]>;

  createFriendship(friendship: FriendshipRecord): Promise<boolean>;
  getFriendship(a: string, b: string): Promise<FriendshipRecord | null>;
  getFriendshipById(id: string): Promise<FriendshipRecord | null>;
  updateFriendship(friendship: FriendshipRecord): Promise<void>;
  deleteFriendship(id: string): Promise<void>;
  listFriendships(accountId: string): Promise<FriendshipRecord[]>;

  createGameInvite(invite: GameInviteRecord): Promise<void>;
  listGameInvites(toAccountId: string): Promise<GameInviteRecord[]>;
  deleteGameInvite(id: string, toAccountId: string): Promise<void>;
}
