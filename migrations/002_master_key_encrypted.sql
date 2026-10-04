-- Migration 002 : stockage de la clé maître CHIFFRÉE (pour le rôle ANIMATEUR)
--
-- Contexte : le rôle animateur déverrouille la vue « résultats détaillés ».
-- Or, déchiffrer les données nécessite la clé maître. Jusqu'ici elle n'était
-- stockée que SOUS FORME DE HASH → impossible de déchiffrer côté serveur sans
-- que l'animateur connaisse la clé maître.
--
-- Solution : stocker EN PLUS une copie de la clé maître chiffrée avec un secret
-- serveur (APP_SECRET). Le serveur peut ainsi déchiffrer les données pour un
-- ANIMATEUR authentifié, sans jamais exposer la clé maître aux clients.
--
-- ⚠️ NON DESTRUCTIF : ajoute une colonne nullable. Les actions existantes
-- (master_key_encrypted = NULL) continuent de fonctionner en rétro-compat :
-- seules la clé maître (créateur) permet alors l'export détaillé.

alter table public.actions
  add column if not exists master_key_encrypted text;

comment on column public.actions.master_key_encrypted is
  'Clé maître chiffrée avec APP_SECRET (secret serveur). Permet au serveur de déchiffrer les données pour un animateur légitime, sans exposer la clé maître. NULL pour les actions créées avant la migration 002 (rétro-compat : export détaillé réservé au créateur).';
