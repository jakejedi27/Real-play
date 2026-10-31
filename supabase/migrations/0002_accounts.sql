-- RealPlay accounts, sessions, profiles, results and friends.
--
-- The app talks to Postgres exclusively through the server (service-role key).
-- Roles `anon` and `authenticated` therefore get NO table privileges: every
-- write is validated on the server, and statistics are only ever derived from
-- rows written by the game engine. RLS is enabled with no permissive policies
-- so a leaked anon key cannot read emails, password hashes or GPS data.
--
-- Run with:  psql "$SUPABASE_DB_URL" -f supabase/migrations/0002_accounts.sql

create extension if not exists "pgcrypto";

create table if not exists public.accounts (
  id             text primary key,
  email          text not null,
  email_lower    text not null unique,
  username       text not null,
  username_lower text not null unique,
  display_name   text not null,
  avatar_url     text,
  password_hash  text not null,
  created_at     bigint not null,
  updated_at     bigint not null
);

create table if not exists public.account_sessions (
  id           text primary key,
  account_id   text not null references public.accounts(id) on delete cascade,
  token_hash   text not null unique,
  created_at   bigint not null,
  expires_at   bigint not null,
  last_seen_at bigint not null
);
create index if not exists idx_sessions_account on public.account_sessions(account_id);

create table if not exists public.password_resets (
  id         text primary key,
  account_id text not null references public.accounts(id) on delete cascade,
  token_hash text not null unique,
  created_at bigint not null,
  expires_at bigint not null,
  used_at    bigint
);
create index if not exists idx_resets_account on public.password_resets(account_id);

-- One authoritative row per (game, account). Written by the server when a game
-- reaches `ended`; unique index makes result attribution idempotent.
create table if not exists public.game_results (
  id           text primary key,
  game_id      text not null,
  account_id   text not null references public.accounts(id) on delete cascade,
  player_id    text not null,
  mode         text not null,
  game_name    text not null,
  game_code    text not null,
  player_count integer not null,
  outcome      text not null check (outcome in ('win', 'loss', 'draw', 'played')),
  ended_at     bigint not null,
  recorded_at  bigint not null
);
create unique index if not exists idx_results_game_account
  on public.game_results(game_id, account_id);
create index if not exists idx_results_account on public.game_results(account_id, ended_at desc);

create table if not exists public.friendships (
  id           text primary key,
  requester_id text not null references public.accounts(id) on delete cascade,
  addressee_id text not null references public.accounts(id) on delete cascade,
  status       text not null check (status in ('pending', 'accepted')),
  created_at   bigint not null,
  responded_at bigint
);
create unique index if not exists idx_friendship_pair
  on public.friendships(requester_id, addressee_id);
create index if not exists idx_friendship_addressee on public.friendships(addressee_id);

create table if not exists public.game_invites (
  id              text primary key,
  from_account_id text not null references public.accounts(id) on delete cascade,
  to_account_id   text not null references public.accounts(id) on delete cascade,
  game_id         text not null,
  code            text not null,
  game_name       text not null,
  mode            text not null,
  created_at      bigint not null
);
create index if not exists idx_invites_to on public.game_invites(to_account_id, created_at desc);

-- Players gain an optional account link. Guests keep playing exactly as before.
alter table if exists public.players add column if not exists account_id text;
create index if not exists idx_players_account on public.players(account_id);

-- ---------------------------------------------------------------------------
-- Row level security: deny-by-default for client roles.
-- The service role bypasses RLS, so the API keeps full access.
-- ---------------------------------------------------------------------------

alter table public.accounts          enable row level security;
alter table public.account_sessions  enable row level security;
alter table public.password_resets   enable row level security;
alter table public.game_results      enable row level security;
alter table public.friendships       enable row level security;
alter table public.game_invites      enable row level security;

revoke all on public.accounts         from anon, authenticated;
revoke all on public.account_sessions from anon, authenticated;
revoke all on public.password_resets  from anon, authenticated;
revoke all on public.game_results     from anon, authenticated;
revoke all on public.friendships      from anon, authenticated;
revoke all on public.game_invites     from anon, authenticated;

-- No policies are created on purpose: browser clients cannot read account
-- emails, password hashes, session tokens, friendships or GPS-linked results.
-- Public profile data and leaderboards are served by the API, which filters
-- every field (and never returns coordinates).
