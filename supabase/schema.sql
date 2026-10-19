-- Courtside schema. SKELETON — not applied to any project yet. See docs/engine/PLAN.md.
--
-- Two halves that never mix:
--   app_*      your state, one row, synced between your phone and your MacBook
--   everything else: the NBA warehouse the worker fills, shared and impersonal
--
-- Deliberately absent: a table for espn_s2 / SWID. Those are live credentials to your ESPN
-- account and they stay on each device. See PLAN.md, "Persistence".

-- ---------------------------------------------------------------- your state

create table app_state (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  settings    jsonb not null default '{}',   -- what cs.settings.v3 holds today
  espn        jsonb not null default '{}',   -- league id and team id, never the cookies
  notes       jsonb not null default '{}',   -- player_id -> your own note
  updated_at  timestamptz not null default now()
);
-- Last write wins. Two devices editing settings in the same second is not a real problem here.

-- ---------------------------------------------------------------- the league

create table teams (
  id        int primary key,                 -- NBA team id, the one ESPN uses too
  abbrev    text not null,
  name      text not null,
  conference text
);

create table players (
  id        int primary key,                 -- ESPN player id; nba.com id in nba_id
  nba_id    int unique,
  name      text not null,
  team_id   int references teams(id),
  positions text[] not null default '{}',
  status    text                             -- ACTIVE, OUT, DAY_TO_DAY, SUSPENSION...
);
create index on players (lower(name));        -- every source joins on name at least once

create table games (
  id          text primary key,              -- nba.com game id
  date        date not null,
  home_team   int references teams(id),
  away_team   int references teams(id),
  status      text,
  pace        numeric
);
create index on games (date);

-- ---------------------------------------------------------------- the spine

-- One row per player per game played. Everything downstream is derived from this table.
create table player_games (
  player_id   int references players(id),
  game_id     text references games(id),
  min         numeric,
  pts smallint, reb smallint, ast smallint, stl smallint, blk smallint, tov smallint,
  fgm smallint, fga smallint, ftm smallint, fta smallint, tpm smallint,
  fp          numeric,                       -- fantasy points under YOUR league's weights
  started     boolean,
  primary key (player_id, game_id)
);

-- Rolling form, recomputed by the worker. sd is the point: a 30-point average with a 14-point
-- spread is a different asset from a 30-point average with a 5-point spread.
create table player_form (
  player_id   int references players(id),
  as_of       date,
  games       smallint,
  mean_min    numeric,
  mean_fp     numeric,
  sd_fp       numeric,
  primary key (player_id, as_of)
);

create table defense_vs_pos (
  team_id     int references teams(id),
  pos         text,                          -- PG SG SF PF C
  as_of       date,
  fp_allowed  numeric,
  league_rank smallint,
  primary key (team_id, pos, as_of)
);

-- ---------------------------------------------------------------- the fine detail

-- Possession-level defender vs scorer, from leagueseasonmatchups / boxscorematchupsv3.
create table matchup_history (
  off_player_id int references players(id),
  def_player_id int references players(id),
  season        text,
  possessions   numeric,
  min           numeric,
  pts smallint, fgm smallint, fga smallint, tov smallint,
  primary key (off_player_id, def_player_id, season)
);

-- Who keeps getting into it with whom. Built from playbyplayv3 technicals, flagrants and
-- ejections where both players are named, then corroborated against news coverage.
create table friction (
  player_a    int references players(id),
  player_b    int references players(id),
  incidents   smallint not null default 0,
  last_at     date,
  detail      jsonb not null default '[]',   -- [{game_id, date, kind, note}]
  primary key (player_a, player_b)           -- store with player_a < player_b
);

-- Off-court and availability news. kind drives what, if anything, the model does with it.
--   injury | suspension | legal | trade | role | personal
-- Only the first four move p_play. 'personal' is surfaced and tagged, never quantified:
-- there is no defensible number for how a divorce changes a jump shot.
create table events (
  id            bigserial primary key,
  player_id     int references players(id),
  kind          text not null,
  headline      text not null,
  url           text,
  source        text,
  published_at  timestamptz not null,
  tone          numeric,                     -- GDELT tone, negative is bad coverage
  p_play_delta  numeric,                     -- null unless kind moves availability
  created_at    timestamptz not null default now()
);
create index on events (player_id, published_at desc);

-- ---------------------------------------------------------------- the output

-- Written BEFORE the games are played, graded after. Never overwrite a row: the history is
-- what makes calibration possible, and a projection you never grade is a horoscope.
create table projections (
  player_id   int references players(id),
  game_date   date,
  mean_fp     numeric not null,
  sd_fp       numeric not null,
  p_play      numeric not null,
  model       text not null,                 -- version tag, so a bad week can be blamed properly
  created_at  timestamptz not null default now(),
  actual_fp   numeric,                       -- filled in by the worker the next morning
  primary key (player_id, game_date, model)
);

create table week_sim (
  id          bigserial primary key,
  week        smallint not null,
  team_id     int not null,                  -- your ESPN fantasy team id
  opp_team_id int not null,
  p_win       numeric not null,
  my_mean     numeric, opp_mean numeric,
  detail      jsonb not null default '{}',   -- swing players, swing days, games-played edge
  model       text not null,
  created_at  timestamptz not null default now(),
  actual_win  boolean                        -- graded Monday. The calibration page reads this.
);
create index on week_sim (week, created_at desc);

-- ---------------------------------------------------------------- access
--
-- The warehouse is impersonal: readable by the anon key, written only by the worker's service
-- key. app_state is yours, behind Supabase Auth (magic link):
--
-- alter table app_state enable row level security;
-- create policy app_state_is_mine on app_state
--   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
--
-- Written out properly in phase 1, with the migration.
