-- PAP-LFI — Migration : rôle ANIMATEUR (séparation participants / animateurs)
-- À exécuter dans le SQL Editor de Supabase (Dashboard → SQL Editor → New query)
--
-- Objectif : permettre à un ANIMATEUR de voir le détail complet des résultats,
-- tandis que les PARTICIPANTS (lien de saisie) ne voient que les agrégats.
--
-- Approche : on ajoute une colonne `animator_key_hash` à la table `actions`.
--   - `master_key_hash`   = clé PARTICIPANT (chiffre les données + accès saisie)
--   - `animator_key_hash` = clé ANIMATEUR  (déverrouille la vue détail/export)
--
-- ⚠️ Migration NON destructive : aucune donnée existante n'est touchée.
--    Les actions existantes auront `animator_key_hash = NULL` → rétro-compatibilité :
--    sans clé animateur, on retombe sur l'ancien comportement (clé maître = contrôle total).
--
-- Rollback (si besoin, plus tard) :
--   alter table public.actions drop column if exists animator_key_hash;

-- 1) Ajouter la colonne (idempotent)
alter table public.actions
  add column if not exists animator_key_hash text;

-- 2) Index (utile pour retrouver une action par sa clé animateur, optionnel)
create index if not exists idx_actions_animator_key_hash
  on public.actions(animator_key_hash);

-- 3) Documentation de la colonne
comment on column public.actions.animator_key_hash is
  'Hash de la clé ANIMATEUR (SHA-256 côté serveur). Permet l''accès à la vue détail/export. NULL pour les actions créées avant cette migration.';

-- Vérification :
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_name = 'actions' order by ordinal_position;
