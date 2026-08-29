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
const supabase = require('./db');
const { encrypt, decrypt, hashSecret, safeEqual } = require('./crypto');
const { createToken, decodeToken } = require('./link');

const app = express();
app.use(express.json({ limit: '1mb' }));

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
app.use(express.static(path.join(__dirname, '..', 'public')));

// Route SPA : /action/:uuid sert toujours l'app (le front lit l'UUID dans l'URL)
app.get('/action/:uuid', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Route SPA : /r/:token — lien opaque. Sert l'app, le front appelle /api/link/:token
// pour obtenir (actionId, key) sans les exposer dans l'URL.
app.get('/r/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

/**
 * GET /api/link/:token
 * Décode un lien opaque → { actionId, key }.
 * Les infos ne sont PAS dans l'URL ; le front les reçoit en JSON et les garde en mémoire.
 */
app.get('/api/link/:token', (req, res) => {
  const decoded = decodeToken(req.params.token);
  if (!decoded) {
    return res.status(400).json({ error: 'Lien invalide ou expiré.' });
  }
  res.json(decoded);
});

// Helper : valider un UUID
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(v) { return typeof v === 'string' && UUID_RE.test(v); }

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
app.post('/api/actions', async (req, res) => {
  try {
    const { name } = req.body || {};
    const cleanName = sanitizeInput(name, 150);
    if (!cleanName) {
      return res.status(400).json({ error: 'Le nom de l\'action est requis.' });
    }

    // Générer une clé de chiffrement aléatoire forte (32 octets → hex)
    const masterKey = crypto.randomBytes(32).toString('hex');

    const { data, error } = await supabase
      .from('actions')
      .insert({ name: cleanName, master_key_hash: hashSecret(masterKey) })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      id: data.id,
      name: data.name,
      token: createToken(data.id, masterKey),
      message: 'Action créée. Partagez ce lien aux équipes.'
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
    if (!sFloor && !sDoor) {
      return res.status(400).json({ error: 'Précisez au moins l\'étage ou le numéro de porte.' });
    }

    const { error } = await supabase.from('doors').insert({
      action_id: actionId,
      team_hash: sTeam ? hashSecret(sTeam) : null,
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
 * Body : { masterKey: string }
 */
app.post('/api/actions/:id/export', async (req, res) => {
  try {
    const actionId = req.params.id;
    if (!isValidUUID(actionId)) {
      return res.status(400).json({ error: 'Identifiant d\'action invalide.' });
    }
    const { masterKey } = req.body || {};

    if (!masterKey) {
      return res.status(400).json({ error: 'La clé maître est requise pour consulter les données.' });
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

    // Vérifier la clé maître (comparaison à temps constant)
    if (!safeEqual(hashSecret(masterKey), action.master_key_hash)) {
      return res.status(403).json({ error: 'Clé maître incorrecte.' });
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
      team: d.team_hash ? d.team_hash.slice(0, 8) : null,
      building: d.building ? decrypt(d.building, masterKey) : null,
      floor: d.floor ? decrypt(d.floor, masterKey) : null,
      doorNumber: d.door_number ? decrypt(d.door_number, masterKey) : null,
      interaction: d.interaction ? decrypt(d.interaction, masterKey) : null,
      details: d.details ? decrypt(d.details, masterKey) : null,
      createdAt: d.created_at
    }));

    res.json({
      action: { id: action.id, name: action.name, createdAt: action.created_at },
      total: decrypted.length,
      doors: decrypted
    });
  } catch (e) {
    console.error('Erreur export:', e.message);
    res.status(500).json({ error: 'Erreur serveur lors de l\'export.' });
  }
});

// --- Démarrage ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ PAP-LFI démarré sur http://localhost:${PORT}`);
});
