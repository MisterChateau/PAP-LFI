const CDP = require('/home/chapi/.openclaw/workspace/node_modules/chrome-remote-interface');
const BASE = 'https://pap-lfi.onrender.com';
const PORT = 9223;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const cr = await fetch(BASE + '/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'DEBUG v1.2' }) }).then(r => r.json());
  console.log('create:', JSON.stringify({ id: cr.id, hasToken: !!cr.token, shortCode: cr.shortCode, animShort: cr.animatorShortCode }));

  const tgt = (await CDP.List({ port: PORT })).find(x => x.type === 'page');
  const c = await CDP({ port: PORT, target: tgt.id });
  const { Runtime, Page } = c;
  await Page.enable(); await Runtime.enable();
  const logs = [];
  Runtime.consoleAPICalled(e => logs.push('[c.' + e.type + '] ' + e.args.map(a => a.value ?? a.description).join(' ')));
  Runtime.exceptionThrown(e => logs.push('[EXC] ' + (e.exceptionDetails.exception?.description || e.exceptionDetails.text)));
  const ev = async (expr, awaitPromise = true) => {
    const r = await Runtime.evaluate({ expression: expr, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) return 'EVALERR:' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  const url = BASE + '/r/' + (cr.shortCode || cr.token);
  console.log('nav →', url);
  await Page.navigate({ url });
  await Page.loadEventFired();
  await sleep(4000);

  console.log('pathname  :', await ev('location.pathname'));
  console.log('barName   :', await ev("document.getElementById('actionBarName') ? document.getElementById('actionBarName').textContent : 'n/a'"));
  console.log('state.act :', await ev("typeof state!=='undefined' ? state.actionId : 'no state'"));
  console.log('cipherLen :', await ev("typeof state!=='undefined' ? (state.cipherKey||'').length : -1"));
  console.log('role      :', await ev("typeof state!=='undefined' ? state.role : '?'"));
  console.log('interBox  :', await ev("document.getElementById('interactionsBox') ? document.getElementById('interactionsBox').children.length : 'n/a'"));
  console.log('view-action hidden:', await ev("document.getElementById('view-action').classList.contains('hidden')"));
  console.log('LOG:', logs.join(' | '));

  // --- Test chemin TOKEN LONG ---
  const urlLong = BASE + '/r/' + cr.token;
  console.log('\nnav (long) →', urlLong.slice(0, 60) + '...');
  await Page.navigate({ url: urlLong });
  await Page.loadEventFired();
  await sleep(4000);
  console.log('LONG barName :', await ev("document.getElementById('actionBarName') ? document.getElementById('actionBarName').textContent : 'n/a'"));
  console.log('LONG state.act:', await ev("typeof state!=='undefined' ? state.actionId : 'no state'"));
  console.log('LONG cipherLen:', await ev("typeof state!=='undefined' ? (state.cipherKey||'').length : -1"));
  console.log('LONG LOG:', logs.slice(-4).join(' | '));

  // purge debug action
  const key = (await fetch(BASE + '/api/link/' + encodeURIComponent(cr.token)).then(r => r.json())).key;
  await fetch(`${BASE}/api/actions/${cr.id}/purge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ masterKey: key }) });
  console.log('purged debug action');
  await c.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
