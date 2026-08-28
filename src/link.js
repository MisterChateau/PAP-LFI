/**
 * PAP-LFI — Génération de liens opaques (/r/<token>)
 * 
 * Le lien partagé ne doit PAS exposer l'UUID ni la clé dans l'URL.
 * On crée un token opaque (chiffré avec un secret serveur APP_SECRET)
 * qui contient { actionId, key } de façon illisible.
 * 
 * Format token : <base64url(iv)>.<base64url(tag)>.<base64url(chiffré)>
 * Tout est dans UN segment d'URL opaque.
 */

const crypto = require('crypto');

// Le secret serveur doit être défini dans l'environnement (APP_SECRET)
function getSecret() {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    throw new Error('APP_SECRET n\'est pas défini. Configurez-le dans les variables d\'environnement.');
  }
  return crypto.createHash('sha256').update(secret).digest(); // 32 octets pour AES-256
}

/**
 * Encode un { actionId, key } en token opaque.
 * @param {string} actionId - UUID de l'action
 * @param {string} key - clé de chiffrement des données
 * @returns {string} token opaque URL-safe
 */
function createToken(actionId, key) {
  const payload = JSON.stringify({ actionId, key });
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
 * Décode un token opaque. Renvoie { actionId, key } ou null si invalide.
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
    return { actionId: parsed.actionId, key: parsed.key };
  } catch (e) {
    return null; // token invalide / falsifié / mauvais secret
  }
}

module.exports = { createToken, decodeToken };
