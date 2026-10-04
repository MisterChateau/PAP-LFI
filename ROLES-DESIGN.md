# Rôles & liens — design (vague 2, nuit du 04/10/2026)

> Document rédigé par Lenina pendant que Chapi dormait. **À valider au réveil.**

## 🎭 Les 3 rôles

| Rôle | Lien | Peut faire | Ne peut PAS |
|------|------|-----------|-------------|
| **Participant** (militant) | `/r/<token>` | Saisir les portes (chiffrées) | Voir les résultats détaillés |
| **Animateur** | `/a/<token>` | Voir les résultats détaillés + stats | Créer d'autres actions |
| **GA** (groupe d'action) | `/g/<token>` | Voir résultats + vue agrégée multi-actions | — |

## 🔑 Le problème du déchiffrement (et sa solution)

**Avant** : pour déchiffrer les résultats, il fallait la **clé maître**. Or on ne
veut PAS la donner aux animateurs.

**Solution retenue (migration 002)** : la clé maître est stockée en BDD **sous
forme scellée** (chiffrée avec `APP_SECRET`, un secret serveur). Ainsi :
- Le serveur peut déchiffrer les données **pour un animateur authentifié**.
- L'animateur n'a **jamais** la clé maître.
- Si la BDD fuit, les clés scellées restent illisibles (il faut `APP_SECRET`).

**Rétro-compat** : les actions créées avant la migration 002 ont
`master_key_encrypted = NULL` → seules la clé maître (créateur) permet l'export
détail. Les nouvelles actions fonctionnent avec les 3 rôles.

## 🛣️ Routes

- `GET  /api/link/:token` → `{ actionId, key, role }` (role ∈ participant/animator/ga)
- `POST /api/actions/:id/export` → accepte `masterKey` | `animatorKey` | `token`
- `POST /api/actions/:id/summary` → agrégats (déjà en place)

## ⚠️ Points à valider par Chapi

1. **Le lien GA (`/g/`) doit-il voir PLUSIEURS actions ?** Aujourd'hui il voit UNE
   action (comme l'animateur). Pour un vrai rôle GA « multi-actions », il faudrait
   un lien qui liste les actions d'un groupe — **pas encore implémenté** (attend
   la décision de Chapi).
2. **Faut-il un mot de passe/PIN** en plus du lien, pour l'animateur/GA ?
3. **`ALLOWED_USER_IDS` du bot** : à garder restreint.

## 🚧 Statut

- [x] Migration `002_master_key_encrypted.sql` écrite (**à exécuter dans Supabase**)
- [x] `crypto.js` : `sealMasterKey` / `unsealMasterKey`
- [x] `server.js` : création scelle la clé + renvoie `animatorToken` ET `gaToken`
- [x] `server.js` : export accepte clé OU token (déchiffrement serveur)
- [x] `link.js` : rôle `ga`
- [ ] Front : rôles dans l'interface (masquer « Résultats » au participant)
- [ ] Bot : afficher les liens animateur + GA
- [ ] Tests bout-en-bout
