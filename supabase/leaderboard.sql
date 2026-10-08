-- 最近 7 天共享榜单；原照和漫画使用同一榜单。
-- 初始数据库结构。只在本游戏专用新项目中执行，再执行 guest-sessions.sql。
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table private.family_players (
  user_id uuid primary key references auth.users(id) on delete cascade,
  public_id uuid not null unique default gen_random_uuid()
);
create table private.family_score_runs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index family_score_runs_user_time_idx on private.family_score_runs(user_id, created_at desc);
create index family_score_runs_time_idx on private.family_score_runs(created_at);
alter table private.family_players enable row level security;
alter table private.family_score_runs enable row level security;
revoke all on private.family_players, private.family_score_runs from public, anon, authenticated;

-- 本表只有可公开的榜单字段，不含 Auth 用户 ID、邮箱、登录信息。
create table public.family_score_entries (
  id uuid primary key references private.family_score_runs(id) on delete cascade,
  public_player_id uuid not null references private.family_players(public_id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 12 and nickname !~ '[[:cntrl:]<>]'),
  points integer not null check (points between 1 and 10000000),
  game_mode text not null check (game_mode in ('photo','comic')),
  created_at timestamptz not null
);
create index family_score_entries_time_idx on public.family_score_entries(created_at desc);
create index family_score_entries_player_idx on public.family_score_entries(public_player_id, points desc, created_at);
alter table public.family_score_entries enable row level security;
revoke all on public.family_score_entries from public, anon, authenticated;
grant select on public.family_score_entries to anon, authenticated;
create policy "Public leaderboard scores are readable" on public.family_score_entries
  for select to anon, authenticated using (true);

create function private.submit_family_score(p_run_id uuid, p_nickname text, p_points integer, p_game_mode text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  player uuid := (select auth.uid());
  display_id uuid;
  display_name text := btrim(regexp_replace(coalesce(p_nickname,''), '[[:cntrl:]<>]', '', 'g'));
begin
  if player is null then raise exception 'Authentication required'; end if;
  if p_run_id is null or p_points is null or p_points not between 1 and 10000000
     or p_game_mode is null or p_game_mode not in ('photo','comic')
     or char_length(display_name) not between 1 and 12 then
    raise exception 'Invalid score submission';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(player::text, 0));
  -- 同一局重试不会重复上榜；身份和时间均在服务端确定。
  if exists(select 1 from private.family_score_runs where id = p_run_id and user_id = player) then return; end if;
  if (select count(*) from private.family_score_runs where user_id = player and created_at > now() - interval '24 hours') >= 120 then
    raise exception 'Daily score submission limit reached';
  end if;
  if exists(select 1 from private.family_score_runs where user_id = player and created_at > now() - interval '3 seconds') then
    raise exception 'Score submission too frequent';
  end if;
  insert into private.family_players(user_id) values(player) on conflict(user_id) do nothing;
  select public_id into display_id from private.family_players where user_id = player;
  insert into private.family_score_runs(id,user_id,created_at) values(p_run_id,player,now());
  insert into public.family_score_entries(id,public_player_id,nickname,points,game_mode,created_at)
    values(p_run_id,display_id,display_name,p_points,p_game_mode,now());
  delete from private.family_score_runs where created_at < now() - interval '30 days';
end;
$$;
revoke all on function private.submit_family_score(uuid,text,integer,text) from public, anon, authenticated;
grant execute on function private.submit_family_score(uuid,text,integer,text) to authenticated;

create function public.submit_family_score(p_run_id uuid, p_nickname text, p_points integer, p_game_mode text)
returns void language sql security invoker set search_path = '' as $$
  select private.submit_family_score(p_run_id,p_nickname,p_points,p_game_mode);
$$;
revoke all on function public.submit_family_score(uuid,text,integer,text) from public, anon, authenticated;
grant execute on function public.submit_family_score(uuid,text,integer,text) to authenticated;

create view public.family_recent_leaderboard with (security_invoker = true) as
with best_per_player as (
  select distinct on(public_player_id) public_player_id,nickname,points,game_mode,created_at
  from public.family_score_entries where created_at >= now() - interval '7 days'
  order by public_player_id,points desc,created_at asc,id
)
select row_number() over(order by points desc,created_at asc,public_player_id)::integer as rank,
  nickname,points,game_mode,created_at
from best_per_player order by points desc,created_at asc,public_player_id limit 20;
revoke all on public.family_recent_leaderboard from public, anon, authenticated;
grant select on public.family_recent_leaderboard to anon, authenticated;

