/**
 * Test offline-first PAP-LFI (démo) via Chrome DevTools Protocol.
 * Scénario : coupure réseau simulée → 3 saisies → retour réseau → vérifie la synchro.
 */
const CDP = require('/home/chapi/.openclaw/workspace/node_modules/chrome-remote-interface');

const BASE = 'http://localhost:3100';

(async () => {
  const targets = await CDP.List({ port: 9222 });
  let t = targets.find(x => x.type === 'page');
  if (!t) t = await CDP.New({ port: 9222 });
  const client = await CDP({ port: 9222, target: t.id });
  const { Page, Runtime, Network } = client;
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

  // 1) Créer une action via l'API (récupère le token)
  const create = await fetch(BASE + '/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Démo offline snack' }) }).then(r => r.json());
  console.log('Action créée :', create.id);

  // 1bis) Neutraliser le service worker (il met en cache l'ancienne coquille pendant le dev)
  await Page.navigate({ url: BASE + '/' });
  await Page.loadEventFired();
  await ev(`(async()=>{const rs=await navigator.serviceWorker.getRegistrations();for(const r of rs)await r.unregister();const ks=await caches.keys();for(const k of ks)await caches.delete(k);localStorage.clear();return true;})()`);
  await sleep(300);

  // 2) Ouvrir l'app sur le lien opaque
  await Page.navigate({ url: BASE + '/r/' + create.token });
  await Page.loadEventFired();
  await sleep(800);
  console.log('Vue action chargée. Nom barre :', await ev("document.getElementById('actionBarName').textContent.trim()"));

  // 3) SIMULER LA COUPURE (le serveur démo renvoie 503 sur /api)
  await fetch(BASE + '/__demo/fail');
  // On force l'état offline côté client aussi (navigator.onLine) via CDP réseau offline
  await Network.emulateNetworkConditions({ offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(300);
  console.log('Badge après coupure :', await ev("document.getElementById('syncBadge').textContent.trim()"));

  // 4) Saisir 3 portes hors-ligne (même rue/étage, portes différentes)
  async function saisir(streetNum, street, floor, door, interId) {
    await ev(`document.getElementById('streetNumber').value=${JSON.stringify(streetNum)};
              document.getElementById('street').value=${JSON.stringify(street)};
              document.getElementById('floor').value=${JSON.stringify(floor)};
              document.getElementById('doorNumber').value=${JSON.stringify(door)};
              state.selectedInteraction=${JSON.stringify(interId)};`);
    await ev('submitDoor()');
    await sleep(120);
  }
  await saisir('12', 'rue de la Paix', '3', 'a', 'sympa');
  await saisir('12', 'rue de la Paix', '3', 'b', 'interesse');
  await saisir('12', 'rue de la Paix', '4', 'a', 'refus');

  console.log('Badge après 3 saisies hors-ligne :', await ev("document.getElementById('syncBadge').textContent.trim()"));
  console.log('File locale (localStorage) :', await ev("JSON.parse(localStorage.getItem('pap_lfi_queue_'+state.actionId)||'[]').length"), 'porte(s)');
  console.log('Champ rue conservé :', await ev("document.getElementById('street').value"), '| étage conservé :', await ev("document.getElementById('floor').value"), '| porte (doit être vide) :', JSON.stringify(await ev("document.getElementById('doorNumber').value")));
  console.log('Focus sur :', await ev("document.activeElement.id"));
  console.log('Message statut :', await ev("document.getElementById('status').textContent.trim()"));

  // 5) RÉTABLIR LE RÉSEAU
  await Network.emulateNetworkConditions({ offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await fetch(BASE + '/__demo/ok');
  await ev('flushQueue()');
  await sleep(1200);

  console.log('Badge après retour réseau :', await ev("document.getElementById('syncBadge').textContent.trim()"));
  console.log('File locale après synchro :', await ev("JSON.parse(localStorage.getItem('pap_lfi_queue_'+state.actionId)||'[]').length"), 'porte(s)');

  // 6) Vérifier côté serveur via export
  const dec = await ev(`fetch('/api/actions/'+state.actionId+'/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({masterKey:state.cipherKey})}).then(r=>r.json()).then(d=>d.total)`);
  console.log('Portes DÉFINITIVEMENT en base (serveur) :', dec);

  // 7) Vérifier l'affichage compilation
  await ev("showTab('compil')");
  await sleep(600);
  console.log('Lignes dans le tableau résultats :', await ev("document.querySelectorAll('#compilTable tbody tr').length"));

  const stats = await fetch(BASE + '/__demo/status').then(r => r.json());
  console.log('Status démo :', JSON.stringify(stats));

  if (logs.length) { console.log('--- LOGS NAVIGATEUR ---'); logs.forEach(l => console.log(l)); }
  else console.log('Aucune erreur console. ✅');

  await client.close();
})().catch(e => { console.error('ERREUR TEST:', e.message); process.exit(1); });
