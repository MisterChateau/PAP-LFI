/**
 * PAP-LFI — Serveur Express principal (avec Supabase)
 * 
 * Routes :
 * - POST /api/actions            : créer une action (retourne le lien UUID à partager)
 * - POST /api/actions/:id/doors  : enregistrer une porte visitée (données chiffrées)
 * - GET  /api/actions/:id/export : compilation déchiffrée (réservée au créateur)
 * - GET  / (static)              : app web
 * 
 * L'ID d'action est un UUID (ex: 97c7335f-aab5-4bdb-9119-9113050cb0b2),
 * le lien partagé contient l'UUID + la clé maître de chiffrement.
 */

const express = require('express');
const path = require('path');
const supabase = require('./db');
const { encrypt, decrypt, hashSecret } = require('./crypto');

const app = express();
app.use(express.json({ limit: '1mb' }));

// --- Servir les fichiers statiques (front) ---
app.use(express.static(path.join(__dirname, '..', 'public')));

// Route SPA : /action/:uuid sert toujours l'app (le front lit l'UUID dans l'URL)
app.get('/action/:uuid', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Helper : valider un UUID
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(v) { return typeof v === 'string' && UUID_RE.test(v); }

// --- Routes API ---

/**
 * POST /api/actions
 * Créer une nouvelle action de porte-à-porte.
 * Body : { name: string, masterKey: string }
 * Retourne l'UUID de l'action + le lien à partager.
 */
app.post('/api/actions', async (req, res) => {
  try {
    const { name, masterKey } = req.body || {};
    if (!name || !masterKey || masterKey.length < 4) {
      return res.status(400).json({ error: 'Le nom et une clé maître (min 4 caractères) sont requis.' });
    }

    const { data, error } = await supabase
      .from('actions')
      .insert({ name, master_key_hash: hashSecret(masterKey) })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      id: data.id,
      name: data.name,
      link: `/action/${data.id}`,
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

    // Vérifier que l'action existe
    const { data: action, error: errAction } = await supabase
      .from('actions')
      .select('id')
      .eq('id', actionId)
      .maybeSingle();

    if (errAction) throw errAction;
    if (!action) {
      return res.status(404).json({ error: 'Action introuvable.' });
    }
    if (!teamCode || teamCode.length < 2) {
      return res.status(400).json({ error: 'Un code équipe est requis.' });
    }
    if (!cipherKey || cipherKey.length < 4) {
      return res.status(400).json({ error: 'La clé de chiffrement est requise.' });
    }
    if (!floor && !doorNumber) {
      return res.status(400).json({ error: 'Précisez au moins l\'étage ou le numéro de porte.' });
    }

    const { error } = await supabase.from('doors').insert({
      action_id: actionId,
      team_hash: hashSecret(teamCode),
      building: building ? encrypt(building, cipherKey) : null,
      floor: encrypt(floor, cipherKey),
      door_number: encrypt(doorNumber, cipherKey),
      interaction: interaction ? encrypt(interaction, cipherKey) : null,
      details: details ? encrypt(details, cipherKey) : null
    });

    if (error) throw error;

    res.status(201).json({ message: 'Porte enregistrée.' });
  } catch (e) {
    console.error('Erreur enregistrement porte:', e.message);
    res.status(500).json({ error: 'Erreur serveur lors de l\'enregistrement.' });
  }
});

/**
 * GET /api/actions/:id/export
 * Compilation déchiffrée des données (réservée au créateur avec la clé maître).
 * Query : ?masterKey=...
 */
app.get('/api/actions/:id/export', async (req, res) => {
  try {
    const actionId = req.params.id;
    if (!isValidUUID(actionId)) {
      return res.status(400).json({ error: 'Identifiant d\'action invalide.' });
    }
    const { masterKey } = req.query;

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

    // Vérifier la clé maître
    if (hashSecret(masterKey) !== action.master_key_hash) {
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
