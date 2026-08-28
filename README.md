# ✊ PAP-LFI — Porte-à-Porte LFI

Application web de **porte-à-porte** pour les actions militantes de La France Insoumise.

## Problème résolu
Aujourd'hui, le porte-à-porte se fait sur **papier** : chaque équipe note étage, numéro et interaction, puis le créateur de l'action compile tout à la main dans un document.

**PAP-LFI numérise ce processus** : saisie rapide sur téléphone + compilation automatique.

## Fonctionnalités
- 📱 **Saisie mobile ultra-rapide** : gros boutons, peu de champs, pensée pour le terrain
- 🚪 Chaque porte : étage, numéro, immeuble, type d'interaction, notes
- 🔐 **Chiffrement AES-256-GCM** : les données sont chiffrées avec le code d'équipe, la clé maître du créateur peut tout déchiffrer
- 📊 **Compilation automatique** : tableau + export CSV pour le créateur
- 🕵️ **Anonymat des militants** : pas de compte, pas d'info perso, juste un code d'équipe

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
- **Chiffrement de bout en bout** : les données stockées dans la BDD sont illisibles sans la clé
- **Clé maître créateur** : dérive une clé AES-256 via PBKDF2 (100 000 itérations)
- **Codes d'équipe** : hashés (SHA-256), jamais stockés en clair
- **Même si la base est volée, rien n'est exploitable** sans les clés

## Techno
- **Back** : Node.js + Express
- **BDD** : SQLite (better-sqlite3) — aucun service externe, gratuit
- **Front** : HTML/JS vanilla, mobile-first (aucun framework lourd)

## Installation locale
```bash
npm install
npm start
# → http://localhost:3000
```

## Utilisation
1. **Créateur** : entre un nom d'action + crée une **clé maître** + un code équipe → obtient un lien à partager
2. **Équipes** : ouvrent le lien, entrent leur **code d'équipe**, et saisissent les portes
3. **Créateur** : avec sa clé maître, consulte la compilation et exporte en CSV

## Déploiement
Déployable gratuitement sur **Render**, **Railway**, ou **Fly.io** (un seul service Node).

---
*Fait avec ✊ pour les camarades de terrain.*
