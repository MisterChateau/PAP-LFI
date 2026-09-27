/**
 * Campagne de test PROD via NAVIGATEUR (Chrome CDP).
 * Vérifie le parcours réel : création → saisie → HORS-LIGNE → synchro → résultats.
 */
const CDP = require('/home/chapi/.openclaw/workspace/node_modules/chrome-remote-interface');
const BASE = 'https://pap-lfi.onrender.com';

(async () => {
  const t = (await CDP.List({ port: 9222 })).find(x => x.type === 'page');
  const c = await CDP({ port: 9222, target: t.id });
  const { Runtime, Page, Network } = c;
  await Page.enable(); await Runtime.enable(); await Network.enable();

  const logs = [];
  Runtime.consoleAPICalled(e => logs.push('[console.' + e.type + '] ' + e.args.map(a => a.value ?? a.description).join(' ')));
  Runtime.exceptionThrown(e => logs.push('[EXCEPTION] ' + (e.exceptionDetails.exception?.description || e.exceptionDetails.text)));

  const ev = async (expr, awaitPromise = true) => {
    const r = await Runtime.evaluate({ expression: expr, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const results = [];
  const ok = (n, cond, d = '') => { results.push({ n, cond: !!cond }); console.log(`${cond ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); };

  // 0) Nettoyer SW/cache + créer une action via l'API
  await Page.navigate({ url: BASE + '/' });
  await Page.loadEventFired();
  await ev(`(async()=>{const rs=await navigator.serviceWorker.getRegistrations();for(const r of rs)await r.unregister();const ks=await caches.keys();for(const k of ks)await caches.delete(k);localStorage.clear();return true;})()`);
  await sleep(500);

  const create = await fetch(BASE + '/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Campagne UI Lenina 27/09 soir' }) }).then(r => r.json());
  console.log('Action UI :', create.id);

  // 1) Ouvrir le lien opaque
  await Page.navigate({ url: BASE + '/r/' + create.token });
  await Page.loadEventFired();
  await sleep(1500);
  const name = await ev("document.getElementById('actionBarName').textContent.trim()");
  ok('Lien opaque ouvre la vue saisie', name.includes('Campagne UI Lenina'), name);
  ok('Badge de sync affiché', await ev("!!document.getElementById('syncBadge')"));

  // 2) SIMULER HORS-LIGNE (côté navigateur)
  await Network.emulateNetworkConditions({ offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(400);
  console.log('Badge hors-ligne :', await ev("document.getElementById('syncBadge').textContent.trim()"));

  // 3) Saisir 4 portes hors-ligne (même rue, étage qui change)
  async function saisir(sn, st, fl, dr, it) {
    await ev(`document.getElementById('streetNumber').value=${JSON.stringify(sn)};
      document.getElementById('street').value=${JSON.stringify(st)};
      document.getElementById('floor').value=${JSON.stringify(fl)};
      document.getElementById('doorNumber').value=${JSON.stringify(dr)};
      state.selectedInteraction=${JSON.stringify(it)};`);
    await ev('submitDoor()');
    await sleep(150);
  }
  await saisir('12', 'rue de la Paix', '3', 'a', 'sympa');
  await saisir('12', 'rue de la Paix', '3', 'b', 'interesse');
  await saisir('12', 'rue de la Paix', '4', 'a', 'refus');
  await saisir('12', 'rue de la Paix', '4', 'b', 'adherent');

  const badgeHorsLigne = await ev("document.getElementById('syncBadge').textContent.trim()");
  ok('4 portes saisies hors-ligne', await ev("JSON.parse(localStorage.getItem('pap_lfi_queue_'+state.actionId)||'[]').length") === 4, badgeHorsLigne);
  ok('Rue + étage conservés après saisie', await ev("document.getElementById('street').value") === 'rue de la Paix' && await ev("document.getElementById('floor').value") === '4');
  ok('Champ N° porte vidé', await ev("document.getElementById('doorNumber').value") === '');
  ok('Focus sur N° porte', await ev("document.activeElement.id") === 'doorNumber');

  // 4) RETOUR RÉSEAU → synchro auto
  await Network.emulateNetworkConditions({ offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await ev('flushQueue()');
  await sleep(3000);
  const badgeOk = await ev("document.getElementById('syncBadge').textContent.trim()");
  ok('Synchro auto après retour réseau', badgeOk.includes('synchronisé'), badgeOk);
  ok('File locale vidée', await ev("JSON.parse(localStorage.getItem('pap_lfi_queue_'+state.actionId)||'[]').length") === 0);

  // 5) Vérifier côté serveur
  const total = await ev(`fetch('/api/actions/'+state.actionId+'/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({masterKey:state.cipherKey})}).then(r=>r.json()).then(d=>d.total)`);
  ok('4 portes reçues côté serveur', total === 4, `total ${total}`);

  // 6) Compilation
  await ev("showTab('compil')");
  await sleep(1500);
  const rows = await ev("document.querySelectorAll('#compilTable tbody tr').length");
  ok('Tableau résultats = 4 lignes', rows === 4, `${rows} lignes`);

  const errs = logs.filter(l => l.startsWith('[EXCEPTION]') || l.includes('console.error'));
  ok('Aucune erreur console', errs.length === 0, errs.join(' | '));

  const pass = results.filter(r => r.cond).length;
  console.log(`\n=== UI PROD : ${pass}/${results.length} tests OK ===`);
  if (logs.length) console.log('LOGS:', logs.join('\n'));

  await c.close();
})().catch(e => { console.error('ERREUR:', e.message); process.exit(1); });
