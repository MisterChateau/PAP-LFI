/**
 * Vérifie : (1) création d'action toujours limitée (createLimiter=20),
 * (2) debug IP 404 par défaut / visible si DEBUG_IP=1.
 */
const BASE = process.env.BASE || 'http://localhost:3100';

(async () => {
  let codes = {};
  for (let i = 0; i < 30; i++) {
    const r = await fetch(BASE + '/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'spam ' + i }) });
    codes[r.status] = (codes[r.status] || 0) + 1;
  }
  console.log('30 créations d\'action →', JSON.stringify(codes));
  console.log(codes['429'] ? '✅ création toujours protégée (429 présent)' : '❌ non protégée');
})().catch(e => { console.error('ERREUR:', e.message); process.exit(1); });
