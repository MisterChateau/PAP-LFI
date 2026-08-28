-- PAP-LFI — Schéma Supabase
-- À exécuter dans le SQL Editor de Supabase (Dashboard → SQL Editor → New query)

-- Table des actions (campagnes de porte-à-porte)
create table if not exists public.actions (
  id bigint generated always as identity primary key,
  name text not null,
  master_key_hash text not null,
  created_at timestamptz not null default now()
);

-- Table des portes visitées (données chiffrées côté application)
create table if not exists public.doors (
  id bigint generated always as identity primary key,
  action_id bigint not null references public.actions(id) on delete cascade,
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

-- Sécurité : on permet l'accès anonyme en lecture/écriture (l'app n'a pas de comptes)
-- car les données sont chiffrées de bout en bout, la BDD elle-même ne contient que du chiffré.
alter table public.actions enable row level security;
alter table public.doors enable row level security;

create policy "allow anon actions" on public.actions for all using (true) with check (true);
create policy "allow anon doors" on public.doors for all using (true) with check (true);
