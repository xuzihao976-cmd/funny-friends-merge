-- Apply after leaderboard.sql. Guest tokens are issued by family-scores only.
-- The database stores token hashes; visitors cannot access private tables or write RPCs.
drop function public.submit_family_score(uuid,text,integer,text);
drop function private.submit_family_score(uuid,text,integer,text);
alter table private.family_players drop constraint family_players_user_id_fkey;
alter table private.family_players alter column user_id set default gen_random_uuid();
alter table private.family_players add column token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$');
alter table private.family_players add column created_at timestamptz not null default now();
alter table private.family_players add column last_seen_at timestamptz not null default now();
create index family_players_created_idx on private.family_players(created_at);
alter table private.family_score_runs drop constraint family_score_runs_user_id_fkey;
alter table private.family_score_runs add constraint family_score_runs_player_fkey
  foreign key(user_id) references private.family_players(user_id) on delete cascade;
revoke all on schema private from authenticated;
grant usage on schema private to service_role;
grant select,insert,update,delete on private.family_players,private.family_score_runs to service_role;
grant select,insert,delete on public.family_score_entries to service_role;

create function public.register_family_guest(p_token_hash text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid guest token'; end if;
  perform pg_catalog.pg_advisory_xact_lock(81009, 1);
  if exists(select 1 from private.family_players where token_hash=p_token_hash) then return; end if;
  if (select count(*) from private.family_players where created_at > now()-interval '1 hour') >= 100
     or (select count(*) from private.family_players where created_at > now()-interval '24 hours') >= 1000 then
    raise exception 'Guest creation limit reached';
  end if;
  insert into private.family_players(token_hash) values(p_token_hash);
  delete from private.family_players where last_seen_at < now()-interval '90 days';
end;
$$;
revoke all on function public.register_family_guest(text) from public,anon,authenticated;
grant execute on function public.register_family_guest(text) to service_role;

create function public.submit_family_guest_score(p_token_hash text,p_run_id uuid,p_nickname text,p_points integer,p_game_mode text)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  player uuid;
  display_id uuid;
  display_name text := btrim(regexp_replace(coalesce(p_nickname,''),'[[:cntrl:]<>]','','g'));
begin
  select user_id,public_id into player,display_id from private.family_players where token_hash=p_token_hash;
  if player is null then raise exception 'Invalid guest session'; end if;
  if p_run_id is null or p_points is null or p_points not between 1 and 10000000
     or p_game_mode is null or p_game_mode not in ('photo','comic')
     or char_length(display_name) not between 1 and 12 then raise exception 'Invalid score submission'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(player::text,0));
  if exists(select 1 from private.family_score_runs where id=p_run_id and user_id=player) then return; end if;
  if (select count(*) from private.family_score_runs where user_id=player and created_at>now()-interval '24 hours') >= 120 then
    raise exception 'Daily score submission limit reached';
  end if;
  if exists(select 1 from private.family_score_runs where user_id=player and created_at>now()-interval '3 seconds') then
    raise exception 'Score submission too frequent';
  end if;
  update private.family_players set last_seen_at=now() where user_id=player;
  insert into private.family_score_runs(id,user_id,created_at) values(p_run_id,player,now());
  insert into public.family_score_entries(id,public_player_id,nickname,points,game_mode,created_at)
    values(p_run_id,display_id,display_name,p_points,p_game_mode,now());
  delete from private.family_score_runs where created_at<now()-interval '30 days';
end;
$$;
revoke all on function public.submit_family_guest_score(text,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.submit_family_guest_score(text,uuid,text,integer,text) to service_role;
