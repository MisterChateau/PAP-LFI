/**
 * PAP-LFI — Serveur de DÉMO local (offline-first)
 *
 * But : tester le front hors-ligne SANS toucher à Supabase.
 *  - Même API que src/server.js (actions / doors / export / purge)
 *  - Stockage : fichier JSON local (data/demo-db.json)
 *  - Chiffrement identique (src/crypto.js, src/link.js) pour rester réaliste
 *  - Endpoint magique /__demo/fail  → simule une coupure réseau (503)
 *    /__demo/ok                    → rétablit le réseau
 *
 * ⚠️ Ce serveur n'est PAS destiné à la prod (pas de rate-limit, pas de helmet strict).
 *    Lancement : node demo/server.js   (port 3100)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { encrypt, decrypt, hashSecret, safeEqual } = require('../src/crypto');
const { createToken, decodeToken } = require('../src/link');

const app = express();
app.use(express.json({ limit: '1mb' }));

// 🔒 Réplique de la config de prod (src/server.js) pour tester le comportement limiter.
app.set('trust proxy', 1);
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Trop de requêtes. Réessayez dans quelques minutes.' }
});
app.use('/api/', limiter);
const createLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Trop de créations d\'action. Réessayez dans quelques minutes.' }
});

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'demo-db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

// --- petite "BDD" fichier ---
function load() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { actions: [], doors: [] }; }
}
function save(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
let db = load();

// --- interrupteur réseau simulé ---
let NETWORK_DOWN = false;
app.get('/__demo/fail', (req, res) => { NETWORK_DOWN = true; res.json({ networkDown: true }); });
app.get('/__demo/ok', (req, res) => { NETWORK_DOWN = false; res.json({ networkDown: false }); });
app.get('/__demo/status', (req, res) => { res.json({ networkDown: NETWORK_DOWN, actions: db.actions.length, doors: db.doors.length }); });

// 🔎 Diagnostic CGNAT / proxy (activable par DEBUG_IP=1) — réplique de src/server.js
const DEBUG_IP = process.env.DEBUG_IP === '1';
const seenIps = new Map();
if (DEBUG_IP) console.warn('🔎 DEBUG_IP activé : /api/debug/ip exposé.');
app.get('/api/debug/ip', (req, res) => {
  if (!DEBUG_IP) return res.status(404).json({ error: 'Not found' });
  const ip = req.ip;
  const rec = seenIps.get(ip) || { count: 0, firstSeen: new Date().toISOString(), uas: new Set() };
  rec.count++; rec.lastSeen = new Date().toISOString();
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

// Bloque les routes API si le réseau est "coupé" (simule une cave)
app.use('/api', (req, res, next) => {
  if (NETWORK_DOWN) return res.status(503).json({ error: 'Réseau indisponible (simulation démo).' });
  next();
});

// --- helpers (copiés de src/server.js pour un comportement identique) ---
function sanitizeInput(value, maxLen = 200) {
  if (typeof value !== 'string') return '';
  let cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  return cleaned.slice(0, maxLen);
}
function sanitizeCode(value, maxLen = 50) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^\w\s\-.,/éèêëàâäîïôöùûüçÉÈÊËÀÂÄÎÏÔÖÙÛÜÇ]/g, '').slice(0, maxLen).trim();
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(v) { return typeof v === 'string' && UUID_RE.test(v); }

// --- API ---
// POST /api/actions
app.post('/api/actions', createLimiter, (req, res) => {
  const cleanName = sanitizeInput((req.body || {}).name, 150);
  if (!cleanName) return res.status(400).json({ error: 'Le nom de l\'action est requis.' });
  const id = crypto.randomUUID();
  const masterKey = crypto.randomBytes(48).toString('base64url'); // clé forte auto
  const action = {
    id,
    name: encrypt(cleanName, masterKey),
    master_key_hash: hashSecret(masterKey),
    created_at: new Date().toISOString()
  };
  db.actions.push(action);
  save(db);
  const token = createToken(id, masterKey);
  res.status(201).json({ id, name: cleanName, token });
});

// GET /api/link/:token
app.get('/api/link/:token', (req, res) => {
  const decoded = decodeToken(req.params.token);
  if (!decoded) return res.status(400).json({ error: 'Lien invalide ou expiré.' });
  res.json({ actionId: decoded.actionId, key: decoded.key });
});

// POST /api/actions/:id/doors
app.post('/api/actions/:id/doors', (req, res) => {
  const actionId = req.params.id;
  if (!isValidUUID(actionId)) return res.status(400).json({ error: 'Identifiant d\'action invalide.' });
  const { teamCode, cipherKey, building, floor, doorNumber, interaction, details } = req.body || {};
  const action = db.actions.find(a => a.id === actionId);
  if (!action) return res.status(404).json({ error: 'Action introuvable.' });
  if (!cipherKey || cipherKey.length < 4) return res.status(400).json({ error: 'La clé de chiffrement est requise.' });
  if (!safeEqual(hashSecret(cipherKey), action.master_key_hash)) return res.status(403).json({ error: 'Clé de chiffrement invalide.' });

  const sFloor = sanitizeCode(floor, 20);
  const sDoor = sanitizeCode(doorNumber, 20);
  const sBuilding = sanitizeInput(building, 200);
  const sDetails = sanitizeInput(details, 1000);
  const sInteraction = sanitizeCode(interaction, 50);
  const sTeam = sanitizeCode(teamCode, 50);

  if (!sBuilding) return res.status(400).json({ error: 'Le numéro et la rue sont obligatoires.' });
  if (!sFloor && !sDoor) return res.status(400).json({ error: 'Précisez au moins l\'étage ou le numéro de porte.' });

  db.doors.push({
    id: db.doors.length + 1,
    action_id: actionId,
    team: sTeam ? encrypt(sTeam, cipherKey) : null,
    building: sBuilding ? encrypt(sBuilding, cipherKey) : null,
    floor: encrypt(sFloor, cipherKey),
    door_number: encrypt(sDoor, cipherKey),
    interaction: sInteraction ? encrypt(sInteraction, cipherKey) : null,
    details: sDetails ? encrypt(sDetails, cipherKey) : null,
    created_at: new Date().toISOString()
  });
  save(db);
  res.status(201).json({ message: 'Porte enregistrée.' });
});

// POST /api/actions/:id/export
app.post('/api/actions/:id/export', (req, res) => {
  const actionId = req.params.id;
  if (!isValidUUID(actionId)) return res.status(400).json({ error: 'Identifiant d\'action invalide.' });
  const { masterKey } = req.body || {};
  if (!masterKey) return res.status(400).json({ error: 'La clé maître est requise.' });
  const action = db.actions.find(a => a.id === actionId);
  if (!action) return res.status(404).json({ error: 'Action introuvable.' });
  if (!safeEqual(hashSecret(masterKey), action.master_key_hash)) return res.status(403).json({ error: 'Clé maître incorrecte.' });

  const doors = db.doors.filter(d => d.action_id === actionId).map(d => ({
    id: d.id,
    team: d.team ? decrypt(d.team, masterKey) : null,
    building: d.building ? decrypt(d.building, masterKey) : null,
    floor: d.floor ? decrypt(d.floor, masterKey) : null,
    doorNumber: d.door_number ? decrypt(d.door_number, masterKey) : null,
    interaction: d.interaction ? decrypt(d.interaction, masterKey) : null,
    details: d.details ? decrypt(d.details, masterKey) : null,
    createdAt: d.created_at
  }));
  res.json({
    action: { id: action.id, name: decrypt(action.name, masterKey), createdAt: action.created_at },
    total: doors.length,
    doors
  });
});

// POST /api/actions/:id/purge
app.post('/api/actions/:id/purge', (req, res) => {
  const actionId = req.params.id;
  if (!isValidUUID(actionId)) return res.status(400).json({ error: 'Identifiant d\'action invalide.' });
  const { masterKey } = req.body || {};
  if (!masterKey) return res.status(400).json({ error: 'La clé maître est requise.' });
  const action = db.actions.find(a => a.id === actionId);
  if (!action) return res.status(404).json({ error: 'Action introuvable.' });
  if (!safeEqual(hashSecret(masterKey), action.master_key_hash)) return res.status(403).json({ error: 'Clé maître incorrecte.' });
  db.doors = db.doors.filter(d => d.action_id !== actionId);
  save(db);
  res.json({ message: 'Données supprimées.', deleted: true });
});

// --- statiques (le front) ---
// Routes SPA : le front lit le token dans l'URL (comme src/server.js).
app.get('/r/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
app.get('/action/:uuid', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log(`🧪 DÉMO PAP-LFI (offline-first) sur http://localhost:${PORT}`);
  console.log(`   Simuler une coupure : http://localhost:${PORT}/__demo/fail`);
  console.log(`   Rétablir le réseau : http://localhost:${PORT}/__demo/ok`);
});
