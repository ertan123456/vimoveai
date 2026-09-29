-- ============================================================
-- ViMove AI — complete backend schema (Supabase SQL Editor)
-- Roles: super_admin | uzman (specialist) | hasta (patient)
--
-- This file rebuilds EVERYTHING from an empty project: tables, row-level
-- security, triggers, the session-video bucket and its policies. Safe to
-- re-run on an existing project (everything is if-not-exists / drop-first).
--
-- After running it, in the dashboard:
--   Authentication -> Providers -> enable Google (client id + secret)
--   Authentication -> URL Configuration -> add https://vimoveai.com
-- ============================================================

-- ---------- profiles: one row per auth user, carries the role ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          text not null default 'hasta' check (role in ('super_admin','uzman','hasta')),
  full_name     text,
  title         text,                        -- uzman ünvanı (ör. "Fizyoterapist") veya hasta notu
  specialist_id uuid references public.profiles(id) on delete set null,  -- hasta -> bağlı uzman
  username      text,                        -- hasta girişi (e-postası olmayan yaşlı kullanıcılar)
  created_at    timestamptz not null default now()
);
-- for projects created before the column existed
alter table public.profiles add column if not exists username text;
alter table public.profiles enable row level security;

-- helper: current user's role without recursive RLS
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- auto-create a profile when someone signs up (default role = hasta)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- backfill: create profile rows for anyone who signed up BEFORE this trigger existed
insert into public.profiles (id, full_name)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')
from auth.users u
on conflict (id) do nothing;

-- stop non-admins from changing their own role (no self-promotion)
create or replace function public.prevent_role_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and public.my_role() <> 'super_admin' then
    new.role := old.role;
  end if;
  return new;
end; $$;
drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles for each row execute function public.prevent_role_change();

-- profiles RLS
drop policy if exists profiles_select_own      on public.profiles;
drop policy if exists profiles_select_patients on public.profiles;
drop policy if exists profiles_select_admin    on public.profiles;
drop policy if exists profiles_update_own       on public.profiles;
create policy profiles_select_own      on public.profiles for select using (id = auth.uid());
create policy profiles_select_patients on public.profiles for select using (specialist_id = auth.uid());
create policy profiles_select_admin    on public.profiles for select using (public.my_role() = 'super_admin');
create policy profiles_update_own      on public.profiles for update using (id = auth.uid());

-- ---------- prescriptions: a specialist assigns a program to a patient ----------
create table if not exists public.prescriptions (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.profiles(id) on delete cascade,
  specialist_id uuid not null references public.profiles(id) on delete cascade,
  title         text,
  program       jsonb not null,              -- [{kind, side, hedef, ad}, ...]
  note          text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table public.prescriptions enable row level security;
drop policy if exists presc_patient_select   on public.prescriptions;
drop policy if exists presc_specialist_all    on public.prescriptions;
drop policy if exists presc_admin_select       on public.prescriptions;
create policy presc_patient_select  on public.prescriptions for select using (patient_id = auth.uid());
create policy presc_specialist_all  on public.prescriptions for all
  using (specialist_id = auth.uid()) with check (specialist_id = auth.uid());
create policy presc_admin_select    on public.prescriptions for select using (public.my_role() = 'super_admin');

-- ---------- messages: specialist <-> patient ----------
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body         text not null,
  read         boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table public.messages enable row level security;
drop policy if exists msg_participant_select on public.messages;
drop policy if exists msg_send                on public.messages;
drop policy if exists msg_mark_read           on public.messages;
create policy msg_participant_select on public.messages for select
  using (sender_id = auth.uid() or recipient_id = auth.uid());
create policy msg_send      on public.messages for insert with check (sender_id = auth.uid());
create policy msg_mark_read on public.messages for update using (recipient_id = auth.uid());

-- ---------- sessions: one row per finished exercise session ----------
create table if not exists public.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  data       jsonb not null,                 -- skorlar, egzersiz kırılımı, AI notu, video yolu
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_created_idx
  on public.sessions (user_id, created_at desc);
alter table public.sessions enable row level security;

drop policy if exists sessions_select_own on public.sessions;
drop policy if exists sessions_insert_own on public.sessions;
drop policy if exists sessions_delete_own on public.sessions;
create policy sessions_select_own on public.sessions for select using (user_id = auth.uid());
create policy sessions_insert_own on public.sessions for insert with check (user_id = auth.uid());
create policy sessions_delete_own on public.sessions for delete using (user_id = auth.uid());

-- ---------- let a specialist read their patients' exercise sessions ----------
drop policy if exists sessions_specialist_select on public.sessions;
create policy sessions_specialist_select on public.sessions for select
  using (exists (select 1 from public.profiles p
                 where p.id = sessions.user_id and p.specialist_id = auth.uid()));

-- ============================================================
-- AFTER first login, make yourselves super_admin (edit emails if needed):
-- ============================================================
-- update public.profiles set role = 'super_admin'
--   where id in (select id from auth.users
--                where email in ('erdemertan08@gmail.com','oguzcetinkaya1903@gmail.com'));


-- ============================================================
-- Session videos (Storage)
-- Private bucket; a patient reads/writes only their own folder, and their
-- own specialist may read it. Nobody else, not even another specialist.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('session-videos', 'session-videos', false)
on conflict (id) do nothing;

drop policy if exists "vimove patient rw own videos" on storage.objects;
create policy "vimove patient rw own videos" on storage.objects for all
  using      (bucket_id = 'session-videos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'session-videos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "vimove specialist reads patient videos" on storage.objects;
create policy "vimove specialist reads patient videos" on storage.objects for select
  using (bucket_id = 'session-videos' and exists (
    select 1 from public.profiles p
    where p.id::text = (storage.foldername(name))[1]
      and p.specialist_id = auth.uid()));
