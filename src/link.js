/**
 * PAP-LFI — Génération de liens opaques (/r/<token>)
 * 
 * Le lien partagé ne doit PAS exposer l'UUID ni la clé dans l'URL.
 * On crée un token opaque (chiffré avec un secret serveur APP_SECRET)
 * qui contient { actionId, key, exp } de façon illisible.
 * 
 * 🔒 Expiration : chaque token porte une date d'expiration (exp, en ms).
 * Un lien fuité ne donne donc plus un accès PERMANENT : il expire après
 * la durée de validité (30 jours par défaut, configurable).
 * 
 * Format token : <base64url(iv)>.<base64url(tag)>.<base64url(chiffré)>
 * Tout est dans UN segment d'URL opaque.
 */

const crypto = require('crypto');

// Durée de validité par défaut d'un lien de campagne (30 jours)
const DEFAULT_EXPIRES_DAYS = 30;

// Le secret serveur doit être défini dans l'environnement (APP_SECRET)
function getSecret() {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    throw new Error('APP_SECRET n\'est pas défini. Configurez-le dans les variables d\'environnement.');
  }
  return crypto.createHash('sha256').update(secret).digest(); // 32 octets pour AES-256
}

/**
 * Encode un { actionId, key } en token opaque avec expiration.
 * @param {string} actionId - UUID de l'action
 * @param {string} key - clé de chiffrement des données
 * @param {number} [expiresInDays] - durée de validité en jours (défaut 30)
 * @returns {string} token opaque URL-safe
 */
function createToken(actionId, key, expiresInDays = DEFAULT_EXPIRES_DAYS) {
  const now = Date.now();
  // Pas d'expiration si expiresInDays <= 0 (choix explicite du créateur)
  const exp = expiresInDays > 0 ? now + expiresInDays * 24 * 60 * 60 * 1000 : null;
  const payload = JSON.stringify({ actionId, key, exp });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSecret(), iv);
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url')
  ].join('.');
}

/**
 * Décode un token opaque. Renvoie { actionId, key } ou null si invalide/expiré.
 * @param {string} token
 * @returns {{actionId: string, key: string}|null}
 */
function decodeToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', getSecret(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]);
    const parsed = JSON.parse(decrypted.toString('utf8'));
    if (!parsed.actionId || !parsed.key) return null;
    // 🔒 Expiration : refuser les liens dont la date est dépassée
    if (parsed.exp && Date.now() > parsed.exp) return null;
    return { actionId: parsed.actionId, key: parsed.key };
  } catch (e) {
    return null; // token invalide / falsifié / mauvais secret / expiré
  }
}

module.exports = { createToken, decodeToken, DEFAULT_EXPIRES_DAYS };
