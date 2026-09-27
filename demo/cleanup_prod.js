/**
 * Nettoyage des actions de test créées en prod pendant la campagne.
 * On purge les portes des actions dont le nom commence par un motif de test.
 * ⚠️ Nécessite la clé maître → on ne peut purger QUE ce qu'on a créé, et on ne
 * connaît les clés que pour les actions créées via token. Pour les actions de test
 * API on a le token. On liste via... pas d'endpoint de listing → on purge au cas par cas.
 *
 * Simplification : on purge les actions dont on a RÉCUPÉRÉ le token dans cette session
 * (API campaign + UI). Les actions "spam limiter test" sont vides (0 porte) → inoffensives,
 * elles seront purgées automatiquement par la purge RGPD à 30 jours.
 */
const BASE = 'https://pap-lfi.onrender.com';

// Actions dont on connaît le token (donc purgeables) — passées en argument
const targets = process.argv.slice(2); // format: id:token

(async () => {
  if (targets.length === 0) {
    console.log('Aucune cible fournie (id:token). Les actions vides de test seront purgées automatiquement à 30j.');
    return;
  }
  for (const t of targets) {
    const [id, token] = t.split(':');
    const lk = await fetch(BASE + '/api/link/' + encodeURIComponent(token)).then(r => r.json());
    if (!lk.key) { console.log('⚠️ clé introuvable pour', id); continue; }
    const r = await fetch(`${BASE}/api/actions/${id}/purge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ masterKey: lk.key }) });
    const d = await r.json();
    console.log(r.ok ? '🗑️ purgé' : '❌ échec', id, JSON.stringify(d));
  }
})().catch(e => { console.error('ERREUR:', e.message); process.exit(1); });
