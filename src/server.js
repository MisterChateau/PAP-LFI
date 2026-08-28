/**
 * PAP-LFI — Serveur Express principal
 * 
 * Routes :
 * - POST /api/actions            : créer une action (retourne le lien à partager)
 * - POST /api/actions/:id/doors  : enregistrer une porte visitée (données chiffrées)
 * - GET  /api/actions/:id/export : compilation déchiffrée (réservée au créateur)
 * - GET  / (static)              : app web
 */

const express = require('express');
const path = require('path');
const db = require('./db');
const { encrypt, decrypt, hashSecret } = require('./crypto');

const app = express();
app.use(express.json({ limit: '1mb' }));

// --- Servir les fichiers statiques (front) ---
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- Routes API ---

/**
 * POST /api/actions
 * Créer une nouvelle action de porte-à-porte.
 * Body : { name: string, masterKey: string }
 */
app.post('/api/actions', (req, res) => {
  const { name, masterKey } = req.body || {};
  if (!name || !masterKey || masterKey.length < 4) {
    return res.status(400).json({ error: 'Le nom et une clé maître (min 4 caractères) sont requis.' });
  }

  const stmt = db.prepare('INSERT INTO actions (name, master_key_hash) VALUES (?, ?)');
  const info = stmt.run(name, hashSecret(masterKey));
  const actionId = info.lastInsertRowid;

  res.status(201).json({
    id: actionId,
    name,
    link: `/action/${actionId}`,
    message: 'Action créée. Partagez ce lien aux équipes.'
  });
});

/**
 * POST /api/actions/:id/doors
 * Enregistrer une porte visitée.
 * Body : { teamCode, building, floor, doorNumber, interaction, details }
 * Toutes les données sont chiffrées avec le teamCode avant stockage.
 */
app.post('/api/actions/:id/doors', (req, res) => {
  const actionId = parseInt(req.params.id, 10);
  // Vérifier que l'action existe et récupérer la clé maître
  const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(actionId);
  if (!action) {
    return res.status(404).json({ error: 'Action introuvable.' });
  }

  // L'équipe fournit son code (identifiant de source) et la clé de chiffrement (cipherKey).
  // Les données sont chiffrées avec cipherKey. Pour que le créateur puisse tout lire,
  // le front envoie la clé maître comme clé de chiffrement (transmise aux équipes via le lien).
  const { teamCode, building, floor, doorNumber, interaction, details, cipherKey } = req.body || {};
  if (!teamCode || teamCode.length < 2) {
    return res.status(400).json({ error: 'Un code équipe est requis.' });
  }
  if (!cipherKey || cipherKey.length < 4) {
    return res.status(400).json({ error: 'La clé de chiffrement est requise.' });
  }
  if (!floor && !doorNumber) {
    return res.status(400).json({ error: 'Précisez au moins l\'étage ou le numéro de porte.' });
  }

  const stmt = db.prepare(`
    INSERT INTO doors (action_id, team_hash, building, floor, door_number, interaction, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    actionId,
    hashSecret(teamCode),
    building ? encrypt(building, cipherKey) : null,
    encrypt(floor, cipherKey),
    encrypt(doorNumber, cipherKey),
    interaction ? encrypt(interaction, cipherKey) : null,
    details ? encrypt(details, cipherKey) : null
  );

  res.status(201).json({ message: 'Porte enregistrée.' });
});

/**
 * GET /api/actions/:id/export
 * Compilation déchiffrée des données (réservée au créateur avec la clé maître).
 * Query : ?masterKey=...
 */
app.get('/api/actions/:id/export', (req, res) => {
  const actionId = parseInt(req.params.id, 10);
  const { masterKey } = req.query;

  if (!masterKey) {
    return res.status(400).json({ error: 'La clé maître est requise pour consulter les données.' });
  }

  const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(actionId);
  if (!action) {
    return res.status(404).json({ error: 'Action introuvable.' });
  }

  // Vérifier la clé maître
  if (hashSecret(masterKey) !== action.master_key_hash) {
    return res.status(403).json({ error: 'Clé maître incorrecte.' });
  }

  // Récupérer toutes les portes
  const doors = db.prepare('SELECT * FROM doors WHERE action_id = ? ORDER BY created_at').all(actionId);

  // Déchiffrer avec la clé maître
  const decrypted = doors.map((d) => ({
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
});

// --- Démarrage ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ PAP-LFI démarré sur http://localhost:${PORT}`);
});
