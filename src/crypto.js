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

/**
 * Chiffre la clé maître avec le secret SERVEUR (APP_SECRET).
 *
 * But : permettre au serveur de retrouver la clé maître pour déchiffrer les
 * données d'une action au nom d'un ANIMATEUR légitime (qui ne connaît PAS la
 * clé maître), sans jamais stocker cette clé en clair en BDD.
 *
 * ⚠️ Si APP_SECRET change, toutes les clés maîtres scellées deviennent
 * indéchiffrables → l'export détaillé par un animateur cesse de fonctionner
 * (rétro-compat : la clé maître du lien créateur reste elle-même valable,
 * puisqu'elle n'est pas scellée mais fournie par le client).
 *
 * @param {string} masterKey - la clé maître en clair (hex)
 * @returns {string} la clé maître scellée (iv:tag:ciphertext en base64)
 */
function sealMasterKey(masterKey) {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error('APP_SECRET n\'est pas défini.');
  const sealedKey = crypto.createHash('sha256').update('pap-lfi-seal-v1:' + secret).digest();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, sealedKey, iv);
  const enc = Buffer.concat([cipher.update(String(masterKey), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/**
 * Déscelle une clé maître scellée par sealMasterKey (avec APP_SECRET).
 * @param {string} sealed - la clé maître scellée
 * @returns {string|null} la clé maître en clair, ou null si échec
 */
function unsealMasterKey(sealed) {
  try {
    const secret = process.env.APP_SECRET;
    if (!secret) return null;
    const sealedKey = crypto.createHash('sha256').update('pap-lfi-seal-v1:' + secret).digest();
    const [ivB64, tagB64, dataB64] = String(sealed).split(':');
    const decipher = crypto.createDecipheriv(ALGO, sealedKey, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return dec.toString('utf8');
  } catch (e) {
    return null;
  }
}

module.exports = { encrypt, decrypt, deriveKey, hashSecret, safeEqual, sealMasterKey, unsealMasterKey };
