// Real-browser test: loads the unpacked extension in current Chromium.
// Run inside the Playwright image (see test/browser/run.sh).
const http = require('http');
const fs = require('fs');
const { chromium } = require(process.env.PW || '/pw');

const results = [];
const ok = (name, pass, detail) => {
  results.push(pass);
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '\n     ' + String(detail).replace(/\n/g, '\n     ') : ''));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// This playwright-core build only accepts string expressions in evaluate().
const E = (target, fn, arg) => target.evaluate('(' + fn.toString() + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')');

const EXT = process.env.EXT || '/ext';
const SITE = 'http://127.0.0.1/*';

function launch(profile, extDir) {
  return chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: ['--disable-extensions-except=' + extDir, '--load-extension=' + extDir],
  });
}
const worker = async (ctx) => ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
const send = (sw, prefix) =>
  E(sw, async (prefix) => {
    const tabs = (await chrome.tabs.query({})).filter((t) => (t.url || t.pendingUrl || '').startsWith(prefix));
    // Without host access the worker cannot see tab URLs; fall back to every tab.
    const targets = tabs.length ? tabs : await chrome.tabs.query({});
    const out = [];
    for (const t of targets) {
      try { out.push(await chrome.tabs.sendMessage(t.id, { type: 'oc-copy-md' })); } catch (e) { out.push({ error: String(e) }); }
    }
    return out;
  }, prefix);
const hasPill = (page) =>
  E(page, () => { const b = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Copy as Markdown'); return b ? getComputedStyle(b).display : 'absent'; });

(async () => {
  const html = fs.readFileSync(__dirname + '/fixture.html');
  const server = http.createServer((_q, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(html));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';

  // ---- phase 1: as shipped, nothing enabled -> the extension must be inert ----
  {
    const ctx0 = await launch('/tmp/oc-profile-0', EXT);
    const sw0 = await worker(ctx0);
    await sleep(1500);
    const p = await ctx0.newPage();
    await p.goto(base);
    await sleep(800);
    await E(p, () => { const r = document.createRange(); r.selectNodeContents(document.querySelector('#p1')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return true; });
    await sleep(300);
    const replies = await send(sw0, base);
    ok('as shipped: no site access, nothing answers on the page', replies.every((r) => r.error), JSON.stringify(replies).slice(0, 200));
    ok('as shipped: no button injected', (await hasPill(p)) === 'absent', await hasPill(p));
    const granted = await E(sw0, async () => (await chrome.permissions.getAll()).origins || []);
    ok('as shipped: no host permissions held', granted.length === 0, JSON.stringify(granted));
    const reg = await E(sw0, async () => (await chrome.scripting.getRegisteredContentScripts()).length);
    ok('as shipped: no content script registered', reg === 0, reg);
    const pages0 = ctx0.pages().map((x) => x.url());
    ok('first install opens the setup/options page', pages0.some((u) => /^chrome-extension:\/\/.*\/options\.html/.test(u)), pages0.join(' | '));
    await ctx0.close();
  }

  // ---- phase 2: site enabled. The permission prompt cannot be clicked in
  // headless, so a copy of the extension gets the grant via its manifest; from
  // there on it is the shipped code path (getAll -> register -> inject). ----
  const testExt = '/tmp/ext-enabled';
  fs.cpSync(EXT, testExt, { recursive: true });
  const mf = JSON.parse(fs.readFileSync(testExt + '/manifest.json', 'utf8'));
  mf.host_permissions = [SITE];
  fs.writeFileSync(testExt + '/manifest.json', JSON.stringify(mf, null, 2));

  const ctx = await launch('/tmp/oc-profile', testExt);
  console.log('browser', ctx.browser() ? ctx.browser().version() : '(persistent)');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const sw = await worker(ctx);
  ok('extension service worker started', !!sw, sw && sw.url());
  let registered = [];
  for (let i = 0; i < 20 && !registered.length; i++) {
    await sleep(250);
    registered = await E(sw, async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.matches.join(',')));
  }
  ok('content script registered for the enabled site only', registered.length === 1 && registered[0] === SITE, JSON.stringify(registered));

  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[page error]', String(e).slice(0, 300)));
  await page.goto(base);
  await page.bringToFront();
  await sleep(800);

  const trigger = async (prefix) => (await send(sw, prefix || base))[0];
  const clip = () => E(page, () => navigator.clipboard.readText()).catch((e) => 'READ-ERROR ' + e.message);
  const select = (a, ao, b, bo) =>
    E(page, 
      function (arg) {
        function node(spec) {
          var n = document.querySelector(spec.sel);
          (spec.path || []).forEach(function (i) { n = n.childNodes[i]; });
          return n;
        }
        var r = document.createRange();
        r.setStart(node(arg.a), arg.ao);
        r.setEnd(node(arg.b), arg.bo);
        var s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        return s.toString();
      },
      { a, ao, b, bo },
    );
  const centre = (sel) => E(page, (s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + Math.min(20, r.width / 2), r.top + r.height / 2]; }, sel);
  const menus = () => E(page, () => window.__appMenus);

  // 1. menu item / shortcut path: selection from "the fix" to "thr" of item 3
  await select({ sel: '#p1 strong', path: [0] }, 0, { sel: '#li3', path: [0] }, 3);
  let reply = await trigger();
  ok('copy via background message replies ok', reply && reply.ok === true, JSON.stringify(reply));
  let text = await clip();
  ok('clipboard holds markdown of just the selection', text === '**the fix**, with *one* caveat and a [link](https://example.com/docs).\n\n1. one\n2. two\n3. thr', text);

  // 2. right-click on the selection must NOT reach the app's menu handler
  let [x, y] = await centre('#li2');
  await page.mouse.click(x, y, { button: 'right' });
  await sleep(150);
  ok('right-click on selection bypasses app menu', (await menus()) === 0, 'app menus opened: ' + (await menus()));
  ok('selection survives the right-click', (await E(page, () => getSelection().toString())).includes('two'));
  await page.keyboard.press('Escape');

  // 3. right-click elsewhere in a message still gets the app's menu
  [x, y] = await centre('#p2');
  await page.mouse.click(x, y, { button: 'right' });
  await sleep(150);
  ok('right-click outside selection keeps app menu', (await menus()) === 1, 'app menus opened: ' + (await menus()));
  await page.keyboard.press('Escape');

  // 4. shift + right-click on the selection gives the app's menu back
  await select({ sel: '#p1 strong', path: [0] }, 0, { sel: '#li3', path: [0] }, 3);
  [x, y] = await centre('#li2');
  const before = await menus();
  await page.keyboard.down('Shift');
  await page.mouse.click(x, y, { button: 'right' });
  await page.keyboard.up('Shift');
  await sleep(150);
  ok('shift + right-click on selection keeps app menu', (await menus()) === before + 1, 'app menus opened: ' + (await menus()));
  await page.keyboard.press('Escape');

  // 5. drag across two messages with the real mouse: chrome is left out, button appears
  await E(page, () => getSelection().removeAllRanges());
  const from = await E(page, () => { const r = document.querySelector('#h').getBoundingClientRect(); return [r.left + 1, r.top + r.height / 2]; });
  const to = await E(page, () => { const r = document.querySelector('#p2').getBoundingClientRect(); const rr = document.createRange(); rr.selectNodeContents(document.querySelector('#p2')); const last = rr.getClientRects(); const l = last[last.length - 1]; return [l.right + 2, l.top + l.height / 2]; });
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 5 });
  await page.mouse.move(to[0], to[1], { steps: 5 });
  await page.mouse.up();
  await sleep(300);
  const pill = await E(page, () => {
    const b = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Copy as Markdown');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { display: getComputedStyle(b).display, x: r.left + r.width / 2, y: r.top + r.height / 2, inView: r.top >= 0 && r.bottom <= innerHeight };
  });
  ok('"Copy as Markdown" button appears after a mouse selection', !!pill && pill.display !== 'none' && pill.inView, JSON.stringify(pill));
  if (pill) {
    await E(page, () => navigator.clipboard.writeText('stale'));
    await page.mouse.click(pill.x, pill.y);
    await sleep(300);
    text = await clip();
    const want = [
      '## Plan for `nginx`',
      'Here is **the fix**, with *one* caveat and a [link](https://example.com/docs).',
      '1. one\n2. two\n3. three\n4. four',
      '```bash\ncd /etc/nginx\nnginx -t\n```',
      '- **plex** — Port: 32400 · Status: up\n- **sonarr** — Port: 8989 · Status: down',
      'Second message with snake_case and 2 \\* 3.',
    ].join('\n\n');
    ok('button copies both messages as markdown, no names/times/buttons/hidden text', text === want, text);
    const toast = await E(page, () => (document.querySelector('[role="status"]') || {}).textContent || '');
    ok('toast confirms', /Copied as Markdown/.test(toast), toast);
  }

  // 6. selecting inside a text box does not show the button
  await E(page, () => { document.querySelector('#paste').focus(); return true; });
  await page.keyboard.type('hello world');
  await page.keyboard.press('Control+A');
  await sleep(200);
  const pillOnInput = await E(page, () => { const b = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Copy as Markdown'); return b ? getComputedStyle(b).display : 'absent'; });
  ok('no button for text selected in a text box', pillOnInput === 'none' || pillOnInput === 'absent', pillOnInput);

  // 7. enabling a site switches on tabs that are already open (no refresh)
  await E(sw, async () => { await chrome.scripting.unregisterContentScripts(); return true; });
  const late = await ctx.newPage();
  await late.goto(base + 'late');
  await sleep(600);
  let r = (await send(sw, base + 'late'))[0];
  ok('tab opened while the site was off has no script', !!(r && r.error), JSON.stringify(r));
  const injected = await E(sw, async (site) => { await syncSites(); return injectOpenTabs([site]); }, SITE);
  await sleep(400);
  r = (await send(sw, base + 'late'))[0];
  ok('after enabling, the already-open tab works without a refresh', !!r && r.reason === 'no-selection', 'injected into ' + injected + ' tab(s); reply ' + JSON.stringify(r));
  await late.close();

  // 8. popup and options pages
  const extBase = sw.url().replace(/background\.js$/, '');
  const tabId = await E(sw, async (prefix) => ((await chrome.tabs.query({})).find((t) => (t.url || '').startsWith(prefix)) || {}).id, base);
  const popup = await ctx.newPage();
  popup.on('pageerror', (e) => console.log('[popup error]', String(e).slice(0, 300)));
  await popup.goto(extBase + 'popup.html?tabId=' + tabId);
  await sleep(700);
  const popupText = await E(popup, () => ({ status: document.getElementById('status').textContent, enable: document.getElementById('enable').hidden, disable: document.getElementById('disable').hidden }));
  ok('popup reports the site as on and offers to turn it off', /^On for 127\.0\.0\.1:\d+\.$/.test(popupText.status) && popupText.enable === true && popupText.disable === false, JSON.stringify(popupText));
  await popup.close();
  const optionsPage = await ctx.newPage();
  optionsPage.on('pageerror', (e) => console.log('[options error]', String(e).slice(0, 300)));
  await optionsPage.goto(extBase + 'options.html');
  await sleep(700);
  const sites = await E(optionsPage, () => Array.from(document.querySelectorAll('#sites code')).map((c) => c.textContent));
  ok('options page lists the enabled site', sites.length === 1 && sites[0] === 'http://127.0.0.1', JSON.stringify(sites));
  const bad = await E(optionsPage, () => { document.getElementById('site').value = 'ftp://nope'; document.getElementById('addSite').click(); return document.getElementById('siteError').textContent; });
  ok('options page rejects a non-web address', /does not look like/.test(bad), bad);
  await optionsPage.close();

  // 9. the real Control UI on this host (login screen; not signed in)
  const real = process.env.REAL_URL;
  if (real) {
    const p2 = await ctx.newPage();
    await p2.goto(real, { waitUntil: 'domcontentloaded' }).catch((e) => console.log('goto', e.message));
    await sleep(5000);
    const info = await E(p2, () => ({ app: !!document.querySelector('openclaw-app'), text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 120) }));
    console.log('real UI:', JSON.stringify(info));
    const rr = (await send(sw, real))[0];
    ok('extension is live on the real Control UI page', !!rr && rr.reason === 'no-selection', JSON.stringify(rr));
  }

  await ctx.close();
  server.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
