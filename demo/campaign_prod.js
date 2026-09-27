/**
 * Campagne de test PROD — pap-lfi.onrender.com
 * Cible : nouveau déploiement (offline-first + rate limiter assoupli).
 * Tests : API complète, sécurité, concurrence, et surtout >100 écritures /doors
 *         pour prouver que le plafond est levé en PROD.
 */
const BASE = 'https://pap-lfi.onrender.com';

const results = [];
function ok(name, cond, detail = '') { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); }

(async () => {
  console.log('=== CAMPAGNE DE TEST PROD ===\n');

  // 1) Page + assets
  const home = await fetch(BASE + '/');
  ok('GET / → 200', home.status === 200, `status ${home.status}`);
  const html = await home.text();
  ok('Front offline-first déployé (syncBadge)', html.includes('syncBadge'));
  ok('Front : worker flushQueue présent', html.includes('flushQueue'));
  ok('Front : clearFormKeepStreet présent', html.includes('clearFormKeepStreet'));
  const man = await fetch(BASE + '/manifest.webmanifest');
  ok('manifest.webmanifest → 200', man.status === 200);
  const sw = await fetch(BASE + '/sw.js');
  ok('sw.js → 200', sw.status === 200);

  // 2) debug/ip doit être masqué (pas de DEBUG_IP en prod)
  const dbg = await fetch(BASE + '/api/debug/ip');
  ok('debug/ip masqué par défaut (404)', dbg.status === 404, `status ${dbg.status}`);

  // 3) Créer une action
  const cr = await fetch(BASE + '/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Campagne test Lenina 27/09 soir' }) });
  const cj = await cr.json();
  ok('POST /api/actions → 201', cr.status === 201, `status ${cr.status}`);
  if (cr.status !== 201) { console.log('STOP: création impossible'); return report(); }
  const { id, token } = cj;
  ok('Action : id UUID valide', /^[0-9a-f-]{36}$/i.test(id));

  // 4) Lien opaque
  const lk = await fetch(BASE + '/api/link/' + encodeURIComponent(token));
  const lj = await lk.json();
  ok('GET /api/link/<token> → 200', lk.status === 200);
  const key = lj.key;
  ok('Clé récupérée (>= 60 car)', key && key.length >= 60, `${key ? key.length : 0} car`);

  // 5) Écriture d'une porte
  const d1 = await fetch(`${BASE}/api/actions/${id}/doors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cipherKey: key, building: '12 rue de la Paix', floor: '3', doorNumber: 'a', interaction: 'sympa', details: 'test' }) });
  ok('POST /doors → 201', d1.status === 201, `status ${d1.status}`);

  // 6) Sécurité : mauvaise clé
  const bad = await fetch(`${BASE}/api/actions/${id}/doors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cipherKey: 'mauvaisecle123', building: '1 rue X', floor: '1', doorNumber: 'a', interaction: 'refus' }) });
  ok('Mauvaise clé → 403', bad.status === 403, `status ${bad.status}`);

  // 7) ⭐ LE TEST CLÉ : > 100 écritures /doors sans 429 (plafond levé en PROD)
  console.log('\n--- Test clé : 110 écritures /doors (ancien plafond = 100) ---');
  let codes = {};
  const t0 = Date.now();
  for (let i = 1; i <= 110; i++) {
    const r = await fetch(`${BASE}/api/actions/${id}/doors`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cipherKey: key, building: '12 rue de la Paix', floor: '3', doorNumber: String(i), interaction: 'sympa', details: '' })
    });
    codes[r.status] = (codes[r.status] || 0) + 1;
    if (i % 25 === 0) console.log(`  ...${i}/110 (${JSON.stringify(codes)})`);
  }
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  110 écritures en ${dur}s → ${JSON.stringify(codes)}`);
  ok('Aucun 429 sur 110 écritures /doors (plafond levé)', !codes['429'], JSON.stringify(codes));
  ok('Toutes les écritures acceptées (201)', codes['201'] === 110, `${codes['201'] || 0}/110`);

  // 8) Concurrence : 40 portes en parallèle
  console.log('\n--- Test concurrence : 40 portes en parallèle ---');
  const t1 = Date.now();
  const par = await Promise.all(Array.from({ length: 40 }, (_, i) =>
    fetch(`${BASE}/api/actions/${id}/doors`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cipherKey: key, building: '5 avenue des Lilas', floor: '2', doorNumber: 'P' + i, interaction: 'interesse', details: 'parallel' })
    }).then(r => r.status).catch(() => 'ERR')
  ));
  const parOk = par.filter(s => s === 201).length;
  console.log(`  40 en parallèle en ${((Date.now() - t1) / 1000).toFixed(1)}s → ${parOk}/40 OK`);
  ok('Concurrence 40 portes → 40/40', parOk === 40, `${parOk}/40`);

  // 9) Export : total cohérent
  const exp = await fetch(`${BASE}/api/actions/${id}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ masterKey: key }) });
  const ej = await exp.json();
  const expected = 1 + 110 + 40; // 1 test + 110 + 40 parallèle
  ok('Export → 200', exp.status === 200);
  ok(`Export total = ${expected}`, ej.total === expected, `total ${ej.total}`);
  ok('Déchiffrement OK (nom action lisible)', ej.action && ej.action.name === 'Campagne test Lenina 27/09 soir', JSON.stringify(ej.action && ej.action.name));

  // 10) Création d'action toujours protégée ? (createLimiter = 20/15min)
  console.log('\n--- createLimiter (20/15min) ---');
  let cmap = {};
  for (let i = 0; i < 25; i++) {
    const r = await fetch(BASE + '/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'spam limiter test ' + i }) });
    cmap[r.status] = (cmap[r.status] || 0) + 1;
  }
  console.log(`  25 créations → ${JSON.stringify(cmap)}`);
  ok('createLimiter actif (429 présent)', (cmap['429'] || 0) > 0, JSON.stringify(cmap));

  report();

  function report() {
    const pass = results.filter(r => r.pass).length;
    console.log(`\n=== RÉSULTAT : ${pass}/${results.length} tests OK ===`);
    const failed = results.filter(r => !r.pass);
    if (failed.length) { console.log('ÉCHECS :'); failed.forEach(f => console.log('  ❌', f.name, f.detail)); }
    else console.log('🎉 TOUS LES TESTS PASSENT');
  }
})().catch(e => { console.error('ERREUR CAMPAGNE:', e.message); process.exit(1); });
