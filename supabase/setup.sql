-- PolSenna Bets — Supabase setup.
-- Paste this whole file into Supabase → SQL Editor → Run. Safe to re-run (data is kept).
-- The browser can't touch the tables directly; it only calls the functions below,
-- which enforce the rules (tip-off lock, 100 credits, admin key).

create extension if not exists pgcrypto;

create table if not exists settings (
  id int primary key default 1 check (id = 1),
  admin_key text not null default encode(gen_random_bytes(9), 'base64'),
  credits_per_game int not null default 100
);
insert into settings (id) values (1) on conflict do nothing;
-- base64 can contain + and / which are awkward in links
update settings set admin_key = translate(admin_key, '+/=', 'xyz');

create table if not exists players (
  id text primary key default substr(md5(random()::text), 1, 10),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists games (
  id text primary key default substr(md5(random()::text), 1, 10),
  title text not null,
  location text not null default '',
  starts_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'closed', 'settled')),
  bets jsonb not null default '[]',   -- [{id, question, options:[{id,label,odds}], result}]
  created_at timestamptz not null default now()
);

create table if not exists wagers (
  game_id text not null references games(id) on delete cascade,
  player_id text not null references players(id) on delete cascade,
  items jsonb not null default '[]',  -- [{betId, optionId, amount}]
  updated_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

-- Lock the tables: no direct access from the browser.
alter table settings enable row level security;
alter table players  enable row level security;
alter table games    enable row level security;
alter table wagers   enable row level security;
revoke all on settings, players, games, wagers from anon, authenticated;

-- ---------- helpers ----------

create or replace function _locked(g games) returns boolean
language sql stable as $$ select g.status <> 'open' or now() >= g.starts_at $$;

create or replace function _check_admin(p_key text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_key is null or p_key <> (select admin_key from settings where id = 1) then
    raise exception 'Wrong admin key';
  end if;
end $$;

create or replace function _state(p_player text, p_admin boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'creditsPerGame', (select credits_per_game from settings where id = 1),
    'serverTime', (extract(epoch from now()) * 1000)::bigint,
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.created_at) from players p), '[]'),
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'title', g.title, 'location', g.location,
        'startsAt', to_char(g.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'status', g.status, 'bets', g.bets, 'locked', _locked(g),
        'participants', (select count(*) from wagers w where w.game_id = g.id and jsonb_array_length(w.items) > 0),
        'wagers', coalesce((
          select jsonb_object_agg(w.player_id, w.items) from wagers w
          where w.game_id = g.id and (p_admin or _locked(g) or w.player_id = p_player)
        ), '{}')
      ) order by g.starts_at desc) from games g
    ), '[]')
  )
$$;

-- ---------- player functions ----------

create or replace function get_state(p_player text default null) returns jsonb
language sql stable security definer set search_path = public as $$ select _state(p_player, false) $$;

create or replace function add_player(p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n text := left(btrim(coalesce(p_name, '')), 30); p players;
begin
  if n = '' then raise exception 'Name required'; end if;
  select * into p from players where lower(name) = lower(n);
  if not found then insert into players (name) values (n) returning * into p; end if;
  return jsonb_build_object('id', p.id, 'name', p.name);
end $$;

create or replace function save_wagers(p_game text, p_player text, p_wagers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g games; w jsonb; b jsonb; clean jsonb := '[]'; total int := 0; amt int;
  cap int := (select credits_per_game from settings where id = 1);
begin
  select * into g from games where id = p_game;
  if not found then raise exception 'Game not found'; end if;
  if not exists (select 1 from players where id = p_player) then raise exception 'Player not found'; end if;
  if _locked(g) then raise exception 'Betting is closed for this game'; end if;
  for w in select * from jsonb_array_elements(coalesce(p_wagers, '[]')) loop
    b := null;
    amt := floor(coalesce((w->>'amount')::numeric, 0));
    continue when amt <= 0;
    select x into b from jsonb_array_elements(g.bets) x where x->>'id' = w->>'betId';
    if b is null or not exists (select 1 from jsonb_array_elements(b->'options') o where o->>'id' = w->>'optionId') then
      raise exception 'Invalid bet or option';
    end if;
    if exists (select 1 from jsonb_array_elements(clean) c where c->>'betId' = w->>'betId') then
      raise exception 'Only one pick per bet';
    end if;
    clean := clean || jsonb_build_array(jsonb_build_object('betId', w->>'betId', 'optionId', w->>'optionId', 'amount', amt));
    total := total + amt;
  end loop;
  if total > cap then raise exception 'You only have % credits', cap; end if;
  insert into wagers (game_id, player_id, items) values (p_game, p_player, clean)
    on conflict (game_id, player_id) do update set items = excluded.items, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- ---------- admin functions (all need the admin key) ----------

create or replace function admin_state(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin perform _check_admin(p_key); return _state(null, true); end $$;

-- Create (no id) or update a game. Bets come pre-shaped from the admin page.
create or replace function admin_save_game(p_key text, p_game jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare gid text := p_game->>'id'; v_bets jsonb := coalesce(p_game->'bets', '[]');
begin
  perform _check_admin(p_key);
  if jsonb_array_length(v_bets) = 0 then raise exception 'Add at least one bet'; end if;
  if exists (select 1 from jsonb_array_elements(v_bets) b where jsonb_array_length(b->'options') < 2) then
    raise exception 'Every bet needs at least 2 options';
  end if;
  if gid is null then
    insert into games (title, location, starts_at, bets)
      values (left(p_game->>'title', 80), left(coalesce(p_game->>'location', ''), 80), (p_game->>'startsAt')::timestamptz, v_bets)
      returning id into gid;
  else
    update games set title = left(p_game->>'title', 80), location = left(coalesce(p_game->>'location', ''), 80),
      starts_at = (p_game->>'startsAt')::timestamptz, bets = v_bets where id = gid;
    if not found then raise exception 'Game not found'; end if;
    -- drop picks on bets/options that no longer exist
    update wagers set items = coalesce((
      select jsonb_agg(i) from jsonb_array_elements(items) i
      where exists (select 1 from jsonb_array_elements(v_bets) b, jsonb_array_elements(b->'options') o
                    where b->>'id' = i->>'betId' and o->>'id' = i->>'optionId')
    ), '[]') where game_id = gid;
  end if;
  return jsonb_build_object('id', gid);
end $$;

create or replace function admin_delete_game(p_key text, p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin perform _check_admin(p_key); delete from games where id = p_id; return jsonb_build_object('ok', true); end $$;

-- p_results: {betId: optionId | "void" | null}
create or replace function admin_settle(p_key text, p_id text, p_results jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare nb jsonb;
begin
  perform _check_admin(p_key);
  select jsonb_agg(b || jsonb_build_object('result', coalesce(p_results->(b->>'id'), 'null'::jsonb)) order by n)
    into nb from games g, jsonb_array_elements(g.bets) with ordinality as t(b, n) where g.id = p_id;
  if nb is null then raise exception 'Game not found'; end if;
  update games set bets = nb,
    status = case when exists (select 1 from jsonb_array_elements(nb) b where jsonb_typeof(b->'result') is distinct from 'string')
                  then 'closed' else 'settled' end
  where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_reopen(p_key text, p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _check_admin(p_key);
  update games set status = 'open',
    bets = (select jsonb_agg(b || '{"result": null}' order by n) from jsonb_array_elements(bets) with ordinality as t(b, n)) where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_add_player(p_key text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin perform _check_admin(p_key); return add_player(p_name); end $$;

create or replace function admin_rename_player(p_key text, p_id text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _check_admin(p_key);
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Name required'; end if;
  update players set name = left(btrim(p_name), 30) where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_delete_player(p_key text, p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin perform _check_admin(p_key); delete from players where id = p_id; return jsonb_build_object('ok', true); end $$;

-- Only the public entry points are callable from the browser.
revoke execute on function _check_admin(text), _state(text, boolean), _locked(games) from public, anon, authenticated;
grant execute on function get_state(text), add_player(text), save_wagers(text, text, jsonb),
  admin_state(text), admin_save_game(text, jsonb), admin_delete_game(text, text), admin_settle(text, text, jsonb),
  admin_reopen(text, text), admin_add_player(text, text), admin_rename_player(text, text, text), admin_delete_player(text, text)
  to anon;

-- Your admin key (keep it secret): open  <site>/admin.html?key=<this value>
select admin_key as your_admin_key from settings;
