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

test('duplicate, copy and paste, and arrow-key nudging', async open => {
  const app = await open(sample());
  const n = () => app.page.locator('#map [data-kind=planting]').count();
  await app.clickPlan(8, 1.4); await app.page.keyboard.press('Control+d');
  eq(await n(), 8, 'duplicated');
  await app.page.waitForTimeout(900);
  const made = (await app.store('gardens/g1')).plantings.at(-1);
  eq([made.plantId, made.x, made.y], ['p2', 8.5, 1.9], 'the copy sits half a metre down and right');
  await app.page.keyboard.press('ArrowRight'); await app.page.keyboard.press('ArrowRight'); await app.page.keyboard.press('Shift+ArrowDown');
  await app.page.waitForTimeout(900);
  const moved = (await app.store('gardens/g1')).plantings.at(-1);
  eq([moved.x, moved.y], [8.7, 2.9], 'nudged by the snap step, ten times as far with Shift');
  await app.page.keyboard.press('Control+z'); await app.page.waitForTimeout(50);
  eq(await n(), 8, 'one undo takes back the whole run of nudges and keeps the copy');
  await app.page.keyboard.press('Control+c');
  const pt = await app.planXY(3, 7); await app.page.mouse.move(pt.x, pt.y); await app.page.keyboard.press('Control+v');
  eq(await n(), 9, 'pasted');
  await app.page.waitForTimeout(900);
  const pasted = (await app.store('gardens/g1')).plantings.at(-1);
  eq([pasted.x, pasted.y], [3, 7], 'pasted under the pointer');
});

test('row tool places evenly spaced plants', async open => {
  const app = await open(sample());
  await app.page.click('#lib [data-pid=p0]'); await app.page.click('[data-tool=row]');
  eq(await app.page.inputValue('#row-gap'), '0.6', 'spacing starts at the mature spread');
  await app.page.fill('#row-gap', '0.5');
  await app.clickPlan(2, 7.5); await app.clickPlan(6, 7.5);
  await app.page.waitForTimeout(900);
  const row = (await app.store('gardens/g1')).plantings.slice(7);
  eq(row.length, 9, 'nine plants over four metres at 0.5 m');
  eq(row.map(p => p.x), [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6], 'evenly spaced');
  ok((await app.page.textContent('#row-info')).includes('Placed 9 plants'), 'row summary');
  await app.page.keyboard.press('Control+z');
  eq(await app.page.locator('#map [data-kind=planting]').count(), 7, 'one undo removes the whole row');
});

test('measure tool reads a distance', async open => {
  const app = await open(sample());
  await app.page.keyboard.press('m');
  await app.clickPlan(1, 1); await app.clickPlan(4, 5);
  ok((await app.page.textContent('#inspector')).includes('5.00 m'), '3-4-5 triangle measures 5.00 m');
  eq((await app.store('gardens/g1')).plantings.length, 7, 'measuring changes nothing');
});

test('labels can be dragged, with a leader line, and reset', async open => {
  const app = await open(sample());
  await app.clickPlan(8, 1.4);
  const h = await app.page.locator('#map [data-kind=lblh]').boundingBox();
  const to = await app.planXY(10.5, 2.6);
  await app.page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await app.page.mouse.down(); await app.page.mouse.move(to.x, to.y, { steps: 5 }); await app.page.mouse.up();
  await app.page.waitForTimeout(900);
  const pl = (await app.store('gardens/g1')).plantings.find(p => p.id === 'c');
  ok(pl.lx > 1 && pl.ly > 0.5, 'label offset stored, got ' + JSON.stringify([pl.lx, pl.ly]));
  eq([pl.x, pl.y], [8, 1.4], 'the plant itself has not moved');
  eq(await app.page.locator('#map [data-id=c] line').count(), 1, 'leader line drawn');
  await app.page.click('[data-act=resetLabel]'); await app.page.waitForTimeout(900);
  eq((await app.store('gardens/g1')).plantings.find(p => p.id === 'c').lx, undefined, 'label reset');
});

test('interest calendar: berries, stems and evergreens beside the flowers', async open => {
  const seed = sample();
  Object.assign(seed['plants/p2'], { interest: [{ kind: 'berries', from: 10, to: 1, color: '#C92F2F' }] });   // rose hips over the new year
  Object.assign(seed['plants/p0'], { foliage: 'evergreen' });
  const app = await open(seed, { hash: '#flowering' });
  eq(await app.page.locator('#calView .cbar.sm').count(), 2, 'a span over the new year is drawn as two bars');
  eq(await app.page.locator('#calView .cbar.ev').count(), 1, 'evergreen line');
  const counts = await app.page.locator('#calView .ccount span').allTextContents();
  eq([counts[11], counts[0], counts[1]], ['1', '1', '–'], 'December and January now have interest; February still has none');
  ok((await app.page.textContent('#calView .calhead')).includes('1 evergreen holds structure'), 'evergreens mentioned');
  // add interest in the species form
  await app.go('plan'); await app.page.click('#lib [data-edit=p1]');
  await app.page.selectOption('#sp-fol', 'deciduous'); await app.page.click('[data-act=addInterest]');
  await app.page.selectOption('[data-ii="0"][data-if=kind]', 'seedheads'); await app.page.click('[data-act=savePlant]'); await app.page.waitForTimeout(100);
  const p1 = await app.store('plants/p1');
  eq([p1.foliage, p1.interest], ['deciduous', [{ kind: 'seedheads', from: 9, to: 2, color: '#9C6B3A' }]], 'saved with the usual months and colour for seed heads');
});

test('season view colours the plan by month', async open => {
  const seed = sample(); Object.assign(seed['plants/p0'], { foliage: 'evergreen' });
  const app = await open(seed);
  const fill = id => app.page.evaluate(id => { const c = document.querySelector(`#map [data-id="${id}"] circle`); return [c.style.fill, c.getAttribute('fill-opacity')]; }, id);
  await app.page.selectOption('#seasonSel', '4');           // April: tulips and the apple are in flower
  eq(await fill('d'), ['rgb(232, 134, 47)', '0.85'], 'tulips in their flower colour');
  eq(await fill('a'), ['rgb(94, 138, 78)', '0.38'], 'evergreen lavender in green');
  eq((await fill('b'))[1], '0.04', 'salvia, not yet in flower, is faint');
  ok(/^April: 2 of 7 species in flower/.test(await app.page.textContent('#hint')), 'summary line, got: ' + await app.page.textContent('#hint'));
  await app.page.selectOption('#seasonSel', '0');
  eq((await fill('a'))[1], '0.3', 'back to the usual layer colours');
});

test('sun study: sun position for a place, date and time', async open => {
  const seed = sample(); Object.assign(seed['gardens/g1'], { north: 0, lat: 51.5072, lon: -0.1276 });
  const app = await open(seed);
  await app.page.click('#sunBtn');
  const set = async (doy, mins) => { await app.page.evaluate(([d, m]) => { const a = document.getElementById('sunDoy'), b = document.getElementById('sunMin'); a.value = d; a.dispatchEvent(new Event('input', { bubbles: true })); b.value = m; b.dispatchEvent(new Event('input', { bubbles: true })); }, [doy, mins]); await app.page.waitForTimeout(60); return app.page.textContent('#sunRead'); };
  const june = await set(172, 13 * 60);                     // 21 June, 13:00 British Summer Time: solar noon in London
  ok(/sun 6[12]° high in the south\b/.test(june), 'midsummer noon sun about 62° in the south, got: ' + june);
  ok(/sunrise 04:4\d, sunset 21:2\d/.test(june), 'midsummer sunrise about 04:43 and sunset about 21:21, got: ' + june);
  const dec = await set(355, 12 * 60);                      // 21 December, noon GMT
  ok(/sun 1[45]° high in the south\b/.test(dec), 'midwinter noon sun about 15°, got: ' + dec);
  ok(/sunrise 08:0\d, sunset 15:5\d/.test(dec), 'midwinter sunrise about 08:04 and sunset about 15:53, got: ' + dec);
  const eve = await set(172, 19 * 60);
  ok(/in the west(-north-west)?\b/.test(eve), 'summer evening sun in the west, got: ' + eve);
});

test('sun study: plants and buildings cast shadows the right way', async open => {
  const seed = sample(); Object.assign(seed['gardens/g1'], { north: 0, lat: 51.5072, lon: -0.1276, plantings: [{ id: 't', plantId: 'p0', x: 6, y: 5, qty: 1 }] });
  seed['plants/p0'].height = 2;
  const app = await open(seed);
  await app.page.click('#sunBtn');
  await app.page.evaluate(() => { const a = document.getElementById('sunDoy'), b = document.getElementById('sunMin'); a.value = 172; a.dispatchEvent(new Event('input', { bubbles: true })); b.value = 13 * 60; b.dispatchEvent(new Event('input', { bubbles: true })); });
  await app.page.waitForTimeout(100);
  const tip = await app.page.evaluate(() => { const c = document.querySelectorAll('#shadows circle'); return [c.length, +c[1].getAttribute('cx'), +c[1].getAttribute('cy')]; });
  eq(tip[0], 2, 'one shadow, drawn as two rounded ends');
  ok(Math.abs(tip[1] - 6) < 0.08 && Math.abs(tip[2] - (5 - 2 / Math.tan(62 * Math.PI / 180))) < 0.08, 'a 2 m plant at midsummer noon throws a shadow about 1.06 m due north, got ' + JSON.stringify(tip));
  // draw a building: four corners, then the first corner again to close it
  await app.page.click('#sunBlock');
  for (const [x, y] of [[2, 6], [5, 6], [5, 8], [2, 8], [2, 6]]) await app.clickPlan(x, y);
  await app.page.waitForTimeout(900);
  const b = (await app.store('gardens/g1')).blocks;
  eq([b.length, b[0].closed, b[0].pts.length, b[0].h], [1, true, 4, 1.8], 'building saved');
  await app.page.fill('#blk-eh', '6'); await app.page.waitForTimeout(900);
  eq((await app.store('gardens/g1')).blocks[0].h, 6, 'height edited');
  ok(await app.page.locator('#shadows path').count() >= 6, 'walls and roof cast shadows');
  // sun hours: ground just north of a 6 m building gets less sun than open ground
  await app.page.click('[data-sundoy="265"]');              // autumn equinox: the sun stays south of east and west all day
  await app.page.check('#sunHoursCk'); await app.page.waitForTimeout(200);
  const fills = await app.page.evaluate(() => { const at = (x, y) => { for (const r of document.querySelectorAll('#map g[shape-rendering] rect')) { const a = n => +r.getAttribute(n); if (x >= a('x') && x < a('x') + a('width') && y >= a('y') && y < a('y') + a('height')) return r.getAttribute('fill'); } }; return [at(3.5, 5.6), at(10, 2)]; });
  ok(fills[0] && fills[1] && fills[0] !== fills[1], 'the map tells shade from sun, got ' + JSON.stringify(fills));
  ok(['#34425F', '#8090B4'].includes(fills[0]) && fills[1] === '#F0A92B', 'shade just north of a 6 m building, full sun on open ground, got ' + JSON.stringify(fills));
  await app.page.keyboard.press('Escape');
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
