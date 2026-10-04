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
  -- Clé maître scellée (chiffrée avec APP_SECRET). Permet au serveur de déchiffrer
  -- les résultats pour un ANIMATEUR/GA légitime sans lui transmettre la clé maître.
  -- NULL pour les actions créées avant la migration 002 (rétro-compat).
  master_key_encrypted text,
  -- Clé ANIMATEUR (hash SHA-256) : déverrouille la vue détail/export.
  -- NULL = action créée avant la migration 001 (rétro-compat : clé maître = contrôle total).
  animator_key_hash text,
  created_at timestamptz not null default now()
);

-- Table des portes visitées (données chiffrées côté application)
create table if not exists public.doors (
  id bigint generated always as identity primary key,
  action_id uuid not null references public.actions(id) on delete cascade,
  team text,
  building text,
  floor text,
  door_number text,
  interaction text,
  details text,
  created_at timestamptz not null default now()
);

-- Index pour accélérer les requêtes par action
create index if not exists idx_doors_action on public.doors(action_id);

-- Index pour retrouver une action par sa clé animateur (rôle animateur, cf. migrations/001)
create index if not exists idx_actions_animator_key_hash on public.actions(animator_key_hash);

-- Sécurité : RLS activée mais AUCUNE policy d'accès public.
-- Le serveur utilise la clé service_role (contourne la RLS).
-- La clé anon (publique) ne peut plus lire/écrire/supprimer quoi que ce soit :
-- si elle fuit, elle ne donne accès à rien.
alter table public.actions enable row level security;
alter table public.doors enable row level security;

-- (Aucune policy "allow anon" : accès réservé au service_role via le serveur)
