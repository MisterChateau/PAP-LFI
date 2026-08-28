/**
 * PAP-LFI — Module de chiffrement AES-256-GCM
 * 
 * Principe :
 * - Le code d'équipe dérive une clé via PBKDF2 (jamais stockée en clair)
 * - Chaque donnée est chiffrée côté serveur avec AES-256-GCM
 * - Une clé maître "créateur" peut tout déchiffrer
 * - Même si la BDD est volée, les données restent illisibles
 */

const crypto = require('crypto');

// Constantes de sécurité
const ALGO = 'aes-256-gcm';
const PBKDF2_ITERATIONS = 100000;
const KEY_LEN = 32; // 256 bits
const IV_LEN = 12;   // GCM standard
const SALT_LEN = 16;

/**
 * Dérive une clé de chiffrement à partir d'un code secret.
 * Utilise PBKDF2-SHA256 avec un sel aléatoire.
 * @param {string} secret - le code d'équipe ou la clé maître
 * @param {Buffer} salt - sel aléatoire
 * @returns {Buffer} clé AES-256
 */
function deriveKey(secret, salt) {
  return crypto.pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, KEY_LEN, 'sha256');
}

/**
 * Chiffre un texte avec AES-256-GCM.
 * @param {string} plaintext - le texte en clair
 * @param {string} secret - le code secret (équipe ou maître)
 * @returns {string} chaîne chiffrée au format base64: sel:iv:tag:ciphertext
 */
function encrypt(plaintext, secret) {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(secret, salt);

  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format : sel:iv:tag:ciphertext (tout en base64)
  return [
    salt.toString('base64'),
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64')
  ].join(':');
}

/**
 * Déchiffre un texte chiffré avec AES-256-GCM.
 * @param {string} encryptedData - la chaîne chiffrée (format sel:iv:tag:ciphertext)
 * @param {string} secret - le code secret
 * @returns {string} le texte en clair, ou null si échec (mauvais secret)
 */
function decrypt(encryptedData, secret) {
  try {
    const [saltB64, ivB64, tagB64, dataB64] = encryptedData.split(':');
    const salt = Buffer.from(saltB64, 'base64');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');

    const key = deriveKey(secret, salt);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (e) {
    return null; // mauvais secret ou données corrompues
  }
}

/**
 * Hash d'un code (pour vérifier un code sans le stocker en clair).
 * @param {string} secret
 * @returns {string} hash SHA-256
 */
function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

module.exports = { encrypt, decrypt, deriveKey, hashSecret };
