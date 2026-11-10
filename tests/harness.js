// Shared set-up for the tests: opens the app in a headless browser against the stand-in runtime.
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
// Offline? Point SL_LIBS at a folder holding html2canvas.min.js, jspdf.umd.min.js, svg2pdf.umd.min.js and xlsx.full.min.js.
const LIBS = process.env.SL_LIBS || '';
const LIB_FILES = { html2canvas: 'html2canvas.min.js', jspdf: 'jspdf.umd.min.js', 'svg2pdf': 'svg2pdf.umd.min.js', xlsx: 'xlsx.full.min.js' };
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFklEQVR4nGP8z8Dwn4EIwESMolGF1FMIAD2cAg8tPRTDAAAAAElFTkSuQmCC', 'base64');

async function open(seed = {}, opts = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1400, height: 900 }, timezoneId: 'Europe/London', locale: 'en-GB' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ path: path.join(__dirname, 'mock-runtime.js') });
  await page.addInitScript(seed => { for (const [k, v] of Object.entries(seed)) window.__mock.store.set(k, v); }, seed);
  if (opts.theme) await page.addInitScript(t => { try { localStorage.setItem('gpm.theme', t); } catch {} }, opts.theme);
  const html = '<!doctype html><html><head><meta charset="utf8"></head><body>' + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') + '</body></html>';
  await page.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: html }));
  await page.route('http://app.test/_blob/**', async r => {
    const id = r.request().url().split('/').pop();
    const hit = await page.evaluate(async id => {
      const b = window.__mock.blobs.get(id); if (!b) return null;
      const u8 = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192));
      return { type: b.type, b64: btoa(s) };
    }, id).catch(() => null);
    if (hit) return r.fulfill({ contentType: hit.type || 'image/png', body: Buffer.from(hit.b64, 'base64') });
    if (id === 'siteplan') return r.fulfill({ contentType: 'image/svg+xml', body: fs.readFileSync(path.join(ROOT, 'example', 'example-site-plan.svg')) });
    if (/^fixture/.test(id)) return r.fulfill({ contentType: 'image/png', body: PIXEL });
    return r.fulfill({ status: 404, body: '' });
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  if (LIBS) await page.route(/https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\/.*/, r => {
    const key = Object.keys(LIB_FILES).find(k => r.request().url().includes(k));
    const f = key && path.join(LIBS, LIB_FILES[key]);
    return f && fs.existsSync(f) ? r.fulfill({ path: f, contentType: 'text/javascript' }) : r.abort();
  });
  await page.goto('http://app.test/' + (opts.hash || ''));
  await page.waitForFunction(() => /Saved|Not saved/.test(document.getElementById('status').textContent), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(150);
  const api = {
    page, browser, errors,
    store: key => page.evaluate(k => window.__mock.store.get(k), key),
    keys: prefix => page.evaluate(p => [...window.__mock.store.keys()].filter(k => k.startsWith(p)), prefix),
    status: () => page.textContent('#status'),
    go: async hash => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(150); },
    saved: () => page.evaluate(() => window.__mock.saved.map(s => ({ filename: s.filename, size: s.blob.size }))),
    savedBytes: i => page.evaluate(async i => { const u8 = new Uint8Array(await window.__mock.saved[i].blob.arrayBuffer()); let s = ''; for (let j = 0; j < u8.length; j += 8192) s += String.fromCharCode(...u8.subarray(j, j + 8192)); return btoa(s); }, i).then(b => Buffer.from(b, 'base64')),
    // click the plan at a position given in metres
    planXY: (x, y) => page.evaluate(([x, y]) => { const svg = document.getElementById('map'), pt = svg.createSVGPoint(); pt.x = x; pt.y = y; const r = pt.matrixTransform(svg.getScreenCTM()); return { x: r.x, y: r.y }; }, [x, y]),
    clickPlan: async (x, y, o) => { const p = await api.planXY(x, y); await page.mouse.click(p.x, p.y, o); await page.waitForTimeout(60); },
    dragPlan: async (x1, y1, x2, y2) => { const a = await api.planXY(x1, y1), b = await api.planXY(x2, y2); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(80); },
    close: () => browser.close(),
  };
  return api;
}

// A small garden with a site plan, six species and a few plants on the plan.
function sample() {
  const P = [['Lavender', "Lavandula angustifolia 'Hidcote'", 'shrub', 6, 8, '#A894D2', 4.25, '2L', 0.6], ['Salvia', "Salvia nemorosa 'Caradonna'", 'herbaceous', 6, 9, '#7B5BB5', 5.1, '2L', 0.45],
    ['Rose', "Rosa 'Olivia Rose Austin'", 'shrub', 6, 9, '#EE9BBE', 24.99, '3.5L', 0.9], ['Tulip', "Tulipa 'Ballerina'", 'tuber', 4, 5, '#E8862F', 0.38, 'Bulb', 0.15],
    ['Geranium', "Geranium 'Rozanne'", 'ground', 6, 10, '#4A6FC2', 5.1, '2L', 0.6], ['Apple', "Malus domestica 'Sunset'", 'understory', 4, 5, '#FFFFFF', 32, '12L', 2.5]];
  const seed = {};
  P.forEach(([common, botanical, role, flowerFrom, flowerTo, flowerColor, cost, supply, spread], i) => { seed['plants/p' + i] = { common, botanical, role, flowerFrom, flowerTo, flowerColor, cost, supply, spread, potSpread: 0.15, height: 0.6, supplier: i < 4 ? 'Babylon Plants' : 'Hill Nursery' }; });
  seed['plants/ex1'] = { common: 'Old birch', botanical: 'Betula pendula', role: 'canopy', existing: true, spread: 4, height: 9 };
  seed['gardens/g1'] = { name: 'Elm Road', client: 'Mr & Mrs Hart', width: 12, depth: 8.6, north: 20, updatedAt: 1, areas: [],
    underlay: { assetId: 'siteplan', kind: 'svg', name: 'site.svg', natW: 1200, natH: 860, mPerPx: 0.01, opacity: 0.6, calibrated: true },
    plantings: [{ id: 'a', plantId: 'p0', x: 4, y: 1.4, qty: 5 }, { id: 'b', plantId: 'p1', x: 6, y: 1.4, qty: 3 }, { id: 'c', plantId: 'p2', x: 8, y: 1.4, qty: 1 }, { id: 'd', plantId: 'p3', x: 5, y: 3, qty: 40 },
      { id: 'e', plantId: 'p4', x: 2, y: 5, qty: 7 }, { id: 'f', plantId: 'p5', x: 10, y: 4.4, qty: 1 }, { id: 'g', plantId: 'ex1', x: 1.6, y: 1.6, qty: 1 }] };
  return seed;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function ok(cond, msg) { if (!cond) throw new Error('expected ' + msg); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }
async function run() {
  const only = process.argv.slice(2);
  let failed = 0, ran = 0;
  for (const t of tests) {
    if (only.length && !only.some(o => t.name.toLowerCase().includes(o.toLowerCase()))) continue;
    ran++;
    const t0 = Date.now(); let app = null;
    try {
      await t.fn(async (...a) => (app = await open(...a)));
      if (app && app.errors.length) throw new Error('page errors: ' + app.errors.join(' | '));
      console.log(`ok   ${t.name} (${Date.now() - t0} ms)`);
    } catch (e) { failed++; console.log(`FAIL ${t.name}\n     ${String(e.message).split('\n')[0]}`); }
    finally { if (app) await app.close().catch(() => {}); }
  }
  console.log(`\n${ran - failed} of ${ran} passed`);
  process.exit(failed ? 1 : 0);
}
module.exports = { open, sample, test, ok, eq, run, ROOT };
