/**
 * Test limiter (version rapide) — le plafond historique était 100 écritures/IP.
 * On envoie 130 écritures sur /doors : si aucune 429 → le limiter d'écriture est bien levé.
 */
const BASE = process.env.BASE || 'http://localhost:3100';
const FAKE_UUID = '00000000-0000-4000-8000-000000000000';
const N = 130;

(async () => {
  const dbg = await fetch(BASE + '/api/debug/ip');
  console.log('debug/ip défaut →', dbg.status, dbg.status === 404 ? '✅ masqué' : '❌ exposé');

  let codes = {};
  // concurrency faible, mais on dépasse largement l'ancien plafond de 100
  for (let i = 1; i <= N; i++) {
    const r = await fetch(`${BASE}/api/actions/${FAKE_UUID}/doors`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cipherKey: 'x'.repeat(64), building: '12 rue X', floor: '3', doorNumber: String(i), interaction: 'sympa' })
    });
    codes[r.status] = (codes[r.status] || 0) + 1;
    if (i % 20 === 0) console.log(`  ...${i}/${N} (${JSON.stringify(codes)})`);
  }
  console.log(`RÉSULTAT ${N} écritures /doors →`, JSON.stringify(codes));
  console.log(codes['429'] ? '❌ 429 détecté (limiter encore actif)' : '✅ aucun 429 : plafond de 100 levé');
})().catch(e => { console.error('ERREUR:', e.message); process.exit(1); });
