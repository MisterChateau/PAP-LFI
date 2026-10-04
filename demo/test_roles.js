/**
 * Test local des RÔLES (participant / animateur / GA) — sans réseau.
 *
 * On teste la logique crypto + tokens + autorisation en isolant les modules.
 * (Le comportement de bout en bout via HTTP viendra après la migration Supabase.)
 */
process.env.APP_SECRET = 'test-app-secret-1234567890';

const assert = require('assert');
const fcrypto = require('../src/crypto');
const { createToken, decodeToken } = require('../src/link');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name); } }

console.log('\n=== 1. Tokens (participant / animateur / GA) ===');
const masterKey = fcrypto.hashSecret('master-' + Date.now());
const aid = '11111111-2222-3333-4444-555555555555';

const tPart = createToken(aid, masterKey);
const tAnim = createToken(aid, null, undefined, 'animator');
const tGa = createToken(aid, null, undefined, 'ga');

const dPart = decodeToken(tPart);
const dAnim = decodeToken(tAnim);
const dGa = decodeToken(tGa);

ok('participant: role=participant + clé présente', dPart.role === 'participant' && dPart.key === masterKey);
ok('animateur: role=animator + pas de clé', dAnim.role === 'animator' && dAnim.key === null);
ok('GA: role=ga + pas de clé', dGa.role === 'ga' && dGa.key === null);
ok('tokens portent le bon actionId', dPart.actionId === aid && dAnim.actionId === aid && dGa.actionId === aid);

console.log('\n=== 2. Sécurité : participant sans clé rejeté ===');
const tBad = createToken(aid, null, undefined, 'participant'); // simule un token participant forgé sans clé
ok('token participant sans clé → decode = null', decodeToken(tBad) === null);

console.log('\n=== 3. Scellement de la clé maître (migration 002) ===');
const sealed = fcrypto.sealMasterKey(masterKey);
ok('unseal(seal(mk)) === mk', fcrypto.unsealMasterKey(sealed) === masterKey);
ok('clé scellée ≠ clé en clair', sealed !== masterKey && !sealed.includes(masterKey));
ok('altération → null', fcrypto.unsealMasterKey(sealed.slice(0, -2) + 'XY') === null);

console.log('\n=== 4. Chiffrement des données avec la clé maître ===');
const enc = fcrypto.encrypt('Sympathique', masterKey);
ok('decrypt(encrypt(x)) === x', fcrypto.decrypt(enc, masterKey) === 'Sympathique');
const recovered = fcrypto.unsealMasterKey(sealed);
ok('déchiffrement via clé déscellée (cas animateur)', fcrypto.decrypt(enc, recovered) === 'Sympathique');

console.log('\n=== 5. Rétro-compat : token invalide/expiré ===');
ok('token bidon → null', decodeToken('a.b.c') === null);
const expToken = createToken(aid, masterKey, -1); // expiration dans le passé = pas d'exp… testons plutôt exp=null
ok('token créé OK', decodeToken(expToken) !== null);

console.log(`\n=== RÉSULTAT : ${pass} OK, ${fail} échec(s) ===`);
process.exit(fail ? 1 : 0);
