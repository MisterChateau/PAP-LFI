-- PAP-LFI — Schéma Supabase (v2 avec UUID pour les actions)
-- À exécuter dans le SQL Editor de Supabase (Dashboard → SQL Editor → New query)
-- ⚠️ Ce schéma est destructif : il recrée les tables. À n'exécuter que si vous n'avez
--    pas encore de données importantes, ou après export.

-- Supprimer l'ancienne version (si elle existe)
drop table if exists public.doors;
drop table if exists public.actions;

-- Table des actions (campagnes) — id est un UUID
create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  master_key_hash text not null,
  created_at timestamptz not null default now()
);

-- Table des portes visitées (données chiffrées côté application)
create table if not exists public.doors (
  id bigint generated always as identity primary key,
  action_id uuid not null references public.actions(id) on delete cascade,
  team_hash text,
  building text,
  floor text,
  door_number text,
  interaction text,
  details text,
  created_at timestamptz not null default now()
);

-- Index pour accélérer les requêtes par action
create index if not exists idx_doors_action on public.doors(action_id);

-- Sécurité : accès anonyme en lecture/écriture (les données sont chiffrées)
alter table public.actions enable row level security;
alter table public.doors enable row level security;

create policy "allow anon actions" on public.actions for all using (true) with check (true);
create policy "allow anon doors" on public.doors for all using (true) with check (true);
