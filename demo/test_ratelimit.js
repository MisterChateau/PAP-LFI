/**
 * Test du correctif rate-limiter : vérifie qu'on peut enchaîner >100 écritures
 * sur /doors sans 429, que POST /actions reste limité, et que le debug IP
 * est masqué par défaut.
 */
const BASE = process.env.BASE || 'http://localhost:3200';

(async () => {
  // 0) debug IP doit être 404 par défaut
  const dbg = await fetch(BASE + '/api/debug/ip');
  console.log('debug/ip par défaut →', dbg.status, dbg.status === 404 ? '✅ masqué' : '❌ exposé !');

  // 1) créer une action
  const create = await fetch(BASE + '/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test rate limit' }) });
  const cj = await create.json();
  console.log('création action →', create.status, create.status === 201 ? '✅' : '❌ ' + JSON.stringify(cj));
  if (create.status !== 201) process.exit(1);
  const { id, token } = cj;

  // récupérer la clé via /api/link
  const link = await fetch(BASE + '/api/link/' + encodeURIComponent(token)).then(r => r.json());
  const cipherKey = link.key;

  // 2) enchaîner 250 écritures de portes (au-delà de l'ancien plafond de 100)
  let ok = 0, limit = 0, other = 0;
  for (let i = 1; i <= 250; i++) {
    const r = await fetch(`${BASE}/api/actions/${id}/doors`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cipherKey, building: `12 rue de la Paix`, floor: '3', doorNumber: String(i), interaction: 'sympa', details: '' })
    });
    if (r.status === 201) ok++;
    else if (r.status === 429) limit++;
    else other++;
  }
  console.log(`250 écritures → 201:${ok} 429:${limit} autres:${other}`, limit === 0 ? '✅ aucun blocage' : '❌ BLOQUÉ par limiter');

  // 3) vérifier que POST /actions reste limité (createLimiter = 20)
  let c429 = 0, c201 = 0;
  for (let i = 0; i < 25; i++) {
    const r = await fetch(BASE + '/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'spam ' + i }) });
    if (r.status === 429) c429++; else if (r.status === 201) c201++;
  }
  console.log(`25 créations d'action → 201:${c201} 429:${c429}`, c429 > 0 ? '✅ création toujours protégée' : '⚠️ pas de 429 (plafond peut-être trop haut)');

  // 4) total final en base
  const exp = await fetch(`${BASE}/api/actions/${id}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ masterKey: cipherKey }) }).then(r => r.json());
  console.log('Portes en base =', exp.total, exp.total === 250 ? '✅' : '❌');
})().catch(e => { console.error('ERREUR:', e.message); process.exit(1); });
