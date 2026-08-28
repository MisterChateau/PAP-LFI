# ✊ PAP-LFI — Porte-à-Porte LFI

Application web de **porte-à-porte** pour les actions militantes de La France Insoumise.

## Problème résolu
Aujourd'hui, le porte-à-porte se fait sur **papier** : chaque équipe note étage, numéro et interaction, puis le créateur de l'action compile tout à la main dans un document.

**PAP-LFI numérise ce processus** : saisie rapide sur téléphone + compilation automatique.

## Fonctionnalités
- 📱 **Saisie mobile ultra-rapide** : gros boutons, peu de champs, pensée pour le terrain
- 🚪 Chaque porte : étage, numéro, immeuble, type d'interaction, notes
- 🔐 **Chiffrement AES-256-GCM** : les données sont chiffrées avec la clé maître, illisibles même si la BDD est volée
- 📊 **Compilation automatique** : tableau + export CSV pour le créateur
- 🕵️ **Anonymat des militants** : pas de compte, pas d'info perso, juste un code d'équipe (hashé)

## Types d'interaction
| Code | Libellé |
|------|---------|
| `pas-reponse` | 📬 Pas de réponse |
| `sympa` | 😊 Sympathique |
| `interesse` | 🤝 Intéressé·e |
| `adherent` | ❤️ Adhérent·e |
| `indecis` | 🗳️ Indécis·e |
| `refus` | 🙅 Refus / hostile |
| `ne-sonne-pas` | ♿ Ne sonne pas |

## Sécurité
- **Chiffrement de bout en bout** : les données sont chiffrées (AES-256-GCM, clé dérivée PBKDF2) avant stockage dans la BDD
- **Clé maître créateur** : seule clé capable de déchiffrer toutes les données
- **Codes d'équipe** : hashés (SHA-256), jamais stockés en clair
- **Même si la base Supabase est compromise, rien n'est exploitable** sans la clé maître

## Techno
- **Back** : Node.js + Express
- **BDD** : **Supabase** (PostgreSQL hébergé, gratuit + persistant)
- **Front** : HTML/JS vanilla, mobile-first (aucun framework lourd)
- **Hébergement** : Render (gratuit)

## Installation locale
```bash
npm install

# Créer un fichier .env avec :
# SUPABASE_URL=https://VOTRE-PROJET.supabase.co
# SUPABASE_ANON_KEY=votre-clé-anon

npm start   # ou : npm run dev
# → http://localhost:3000
```

## Configuration Supabase
1. Créez un projet sur [supabase.com](https://supabase.com) (gratuit)
2. Dans le **SQL Editor**, exécutez le contenu de `supabase_schema.sql`
3. Récupérez dans **Settings → API** : l'URL et la clé `anon public`
4. Configurez ces valeurs en variables d'environnement (`SUPABASE_URL`, `SUPABASE_ANON_KEY`)

## Déploiement Render
1. Connectez votre repo GitHub `MisterChateau/PAP-LFI` sur Render
2. Render détecte `render.yaml` (Blueprint) → déploie `pap-lfi`
3. Dans le Dashboard Render → Service → Environment, ajoutez :
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`

## Utilisation
1. **Créateur** : entre un **nom d'action** → obtient un **lien opaque** `/r/<token>` à partager
2. **Équipes** : ouvrent le lien → arrivent **directement sur la saisie + compilation** (aucun UUID ni clé visible dans l'URL)
3. **Exit** : bouton dans la barre noire pour revenir à l'écran "Créer une action"

> 🔑 **Aucune clé à retenir** : la clé de chiffrement est **générée automatiquement** par le serveur (aléatoire, 64 caractères) et embarquée dans le lien opaque. L'utilisateur ne saisit que le nom de l'action.

## Sécurité du lien
- Le lien opaque `/r/<token>` contient l'UUID + la clé **chiffrés** avec le secret serveur (`APP_SECRET`)
- L'UUID et la clé ne sont **jamais visibles dans l'URL**
- La clé aléatoire est générée par le serveur, elle n'est jamais renvoyée en clair au navigateur (seulement dans le token)
- `APP_SECRET` doit être une longue chaîne aléatoire (voir `.env.example`)
- Les données restent chiffrées AES-256 en BDD même si le serveur est compromis

---
*Fait avec ✊ pour les camarades de terrain.*
