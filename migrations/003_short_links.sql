-- Migration 003 : liens COURTS (short links)
--
-- Pourquoi : les tokens opaques (250+ caractères) sont coupés par Telegram/SMS
-- et le copier-coller → liens morts. On stocke un code court unique par lien.
--
-- Table `short_links` :
--   code        : 10 caractères (a-zA-Z0-9), unique, INDEXÉ
--   action_id   : l'action visée
--   role        : 'participant' | 'animator' | 'ga'
--   expires_at  : aligné sur la rétention (30 j)
--
-- ⚠️ La clé maître reste dans `actions.master_key_encrypted` (scellée APP_SECRET).
-- Le serveur renvoie la clé au PARTICIPANT (qui en a besoin pour chiffrer) et
-- déchiffre lui-même pour l'ANIMATEUR/GA. Modèle : serveur de confiance, BDD non.

create table if not exists public.short_links (
  code       text primary key,
  action_id  uuid not null references public.actions(id) on delete cascade,
  role       text not null default 'participant',
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists idx_short_links_action on public.short_links(action_id);
create index if not exists idx_short_links_expires on public.short_links(expires_at);

-- 🔒 Sécurité : RLS activée SANS aucune policy → accès réservé au service_role
-- (le serveur), comme pour actions/doors. L'anon/authenticated ne peut rien lire.
alter table public.short_links enable row level security;
