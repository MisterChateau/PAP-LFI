# 🧪 Rapport de campagne de tests — PAP-LFI v1.2 « prise de contact »

**Date** : 2026-10-11
**Cible** : production `https://pap-lfi.onrender.com`
**Branche/commit testés** : `main` @ `6c760a5` — version front `2026-10-11.4`
**Tags** : `v1.2.0-contact`, `v1.2.1-csv`, `v1.2.2-pwa-reload`
**Outils** : `demo/campaign_v1.2_ui.js` (E2E navigateur, Chrome CDP) + `demo/test_roles_http.js` (API, BDD mockée)

---

## Objet de la version

Refonte de la saisie terrain pour répondre au retour des militants (via le GA) :
- ne plus imposer l'étage / le n° de porte à chaque porte ;
- ne noter ces données **nominatives** (rattachables à une personne) **que lorsqu'un contact est pris** avec accord de la personne (principe de minimisation RGPD).

---

## Cas d'usage testés (E2E navigateur)

| # | Cas d'usage | Attendu | Résultat |
|---|-------------|---------|----------|
| 1 | Formulaire épuré | Ét/Porte absents du formulaire principal (dans la section contact) | ✅ |
| 2 | GPS discret | Icône inline dans le champ Rue, plus de bouton pleine largeur | ✅ |
| 3 | Interaction **négative** (refus) | Aucun bandeau de contact | ✅ |
| 4 | Interaction **positive** (intéressé·e) | Bandeau « accepte d'être recontactée » + ✕ affiché | ✅ |
| 5 | Pattern « morph » | Coche → champs contact déployés | ✅ |
| 6 | Annulation ✕ | Champs fermés + case décochée + bandeau masqué | ✅ |
| 7 | **Garde-fou RGPD** | Ét/Porte enregistrés SEULEMENT si consentement coché | ✅ (0 fuite) |
| 8 | Tableau animateur adaptatif — aucune prise de contact | Colonnes Ét/Porte masquées | ✅ |
| 9 | Tableau animateur adaptatif — ≥1 prise de contact | Colonnes Ét/Porte visibles | ✅ |
| 10 | Export CSV | 8 colonnes, **toutes les lignes alignées**, complet | ✅ |

**Résultat E2E : 37/37 tests OK.**

## Non-régression (API, BDD mockée)

`test_roles_http.js` — flux complet des rôles (création → 3 liens courts/longs → export par rôle → sécurité) : **20/20 OK.**

---

## 🐛 Bugs détectés par la campagne (et corrigés)

1. **Export CSV désaligné** (introduit par les colonnes adaptatives)
   L'export lisait le tableau DOM (colonnes masquées) alors que l'en-tête restait figé à 8 colonnes.
   → **Fix** : CSV reconstruit depuis les données (`lastCompilDoors`), colonnes toujours complètes. Tag `v1.2.1-csv`.

2. **Perte du lien d'action à l'ouverture (Service Worker)**
   Quand le SW s'activait pendant l'ouverture d'un `/r/<code>`, `location.reload()` rechargeait `/` (le token avait déjà été retiré de l'URL par `replaceState`) → **le militant perdait son action**.
   → **Fix** : (a) on ne recharge que sur une **vraie mise à jour** (un contrôleur existait déjà) ; (b) le token est conservé brièvement (`sessionStorage`) pour rouvrir l'action si un reload survient. Tag `v1.2.2-pwa-reload`.

---

## Correctifs UX post-déploiement (retours Chapi en direct)

| Tag | Fix |
|-----|-----|
| `v1.2.3-spacing` | Bandeau de contact : marge basse manquante → label « Équipe » collé. |
| `v1.2.4-numfield` | Champ « N° rue » trop large (50 %) → passé à ~26 % (classe `.num-field`) pour élargir la Rue. |
| `v1.2.5-refresh` | **F5 / rafraîchissement perdait l'action** → action mémorisée en `sessionStorage` (par onglet), rouverte au reload, sans ré-exposer le token dans l'URL. (`exitAction` nettoie la mémoire de session.) |
| `v1.2.6-pwa-update` | Vérification de MAJ du SW **au retour au premier plan** + checklist de livraison PWA (AGENTS.md). |
| `v1.2.7-underline` | Les liens stylés en bouton (`a.btn`) ne sont plus soulignés. |
| `v1.2.8-linkcapture` | Tentative de capture de lien PWA (`handle_links`). |
| `v1.2.9-remove-linkcapture` | **Retrait** de la capture de lien (non fiable hors TWA/Android). |
| `v1.2.10-persist-action` | Action mémorisée durablement (`localStorage`) → rouvrir l'appli installée ramène dans la dernière action. |
| `v1.2.11-access-link` | Accueil : bloc **« Accéder à l'action »** (coller un lien) **visible seulement si la PWA est installée** — parade au fait qu'un lien externe ne peut pas ouvrir la PWA sans TWA. |

Ajout de 2 tests E2E : « F5 → on reste dans l'action » et « F5 → URL sans token ». **Total campagne : 42/42 OK.**

## Hygiène des données

Les actions créées pour les tests (`TEST v1.2 A/B`, `DEBUG`, `REPRO`) ont été **purgées** en fin de campagne via `POST /api/actions/:id/purge` (droit à l'effacement).

---

## Comment rejouer

```bash
# 1) Chrome headless sur le port 9223 (voir skills/chrome-headless)
# 2) Campagne E2E prod :
node PAP-LFI/demo/campaign_v1.2_ui.js
# 3) Non-régression API (locale, sans réseau) :
node PAP-LFI/demo/test_roles_http.js
```
