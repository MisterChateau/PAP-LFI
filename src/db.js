/**
 * PAP-LFI — Couche base de données (SQLite)
 * 
 * Tables :
 * - actions : les campagnes de porte-à-porte créées par les organisateurs
 * - doors : chaque porte visitée (données chiffrées)
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'pap.db');

// S'assurer que le dossier data existe
if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);

// Activer les clés étrangères et WAL pour la robustesse
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Schéma ---
db.exec(`
  CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,               -- nom de l'action (ex: "Porte-à-porte Quartier Nord")
    master_key_hash TEXT NOT NULL,    -- hash SHA-256 de la clé maître créateur
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS doors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_id INTEGER NOT NULL,
    team_hash TEXT NOT NULL,          -- hash du code d'équipe (pour identifier la source)
    building TEXT,                    -- nom/rue de l'immeuble (chiffré)
    floor TEXT,                       -- étage (chiffré)
    door_number TEXT,                 -- numéro de porte (chiffré)
    interaction TEXT,                 -- type d'interaction (chiffré)
    details TEXT,                     -- notes/détails (chiffré)
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (action_id) REFERENCES actions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_doors_action ON doors(action_id);
`);

module.exports = db;
