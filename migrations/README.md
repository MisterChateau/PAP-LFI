# 🔄 Migrations PAP-LFI

Exécuter dans l'ordre dans le **SQL Editor Supabase** (Dashboard → SQL Editor → New query).

| # | Fichier | Objet | Destructif |
|---|---------|-------|-----------|
| 001 | `001_add_animator_key.sql` | Ajoute `actions.animator_key_hash` (rôle animateur) | ❌ non |

## 001 — Rôle animateur

Ajoute une colonne `animator_key_hash` à la table `actions` :
- `master_key_hash` = clé **participant** (chiffre les données + accès à la saisie)
- `animator_key_hash` = clé **animateur** (déverrouille la vue détail/export)

**Non destructive** : aucune donnée touchée. Les actions existantes ont
`animator_key_hash = NULL` → rétro-compatibilité (clé maître = contrôle total).

**Rollback :**
```sql
alter table public.actions drop column if exists animator_key_hash;
```

## Conventions

- Un fichier = une migration, numérotée `NNN_description.sql`.
- Chaque migration doit être **idempotente** (`if not exists`) quand c'est possible.
- Documenter le rollback en commentaire dans le fichier.
- Mettre à jour `supabase_schema.sql` (schéma « from scratch ») en parallèle.
