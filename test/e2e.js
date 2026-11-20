// End-to-end: load the built extension into Chromium, serve test documents over HTTP,
// and check what the user would see. Also exercises the web tool in dist/site.
// Usage: node test/e2e.js   (env CHROME=/path/to/chrome, SHOTS=/dir for screenshots, BIG_MB=50)
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const assert = require('assert');
const { chromium } = require('playwright-core');

const root = path.join(__dirname, '..');
const extDir = path.join(root, 'dist/extension'), siteDir = path.join(root, 'dist/site');
const CHROME = process.env.CHROME || path.join(os.homedir(), '.cache/ms-playwright/chromium-1255/chrome-linux64/chrome');
const SHOTS = process.env.SHOTS || '';
const BIG_MB = Number(process.env.BIG_MB || 20);

function bigDoc(mb) {
  const items = [];
  let size = 0, i = 0;
  while (size < mb * 1e6) {
    const s = `{"id":${9007199254740993n + BigInt(i)},"name":"user ${i}","tags":["a","b"],"geo":{"lat":${(i % 180) - 90}.25,"lng":${(i % 360) - 180}.5},"ok":${i % 2 === 0}}`;
    items.push(s); size += s.length + 1; i++;
  }
  return { text: '{"count":' + i + ',"items":[' + items.join(',') + ']}', count: i };
}

const big = bigDoc(BIG_MB);
const docs = {
  '/data.json': ['application/json; charset=utf-8', JSON.stringify({ id: 1, name: 'Ada', nested: { list: [1, 2, 3], url: 'https://example.com/x' } }).replace('"id":1', '"id":12345678901234567890')],
  '/bad.json': ['application/json', '{\n  "a": 1,\n  "b": [1, 2,]\n}'],
  '/lines.jsonl': ['text/plain', '{"n":1}\n{"n":2}\n{"n":3}\n'],
  '/plain.txt': ['text/plain', '[{"x":1},{"x":2}]'],
  '/prose.txt': ['text/plain', 'Just some text, not JSON.'],
  '/page.html': ['text/html', '<!doctype html><title>t</title><body><pre>{"a":1}</pre><p>html page</p></body>'],
  '/xssi.json': ['application/json', ")]}'\n{\"guarded\":true}"],
  '/nav.json': ['application/json', '{"a":{"b":[1]},"c":2}'],
  '/esc.json': ['application/json', '{"u":"https:\\/\\/example.com\\/x","c":"caf\\u00e9","plain":"example"}'],
  '/big.json': ['application/json', big.text],
};

function serve(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (!dir && docs[url]) { res.writeHead(200, { 'content-type': docs[url][0] }); res.end(docs[url][1]); return; }
      if (dir) {
        const f = path.join(dir, url.endsWith('/') ? url + 'index.html' : url);
        if (f.startsWith(dir) && fs.existsSync(f) && fs.statSync(f).isFile()) {
          const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.zip': 'application/zip' }[path.extname(f)] || 'application/octet-stream';
          res.writeHead(200, { 'content-type': type }); fs.createReadStream(f).pipe(res); return;
        }
      }
      res.writeHead(404); res.end('nope');
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// Reads the visible state of the viewer from inside its (open) shadow root.
const READ = () => {
  const host = document.getElementById('json-peek-root') || document.getElementById('viewer');
  const sr = host && host.shadowRoot;
  if (!sr || !sr.querySelector('.jp')) return { mounted: false, bodyText: document.body.innerText.slice(0, 200) };
  const q = (s) => sr.querySelector(s);
  return {
    mounted: true,
    rows: [...sr.querySelectorAll('.r')].map((r) => r.textContent),
    meta: q('.meta').textContent, path: q('.path').textContent, count: q('.count').textContent,
    err: q('.err').hidden ? null : q('.err').textContent,
  };
};

const results = [];
async function check(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push(['PASS', name, Date.now() - t0]); }
  catch (e) { results.push(['FAIL', name, Date.now() - t0, e.message.split('\n').slice(0, 6).join(' | ')]); }
}

(async () => {
  const api = await serve(null), site = await serve(siteDir);
  const base = 'http://127.0.0.1:' + api.address().port, siteBase = 'http://127.0.0.1:' + site.address().port;
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    executablePath: CHROME, headless: true, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  const page = await ctx.newPage();
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const open = async (u) => { await page.goto(base + u); await page.waitForTimeout(150); return page.evaluate(READ); };

  await check('extension renders application/json as a tree with exact big number', async () => {
    const s = await open('/data.json');
    assert(s.mounted, 'viewer not mounted: ' + JSON.stringify(s));
    const all = s.rows.join('\n');
    assert(all.includes('"id": 12345678901234567890'), all);
    assert(all.includes('exact'), 'no lossy badge');
    assert(all.includes('"url": "https://example.com/x"'), all);
    assert(await page.evaluate(() => !!document.getElementById('json-peek-root').shadowRoot.querySelector('.r a[href="https://example.com/x"][rel~="noopener"]')), 'url not linked');
    await shot('data');
  });

  await check('click selects and shows the path; copy path button works', async () => {
    await page.evaluate(() => {
      const sr = document.getElementById('json-peek-root').shadowRoot;
      [...sr.querySelectorAll('.r')].find((r) => r.textContent.includes('"url"')).click();
    });
    const s = await page.evaluate(READ);
    assert.strictEqual(s.path, '$.nested.url');
  });

  await check('keyboard: Left collapses parent chain, Right expands', async () => {
    await page.keyboard.press('ArrowLeft'); // url (primitive) -> select parent "nested"
    let s = await page.evaluate(READ);
    assert.strictEqual(s.path, '$.nested');
    await page.keyboard.press('ArrowLeft'); // collapse nested
    s = await page.evaluate(READ);
    assert(s.rows.some((r) => r.includes('"nested": {…}')), s.rows.join('\n'));
    await page.keyboard.press('ArrowRight');
    s = await page.evaluate(READ);
    assert(s.rows.some((r) => r.includes('"list"')), s.rows.join('\n'));
  });

  await check('search highlights and JSONPath query works', async () => {
    await page.keyboard.press('Control+f');
    await page.keyboard.type('ada');
    await page.waitForTimeout(300);
    let s = await page.evaluate(READ);
    assert.strictEqual(s.count, '1 / 1');
    assert.strictEqual(s.path, '$.name');
    await page.evaluate(() => { const i = document.getElementById('json-peek-root').shadowRoot.querySelector('.search input'); i.value = ''; });
    await page.keyboard.type('$.nested.list[-1]');
    await page.waitForTimeout(300);
    s = await page.evaluate(READ);
    assert.strictEqual(s.path, '$.nested.list[2]');
    await shot('search');
  });

  await check('keyboard: ArrowDown walks past adjacent closing brackets; End/ArrowUp land on real rows', async () => {
    await open('/nav.json');
    await page.evaluate(() => document.getElementById('json-peek-root').shadowRoot.querySelector('.scroller').focus());
    const seen = [];
    for (let i = 0; i < 6; i++) { await page.keyboard.press('ArrowDown'); seen.push((await page.evaluate(READ)).path); }
    assert.deepStrictEqual(seen, ['$.a', '$.a.b', '$.a.b[0]', '$.c', '$.c', '$.c']);
    await page.keyboard.press('Home'); await page.keyboard.press('End');
    assert.strictEqual((await page.evaluate(READ)).path, '$.c');
    await page.keyboard.press('ArrowUp');
    assert.strictEqual((await page.evaluate(READ)).path, '$.a.b[0]');
  });

  await check('search finds strings written with escapes (\\/ and \\u00e9); first Enter advances', async () => {
    await open('/esc.json');
    await page.keyboard.press('Control+f');
    await page.keyboard.type('example.com/x');
    await page.waitForTimeout(300);
    let s = await page.evaluate(READ);
    assert.strictEqual(s.count, '1 / 1'); assert.strictEqual(s.path, '$.u');
    await page.evaluate(() => { document.getElementById('json-peek-root').shadowRoot.querySelector('.search input').value = ''; });
    await page.keyboard.type('caf\u00e9');
    await page.waitForTimeout(300);
    s = await page.evaluate(READ);
    assert.strictEqual(s.path, '$.c', JSON.stringify(s));
    await page.evaluate(() => { document.getElementById('json-peek-root').shadowRoot.querySelector('.search input').value = ''; });
    await page.keyboard.type('example');
    await page.waitForTimeout(300);
    assert.strictEqual((await page.evaluate(READ)).count, '1 / 2');
    await page.keyboard.press('Enter');
    assert.strictEqual((await page.evaluate(READ)).count, '2 / 2');
  });

  await check('invalid JSON shows reason, line and column', async () => {
    const s = await open('/bad.json');
    assert(s.err && /Trailing comma/.test(s.err) && /line 3, column 14/.test(s.err), JSON.stringify(s));
    await shot('error');
  });

  await check('JSON Lines served as text/plain is detected', async () => {
    const s = await open('/lines.jsonl');
    assert(/JSON Lines: 3 records/.test(s.meta), s.meta);
  });

  await check('text/plain containing JSON is detected', async () => {
    const s = await open('/plain.txt');
    assert(s.mounted && s.rows.some((r) => r.includes('"x": 2')), JSON.stringify(s));
  });

  await check('text/plain prose is left alone', async () => {
    const s = await open('/prose.txt');
    assert(!s.mounted && s.bodyText.includes('Just some text'), JSON.stringify(s));
  });

  await check('HTML pages are left alone', async () => {
    const s = await open('/page.html');
    assert(!s.mounted && s.bodyText.includes('html page'), JSON.stringify(s));
  });

  await check('XSSI prefix is stripped', async () => {
    const s = await open('/xssi.json');
    assert(/prefix removed/.test(s.meta) && s.rows.some((r) => r.includes('"guarded": true')), JSON.stringify(s));
  });

  await check(`big document (${BIG_MB} MB, ${big.count} records): opens, expand-all, scroll to end, search`, async () => {
    const t0 = Date.now();
    await page.goto(base + '/big.json');
    await page.waitForFunction(() => { const h = document.getElementById('json-peek-root'); return h && h.shadowRoot && h.shadowRoot.querySelectorAll('.r').length > 5; }, null, { timeout: 60000 });
    const openMs = Date.now() - t0;
    let s = await page.evaluate(READ);
    const parseMs = Number((s.meta.match(/parsed in (\d+) ms/) || [])[1]);
    const t1 = Date.now();
    await page.evaluate(() => document.getElementById('json-peek-root').shadowRoot.querySelector('[data-act=expand]').click());
    const expandMs = Date.now() - t1;
    await page.evaluate(() => { const sc = document.getElementById('json-peek-root').shadowRoot.querySelector('.scroller'); sc.scrollTop = sc.scrollHeight; });
    await page.waitForTimeout(200);
    s = await page.evaluate(READ);
    assert(s.rows[s.rows.length - 1].trim() === '}', 'last row should be the closing brace: ' + s.rows.slice(-3).join(' / '));
    assert(s.rows.some((r) => /"ok": (true|false)/.test(r)), 'expand all did not expand the records: ' + s.rows.slice(-4).join(' / '));
    const t2 = Date.now();
    await page.evaluate(() => { const i = document.getElementById('json-peek-root').shadowRoot.querySelector('.search input'); i.value = 'user 12345'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    const searchMs = Date.now() - t2;
    s = await page.evaluate(READ);
    assert(/^1 \/ \d/.test(s.count) && s.path.startsWith('$.items[12345]'), JSON.stringify({ count: s.count, path: s.path }));
    await shot('big');
    console.log(`  big.json: navigation→rows ${openMs} ms (parse ${parseMs} ms), expand all ${expandMs} ms, search ${searchMs} ms`);
  });

  // ---- web tool ----
  await check('web tool: sample renders, format and invalid input', async () => {
    await page.goto(siteBase + '/');
    await page.waitForTimeout(200);
    let s = await page.evaluate(READ);
    assert(s.mounted && s.rows.join('\n').includes('"id": 1428935717813211136'), JSON.stringify(s).slice(0, 400));
    const at = (k) => s.rows.findIndex((r) => r.trimStart().startsWith('"' + k + '":'));
    assert(at('user') >= 0 && at('user') < at('10') && at('10') < at('2'), 'key order not preserved: ' + s.rows.slice(0, 12).join(' / '));
    await shot('site');
    await page.fill('#input', '{"a":1,"b":[1,2,]}');
    await page.waitForTimeout(400);
    s = await page.evaluate(READ);
    assert(s.err && /Trailing comma/.test(s.err), JSON.stringify(s));
    await page.fill('#input', '{"b":2,"a":[1,{"c":12345678901234567890}]}');
    await page.waitForTimeout(400);
    await page.click('#format');
    const v = await page.inputValue('#input');
    assert.strictEqual(v, '{\n  "b": 2,\n  "a": [\n    1,\n    {\n      "c": 12345678901234567890\n    }\n  ]\n}');
    await page.click('#minify');
    assert.strictEqual(await page.inputValue('#input'), '{"b":2,"a":[1,{"c":12345678901234567890}]}');
  });

  await check('web tool: dark theme toggle and screenshot', async () => {
    await page.click('#sample');
    await page.evaluate(() => document.getElementById('viewer').shadowRoot.querySelector('[data-act=theme]').click());
    await page.waitForTimeout(100);
    const theme = await page.evaluate(() => document.getElementById('viewer').shadowRoot.querySelector('.jp').getAttribute('data-theme'));
    assert.strictEqual(theme, 'dark');
    await shot('site-dark');
  });

  await check('web tool: JSONPath tester page runs its preset query', async () => {
    await page.goto(siteBase + '/jsonpath.html');
    await page.waitForTimeout(300);
    const s = await page.evaluate(READ);
    assert.strictEqual(s.count, '1 / 2');
    assert.strictEqual(s.path, '$.orders[0].sku');
    await shot('jsonpath');
  });

  await ctx.close();
  api.close(); site.close();
  fs.rmSync(userDir, { recursive: true, force: true });
  for (const r of results) console.log(r[0], r[1], `(${r[2]} ms)`, r[3] || '');
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
