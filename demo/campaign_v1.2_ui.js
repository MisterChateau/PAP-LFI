/**
 * Campagne de tests PROD — PAP-LFI v1.2.x (contact section)
 * Cible : https://pap-lfi.onrender.com  (Chrome headless CDP sur le port 9223)
 *
 * Cas d'usage couverts :
 *  - Form épuré : étage/n° de porte hors formulaire principal
 *  - GPS discret (icône inline dans le champ Rue)
 *  - Bandeau de prise de contact contextuel (uniquement sur interaction positive)
 *  - Pattern "morph" : case consentement → déploiement ; ✕ = annuler
 *  - Garde-fou RGPD : étage/porte enregistrés SEULEMENT si consentement coché
 *  - Tableau animateur ADAPTATIF : colonnes Étage/N° porte masquées si vides
 *  - Export CSV COMPLET et aligné (8 colonnes) malgré le tableau adaptatif
 */
const CDP = require('/home/chapi/.openclaw/workspace/node_modules/chrome-remote-interface');
const BASE = 'https://pap-lfi.onrender.com';
const PORT = 9223;

const results = [];
const ok = (n, cond, d = '') => { results.push({ n, cond: !!cond, d }); console.log(`${cond ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('=== CAMPAGNE UI PROD — v1.2 contact ===\n');

  // 0) Déploiement / version
  const home = await fetch(BASE + '/');
  const html = await home.text();
  ok('GET / → 200', home.status === 200, `status ${home.status}`);
  ok('Version déployée = 2026-10-11.7', html.includes("APP_VERSION = '2026-10-11.7'"));
  ok('Front contient contactPrompt', html.includes('contactPrompt'));
  ok('Front contient toggleContact/dismissContact', html.includes('toggleContact') && html.includes('dismissContact'));
  ok('Front contient lastCompilDoors (fix CSV)', html.includes('lastCompilDoors'));
  ok('Front contient le fix F5/SW (pap_current_action + hadController)', html.includes('pap_current_action') && html.includes('hadController'));

  // Action A (aucun contact) et Action B (avec contact)
  const mk = (name) => fetch(BASE + '/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).then(r => r.json());
  const A = await mk('TEST v1.2 A — sans contact');
  const B = await mk('TEST v1.2 B — avec contact');
  ok('Création action A', !!A.id && !!A.token);
  ok('Création action B', !!B.id && !!B.token);

  const keyA = (await fetch(BASE + '/api/link/' + encodeURIComponent(A.token)).then(r => r.json())).key;
  const keyB = (await fetch(BASE + '/api/link/' + encodeURIComponent(B.token)).then(r => r.json())).key;

  // --- Connexion CDP ---
  const tgt = (await CDP.List({ port: PORT })).find(x => x.type === 'page');
  const c = await CDP({ port: PORT, target: tgt.id });
  const { Runtime, Page } = c;
  await Page.enable(); await Runtime.enable();
  const ev = async (expr, awaitPromise = true) => {
    const r = await Runtime.evaluate({ expression: expr, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const nav = async (url) => { await Page.navigate({ url }); await Page.loadEventFired(); await waitFor("typeof state!=='undefined' && !!state.actionId && document.getElementById('interactionsBox') && document.getElementById('interactionsBox').children.length>0", 25000); };
  const waitFor = async (expr, timeoutMs = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try { if (await ev(expr)) return true; } catch (e) {}
      await sleep(250);
    }
    return false;
  };
  const waitCompil = () => waitFor("document.getElementById('compilStats') && !/Chargement/.test(document.getElementById('compilStats').textContent)", 20000);
  const clickInteraction = (id) => ev(`(function(){var e=[...document.querySelectorAll('#interactionsBox .interaction')].find(x=>x.dataset.id===${JSON.stringify(id)}); if(!e) return 'no'; e.click(); return 'ok';})()`);
  const setConsent = (on) => ev(`(function(){var c=document.getElementById('contactConsent'); c.checked=${on ? 'true' : 'false'}; if(typeof toggleContact==='function') toggleContact(); return c.checked;})()`);
  const submit = async (sn, st, it) => ev(`(function(){document.getElementById('streetNumber').value=${JSON.stringify(sn)};document.getElementById('street').value=${JSON.stringify(st)};return submitDoor();})()`);

  // Nettoyer SW/cache avant test
  await Page.navigate({ url: BASE + '/' });
  await Page.loadEventFired();
  await ev(`(async()=>{const rs=await navigator.serviceWorker.getRegistrations();for(const r of rs)await r.unregister();const ks=await caches.keys();for(const k of ks)await caches.delete(k);localStorage.clear();return true;})()`);

  // ================= PARTICIPANT (action B) =================
  console.log('\n--- 1) Formulaire épuré (participant) ---');
  await nav(BASE + '/r/' + (B.shortCode || B.token));
  await waitFor("/TEST v1.2 B/.test(document.getElementById('actionBarName').textContent)", 15000);
  ok('Vue saisie ouverte', (await ev("document.getElementById('actionBarName').textContent")).includes('TEST v1.2 B'), await ev("document.getElementById('actionBarName').textContent"));
  ok('contactFields caché au départ', await ev("document.getElementById('contactFields').classList.contains('hidden')"));
  ok('#floor est DANS #contactFields (hors form principal)', await ev("!!document.getElementById('floor').closest('#contactFields')"));
  ok('#doorNumber est DANS #contactFields', await ev("!!document.getElementById('doorNumber').closest('#contactFields')"));
  ok('GPS inline (.gps-inline) présent', await ev("!!document.querySelector('.gps-inline')"));
  ok('Ancien .gps-btn supprimé', (await ev("document.querySelectorAll('.gps-btn').length")) === 0);
  ok('GPS inline dans le champ Rue (.input-group)', await ev("!!document.querySelector('.input-group .gps-inline')"));

  // F5 / rafraîchissement : on doit rester dans l'action (pas revenir à l'accueil)
  await Page.reload();
  await Page.loadEventFired();
  await waitFor("typeof state!=='undefined' && !!state.actionId && document.getElementById('interactionsBox') && document.getElementById('interactionsBox').children.length>0", 25000);
  ok('F5 : on reste dans l\'action (pas de retour accueil)', (await ev("document.getElementById('actionBarName').textContent")).includes('TEST v1.2 B'), await ev("document.getElementById('actionBarName').textContent"));
  ok('F5 : URL sans token (pathname = /)', (await ev('location.pathname')) === '/');

  console.log('\n--- 2) Bandeau de contact contextuel ---');
  await clickInteraction('refus');
  ok('Interaction négative (refus) → PAS de bandeau', await ev("document.getElementById('contactPrompt').classList.contains('hidden')"));
  await clickInteraction('interesse');
  ok('Interaction positive (intéressé·e) → bandeau affiché', await ev("!document.getElementById('contactPrompt').classList.contains('hidden')"));
  ok('Champs contact encore cachés (avant coche)', await ev("document.getElementById('contactFields').classList.contains('hidden')"));
  ok('Case consentement + ✕ présents dans le bandeau', await ev("!!document.querySelector('#contactPrompt .contact-consent input') && !!document.querySelector('#contactPrompt .contact-x')"));

  console.log('\n--- 3) Morph (coche → déploiement) + ✕ ---');
  await setConsent(true);
  ok('Coche consentement → champs contact affichés', await ev("!document.getElementById('contactFields').classList.contains('hidden')"));
  await ev("dismissContact()");
  ok('✕ → champs cachés', await ev("document.getElementById('contactFields').classList.contains('hidden')"));
  ok('✕ → case décochée', (await ev("document.getElementById('contactConsent').checked")) === false);
  ok('✕ → bandeau caché', await ev("document.getElementById('contactPrompt').classList.contains('hidden')"));

  console.log('\n--- 4) Garde-fou RGPD (étage/porte seulement si consentement) ---');
  // Porte 1 : refus, sans contact
  await clickInteraction('refus');
  await submit('10', 'rue des Tests');
  // Porte 2 : positif + consentement + étage/porte
  await clickInteraction('interesse');
  await setConsent(true);
  await ev("document.getElementById('floor').value='3'; document.getElementById('doorNumber').value='12B';");
  await submit('10', 'rue des Tests');
  // Porte 3 : positif, on remplit étage/porte puis on DÉCOCHE → ne doit RIEN enregistrer
  await clickInteraction('interesse');
  await setConsent(true);
  await ev("document.getElementById('floor').value='9'; document.getElementById('doorNumber').value='ZZ';");
  await setConsent(false); // décoche → les valeurs restent dans le DOM mais ne doivent pas être envoyées
  await submit('10', 'rue des Tests');
  await waitFor("JSON.parse(localStorage.getItem('pap_lfi_queue_'+state.actionId)||'[]').length===0", 15000);
  await sleep(1200);

  const expB = await fetch(`${BASE}/api/actions/${B.id}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ masterKey: keyB }) }).then(r => r.json());
  ok('3 portes enregistrées côté serveur', expB.total === 3, `total ${expB.total}`);
  const withLoc = (expB.doors || []).filter(d => d.floor === '3' && d.doorNumber === '12B');
  ok('Porte avec consentement : étage/porte enregistrés', withLoc.length === 1, JSON.stringify((expB.doors || []).map(d => [d.floor, d.doorNumber])));
  const leaked = (expB.doors || []).filter(d => d.floor === '9' || d.doorNumber === 'ZZ');
  ok('Porte SANS consentement : étage/porte NON enregistrés (RGPD)', leaked.length === 0, `${leaked.length} fuite(s)`);

  console.log('\n--- 5) Vue animateur : tableau ADAPTATIF ---');
  // Action A : 2 portes SANS étage/porte
  await nav(BASE + '/r/' + (A.shortCode || A.token));
  await clickInteraction('sympa'); await submit('1', 'rue A');
  await clickInteraction('refus'); await submit('1', 'rue A');
  await waitFor("JSON.parse(localStorage.getItem('pap_lfi_queue_'+state.actionId)||'[]').length===0", 15000);
  await sleep(800);
  await nav(BASE + '/a/' + (A.animatorShortCode || A.animatorToken));
  await waitCompil();
  const headA = await ev("[...document.querySelectorAll('#compilTable thead th')].map(t=>t.textContent).join('|')");
  ok('Table A (aucun contact) : pas de colonne Étage', !headA.includes('Étage'), headA);
  ok('Table A : pas de colonne N° porte', !headA.includes('N° porte'), headA);
  ok('Table A : colonnes clés présentes (Rue|Interaction)', headA.includes('Rue') && headA.includes('Interaction'));

  // Action B : une porte avec étage/porte → colonnes visibles
  await nav(BASE + '/a/' + (B.animatorShortCode || B.animatorToken));
  await waitCompil();
  const headB = await ev("[...document.querySelectorAll('#compilTable thead th')].map(t=>t.textContent).join('|')");
  ok('Table B (1 contact) : colonne Étage présente', headB.includes('Étage'), headB);
  ok('Table B : colonne N° porte présente', headB.includes('N° porte'), headB);

  console.log('\n--- 6) Export CSV complet & aligné ---');
  await ev(`(function(){window.__csv=null;const _c=URL.createObjectURL.bind(URL);URL.createObjectURL=(b)=>{const fr=new FileReader();fr.onload=()=>{window.__csv=fr.result};fr.readAsText(b);return _c(b);};})()`);
  await ev("exportCsv()");
  await sleep(600);
  const csv = await ev("window.__csv");
  const lines = (csv || '').split('\n').filter(l => l.trim() !== '');
  const header = (lines[0] || '').split(';');
  ok('CSV : en-tête = 8 colonnes', header.length === 8, `${header.length} : ${lines[0]}`);
  ok('CSV contient Étage ET N° porte', csv.includes('Étage') && csv.includes('N° porte'));
  const rowCols = lines.slice(1).map(l => l.split(';').length);
  ok('CSV : toutes les lignes alignées (8 colonnes)', rowCols.every(n => n === 8), JSON.stringify(rowCols));
  ok('CSV : 3 lignes de données (action B)', lines.length - 1 === 3, `${lines.length - 1}`);

  // --- 7) Accueil PWA installée : accès par lien collé ---
  console.log('\n--- 7) Accueil PWA installée (accès par lien collé) ---');
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] });
  await ev("try{localStorage.removeItem('pap_current_action')}catch(e){}");
  await Page.navigate({ url: BASE + '/' });
  await Page.loadEventFired();
  await sleep(1200);
  ok('PWA installée : bloc \"Accéder à l\'action\" visible', !(await ev("document.getElementById('homeAccessBox').classList.contains('hidden')")));
  ok('extractToken(URL complète) OK', (await ev("extractToken('https://pap-lfi.onrender.com/r/" + (B.shortCode || B.token) + "')")) === (B.shortCode || B.token));
  await ev("document.getElementById('homeAccessInput').value='https://pap-lfi.onrender.com/r/" + (B.shortCode || B.token) + "'; accessFromHome();");
  await waitFor("typeof state!=='undefined' && !!state.actionId && document.getElementById('interactionsBox') && document.getElementById('interactionsBox').children.length>0", 25000);
  ok('Lien collé → ouvre bien l\'action', (await ev("document.getElementById('actionBarName').textContent")).includes('TEST v1.2 B'));
  await c.send('Emulation.setEmulatedMedia', { features: [] });

  // --- Nettoyage : purge des actions de test ---
  console.log('\n--- 8) Nettoyage (purge RGPD des actions de test) ---');
  for (const [id, key] of [[A.id, keyA], [B.id, keyB]]) {
    const r = await fetch(`${BASE}/api/actions/${id}/purge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ masterKey: key }) });
    ok('Purge action ' + id.slice(0, 8), r.ok, `status ${r.status}`);
  }

  const pass = results.filter(r => r.cond).length;
  console.log(`\n=== RÉSULTAT : ${pass}/${results.length} tests OK ===`);
  const failed = results.filter(r => !r.cond);
  if (failed.length) { console.log('ÉCHECS :'); failed.forEach(f => console.log('  ❌', f.n, f.d)); }
  else console.log('🎉 TOUS LES TESTS PASSENT');

  await c.close();
})().catch(e => { console.error('ERREUR CAMPAGNE:', e.message); process.exit(1); });
