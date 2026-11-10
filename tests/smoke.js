// Run with:  node tests/smoke.js            (all tests)
//            node tests/smoke.js backup     (only tests whose name contains "backup")
const { sample, test, ok, eq, run } = require('./harness');

test('loads the garden with no errors', async open => {
  const app = await open(sample());
  eq(await app.page.inputValue('#gardenSel'), 'g1', 'garden shown');
  eq(await app.page.locator('#map [data-kind=planting]').count(), 7, 'plantings drawn');
});

test('placing a plant updates the schedule and saves', async open => {
  const app = await open(sample());
  await app.page.click('#lib [data-pid=p1]');
  await app.clickPlan(9, 7);
  await app.page.waitForTimeout(900);
  eq((await app.store('gardens/g1')).plantings.length, 8, 'saved plantings');
  await app.go('schedule');
  ok((await app.page.textContent('#schedSum')).includes('58 plants'), 'schedule total of 58 plants');
});

test('undo and redo on the plan', async open => {
  const app = await open(sample());
  eq(await app.page.isDisabled('#undoBtn'), true, 'undo starts disabled');
  await app.clickPlan(8, 1.4); await app.page.keyboard.press('Delete');
  eq(await app.page.locator('#map [data-kind=planting]').count(), 6, 'after delete');
  await app.page.keyboard.press('Control+z');
  eq(await app.page.locator('#map [data-kind=planting]').count(), 7, 'after undo');
  await app.page.keyboard.press('Control+Shift+z');
  eq(await app.page.locator('#map [data-kind=planting]').count(), 6, 'after redo');
  await app.page.click('#undoBtn'); await app.page.click('#redoBtn'); await app.page.keyboard.press('Control+y');
  eq(await app.page.isDisabled('#redoBtn'), true, 'redo used up');
});

test('undo covers species edits', async open => {
  const app = await open(sample());
  await app.page.click('#lib [data-edit=p0]');
  await app.page.fill('#sp-common', 'Hidcote lavender'); await app.page.click('[data-act=savePlant]'); await app.page.waitForTimeout(100);
  eq((await app.store('plants/p0')).common, 'Hidcote lavender', 'edit saved');
  await app.page.click('#undoBtn'); await app.page.waitForTimeout(150);
  eq((await app.store('plants/p0')).common, 'Lavender', 'edit undone');
  await app.page.click('#redoBtn'); await app.page.waitForTimeout(150);
  eq((await app.store('plants/p0')).common, 'Hidcote lavender', 'edit redone');
});

test('changes are saved at once when the tab is hidden', async open => {
  const app = await open(sample());
  await app.clickPlan(8, 1.4); await app.page.keyboard.press('Delete');
  await app.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await app.page.waitForTimeout(60);   // well inside the usual 0.7 s wait
  eq((await app.store('gardens/g1')).plantings.length, 6, 'saved without waiting');
});

test('booklet settings survive a reload', async open => {
  const seed = sample(); seed['gardens/g1'].booklet = { designer: 'Fern & Co', lines: [{ label: 'Design fee', amount: 650 }] };
  const app = await open(seed, { hash: '#presentation' });
  eq(await app.page.inputValue('[data-bk=designer]'), 'Fern & Co', 'designer kept');
  await app.go('plan'); await app.clickPlan(8, 1.4); await app.page.keyboard.press('Delete'); await app.page.waitForTimeout(900);
  eq((await app.store('gardens/g1')).booklet.designer, 'Fern & Co', 'still stored after a plan edit');
});

test('backup: download, delete, restore', async open => {
  const app = await open(sample());
  await app.go('preferences');
  await app.page.click('[data-act=bkpGarden]'); await app.page.waitForFunction(() => window.__mock.saved.length === 1);
  const file = JSON.parse((await app.savedBytes(0)).toString('utf8'));
  eq([file.app, file.kind, file.gardens.length, file.plants.length], ['SevenLayers', 'garden', 1, 7], 'backup contents');
  ok(file.files.siteplan && file.files.siteplan.data.length > 100, 'site plan inside the backup');
  // lose the garden and two species, then restore
  await app.page.evaluate(() => { const s = window.__mock.store; s.delete('gardens/g1'); s.delete('plants/p0'); s.delete('plants/p1'); });
  await app.close();
  const again = await open(Object.fromEntries(Object.entries(sample()).filter(([k]) => !['gardens/g1', 'plants/p0', 'plants/p1'].includes(k))), { hash: '#preferences' });
  await again.page.setInputFiles('[data-restore]', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await again.page.waitForFunction(() => /Restored/.test(document.getElementById('bkpMsg')?.textContent || ''), null, { timeout: 5000 });
  const g = await again.store('gardens/g1');
  eq([g.name, g.plantings.length], ['Elm Road', 7], 'garden restored');
  ok(g.underlay && g.underlay.assetId !== 'siteplan', 'site plan uploaded again under a new id');
  ok(await again.store('plants/p0'), 'missing species restored');
  ok((await again.page.textContent('#bkpMsg')).includes('5 species were already in your library'), 'existing species left alone');
  app.errors.push(...again.errors); await again.close();
});

test('backup: a tampered file cannot inject markup', async open => {
  const app = await open(sample(), { hash: '#preferences' });
  const evil = '"><img src=x onerror="window.__pwned=1">';
  const file = { app: 'SevenLayers', format: 1, kind: 'garden', files: {},
    plants: [{ id: 'px', common: evil, botanical: evil, height: evil, spread: evil, flowerColor: evil, role: evil }, { id: evil, common: 'bad id' }],
    gardens: [{ id: 'gx', name: evil, width: evil, plantings: [{ id: evil, plantId: 'px', x: evil, y: 2, qty: evil }, { id: 'ok', plantId: evil, x: 1, y: 1 }], booklet: { designer: evil, lines: [{ label: evil, amount: evil }] } }] };
  await app.page.setInputFiles('[data-restore]', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await app.page.waitForFunction(() => /Restored/.test(document.getElementById('bkpMsg')?.textContent || ''));
  const g = await app.store('gardens/gx'), p = await app.store('plants/px');
  eq([typeof g.width, g.plantings.length, typeof g.plantings[0].x, g.plantings[0].qty], ['number', 1, 'number', 1], 'garden fields coerced');
  eq([p.height, p.spread, p.flowerColor, p.role], [null, 0.5, null, 'herbaceous'], 'species fields coerced');
  for (const h of ['plan', 'schedule', 'flowering', 'database', 'presentation']) await app.go(h);
  await app.page.click('#navPlan'); await app.page.click('#lib [data-edit=px]'); await app.page.waitForTimeout(200);
  eq(await app.page.evaluate(() => window.__pwned || document.querySelectorAll('img[src="x"]').length), 0, 'no injected element');
});

test('large plans: a warning near the limit, a clear message over it', async open => {
  // fill a garden with single plants until its saved record reaches a share of the 256 KiB cap
  const fill = share => { const seed = sample(), g = seed['gardens/g1']; let i = 0;
    while (Buffer.byteLength(JSON.stringify(g)) < share * 256 * 1024) { for (let k = 0; k < 50; k++, i++) g.plantings.push({ id: 'mw6prrcs' + String(i).padStart(6, '0'), plantId: 'p' + (i % 5), x: (i % 60) * 0.15, y: Math.round(Math.floor(i / 60) * 0.1 * 100) / 100, qty: 1 }); }
    return { seed, n: g.plantings.length }; };
  const a = fill(0.85), near = await open(a.seed);
  const t0 = Date.now(); await near.page.evaluate(() => document.getElementById('zIn').click()); const ms = Date.now() - t0;
  await near.page.click('#zFit');
  await near.page.click('#lib [data-pid=p1]'); await near.clickPlan(11.7, 8.4); await near.page.waitForTimeout(1200);
  ok(/Saved · this plan is \d+% of the size/.test(await near.status()), 'a warning near the limit, got: ' + (await near.status()));
  console.log(`     (${a.n} placements: "${await near.status()}"; one redraw took about ${ms} ms)`);
  await near.close();
  const b = fill(0.995), app = await open(b.seed);
  for (let i = 0; i < 40; i++) { await app.page.click('#lib [data-pid=p1]'); await app.clickPlan(9.6 + (i % 8) * 0.3, 0.4 + Math.floor(i / 8) * 0.5); }
  await app.page.waitForTimeout(1200);
  ok(/too large for one garden/.test(await app.status()), 'a clear "too large" message, got: ' + (await app.status()));
  console.log(`     (${b.n + 40} placements: "${(await app.status()).slice(0, 70)}…")`);
  app.errors.push(...near.errors);
});

run();
