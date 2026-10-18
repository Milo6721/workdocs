-- =====================================================================
-- Work Docs — schemat Supabase (konta, tablice, udostępnianie, live)
-- Uruchom raz: Supabase → SQL Editor → New query → wklej całość → Run.
--
-- WSZYSTKIE obiekty mają sufiks _workdocs, żeby nie kolidować z innymi
-- projektami w tym samym Supabase. Skrypt jest idempotentny (można go
-- uruchomić ponownie) i nie zmienia ani nie usuwa niczego, co nie ma
-- sufiksu _workdocs.
-- =====================================================================

-- ---------- tabele ----------
create table if not exists public.boards_workdocs (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default 'Tablica',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.board_members_workdocs (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards_workdocs(id) on delete cascade,
  email       text not null,
  role        text not null default 'edit' check (role in ('edit','view')),
  invited_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint board_members_workdocs_uniq unique (board_id, email)
);
create index if not exists board_members_workdocs_email_idx on public.board_members_workdocs (email);

create table if not exists public.board_elements_workdocs (
  board_id    uuid not null references public.boards_workdocs(id) on delete cascade,
  id          text not null,
  data        jsonb not null,
  z           double precision not null default 0,
  ts          bigint not null default 0,
  updated_by  uuid default auth.uid(),
  primary key (board_id, id)
);

create table if not exists public.board_images_workdocs (
  board_id    uuid not null references public.boards_workdocs(id) on delete cascade,
  key         text not null,
  data        text not null,
  primary key (board_id, key)
);

-- ---------- funkcje pomocnicze ----------
create or replace function public.jwt_email_workdocs()
returns text language sql stable
as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_owner_workdocs(b uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.boards_workdocs where id = b and owner_id = auth.uid()) $$;

create or replace function public.can_view_workdocs(b uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.boards_workdocs where id = b and owner_id = auth.uid())
      or exists (select 1 from public.board_members_workdocs
                 where board_id = b and email = public.jwt_email_workdocs())
$$;

create or replace function public.can_edit_workdocs(b uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.boards_workdocs where id = b and owner_id = auth.uid())
      or exists (select 1 from public.board_members_workdocs
                 where board_id = b and role = 'edit' and email = public.jwt_email_workdocs())
$$;

revoke all on function public.is_owner_workdocs(uuid), public.can_view_workdocs(uuid), public.can_edit_workdocs(uuid) from public, anon;
grant execute on function public.jwt_email_workdocs(), public.is_owner_workdocs(uuid), public.can_view_workdocs(uuid), public.can_edit_workdocs(uuid) to authenticated;

-- e-maile zawsze małymi literami
create or replace function public.members_lower_email_workdocs()
returns trigger language plpgsql
as $$ begin new.email := lower(btrim(new.email)); return new; end $$;

drop trigger if exists members_lower_email_trg_workdocs on public.board_members_workdocs;
create trigger members_lower_email_trg_workdocs
  before insert or update on public.board_members_workdocs
  for each row execute function public.members_lower_email_workdocs();

-- aktualizacja daty ostatniej zmiany tablicy
create or replace function public.touch_board_workdocs()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.boards_workdocs set updated_at = now()
   where id = coalesce(new.board_id, old.board_id);
  return null;
end $$;

drop trigger if exists elements_touch_trg_workdocs on public.board_elements_workdocs;
create trigger elements_touch_trg_workdocs
  after insert or update or delete on public.board_elements_workdocs
  for each row execute function public.touch_board_workdocs();

-- ---------- RLS ----------
alter table public.boards_workdocs          enable row level security;
alter table public.board_members_workdocs   enable row level security;
alter table public.board_elements_workdocs  enable row level security;
alter table public.board_images_workdocs    enable row level security;

-- tablice
drop policy if exists "boards_select_workdocs" on public.boards_workdocs;
-- UWAGA: warunek właściciela jest sprawdzany bezpośrednio (nie tylko przez funkcję). Przy
-- INSERT ... RETURNING funkcja stable nie widzi jeszcze wstawianego wiersza i baza zgłaszałaby
-- błąd „new row violates row-level security policy".
create policy "boards_select_workdocs" on public.boards_workdocs
  for select to authenticated using (owner_id = auth.uid() or public.can_view_workdocs(id));

drop policy if exists "boards_insert_workdocs" on public.boards_workdocs;
create policy "boards_insert_workdocs" on public.boards_workdocs
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "boards_update_workdocs" on public.boards_workdocs;
create policy "boards_update_workdocs" on public.boards_workdocs
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "boards_delete_workdocs" on public.boards_workdocs;
create policy "boards_delete_workdocs" on public.boards_workdocs
  for delete to authenticated using (owner_id = auth.uid());

-- członkowie (udostępnianie)
drop policy if exists "members_select_workdocs" on public.board_members_workdocs;
create policy "members_select_workdocs" on public.board_members_workdocs
  for select to authenticated
  using (public.is_owner_workdocs(board_id) or email = public.jwt_email_workdocs());

drop policy if exists "members_insert_workdocs" on public.board_members_workdocs;
create policy "members_insert_workdocs" on public.board_members_workdocs
  for insert to authenticated with check (public.is_owner_workdocs(board_id));

drop policy if exists "members_update_workdocs" on public.board_members_workdocs;
create policy "members_update_workdocs" on public.board_members_workdocs
  for update to authenticated
  using (public.is_owner_workdocs(board_id)) with check (public.is_owner_workdocs(board_id));

drop policy if exists "members_delete_workdocs" on public.board_members_workdocs;
create policy "members_delete_workdocs" on public.board_members_workdocs
  for delete to authenticated
  using (public.is_owner_workdocs(board_id) or email = public.jwt_email_workdocs());

-- elementy tablicy
drop policy if exists "elements_select_workdocs" on public.board_elements_workdocs;
create policy "elements_select_workdocs" on public.board_elements_workdocs
  for select to authenticated using (public.can_view_workdocs(board_id));

drop policy if exists "elements_insert_workdocs" on public.board_elements_workdocs;
create policy "elements_insert_workdocs" on public.board_elements_workdocs
  for insert to authenticated with check (public.can_edit_workdocs(board_id));

drop policy if exists "elements_update_workdocs" on public.board_elements_workdocs;
create policy "elements_update_workdocs" on public.board_elements_workdocs
  for update to authenticated
  using (public.can_edit_workdocs(board_id)) with check (public.can_edit_workdocs(board_id));

drop policy if exists "elements_delete_workdocs" on public.board_elements_workdocs;
create policy "elements_delete_workdocs" on public.board_elements_workdocs
  for delete to authenticated using (public.can_edit_workdocs(board_id));

-- obrazy
drop policy if exists "images_select_workdocs" on public.board_images_workdocs;
create policy "images_select_workdocs" on public.board_images_workdocs
  for select to authenticated using (public.can_view_workdocs(board_id));

drop policy if exists "images_insert_workdocs" on public.board_images_workdocs;
create policy "images_insert_workdocs" on public.board_images_workdocs
  for insert to authenticated with check (public.can_edit_workdocs(board_id));

-- ---------- Realtime: zmiany w bazie ----------
do $$
declare t text;
begin
  foreach t in array array['board_elements_workdocs', 'boards_workdocs'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- Realtime: prywatne kanały (kursory, podgląd na żywo, obecność) ----------
-- Temat kanału: board_<uuid tablicy>_workdocs
-- Odbiór i obecność: każdy, kto może zobaczyć tablicę. Wysyłanie zmian: tylko edytorzy.
drop policy if exists "realtime_read_workdocs" on realtime.messages;
create policy "realtime_read_workdocs" on realtime.messages
  for select to authenticated
  using (
    case when realtime.topic() ~ '^board_[0-9a-f-]{36}_workdocs$'
         then public.can_view_workdocs(substring(realtime.topic() from 7 for 36)::uuid)
         else false end
  );

drop policy if exists "realtime_write_broadcast_workdocs" on realtime.messages;
create policy "realtime_write_broadcast_workdocs" on realtime.messages
  for insert to authenticated
  with check (
    extension = 'broadcast'
    and case when realtime.topic() ~ '^board_[0-9a-f-]{36}_workdocs$'
             then public.can_edit_workdocs(substring(realtime.topic() from 7 for 36)::uuid)
             else false end
  );

drop policy if exists "realtime_write_presence_workdocs" on realtime.messages;
create policy "realtime_write_presence_workdocs" on realtime.messages
  for insert to authenticated
  with check (
    extension = 'presence'
    and case when realtime.topic() ~ '^board_[0-9a-f-]{36}_workdocs$'
             then public.can_view_workdocs(substring(realtime.topic() from 7 for 36)::uuid)
             else false end
  );

-- =====================================================================
-- PREMIUM I PŁATNOŚCI (Przelewy24)  — uruchom w Supabase → SQL Editor (bezpieczne do powtórzenia)
-- Zapis do tych tabel robi wyłącznie serwer (funkcje api/p24_*.js kluczem service_role, który omija RLS).
-- Aplikacja może tylko ODCZYTAĆ własny wiersz Premium.
-- =====================================================================
create table if not exists public.premium_workdocs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'premium',
  since timestamptz not null default now(),
  last_order_id text
);
alter table public.premium_workdocs enable row level security;
drop policy if exists premium_select_own_workdocs on public.premium_workdocs;
create policy premium_select_own_workdocs on public.premium_workdocs
  for select to authenticated using (user_id = auth.uid());

create table if not exists public.payments_workdocs (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  amount integer not null,              -- w groszach (1000 = 10 zł)
  currency text not null default 'PLN',
  status text not null default 'pending', -- pending | paid | failed
  p24_order_id bigint,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists payments_workdocs_user_idx on public.payments_workdocs(user_id);
alter table public.payments_workdocs enable row level security;
drop policy if exists payments_select_own_workdocs on public.payments_workdocs;
create policy payments_select_own_workdocs on public.payments_workdocs
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Premium jest MIESIĘCZNE: premium_until = do kiedy ważne. Kolejna płatność przedłuża o 30 dni.
-- (bezpieczne do powtórzenia)
-- ---------------------------------------------------------------------
alter table public.premium_workdocs add column if not exists premium_until timestamptz;
update public.premium_workdocs set premium_until = since + interval '30 days' where premium_until is null;