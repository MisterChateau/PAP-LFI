/**
 * Test ciblé de la COUCHE LIMITER uniquement (Supabase factice → les écritures
 * échoueront en 500, mais ce qui nous intéresse c'est l'ABSENCE de 429 sur /doors).
 */
const BASE = process.env.BASE || 'http://localhost:3200';
const FAKE_UUID = '00000000-0000-4000-8000-000000000000';

(async () => {
  // 1) debug/ip masqué par défaut
  const dbg = await fetch(BASE + '/api/debug/ip');
  console.log('debug/ip défaut →', dbg.status, dbg.status === 404 ? '✅ masqué' : '❌ exposé');

  // 2) 250 écritures sur /doors : on ne doit JAMAIS voir de 429
  let codes = {};
  for (let i = 1; i <= 250; i++) {
    const r = await fetch(`${BASE}/api/actions/${FAKE_UUID}/doors`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cipherKey: 'x'.repeat(64), building: '12 rue X', floor: '3', doorNumber: String(i), interaction: 'sympa' })
    });
    codes[r.status] = (codes[r.status] || 0) + 1;
  }
  console.log('250 écritures /doors → répartition:', JSON.stringify(codes));
  console.log(codes['429'] ? '❌ 429 détecté sur /doors !' : '✅ aucun 429 sur /doors (limiter levé)');

  // 3) /export : idem, pas de limiter strict
  let expCodes = {};
  for (let i = 0; i < 150; i++) {
    const r = await fetch(`${BASE}/api/actions/${FAKE_UUID}/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ masterKey: 'k'.repeat(64) })
    });
    expCodes[r.status] = (expCodes[r.status] || 0) + 1;
  }
  console.log('150 /export → répartition:', JSON.stringify(expCodes));

  // 4) création d'action : DOIT être limitée (createLimiter = 20)
  let cCodes = {};
  for (let i = 0; i < 30; i++) {
    const r = await fetch(BASE + '/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'spam ' + i }) });
    cCodes[r.status] = (cCodes[r.status] || 0) + 1;
  }
  console.log('30 créations → répartition:', JSON.stringify(cCodes));
  console.log(cCodes['429'] ? '✅ création toujours protégée (429 présent)' : '❌ création NON protégée');
})().catch(e => { console.error('ERREUR:', e.message); process.exit(1); });
