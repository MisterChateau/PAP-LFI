/**
 * PAP-LFI — Module de chiffrement AES-256-GCM
 * 
 * Principe :
 * - La clé maître (générée aléatoirement, 256 bits) est fournie par le lien opaque
 * - Chaque donnée est chiffrée côté serveur avec AES-256-GCM
 * - La clé maître peut tout déchiffrer
 * - Même si la BDD est volée, les données restent illisibles
 */

const crypto = require('crypto');

// Constantes de sécurité
const ALGO = 'aes-256-gcm';
const KEY_LEN = 32; // 256 bits
const IV_LEN = 12;   // GCM standard

/**
 * Dérive une clé de chiffrement AES-256 à partir de la clé maître.
 * 
 * ⚠️ IMPORTANT (fix anti-DoS) : la clé maître est ALÉATOIRE 256 bits
 * (générée par crypto.randomBytes), pas un mot de passe humain faible.
 * PBKDF2 n'apporte donc RIEN ici (il sert à ralentir les attaques par
 * brute-force sur les mots de passe, inutile sur de l'entropie aléatoire).
 * On passe à HKDF : beaucoup plus rapide (~µs vs ~100ms), et surtout
 * SYNCHRONE et O(n) — une dérivation par requête, plus de blocage
 * de la boucle d'événements Node.
 * 
 * @param {string} masterKey - clé maître (256 bits d'entropie)
 * @returns {Buffer} clé AES-256 dérivée
 */
function deriveKey(masterKey) {
  // HKDF avec salt et info fixes (déterministe) : même masterKey → même clé
  return crypto.hkdfSync('sha256', Buffer.from(String(masterKey), 'utf8'),
    Buffer.alloc(16, 0), 'pap-lfi-key-v1', KEY_LEN);
}

/**
 * Chiffre un texte avec AES-256-GCM.
 * @param {string} plaintext - le texte en clair
 * @param {string} masterKey - la clé maître
 * @returns {string} chaîne chiffrée au format base64: sel:iv:tag:ciphertext
 */
function encrypt(plaintext, masterKey) {
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(masterKey); // une dérivation par appel (rapide)

  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format : iv:tag:ciphertext (tout en base64) — plus de sel nécessaire (HKDF fixe)
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64')
  ].join(':');
}

/**
 * Déchiffre un texte chiffré avec AES-256-GCM.
 * @param {string} encryptedData - la chaîne chiffrée (format iv:tag:ciphertext)
 * @param {string} masterKey - la clé maître
 * @returns {string} le texte en clair, ou null si échec (mauvais secret)
 */
function decrypt(encryptedData, masterKey) {
  try {
    const [ivB64, tagB64, dataB64] = encryptedData.split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');

    const key = deriveKey(masterKey);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (e) {
    return null; // mauvais secret ou données corrompues
  }
}

/**
 * Hash d'une clé/code (pour vérifier un secret sans le stocker en clair).
 * @param {string} secret
 * @returns {string} hash SHA-256
 */
function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

/**
 * Comparaison à temps constant de deux hashes (anti side-channel).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = { encrypt, decrypt, deriveKey, hashSecret, safeEqual };
