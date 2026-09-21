# AGENTS.md — PAP-LFI (notes techniques pour les agents)

Ce fichier documente l'architecture, les conventions et les pièges du projet **PAP-LFI**
(application de porte-à-porte LFI). À lire avant toute modification.

> Pour la présentation fonctionnelle, voir `README.md`.

---

## 🗂️ Structure

```
PAP-LFI/
├── src/
│   ├── server.js   # Serveur Express : routes API, CSP/helmet, rate-limit, purge RGPD
│   ├── db.js       # Client Supabase (service_role prioritaire, fallback anon)
│   ├── crypto.js   # AES-256-GCM : encrypt/decrypt, hashSecret, safeEqual
│   └── link.js     # Liens opaques /r/<token> (UUID + clé chiffrés avec APP_SECRET)
├── public/
│   └── index.html  # Front complet (HTML + CSS + JS inline, mobile-first, vanilla)
├── supabase_schema.sql  # Schéma BDD (tables actions + doors)
├── render.yaml     # Blueprint Render
└── .env.example
```

---

## 🗄️ Modèle de données (Supabase)

**`actions`** (campagnes) : `id` (uuid), `name` (chiffré), `master_key_hash`, `created_at`

**`doors`** (portes visitées) : `id`, `action_id`, `team`, `building`, `floor`,
`door_number`, `interaction`, `details`, `created_at`
- **Toutes les colonnes de contenu sont chiffrées AES-256-GCM** côté serveur avant insert.
- RLS activée, **aucune policy publique** : seul le `service_role` (utilisé côté serveur) accède.

### ⚠️ Convention clé : la colonne `building`
- `building` stocke l'adresse au format uniforme **`"<n° de rue> <rue>"`** (ex : `"12 rue de la Paix"`).
- C'est **volontaire** : on réutilise la colonne existante pour éviter toute migration Supabase en prod.
- Le front **parse** `building` au tri via `parseAddr()` (regex `^(\d+)\s*[\s,]*\s*(.*)$`).
- Si un jour on veut des colonnes séparées (`street_number`, `street`), **prévoir une migration**
  et garder la rétrocompat de lecture des anciennes lignes.

---

## 🚪 Formulaire de saisie (public/index.html)

Champs actuels (ordre) :
1. **`N° rue`** (`#streetNumber`) — **OBLIGATOIRE**, `inputmode=numeric`
2. **`Rue`** (`#street`) — **OBLIGATOIRE**, pré-remplie par GPS, corrigeable
3. Bouton **📍 GPS (optionnel)** (`#gpsBtn`) → `fillFromGPS()`
4. `Étage` (`#floor`) — optionnel
5. `N° porte` (`#doorNumber`) — optionnel (appartement/porte, **≠ n° de rue**)
6. `Interaction` — obligatoire (un des codes d'`INTERACTIONS`)
7. `Équipe` (`#team`) — optionnel
8. `Détails` (`#details`) — optionnel

### ⚠️ Ne pas confondre
- **N° de rue** (`streetNumber`) : numéro dans l'adresse → sert au **regroupement du siège**.
- **N° porte** (`doorNumber`) : appartement/porte dans l'immeuble → suivi terrain.

### Persistance à la saisie
- À la validation, on **ne vide PAS** `streetNumber` ni `street` : la rue reste pré-remplie
  pour la porte suivante (même immeuble/rue). On vide seulement `floor`, `doorNumber`, `details`.
- `resetForm()` (changement d'action) vide tout, y compris la rue.
- Il n'y a **pas** de localStorage : la persistance est purement « valeur du champ non réinitialisée ».

---

## 📍 Aide GPS (optionnelle, jamais bloquante)

- `fillFromGPS()` : `navigator.geolocation` → reverse-geocoding **Nominatim (OpenStreetMap)**
  → pré-remplit `#street` (+ ville entre parenthèses) et `#streetNumber` si `house_number` dispo.
- **Anti-écrasement** : si `#street` contient déjà du texte, `confirm()` avant remplacement.
- **Timeouts courts** (6 s) : si échec/refus/hors-ligne → message clair, **la saisie manuelle reste disponible**.
- 🔒 **Aucune coordonnée GPS n'est stockée** : seul le texte corrigé par le militant part en BDD.

### ⚠️ CSP — piège à connaître
La CSP est configurée dans `src/server.js` (helmet). Elle **doit** autoriser Nominatim :
```js
connectSrc: ["'self'", "https://nominatim.openstreetmap.org"]
```
**Si on ajoute un autre service externe (autre géocodeur, etc.), il FAUT l'ajouter ici**, sinon
le `fetch()` est silencieusement bloqué par le navigateur.

---

## 📊 Compilation & tri (loadCompil)

- Récupère via `POST /api/actions/:id/export` (clé maître dans le **corps**, jamais dans l'URL).
- **Tri (tableau ET CSV)** : `parseAddr()` → **rue (alpha, localeCompare fr) → n° de rue (numérique) → date**.
  - ⚠️ Tri numérique obligatoire : sinon `"10"` passerait avant `"2"`.
  - Les adresses **sans numéro** sont reléguées en fin de groupe (`num: Infinity`).
- Colonnes du tableau/CSV : `Rue; N°; Étage; N° porte; Interaction; Détails; Équipe; Heure`.
- `exportCsv()` lit **les lignes du tableau déjà triées** → le CSV hérite du tri.

---

## 🔐 Sécurité — invariants à ne jamais casser

- **`APP_SECRET`** : ne **jamais** changer en prod → invaliderait tous les liens `/r/<token>` partagés.
- La **clé maître** circule dans le **corps** des POST (jamais en query string → pas de fuite logs/historique).
- Les valeurs affichées via `innerHTML` passent **toujours** par `esc()` (anti-XSS).
- `Referrer-Policy: no-referrer` : empêche la fuite de l'UUID/clé via le Referrer.
- Rate-limit : `limiter` global sur `/api/`, `writeLimiter` plus strict sur les écritures.

---

## 📜 RGPD

- `RETENTION_DAYS = 30` : purge auto des actions (et portes en cascade) au démarrage + quotidiennement.
- Bouton « 🗑️ Supprimer les données » → `purgeData()` avec **double confirmation**.
- L'adresse étant une donnée personnelle, ne jamais la logger ni l'exposer en clair côté serveur.

---

## 🚀 Déploiement

- Prod : **Render** → `pap-lfi.onrender.com` (repo `MisterChateau/PAP-LFI`, branche `main`).
- **Tout push sur `main` déclenche un redéploiement automatique.**
- Variables d'env Render : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_SECRET`.

### Test local
```bash
npm install
# créer .env (voir .env.example)
npm start          # ou npm run dev
# → http://localhost:3000 (ou PORT choisi)
```

---

## ✅ Checklist avant commit

- [ ] `node --check src/server.js` passe
- [ ] Le JS inline de `public/index.html` parse sans erreur
- [ ] Si nouvel appel externe → **ajouté à `connectSrc`** dans la CSP
- [ ] Les valeurs affichées via `innerHTML` sont `esc()`-ées
- [ ] Pas de n° de rue / n° de porte confondus
- [ ] Testé le tri (rue → n° → date) si touché à la compilation

---

## 🕓 Journal des changements notables

### 2026-09-21 — Adresse obligatoire + GPS + tri par n° de rue
- **Demande terrain** : les militants ne saisissaient pas l'adresse (optionnelle) → données
  inexploitables pour l'organisateur. L'organisateur veut **regrouper par n° de rue**
  (le siège a une app à remplir par numéro de rue, et une équipe couvre plusieurs n° d'une rue).
- **Ajouté** : champs `N° rue` + `Rue` **obligatoires** (remplace l'ancien champ unique « Immeuble / rue »).
- **Ajouté** : bouton **GPS optionnel** (Nominatim) pour **uniformiser** la donnée d'adresse.
- **Ajouté** : tri **rue → n° de rue → date** dans le tableau et le CSV.
- **Technique** : colonne DB `building` réutilisée au format `"<n°> <rue>"` → **pas de migration**.
- Fichiers touchés : `public/index.html`, `src/server.js`.
