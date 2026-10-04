/**
 * Test d'intégration des rôles via HTTP, avec une BDD Supabase MOCKÉE en mémoire.
 * Objectif : prouver que le flux complet marche (création → 3 liens → export par
 * chaque rôle), sans dépendre du réseau ni de la vraie base.
 */
const http = require('http');
const Module = require('module');
const path = require('path');

process.env.APP_SECRET = 'integration-test-secret';
process.env.SUPABASE_URL = 'http://mock.local';
process.env.SUPABASE_ANON_KEY = 'mock';

// --- Mock Supabase minimal en mémoire ---
const store = { actions: [], doors: [], short_links: [] };
let idc = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++idc).padStart(12, '0')}`;

function makeClient() {
  return {
    from(table) {
      const q = { filters: [], insert: null };
      const chain = {
        insert(row) { q.insert = Array.isArray(row) ? row : [row]; return chain; },
        select() { return chain; },
        eq(c, v) { q.filters.push([c, v]); return chain; },
        order() { return chain; },
        limit() { return chain; },
        single() { return Promise.resolve(run(true)); },
        maybeSingle() { return Promise.resolve(run(true)); },
        then(res, rej) { return Promise.resolve(run(false)).then(res, rej); }
      };
      function matches(row) { return q.filters.every(([c, v]) => row[c] === v); }
      function run(one) {
        if (q.insert) {
          const rows = q.insert.map((r) => ({ id: uuid(), created_at: new Date().toISOString(), ...r }));
          store[table].push(...rows);
          return { data: one ? rows[0] : rows, error: null };
        }
        const rows = store[table].filter(matches);
        return { data: one ? (rows[0] || null) : rows, error: null };
      }
      return chain;
    }
  };
}

// Intercepte le require('./db')
const stubPath = path.join(__dirname, '__mock_db__.js');
require.cache[stubPath] = { id: stubPath, filename: stubPath, loaded: true, exports: makeClient() };
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  const resolved = origResolve.call(this, request, ...args);
  if (resolved.endsWith(path.sep + 'db.js')) return stubPath;
  return resolved;
};

const app = require('../src/server.js');

let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✅', n)) : (fail++, console.log('  ❌', n)); };

function req(method, urlPath, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: 3999, path: urlPath, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(b); } catch { return b; } })() })); });
    r.on('error', () => resolve({ status: 0, json: null }));
    if (data) r.write(data);
    r.end();
  });
}

const server = app.listen(3999, async () => {
  console.log('\n=== Flux complet des rôles (BDD mockée) ===\n');

  // 1. Créer une action
  const create = await req('POST', '/api/actions', { name: 'Test Damesme' });
  ok('POST /api/actions → 201', create.status === 201);
  ok('réponse contient token (participant)', !!create.json.token);
  ok('réponse contient animatorToken', !!create.json.animatorToken);
  ok('réponse contient gaToken', !!create.json.gaToken);
  const { id, token, animatorToken, gaToken } = create.json;

  // 2. Décoder les 3 liens
  const lPart = await req('GET', `/api/link/${encodeURIComponent(token)}`);
  const lAnim = await req('GET', `/api/link/${encodeURIComponent(animatorToken)}`);
  const lGa = await req('GET', `/api/link/${encodeURIComponent(gaToken)}`);
  ok('lien participant → role=participant + clé', lPart.json.role === 'participant' && !!lPart.json.key);
  ok('lien animateur → role=animator + sans clé', lAnim.json.role === 'animator' && lAnim.json.key === null);
  ok('lien GA → role=ga + sans clé', lGa.json.role === 'ga' && lGa.json.key === null);

  // 2bis. 🔗 Codes COURTS
  ok('réponse contient shortCode (participant)', /^[A-Za-z0-9]{6,14}$/.test(create.json.shortCode || ''));
  ok('réponse contient animatorShortCode', /^[A-Za-z0-9]{6,14}$/.test(create.json.animatorShortCode || ''));
  const lShortPart = await req('GET', `/api/link/${create.json.shortCode}`);
  const lShortAnim = await req('GET', `/api/link/${create.json.animatorShortCode}`);
  ok('code court participant → role=participant + clé', lShortPart.json.role === 'participant' && !!lShortPart.json.key);
  ok('code court animateur → role=animator + sans clé', lShortAnim.json.role === 'animator' && lShortAnim.json.key === null);
  ok('code court inconnu → 400', (await req('GET', '/api/link/ZZZZZZZZZZ')).status === 400);

  // 3. Enregistrer une porte (avec la clé participant)
  const masterKey = lPart.json.key;
  const door = await req('POST', `/api/actions/${id}/doors`, {
    cipherKey: masterKey, building: '12 Rue de la Paix', floor: '1', doorNumber: '2',
    interaction: 'Sympathique', teamCode: 'EQ1'
  });
  ok('POST doors → 201', door.status === 201);

  // 4. Export par la clé maître (créateur)
  const expMaster = await req('POST', `/api/actions/${id}/export`, { masterKey });
  ok('export clé maître → 200 + 1 porte', expMaster.status === 200 && expMaster.json.total === 1);

  // 5. Export par TOKEN animateur (le serveur déchiffre via la clé scellée)
  const expAnim = await req('POST', `/api/actions/${id}/export`, { token: animatorToken });
  ok('export token ANIMATEUR → 200 + déchiffré', expAnim.status === 200 && expAnim.json.total === 1 && expAnim.json.doors[0].interaction === 'Sympathique');

  // 6. Export par TOKEN GA
  const expGa = await req('POST', `/api/actions/${id}/export`, { token: gaToken });
  ok('export token GA → 200 + déchiffré', expGa.status === 200 && expGa.json.doors[0].interaction === 'Sympathique');

  // 7. Export par TOKEN participant → refusé (pas de résultats détaillés)
  const expPart = await req('POST', `/api/actions/${id}/export`, { token });
  ok('export token PARTICIPANT → 403', expPart.status === 403);

  // 8. Summary par token animateur (bot /stats)
  const sumAnim = await req('POST', `/api/actions/${id}/summary`, { token: animatorToken });
  ok('summary token ANIMATEUR → 200 + compteurs', sumAnim.status === 200 && sumAnim.json.sympathique === 1 && sumAnim.json.total === 1);

  // 9. Summary par clé maître
  const sumMaster = await req('POST', `/api/actions/${id}/summary`, { masterKey });
  ok('summary clé maître → 200', sumMaster.status === 200 && sumMaster.json.positifs === 1);

  // 10. Token d'une autre action → refusé
  const create2 = await req('POST', '/api/actions', { name: 'Autre action' });
  const cross = await req('POST', `/api/actions/${create2.json.id}/export`, { token: animatorToken });
  ok('token d\'une autre action → 403', cross.status === 403);

  console.log(`\n=== RÉSULTAT : ${pass} OK, ${fail} échec(s) ===`);
  server.close();
  process.exit(fail ? 1 : 0);
});
