/**
 * PAP-LFI — Serveur Express principal (avec Supabase)
 * 
 * Routes :
 * - POST /api/actions            : créer une action (retourne le lien UUID à partager)
 * - POST /api/actions/:id/doors  : enregistrer une porte visitée (données chiffrées)
 * - POST /api/actions/:id/export : compilation déchiffrée (réservée au créateur)
 * - GET  / (static)              : app web
 * 
 * L'action est identifiée par un UUID interne (jamais exposé dans l'URL publique).
 * Le lien partagé est un token opaque /r/<token> qui encapsule { actionId, clé }.
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const supabase = require('./db');
const { encrypt, decrypt, hashSecret, safeEqual, sealMasterKey, unsealMasterKey } = require('./crypto');
const { createToken, decodeToken, generateShortCode, DEFAULT_EXPIRES_DAYS } = require('./link');

const app = express();
app.use(express.json({ limit: '1mb' }));

// 🔒 Sécurité des en-têtes HTTP (helmet) : Referrer-Policy, X-Content-Type-Options,
// suppression de X-Powered-By, etc. Empêche les fuites via Referrer.
//
// ⚠️ La CSP est configurée pour autoriser les scripts/styles inline ('unsafe-inline')
// car le front est un fichier statique unique (public/index.html) qui embarque tout
// son JS/CSS inline. Les valeurs affichées sont échappées (esc()) donc le risque
// XSS est maîtrisé. On garde la Referrer-Policy stricte (no-referrer) pour que
// l'UUID/la clé ne fuient jamais via le Referrer vers des ressources externes.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      // 🇫🇷 BAN (Base Adresse Nationale, api-adresse.data.gouv.fr) : reverse-geocoding
      // officiel français, gratuit et sans clé. Remplace Nominatim (qui bloque les
      // appels navigateur pour cause d'User-Agent non conforme).
      connectSrc: ["'self'", "https://api-adresse.data.gouv.fr"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));

// 🔒 Derrière un proxy (Render), on fait confiance à 1 niveau de proxy pour que
// req.ip reflète la VRAIE IP du client (X-Forwarded-For) et non celle du proxy.
// Sans ceci, TOUS les clients apparaissent avec l'IP du proxy Render → les limiteurs
// par IP deviennent globalisés (tout le monde dans le même seau).
app.set('trust proxy', 1);

// 🔒 Rate limiting GLOBAL : garde-fou anti-abus (saturation, boucles folles).
// ⚠️ Volontairement large : sur le terrain, plusieurs militants peuvent partager
// une même IP publique (wifi de permanence, HOTSPOT, ou CGNAT des opérateurs mobiles
// où des milliers d'abonnés sortent derrière la même IP). Un plafond trop bas
// bloquerait toute une équipe pendant 15 min.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,                 // 1000 requêtes globales / 15 min par IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes. Réessayez dans quelques minutes.' }
});
app.use('/api/', limiter);

// 🔎 Diagnostic CGNAT / proxy (DÉSACTIVÉ par défaut).
// Activer avec la variable d'env DEBUG_IP=1 pendant une action terrain.
// Sert à vérifier combien d'IP distinctes arrivent réellement côté serveur :
// si plusieurs militants en 5G partagent la même IP → CGNAT de l'opérateur.
// Ne stocke rien : juste un compteur en mémoire (remis à zéro au redéploiement).
const DEBUG_IP = process.env.DEBUG_IP === '1';
const seenIps = new Map(); // ip → { count, firstSeen, lastSeen, uas }
if (DEBUG_IP) {
  console.warn('🔎 DEBUG_IP activé : /api/debug/ip est exposé (à désactiver après le test).');
}
app.get('/api/debug/ip', (req, res) => {
  if (!DEBUG_IP) return res.status(404).json({ error: 'Not found' });
  const ip = req.ip;
  const rec = seenIps.get(ip) || { count: 0, firstSeen: new Date().toISOString(), uas: new Set() };
  rec.count++;
  rec.lastSeen = new Date().toISOString();
  const ua = String(req.headers['user-agent'] || '').slice(0, 80);
  if (rec.uas.size < 20) rec.uas.add(ua);
  seenIps.set(ip, rec);
  res.json({
    seenIp: ip,
    xForwardedFor: req.headers['x-forwarded-for'] || null,
    distinctIpsSoFar: seenIps.size,
    ips: [...seenIps.entries()].map(([k, v]) => ({ ip: k, count: v.count, lastSeen: v.lastSeen, uas: [...v.uas] }))
  });
});

// 🔒 Limite STRICTE réservée à la CRÉATION d'action (seule vraie surface de spam :
// endpoint non authentifié qui insère en base).
const createLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 créations d'action / 15 min par IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de créations d\'action. Réessayez dans quelques minutes.' }
});

// ⚠️ Plus de writeLimiter sur /doors : la protection réelle est la CLÉ MAÎTRE
// (une mauvaise clé → 403). Limiter par IP y exposait un risque terrain :
// plusieurs militants sur la même IP (wifi partagé / CGNAT mobile) se bloquaient
// mutuellement après ~100 écritures cumulées.

// --- Sanitisation des entrées ---
// Nettoie une chaîne : retire caractères de contrôle, balises HTML, tronque.
function sanitizeInput(value, maxLen = 200) {
  if (typeof value !== 'string') return '';
  // Retirer caractères de contrôle (hors tabulation/newline)
  let cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  // Retirer les balises HTML (< >) pour éviter tout XSS
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  // Remplacer plusieurs espaces par un seul, trim
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  // Limiter la longueur
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen);
  return cleaned;
}

// Force un type attendu (floor/number -> chaîne courte sans caractères dangereux)
function sanitizeCode(value, maxLen = 50) {
  if (typeof value !== 'string') return '';
  let v = value.replace(/[^\w\-\u00C0-\u017F\s]/g, ''); // alphanum + accents + tiret/underscore
  v = v.replace(/\s+/g, ' ').trim();
  if (v.length > maxLen) v = v.slice(0, maxLen);
  return v;
}

// --- Servir les fichiers statiques (front) ---
// ⚠️ Le service worker DOIT être servi depuis la racine et ne jamais être mis en cache
// par le navigateur (sinon les mises à jour restent bloquées). On le déclare avant le statique.
app.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Service-Worker-Allowed', '/');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'public', 'sw.js'));
});

app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    // Type MIME explicite pour le manifest (certains serveurs le servent en octet-stream).
    if (filePath.endsWith('.webmanifest')) {
      res.set('Content-Type', 'application/manifest+json; charset=utf-8');
    }
  }
}));

// Route SPA : /action/:uuid sert toujours l'app (le front lit l'UUID dans l'URL)
app.get('/action/:uuid', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Route SPA : /r/:token — lien opaque. Sert l'app, le front appelle /api/link/:token
// pour obtenir (actionId, key) sans les exposer dans l'URL.
app.get('/r/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Route SPA : /a/:token — lien ANIMATEUR. Même app, mais le front bascule en mode
// « résultats détail » après validation du jeton auprès de /api/link/:token.
app.get('/a/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Route SPA : /g/:token — lien GA (groupe d'action). Même app, mode résultats.
app.get('/g/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

/**
 * GET /api/link/:token
 * Résout un lien → { actionId, key, role }.
 * Accepte DEUX formats :
 *   • code court (ex. « A7x9K2pQrT ») → lookup dans la table short_links.
 *   • token opaque long (rétro-compat) → decodeToken().
 * role = 'participant' (saisie) | 'animator' | 'ga' (résultats).
 * 🔑 Pour un code PARTICIPANT, on renvoie la clé maître (déscellée) : le front en a
 * besoin pour chiffrer les portes. Pour animateur/GA, key = null (le serveur déchiffre).
 */
app.get('/api/link/:token', async (req, res) => {
  const raw = req.params.token;
  try {
    // 1) Code court ? (que des caractères base62, longueur raisonnable)
    if (/^[A-Za-z0-9_-]{6,14}$/.test(raw)) {
      const { data: link, error } = await supabase
        .from('short_links')
        .select('code, action_id, role, expires_at')
        .eq('code', raw)
        .maybeSingle();
      if (error) throw error;
      if (!link) return res.status(400).json({ error: 'Lien invalide ou expiré.' });
      if (link.expires_at && Date.now() > new Date(link.expires_at).getTime()) {
        return res.status(400).json({ error: 'Lien expiré.' });
      }
      // Récupérer la clé scellée (nécessaire pour le participant ; utile aussi au serveur)
      let key = null;
      if (link.role === 'participant') {
        const { data: act } = await supabase
          .from('actions')
          .select('master_key_encrypted')
          .eq('id', link.action_id)
          .maybeSingle();
        key = act && act.master_key_encrypted ? unsealMasterKey(act.master_key_encrypted) : null;
        if (!key) return res.status(409).json({ error: 'Ancienne action : utilisez le lien complet.' });
      }
      return res.json({ actionId: link.action_id, key, role: link.role || 'participant' });
    }

    // 2) Token opaque long (rétro-compat)
    const decoded = decodeToken(raw);
    if (!decoded) {
      return res.status(400).json({ error: 'Lien invalide ou expiré.' });
    }
    return res.json(decoded);
  } catch (e) {
    console.error('Erreur résolution lien:', e.message);
    res.status(500).json({ error: 'Erreur serveur lors de la résolution du lien.' });
  }
});

// Helper : valider un UUID
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(v) { return typeof v === 'string' && UUID_RE.test(v); }

/**
 * Résout un lien (code court OU token opaque long) → { actionId, key, role } ou null.
 * Utilisé par /export et /summary pour accepter les deux formats.
 */
async function resolveLink(raw) {
  if (!raw || typeof raw !== 'string') return null;
  // Code court ? (base62, 6 à 14 caractères)
  if (/^[A-Za-z0-9_-]{6,14}$/.test(raw)) {
    const { data: link, error } = await supabase
      .from('short_links')
      .select('code, action_id, role, expires_at')
      .eq('code', raw)
      .maybeSingle();
    if (error || !link) return null;
    if (link.expires_at && Date.now() > new Date(link.expires_at).getTime()) return null;
    let key = null;
    if (link.role === 'participant') {
      const { data: act } = await supabase.from('actions').select('master_key_encrypted').eq('id', link.action_id).maybeSingle();
      key = act && act.master_key_encrypted ? unsealMasterKey(act.master_key_encrypted) : null;
    }
    return { actionId: link.action_id, key, role: link.role || 'participant' };
  }
  // Token opaque long (rétro-compat)
  return decodeToken(raw);
}

// --- Routes API ---

/**
 * POST /api/actions
 * Créer une nouvelle action de porte-à-porte.
 * Body : { name: string }
 * La clé de chiffrement est GÉNÉRÉE automatiquement par le serveur
 * (l'utilisateur n'a plus à en saisir une). Elle est embarquée dans le
 * lien opaque /r/<token> ; aucune clé à retenir côté utilisateur.
 * Retourne l'UUID de l'action + le lien opaque à partager.
 */
app.post('/api/actions', createLimiter, async (req, res) => {
  try {
    const { name } = req.body || {};
    const cleanName = sanitizeInput(name, 150);
    if (!cleanName) {
      return res.status(400).json({ error: 'Le nom de l\'action est requis.' });
    }

    // Générer une clé de chiffrement aléatoire forte (32 octets → hex)
    const masterKey = crypto.randomBytes(32).toString('hex');
    // 🔑 Clé ANIMATEUR : déverrouille la vue détail/export. Ne chiffre rien
    // (le serveur déchiffre avec la clé maître) ; sert uniquement de laissez-passer.
    const animatorKey = crypto.randomBytes(32).toString('hex');

    // 🔒 Le nom d'action est CHIFFRÉ avec la clé maître : une fuite Supabase
    // ne révèle plus où/quand le parti fait du terrain.
    const { data, error } = await supabase
      .from('actions')
      .insert({
        name: encrypt(cleanName, masterKey),
        master_key_hash: hashSecret(masterKey),
        // 🔑 Copie scellée de la clé maître (chiffrée avec APP_SECRET) : permet au
        // serveur de déchiffrer les résultats pour un ANIMATEUR légitime, sans lui
        // transmettre la clé maître. NULL si APP_SECRET absent (rétro-compat).
        master_key_encrypted: sealMasterKey(masterKey),
        animator_key_hash: hashSecret(animatorKey)
      })
      .select()
      .single();

    if (error) throw error;

    // 🔗 Liens COURTS : on crée un code court unique par rôle (participant/animateur/ga).
    // Les tokens opaques longs restent générés pour rétro-compat, mais on privilégie
    // les codes courts côté UI/partage (ils ne se tronquent pas dans Telegram/SMS).
    const short = {};
    try {
      const expiresAt = new Date(Date.now() + DEFAULT_EXPIRES_DAYS * 24 * 60 * 60 * 1000).toISOString();
      for (const role of ['participant', 'animator', 'ga']) {
        let code, inserted = false;
        for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
          code = generateShortCode();
          const { error: eSh } = await supabase.from('short_links').insert({ code, action_id: data.id, role, expires_at: expiresAt });
          if (!eSh) inserted = true;
          // si collision (PK), on retente avec un nouveau code
        }
        if (inserted) short[role] = code;
      }
    } catch (e) {
      // Si la table short_links n'existe pas encore (migration non passée), on continue
      // avec les tokens longs : le service reste fonctionnel.
      console.warn('short_links indisponible (migration 003 non passée ?):', e.message);
    }

    res.status(201).json({
      id: data.id,
      name: cleanName, // renvoyé en clair au créateur (il a la clé dans le token)
      token: createToken(data.id, masterKey),                    // lien PARTICIPANTS (long, rétro-compat)
      // 🔒 Lien ANIMATEUR : jeton d'accès SANS clé (le serveur déchiffre pour lui).
      animatorToken: createToken(data.id, null, undefined, 'animator'),
      // 🔑 Lien GA (groupe d'action) : même jeton que l'animateur, mais destiné
      // à la coordination. Il voit la vue agrégée et le détail (comme l'animateur).
      gaToken: createToken(data.id, null, undefined, 'ga'),
      // 🔗 Codes courts (à privilégier pour le partage) : /r/<code>, /a/<code>, /g/<code>
      shortCode: short.participant || null,
      animatorShortCode: short.animator || null,
      gaShortCode: short.ga || null,
      message: 'Action créée. Partagez le lien participants aux équipes, gardez le lien résultats pour l\'animateur.'
    });
  } catch (e) {
    console.error('Erreur création action:', e.message);
    res.status(500).json({ error: 'Erreur serveur lors de la création.' });
  }
});

/**
 * POST /api/actions/:id/doors
 * Enregistrer une porte visitée.
 * Body : { teamCode, cipherKey, building, floor, doorNumber, interaction, details }
 * Toutes les données sont chiffrées avec cipherKey (la clé maître) avant stockage.
 */
app.post('/api/actions/:id/doors', async (req, res) => {
  try {
    const actionId = req.params.id;
    if (!isValidUUID(actionId)) {
      return res.status(400).json({ error: 'Identifiant d\'action invalide.' });
    }
    const { teamCode, cipherKey, building, floor, doorNumber, interaction, details } = req.body || {};

    // Sanitiser les entrées utilisateur
    const sFloor = sanitizeCode(floor, 20);
    const sDoor = sanitizeCode(doorNumber, 20);
    const sBuilding = sanitizeInput(building, 200);
    const sDetails = sanitizeInput(details, 1000);
    const sInteraction = sanitizeCode(interaction, 50);
    const sTeam = sanitizeCode(teamCode, 50);

    // Vérifier que l'action existe ET que la clé fournie est bien la clé maître
    // (fix anti-écriture non authentifiée : empêche d'injecter des lignes
    //  illisibles avec une clé arbitraire si on connaît l'UUID)
    const { data: action, error: errAction } = await supabase
      .from('actions')
      .select('id, master_key_hash')
      .eq('id', actionId)
      .maybeSingle();

    if (errAction) throw errAction;
    if (!action) {
      return res.status(404).json({ error: 'Action introuvable.' });
    }
    if (!cipherKey || cipherKey.length < 4) {
      return res.status(400).json({ error: 'La clé de chiffrement est requise.' });
    }
    // La clé doit correspondre à celle qui a créé l'action (comparaison à temps constant)
    if (!safeEqual(hashSecret(cipherKey), action.master_key_hash)) {
      return res.status(403).json({ error: 'Clé de chiffrement invalide.' });
    }
    if (!sBuilding) {
      return res.status(400).json({ error: 'Le numéro et la rue sont obligatoires.' });
    }
    // Étage et n° de porte sont désormais OPTIONNELS (terrain : maisons individuelles,
    // portes d'entrée simples...). La porte reste exploitable via n° de rue + rue + heure.

    const { error } = await supabase.from('doors').insert({
      action_id: actionId,
      // Le code d'équipe est CHIFFRÉ (comme les autres champs), pas haché :
      // le créateur (qui a la clé) peut le relire dans la compilation,
      // et en BDD il reste illisible (AES-256-GCM).
      team: sTeam ? encrypt(sTeam, cipherKey) : null,
      building: sBuilding ? encrypt(sBuilding, cipherKey) : null,
      floor: encrypt(sFloor, cipherKey),
      door_number: encrypt(sDoor, cipherKey),
      interaction: sInteraction ? encrypt(sInteraction, cipherKey) : null,
      details: sDetails ? encrypt(sDetails, cipherKey) : null
    });

    if (error) throw error;

    res.status(201).json({ message: 'Porte enregistrée.' });
  } catch (e) {
    console.error('Erreur enregistrement porte:', e.message);
    res.status(500).json({ error: 'Erreur serveur lors de l\'enregistrement.' });
  }
});

/**
 * POST /api/actions/:id/export
 * Compilation déchiffrée des données (réservée à qui détient la clé maître).
 * 
 * 🔒 Fix anti-fuite : la clé est envoyée dans le CORPS de la requête (POST),
 * PLUS JAMAIS dans l'URL (?masterKey=...). Elle ne se retrouve donc ni dans
 * les logs d'accès Render, ni dans l'historique du navigateur, ni dans un
 * proxy intermédiaire.
 * Body : { masterKey?: string, animatorKey?: string, token?: string }
 *
 * 3 modes d'autorisation :
 *   1. `masterKey` (créateur) → déchiffre directement ; OK pour tout.
 *   2. `animatorKey` (rôle animateur, actions ≥ migration 001).
 *   3. `token` (lien animateur/GA) → le SERVEUR déchiffre via la copie scellée
 *      de la clé maître (`master_key_encrypted`, migration 002).
 *
 * Rétro-compat : les actions créées AVANT la migration 002 (master_key_encrypted
 * = NULL) ne peuvent être déchiffrées que via la clé maître (mode 1).
 */
app.post('/api/actions/:id/export', async (req, res) => {
  try {
    const actionId = req.params.id;
    if (!isValidUUID(actionId)) {
      return res.status(400).json({ error: 'Identifiant d\'action invalide.' });
    }
    const { masterKey, animatorKey, token } = req.body || {};
    const providedKey = animatorKey || masterKey;

    // Cas 3 : jeton (lien animateur / GA) → accès aux résultats SANS clé.
    let roleFromToken = null;
    let tokenActionId = null;
    if (token) {
      const decoded = await resolveLink(token);
      if (!decoded) {
        return res.status(401).json({ error: 'Lien invalide ou expiré.' });
      }
      roleFromToken = decoded.role;
      tokenActionId = decoded.actionId;
      // Le jeton doit porter sur CETTE action (pas de rejeu sur une autre).
      if (tokenActionId !== actionId) {
        return res.status(403).json({ error: 'Ce lien ne concerne pas cette action.' });
      }
    }

    if (!providedKey && !token) {
      return res.status(400).json({ error: 'Clé ou lien requis pour consulter les données.' });
    }

    const { data: action, error: errAction } = await supabase
      .from('actions')
      .select('*')
      .eq('id', actionId)
      .maybeSingle();

    if (errAction) throw errAction;
    if (!action) {
      return res.status(404).json({ error: 'Action introuvable.' });
    }

    // --- Détermination du mode d'accès ---
    let decryptKey = null; // clé maître utilisée pour déchiffrer

    if (token) {
      // Accès par lien animateur/GA : déchiffrement serveur via la clé scellée.
      if (roleFromToken === 'participant') {
        return res.status(403).json({ error: 'Ce lien ne donne pas accès aux résultats détaillés.' });
      }
      if (!action.master_key_encrypted) {
        return res.status(403).json({ error: 'Résultats indisponibles par lien pour cette action (ancienne action : utilisez la clé ma\u00eetre).' });
      }
      decryptKey = unsealMasterKey(action.master_key_encrypted);
      if (!decryptKey) {
        return res.status(500).json({ error: 'Déchiffrement impossible (clé scellée illisible).' });
      }
    } else {
      // Accès par clé (créateur) ou clé animateur (actions ≥ migration 001).
      const okAnimator = action.animator_key_hash
        ? safeEqual(hashSecret(providedKey), action.animator_key_hash)
        : false;
      const okMaster = safeEqual(hashSecret(providedKey), action.master_key_hash);
      if (!okAnimator && !okMaster) {
        return res.status(403).json({ error: 'Clé animateur incorrecte.' });
      }
      if (!okMaster) {
        // Clé animateur valide mais pas la clé maître → déchiffrement serveur
        // possible seulement si la clé maître a été scellée (migration 002).
        if (!action.master_key_encrypted) {
          return res.status(403).json({ error: 'Le détail nécessite la clé maître (embarquée dans le lien créateur).' });
        }
        decryptKey = unsealMasterKey(action.master_key_encrypted);
        if (!decryptKey) {
          return res.status(500).json({ error: 'Déchiffrement impossible (clé scellée illisible).' });
        }
      } else {
        decryptKey = providedKey; // clé maître → déchiffre directement
      }
    }

    // Récupérer toutes les portes
    const { data: doors, error: errDoors } = await supabase
      .from('doors')
      .select('*')
      .eq('action_id', actionId)
      .order('created_at', { ascending: true });

    if (errDoors) throw errDoors;

    // Déchiffrer avec la clé maître
    const decrypted = (doors || []).map((d) => ({
      id: d.id,
      team: d.team ? decrypt(d.team, decryptKey) : null,
      building: d.building ? decrypt(d.building, decryptKey) : null,
      floor: d.floor ? decrypt(d.floor, decryptKey) : null,
      doorNumber: d.door_number ? decrypt(d.door_number, decryptKey) : null,
      interaction: d.interaction ? decrypt(d.interaction, decryptKey) : null,
      details: d.details ? decrypt(d.details, decryptKey) : null,
      createdAt: d.created_at
    }));

    res.json({
      action: { id: action.id, name: action.name ? decrypt(action.name, decryptKey) : null, createdAt: action.created_at },
      total: decrypted.length,
      doors: decrypted
    });
  } catch (e) {
    console.error('Erreur export:', e.message);
    res.status(500).json({ error: 'Erreur serveur lors de l\'export.' });
  }
});

/**
 * POST /api/actions/:id/summary
 * Vue AGRÉGÉE (participants) : uniquement des compteurs, jamais le détail nominatif
 * ni les adresses. Il faut déchiffrer les interactions pour compter.
 * Body : { masterKey?: string, token?: string }
 *   • masterKey → déchiffre directement (créateur / participant).
 *   • token (animateur/GA) → le serveur déchiffre via la clé scellée (migration 002).
 * Retour : { total, sympathique, interesse, adherent, indecis, absent, refus, neSonnePas, positifs, pourcentage_positifs }
 */
app.post('/api/actions/:id/summary', async (req, res) => {
  try {
    const actionId = req.params.id;
    if (!isValidUUID(actionId)) {
      return res.status(400).json({ error: 'Identifiant d\'action invalide.' });
    }
    const { masterKey, token } = req.body || {};
    if (!masterKey && !token) {
      return res.status(400).json({ error: 'La clé ou un lien est requis pour consulter les statistiques.' });
    }

    const { data: action, error: errAction } = await supabase
      .from('actions')
      .select('id, master_key_hash, master_key_encrypted')
      .eq('id', actionId)
      .maybeSingle();
    if (errAction) throw errAction;
    if (!action) return res.status(404).json({ error: 'Action introuvable.' });

    // Détermination de la clé de déchiffrement
    let decryptKey = null;
    if (token) {
      const decoded = await resolveLink(token);
      if (!decoded || decoded.actionId !== actionId) {
        return res.status(403).json({ error: 'Lien invalide pour cette action.' });
      }
      if (!action.master_key_encrypted) {
        return res.status(403).json({ error: 'Stats indisponibles par lien pour cette action (ancienne action).' });
      }
      decryptKey = unsealMasterKey(action.master_key_encrypted);
      if (!decryptKey) return res.status(500).json({ error: 'Déchiffrement impossible.' });
    } else {
      if (!safeEqual(hashSecret(masterKey), action.master_key_hash)) {
        return res.status(403).json({ error: 'Clé incorrecte.' });
      }
      decryptKey = masterKey;
    }

    const { data: doors, error: errDoors } = await supabase
      .from('doors')
      .select('interaction')
      .eq('action_id', actionId);
    if (errDoors) throw errDoors;

    // Comptage par type d'interaction (déchiffrement éphémère, aucun détail renvoyé)
    const counts = {
      sympathique: 0, interesse: 0, adherent: 0, indecis: 0,
      absent: 0, refus: 0, neSonnePas: 0
    };
    for (const d of doors || []) {
      if (!d.interaction) continue;
      const v = decrypt(d.interaction, decryptKey) || '';
      const s = v.toLowerCase();
      if (s.includes('sympa')) counts.sympathique++;
      else if (s.includes('intéress') || s.includes('interess')) counts.interesse++;
      else if (s.includes('adhérent') || s.includes('adherent')) counts.adherent++;
      else if (s.includes('indécis') || s.includes('indecis')) counts.indecis++;
      else if (s.includes('pas de réponse') || s.includes('pas de reponse')) counts.absent++;
      else if (s.includes('refus')) counts.refus++;
      else if (s.includes('ne sonne pas')) counts.neSonnePas++;
    }
    const total = (doors || []).length;
    const positifs = counts.sympathique + counts.interesse + counts.adherent + counts.indecis;
    res.json({
      total,
      ...counts,
      positifs,
      pourcentage_positifs: total ? Math.round((positifs / total) * 100) : 0
    });
  } catch (e) {
    console.error('Erreur summary:', e.message);
    res.status(500).json({ error: 'Erreur serveur lors du calcul des stats.' });
  }
});

// --- Purge des données (conformité RGPD) ---

// Durée de conservation : 30 jours (les données d'opinion politique + adresse
// ne doivent pas être gardées indéfiniment). Au-delà, tout est supprimé.
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Supprime toutes les portes d'une action.
 * @param {string} actionId
 */
async function purgeDoors(actionId) {
  const { error } = await supabase.from('doors').delete().eq('action_id', actionId);
  if (error) throw error;
}

/**
 * Purge automatique : supprime les ACTIONS (et leurs portes en cascade) dont
 * la dernière activité est antérieure à la durée de rétention.
 * Basé sur la date de création de l'action (on pourrait affiner avec la
 * dernière porte, mais created_at est un bon proxy simple).
 * @returns {number} nombre d'actions purgées
 */
async function purgeExpiredActions() {
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  const { data, error } = await supabase
    .from('actions')
    .select('id')
    .lt('created_at', cutoff);
  if (error) throw error;
  if (!data || data.length === 0) return 0;
  // Supabase delete avec filtre (cascade sur les portes via FK on delete cascade)
  const ids = data.map(a => a.id);
  const { error: delErr } = await supabase.from('actions').delete().in('id', ids);
  if (delErr) throw delErr;
  return data.length;
}

/**
 * POST /api/actions/:id/purge
 * Supprime TOUTES les données (portes) d'une action. Réservé à qui détient
 * la clé maître (le créateur). Conforme RGPD (droit à l'effacement).
 * Body : { masterKey: string }
 */
app.post('/api/actions/:id/purge', async (req, res) => {
  try {
    const actionId = req.params.id;
    if (!isValidUUID(actionId)) {
      return res.status(400).json({ error: 'Identifiant d\'action invalide.' });
    }
    const { masterKey } = req.body || {};
    if (!masterKey) {
      return res.status(400).json({ error: 'La clé maître est requise.' });
    }
    const { data: action, error: errAction } = await supabase
      .from('actions')
      .select('master_key_hash')
      .eq('id', actionId)
      .maybeSingle();
    if (errAction) throw errAction;
    if (!action) return res.status(404).json({ error: 'Action introuvable.' });
    if (!safeEqual(hashSecret(masterKey), action.master_key_hash)) {
      return res.status(403).json({ error: 'Clé maître incorrecte.' });
    }
    await purgeDoors(actionId);
    res.json({ message: 'Données supprimées.', deleted: true });
  } catch (e) {
    console.error('Erreur purge:', e.message);
    res.status(500).json({ error: 'Erreur serveur lors de la purge.' });
  }
});

// --- Démarrage ---
// `require.main === module` : on ne démarre le serveur que si le fichier est
// lancé directement (node src/server.js). Cela permet aux tests d'importer `app`
// sans ouvrir de port.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ PAP-LFI démarré sur http://localhost:${PORT}`);
    // Purge au démarrage + quotidienne (conformité RGPD, pas besoin de cron externe)
    purgeExpiredActions()
      .then(n => n > 0 && console.log(`🧹 Purge RGPD : ${n} action(s) expirée(s) supprimée(s).`))
      .catch(e => console.error('Erreur purge démarrage:', e.message));
    setInterval(() => {
      purgeExpiredActions()
        .then(n => n > 0 && console.log(`🧹 Purge RGPD : ${n} action(s) expirée(s) supprimée(s).`))
        .catch(e => console.error('Erreur purge périodique:', e.message));
    }, 24 * 60 * 60 * 1000); // tous les jours
  });
}

module.exports = app;
