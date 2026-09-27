# 🔍 AUDIT RGPD — PAP-LFI

**Date** : 19 septembre 2026
**Périmètre audité** : application PAP-LFI (`~/workspace/PAP-LFI`) — commit `ca8e2d1`
**Auditeur** : Lenina (assistante OpenClaw)
**Nature du traitement** : collecte de données de porte-à-porte militant — **données d'opinion politique** (art. 9 RGPD, catégorie particulière) + données de localisation.

---

## ⚠️ AVERTISSEMENT LIMINAIRE

Cet audit est une **analyse technique et méthodologique** des conformités détectables dans le code. Il **ne constitue pas un avis juridique**. Pour une validation opposable (notamment vis-à-vis de la CNIL), faire relire par un juriste ou le référent RGPD du parti.

**Point d'attention majeur dès l'entrée** : la combinaison *opinion politique* + *adresse précise* + *interaction nominative* place ce traitement dans le régime le **plus sensible du RGPD**. Une base légale solide est **obligatoire** — le consentement ou l'intérêt légitime ne "suffisent" pas en soi pour des données art. 9.

---

## 1. BASE LÉGALE — 🔴 CRITIQUE

| Élément | Constat |
|---|---|
| Base légale documentée | ❌ **Aucune** — rien dans le code, le README ou le schéma |
| Fondement probable | Intérêt légitime (art. 6.1.f) — **insuffisant seul** pour des données art. 9 |
| Exception art. 9.2 applicable | Non documentée. Pistes : 9.2.e (données rendues publiques par la personne — **non**), 9.2.a (consentement explicite — **non recueilli**), 9.2.d (association à but politique/syndical — **PLAUSIBLE, c'est la seule voie crédible**) |
| Code d'équipe | Stocké chiffré mais **chaque militant pourrait être identifié indirectement** (horaires de saisie, `created_at`) → ne garantit pas l'anonymat |

**Recommandation** :
- S'appuyer **explicitement** sur l'exception **art. 9.2.d** (traitement nécessaire à l'exercice d'activités légitimes d'une association à but politique) **combinée** à art. 6.1.f (intérêt légitime) — c'est la voie standard pour un parti.
- Le **documenter** dans un registre de traitement (même une page).
- Vérifier que les **garanties** de l'art. 9.2.d sont bien en place (données non transmises hors association, pas de diffusion).

---

## 2. PRINCIPES FONDAMENTAUX

### 2.1 Minimisation (art. 5.1.c) — 🟠 À CORRIGER
- Champs collectés : immeuble, étage, n° de porte, interaction, **détails libres (1000 car.)**.
- Le champ `details` libre est un **risque majeur** : rien n'empêche un militant d'y écrire « M. Dupont, retraité, ancien CGT, sa femme est malade ». C'est de la collecte non minimisée.
- **Reco :** avertissement dans l'UI ("Ne notez aucune donnée personnelle identifiante : pas de nom, pas de situation personnelle"), et/ou guidance dans le champ.

### 2.2 Limitation de la finalité (art. 5.1.b) — 🟡 OK (à formaliser)
- Le traitement est clairement à finalité électorale/militante. Mais **aucune finalité écrite** n'est portée dans l'app.
- **Reco :** afficher la finalité dans l'app (« Ces données servent uniquement à la compilation de cette campagne de terrain »).

### 2.3 Limitation de conservation (art. 5.1.e) — 🟢 BON
- ✅ Purge automatique à **30 jours** (`RETENTION_DAYS = 30`), au démarrage + toutes les 24 h.
- ✅ Purge manuelle (droit à l'effacement) avec double confirmation.
- ⚠️ **Faiblesse** : la purge se base sur `actions.created_at`, **pas sur la dernière activité**. Une action active depuis 29 jours sera purgée en pleine campagne → perte de données militantes. À l'inverse, si on corrige en "dernière porte", la durée peut s'étirer indéfiniment.
- **Reco :** purger sur `MAX(doors.created_at)` (dernière activité réelle) plutôt que la création, avec un **plafond dur** absolu (ex. 90 j).

### 2.4 Exactitude (art. 5.1.d) — 🟢 OK
- Données saisies manuellement, pas de croisement automatique de sources. Correct.

### 2.5 Intégrité & confidentialité (art. 5.1.f) — 🟢 TRÈS BON
- ✅ AES-256-GCM sur toutes les données sensibles.
- ✅ Clé maître jamais stockée en clair (seul le **hash SHA-256** en BDD).
- ✅ RLS activée sans policy publique (service_role uniquement).
- ✅ Helmet, rate limiting, `Referrer-Policy: no-referrer`.
- ✅ Token opaque avec expiration (30 j).
- ✅ Clé jamais dans l'URL (`history.replaceState`).
- Voir section 5 pour les réserves.

---

## 3. DONNÉES PERSONNELLES — CARTOGRAPHIE

| Donnée | Table/champ | Sensibilité | Chiffrée ? |
|---|---|---|---|
| Nom de l'action | `actions.name` | Faible | ✅ |
| Clé maître | (jamais stockée) | — | hash seul |
| Code équipe | `doors.team` | Moyenne (pseudonyme) | ✅ |
| Immeuble / adresse | `doors.building` | **Élevée** (localisation) | ✅ |
| Étage / n° porte | `doors.floor`, `door_number` | **Élevée** | ✅ |
| Interaction | `doors.interaction` | **Très élevée** (opinion politique) | ✅ |
| Détails libres | `doors.details` | **Très élevée** | ✅ |
| Horodatage | `doors.created_at` | Moyenne (traçabilité militant) | ❌ **en clair** |
| IP | (logs Render) | Moyenne | ❌ **en clair, non documenté** |

### 🔴 Points d'alerte :
1. **`created_at` en clair** : couplé à un code d'équipe chiffré mais à un seul militant sur le terrain, il peut **désanonymiser un militant** (qui a tracté quand, dans quel immeuble). Données de militant = données personnelles.
2. **Logs IP Render** : non mentionnés dans le README. Les IP sont des données personnelles (CJUE *Breyer*). **Rétention inconnue**, probablement 7-30 j par défaut Render. À documenter + réduire.
3. **Aucun registre des traitements** : obligatoire (art. 30) même pour une association.

---

## 4. DROITS DES PERSONNES (art. 12-22) — 🔴 CRITIQUE

Le traitement concerne **des électeurs qui n'ont rien demandé** (les personnes visitées). Or :

| Droit | État |
|---|---|
| Information (art. 13) | ❌ **AUCUNE** information sur place : pas de mention, pas de flyer RGPD, pas de QR code, rien |
| Accès (art. 15) | ❌ Impossible — comment un visiteur ferait-il une demande ? |
| Effacement (art. 17) | 🟡 Existant **techniquement** (bouton purge) mais **pas actionnable par la personne concernée** |
| Opposition (art. 21) | ❌ Rien |
| Rectification (art. 16) | ❌ Rien |

**C'est LE point noir de cet audit.**

**Recommandation impérative** : produire une **mention d'information terrain** (flyer/carte au format poche) remise lors du porte-à-porte, contenant :
- Identité du responsable de traitement (le parti / la structure LFI locale avec adresse).
- Finalité : « constitution de fichiers à usage militant, porte-à-porte ».
- Catégories de données : adresse, interaction, notes.
- Durée : 30 jours.
- Droits : accès, rectification, effacement, opposition — **avec un contact** (email/adresse DPO ou référent).
- Voie de recours CNIL.
- **Base légale** invoquée.

Sans ça, la collecte est **opposable en nullité** et expose à une plainte CNIL directe.

---

## 5. SÉCURITÉ — ANALYSE DÉTAILLÉE

### 🟢 Points forts
- AES-256-GCM, IV aléatoire par enregistrement, tag d'authentification vérifié → **intégrité garantie**.
- HKDF (et non PBKDF2) : choix **pertinent** car clé aléatoire 256 bits (pas un mot de passe) ; commentaire de code correct et bien argumenté.
- Vérification de clé à **temps constant** (`timingSafeEqual`) → anti side-channel.
- Anti-écriture non authentifiée : une clé invalide est rejetée (403) avant insertion.
- Export en POST (clé jamais en query string) → pas de fuite via logs/historique.
- Front : échappement systématique (`esc()`) + CSP + sanitisation serveur → XSS maîtrisé.

### 🟠 Faiblesses
1. **Fallback `SUPABASE_ANON_KEY`** dans `db.js` : si `SERVICE_ROLE_KEY` manque, le serveur retombe **silencieusement** (un `console.warn` perdu dans les logs) sur la clé anon. Combiné à la RLS sans policy → ça casse ou, selon config, expose. **Reco : supprimer ce fallback**, faire échouer le démarrage (`process.exit(1)`).
2. **CSP `unsafe-inline`** : nécessaire vu le front monolithique, mais affaiblit la protection XSS. **Reco long terme** : nonce ou extraction du JS.
3. **Pas de chiffrement au repos côté Supabase** (au-delà du chiffrement disque standard) : déjà compensé par le chiffrement applicatif. OK.
4. **Rotation des clés impossible** : `APP_SECRET` sert au chiffrement des tokens ; le changer **invalide tous les liens en cours** (bien documenté dans MEMORY.md). Mais il n'y a **aucune procédure** de rotation `master_key` non plus. **Reco : documenter + versionner les clés** (`key_id`).
5. **Pas de journal d'accès aux données** (qui a exporté quoi, quand) : art. 5.1.f. **Reco : logger les exports** (sans la clé) — au moins l'horodatage + l'actionId.
6. **Pas de 2FA sur le dashboard Supabase / Render** (à vérifier côté compte). Recommandé fortement vu la sensibilité.

### 🔴 Point d'attention RGPD
Le chiffrement applicatif est **excellent** mais **le responsable de traitement reste détenteur des clés** via les liens. RGPD : ça protège contre une fuite de BDD, **pas** contre une obligation d'accès RGPD — nuance importante à assumer (choix « privacy by design » de protection contre le vol, pas « privacy by default » d'anonymisation).

---

## 6. SOUS-TRAITANTS & TRANSFERTS (art. 28, 44+)

| Sous-traitant | Rôle | Pays | DPA signé ? |
|---|---|---|---|
| **Supabase** | Hébergement BDD | À vérifier (région du projet) | ❓ |
| **Render** | Hébergement serveur | US par défaut ? | ❓ |
| **Google Fonts** | Polices (Anton, Inter) | **US — imposé depuis le front** | ❌ |

### 🔴 Transfert hors UE non maîtrisé
- **Google Fonts chargées depuis `fonts.googleapis.com`** : l'IP de chaque visiteur (donc de chaque militant) est transmise à Google US. **Jurisprudence allemande** (LG München 2022) : **illicite sans consentement**, amendes prononcées. C'est le point le plus facile à corriger.
- **Reco immédiate** : **héberger les polices en local** (`/public/fonts/`) et retirer les `<link>` Google. 100 % gratuit, 100 % conforme, supprime aussi une dépendance externe.

### Autres actions
- Vérifier la **région Supabase** (Paris/Francfort = UE, OK ; ailleurs = transfert).
- Vérifier la **région Render** et signer le DPA (disponible dans leur dashboard).
- Documenter les DPA dans le registre.

---

## 7. ANALYSE D'IMPACT (AIPD / DPIA) — 🔴 OBLIGATOIRE

Le traitement remplit au moins **3 critères** du guichet CNIL imposant une AIPD :
1. ✅ Données sensibles (art. 9 — opinion politique)
2. ✅ Personnes vulnérables / collecte à grande échelle
3. ✅ Traitement innovant (numérisation, géolocalisation, profilage)

**Conclusion : une AIPD est juridiquement requise.** Elle n'existe pas.

**Reco** : produire une AIPD (même simplifiée, 5-10 pages) couvrant : description, nécessité/proportionnalité, risques (fuite, détournement, réidentification des militants), mesures (chiffrement, purge, minimisation), avis du DPO.

---

## 8. POLITIQUE DE CONFIDENTIALITÉ & MENTIONS

- ❌ **Aucune politique de confidentialité** dans l'app
- ❌ **Aucunes mentions légales**
- ❌ **Aucune information sur l'usage des données** dans l'UI
- Le README parle de RGPD **techniquement** (purge) mais ne remplace pas ces obligations.

**Reco** : ajouter un lien discret en pied de page → `/confidentialite` avec la politique complète.

---

## 9. SYNTHÈSE — PLAN D'ACTION PRIORISÉ

### 🔴 CRITIQUE (à faire avant tout déploiement public)
1. **Mention d'information terrain** remise lors du porte-à-porte (art. 13) + contact pour exercer les droits.
2. **Retirer Google Fonts** → polices locales (transfert US illicite).
3. **Documenter la base légale** (art. 9.2.d + 6.1.f) et le **registre des traitements** (art. 30).
4. **Politique de confidentialité + mentions légales** dans l'app.

### 🟠 IMPORTANT
5. **Supprimer le fallback anon** dans `db.js` → échec au démarrage si service_role absent.
6. **Purge basée sur la dernière activité** (`MAX(doors.created_at)`) + plafond dur.
7. **Avertissement anti-données-personnelles** dans le champ `details`.
8. Vérifier **régions Supabase/Render** + signer les DPA.
9. **2FA** sur les comptes Supabase, Render, GitHub.

### 🟡 RECOMMANDÉ
10. **Journal d'audit** des exports (horodatage, actionId).
11. **AIPD** (obligatoire en droit, mais à défaut : version simplifiée).
12. **Rotation de clés** documentée (versioning `key_id`).
13. Réduire la rétention des **logs IP** Render.
14. Nonce CSP au lieu d'`unsafe-inline` (long terme).

---

## 10. NOTE DE RISQUE GLOBALE

| Domaine | Note |
|---|---|
| Sécurité technique | 🟢 **8/10** — très au-dessus de la moyenne militante |
| Conformité documentaire | 🔴 **2/10** — quasi rien |
| Information des personnes | 🔴 **1/10** — inexistante |
| Transferts hors UE | 🟠 **3/10** — Google Fonts à corriger d'urgence |
| **Global** | 🟠 **~4/10** |

**Verdict** : le travail **technique** est remarquable (chiffrement, purge, RLS, anti-XSS — c'est du bon niveau). Mais la conformité RGPD ne se limite pas à la sécurité : **le volet "information des personnes" et "documentation" est le talon d'Achille**. Bonne nouvelle : les correctifs sont **peu coûteux** (une page de texte, un flyer, des polices locales) et **hautement rentables** en termes de risque évité.

---

*Audit produit à la demande de Chapi. Ne constitue pas un avis juridique.*
*Sources : code source PAP-LFI (commit ca8e2d1), RGPD (UE 2016/679), lignes directrices CNIL, jurisprudence CJUE/LG München sur Google Fonts.*
