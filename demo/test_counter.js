/**
 * Test du COMPTEUR OPTIMISTE PAP-LFI (démo, CDP).
 * Vérifie : le compteur s'incrémente DÈS la saisie (file locale), même hors-ligne,
 * puis reste correct après resynchronisation serveur.
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
  const counterNum = () => ev(`(document.querySelector('#counter .nums span')||{}).textContent || ''`);
  const counterLabel = () => ev(`(document.querySelector('#counter .label')||{}).textContent || ''`);

  const results = [];
  const check = (name, cond, detail) => { results.push(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

  // 0) Créer une action
  const create = await fetch(BASE + '/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test compteur optimiste' }) }).then(r => r.json());
  console.log('Action créée :', create.id);

  // 0bis) Reset SW/caches/localStorage
  await Page.navigate({ url: BASE + '/' });
  await Page.loadEventFired();
  await ev(`(async()=>{const rs=await navigator.serviceWorker.getRegistrations();for(const r of rs)await r.unregister();const ks=await caches.keys();for(const k of ks)await caches.delete(k);localStorage.clear();return true;})()`);
  await sleep(300);

  // 1) Ouvrir le lien opaque
  await Page.navigate({ url: BASE + '/r/' + create.token });
  await Page.loadEventFired();
  await sleep(700);
  let n = await counterNum();
  check('Compteur initial à 0', n === '0', `affiché="${n}" label="${await counterLabel()}"`);

  const fill = async () => ev(`(()=>{
    document.getElementById('streetNumber').value='12';
    document.getElementById('street').value='Rue de la Révolte';
    document.getElementById('floor').value='3';
    document.getElementById('doorNumber').value='A';
    const box=document.getElementById('interactionsBox');
    state.selectedInteraction='sympathisant';
    return true;})()`);

  // 2) RÉSEAU COUPÉ → 3 saisies → le compteur doit monter à 3 malgré le hors-ligne
  await fetch(BASE + '/__demo/fail');
  await fill(); await ev(`submitDoor()`); await sleep(400);
  n = await counterNum();
  check('Hors-ligne : compteur = 1 après 1re saisie', n === '1', `affiché="${n}" label="${await counterLabel()}"`);

  await fill(); await ev(`submitDoor()`); await sleep(150);
  await fill(); await ev(`submitDoor()`); await sleep(150);
  n = await counterNum(); const l = await counterLabel();
  check('Hors-ligne : compteur = 3 après 3 saisies', n === '3', `affiché="${n}" label="${l}"`);
  check('Label mentionne "en attente"', /en attente/.test(l), `label="${l}"`);
  const pending = await ev(`readQueue().length`);
  check('File locale = 3 portes', pending === 3, `file=${pending}`);

  // 3) RÉSEAU RÉTABLI → laisser la file se vider (le garde anti-réentrance peut
  //    court-circuiter un appel manuel si le filet périodique tourne déjà) →
  //    compteur doit rester 3, label revenir à la normale.
  await fetch(BASE + '/__demo/ok');
  // Boucle d'attente : la file locale doit atteindre 0 (max ~20 s, tick = 15 s + backoff).
  let pendWait = 99;
  for (let i = 0; i < 25; i++) {
    await ev(`flushQueue()`);
    pendWait = await ev(`readQueue().length`);
    if (pendWait === 0) break;
    await sleep(1000);
  }
  await sleep(500);
  n = await counterNum(); const l2 = await counterLabel();
  check('Après synchro : compteur toujours = 3 (pas de recul)', n === '3', `affiché="${n}" label="${l2}"`);
  check('Après synchro : plus de "en attente"', !/en attente/.test(l2), `label="${l2}" file=${pendWait}`);
  const dbCount = await fetch(BASE + '/__demo/status').then(r => r.json());
  check('Serveur : 3 portes enregistrées', dbCount.doors === 3, `serveur=${dbCount.doors}`);

  // 4) NOUVELLE saisie en ligne → incrément immédiat (4)
  await fill(); await ev(`submitDoor()`); await sleep(800);
  n = await counterNum();
  check('En ligne : compteur = 4 après nouvelle saisie', n === '4', `affiché="${n}" label="${await counterLabel()}"`);

  // 5) Le compteur et la compil s'accordent
  await ev(`(async()=>{await loadCompil();})()`); await sleep(700);
  const compilTotal = await ev(`document.querySelector('#compilStats .big') ? document.querySelector('#compilStats .big').textContent : ''`);
  check('Compilation = 4 portes (accord compteur/compil)', compilTotal === '4', `compil="${compilTotal}"`);

  console.log('\n=== RÉSULTATS ===');
  results.forEach(r => console.log(r));
  const jsErrors = logs.filter(x => x.startsWith('[EXCEPTION]'));
  check('Aucune exception JS', jsErrors.length === 0, jsErrors.join(' | '));
  console.log(`\nJS exceptions: ${jsErrors.length}`);
  const ko = results.filter(r => r.startsWith('❌')).length;
  console.log(ko === 0 ? '\n🎉 TOUS LES TESTS PASSENT' : `\n⚠️ ${ko} échec(s)`);

  await client.close();
  process.exit(ko === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
