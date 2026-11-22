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

test('rows bend: drag the middle dot and the plants follow the curve, evenly spaced', async open => {
  const seed = sample(); seed['gardens/g1'].underlay = null;
  const app = await open(seed);
  await app.page.click('#lib [data-pid=p0]'); await app.page.click('[data-tool=row]');
  await app.page.fill('#row-gap', '0.5');
  await app.clickPlan(2, 7); await app.clickPlan(6, 7); await app.page.waitForTimeout(900);
  const straight = (await app.store('gardens/g1')).plantings.filter(q => q.row);
  eq(straight.length, 9, 'a straight row of nine');
  eq(await app.page.locator('#map [data-kind=rowc]').count(), 1, 'with a bend dot');
  await app.dragPlan(4, 7, 4, 5.5); await app.page.waitForTimeout(900);
  const bent = (await app.store('gardens/g1')).plantings.filter(q => q.row).sort((a, b) => a.rowI - b.rowI);
  eq([bent[0].x, bent[0].y, bent.at(-1).x, bent.at(-1).y], [2, 7, 6, 7], 'the ends stay put');
  const mid = bent[Math.floor(bent.length / 2)];
  ok(Math.abs(mid.x - 4) < 0.15 && Math.abs(mid.y - 5.5) < 0.1, 'the curve passes through the dot, got ' + JSON.stringify(mid));
  const gaps = bent.slice(1).map((q, i) => Math.hypot(q.x - bent[i].x, q.y - bent[i].y));
  ok(gaps.every(g => Math.abs(g - gaps[0]) < 0.03) && Math.abs(gaps[0] - 0.5) < 0.06, 'evenly spaced along the curve at about 0.5 m, got ' + gaps.map(g => g.toFixed(2)));
  ok(bent.length > 9, 'a longer curve takes more plants, got ' + bent.length);
  await app.page.keyboard.press('Control+z'); await app.page.waitForTimeout(900);
  const back = (await app.store('gardens/g1')).plantings.filter(q => q.row);
  ok(back.length === 9 && back.every(q => q.y === 7), 'one undo straightens it again');
});

test('measure tool reads a distance', async open => {
  const app = await open(sample());
  await app.page.keyboard.press('m');
  await app.clickPlan(1, 1); await app.clickPlan(4, 5);
  ok((await app.page.textContent('#inspector')).includes('5.00 m'), '3-4-5 triangle measures 5.00 m');
  eq((await app.store('gardens/g1')).plantings.length, 7, 'measuring changes nothing');
});

test('labels can be dragged, with a leader line, and reset', async open => {
  const seed = sample(); seed['settings/prefs'] = { labelPlace: 'plan' }; const app = await open(seed);   // dragging labels is for labels on the plan
  await app.clickPlan(8, 1.4);
  const h = await app.page.locator('#map [data-kind=lblh]').boundingBox();
  const to = await app.planXY(10.5, 2.6);
  await app.page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await app.page.mouse.down(); await app.page.mouse.move(to.x, to.y, { steps: 5 }); await app.page.mouse.up();
  await app.page.waitForTimeout(900);
  const pl = (await app.store('gardens/g1')).plantings.find(p => p.id === 'c');
  ok(pl.lx > 1 && pl.ly > 0.5, 'label offset stored, got ' + JSON.stringify([pl.lx, pl.ly]));
  eq([pl.x, pl.y], [8, 1.4], 'the plant itself has not moved');
  eq(await app.page.locator('#map [data-id=c] path.lead').count(), 1, 'leader line drawn');
  await app.page.click('[data-act=resetLabel]'); await app.page.waitForTimeout(900);
  eq((await app.store('gardens/g1')).plantings.find(p => p.id === 'c').lx, undefined, 'label reset');
});


test('area labels can be dragged too, move with their area, and reset', async open => {
  const seed = sample(); seed['settings/prefs'] = { labelPlace: 'plan' };
  seed['gardens/g1'].areas = [{ id: 'ar1', kind: 'drift', plantId: 'p1', pts: [[2, 5], [5, 5], [5, 7.5], [2, 7.5]], density: 5 }];
  const app = await open(seed);
  const lbl = app.page.locator('#map rect.lblhit[data-lk=aar1]');
  eq(await lbl.count(), 1, 'the area label can be grabbed');
  const h = await lbl.boundingBox(), to = await app.planXY(8.5, 7.8);
  await app.page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await app.page.mouse.down(); await app.page.mouse.move(to.x, to.y, { steps: 6 }); await app.page.mouse.up();
  await app.page.waitForTimeout(900);
  let a = (await app.store('gardens/g1')).areas[0];
  ok(a.lx > 4 && a.ly > 1, 'label offset stored on the area, got ' + JSON.stringify([a.lx, a.ly]));
  eq(a.pts[0], [2, 5], 'the area itself has not moved');
  const x0 = await app.page.$eval('#map text[data-lk=aar1]', t => +t.getAttribute('x'));
  ok(Math.abs(x0 - (3.5 + a.lx)) < 0.05, 'label drawn where it was dropped, got ' + x0);
  ok((await app.page.textContent('#inspector')).includes('Reset label'), 'the area is selected, with its label buttons');
  await app.page.click('[data-act=resetLabel]'); await app.page.waitForTimeout(900);
  a = (await app.store('gardens/g1')).areas[0];
  eq([a.lx, a.ly], [undefined, undefined], 'label reset');
});

test('names of areas drawn with the Area tool can be dragged, hidden and put back', async open => {
  const seed = sample();
  seed['gardens/g1'].beds = [{ id: 'bPond', kind: 'water', name: 'Pond', pts: [[8, 5], [11, 5], [11, 8], [8, 8]] }];
  const app = await open(seed);
  const hit = app.page.locator('#map rect.lblhit[data-lk=bbPond]').first();
  eq(await hit.count(), 1, 'the pond name can be grabbed');
  const h = await hit.boundingBox(), to = await app.planXY(4, 2);
  await app.page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await app.page.mouse.down(); await app.page.mouse.move(to.x, to.y, { steps: 6 }); await app.page.mouse.up();
  await app.page.waitForTimeout(900);
  let b = (await app.store('gardens/g1')).beds[0];
  ok(b.lx < -3 && b.ly < -2, 'offset stored on the area, got ' + JSON.stringify([b.lx, b.ly]));
  eq(b.pts[0], [8, 5], 'the pond itself has not moved');
  const [x, y] = await app.page.$eval('#map text[data-lk=bbPond]', t => [+t.getAttribute('x'), +t.getAttribute('y')]);
  ok(Math.abs(x - 4) < 0.6 && Math.abs(y - 2) < 0.6, 'drawn where it was dropped, got ' + [x, y]);
  await app.page.keyboard.press('Delete'); await app.page.waitForTimeout(900);
  eq((await app.store('gardens/g1')).beds[0].lhide, true, 'Delete hides it');
  eq(await app.page.locator('#map text[data-lk=bbPond]').count(), 0, 'and it is gone from the plan');
  await app.page.click('[data-act=showAllLabels]'); await app.page.click('[data-act=resetAllLabels]'); await app.page.waitForTimeout(900);
  b = (await app.store('gardens/g1')).beds[0];
  eq([b.lx, b.lhide], [undefined, undefined], 'shown again and put back');
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
  const back = await fill('a'); ok(['0.6', '1'].includes(back[1]) && back[0] !== 'rgb(94, 138, 78)', 'back to its own species colour and pattern, got ' + JSON.stringify(back));
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

test('order lists by supplier flag lines short of stock', async open => {
  const seed = sample();
  seed['plants/p3'].source = { list: 'l1', listName: 'Babylon · Autumn', code: 'TUL-BAL', stock: '25', checkedAt: Date.UTC(2026, 10, 3) };   // 40 tulips wanted, 25 in stock
  seed['plants/p0'].source = { list: 'l1', listName: 'Babylon · Autumn', code: 'LAV-HID', stock: '200+', checkedAt: Date.UTC(2026, 10, 3) };
  const app = await open(seed, { hash: '#schedule' });
  eq(await app.page.locator('#orderLists .order h3').allTextContents(), ['Babylon Plants', 'Hill Nursery'], 'one list per supplier');
  const first = await app.page.locator('#orderLists .order').first().textContent();
  ok(first.includes('1 line short of stock') && first.includes('short by 15'), 'tulips flagged 15 short');
  ok(!/Lavandula[^£]*short/.test(first), 'lavender, with 200+ in stock, is not flagged');
  await app.page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__copied = t; } }, configurable: true }); });
  await app.page.locator('[data-copyorder]').first().click();
  const copied = await app.page.evaluate(() => window.__copied);
  ok(copied.startsWith('Order for Babylon Plants') && copied.includes("TUL-BAL\tTulipa 'Ballerina'\tTulip\tBulb\t40\t0.38\t15.20"), 'copied order has code, names, quantity and prices');
});

test('scaled plan sheet: A3 at a true 1:50, with a logo', async open => {
  const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
  const seed = sample(); seed['gardens/g1'].sheet = { paper: 'A3', scale: 50 };
  const app = await open(seed, { hash: '#presentation' });
  await app.page.waitForSelector('.bpage');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFklEQVR4nGP8z8Dwn4EIwESMolGF1FMIAD2cAg8tPRTDAAAAAElFTkSuQmCC', 'base64');
  await app.page.setInputFiles('[data-logo]', { name: 'logo.png', mimeType: 'image/png', buffer: png });
  await app.page.waitForFunction(() => /Logo added/.test(document.getElementById('presMsg').textContent));
  eq(await app.page.locator('.bcover img.blogo').count(), 1, 'logo on the booklet cover');
  ok((await app.page.textContent('#sheetNote')).startsWith('Prints at 1:50 on A3 landscape'), 'fit note');
  await app.page.click('#sheetPdf');
  await app.page.waitForFunction(() => /Plan sheet saved|Couldn/.test(document.getElementById('presMsg').textContent), null, { timeout: 30000 });
  eq((await app.saved()).map(s => s.filename), ['Elm Road - planting plan 1-50 A3.pdf'], 'file name');
  const pdf = await app.savedBytes(0), text = pdf.toString('latin1');
  ok(/\/MediaBox \[0 0 1190\.5\d* 841\.8\d*\]/.test(text), 'A3 landscape page, got ' + (text.match(/\/MediaBox[^\]]*\]/) || [''])[0]);
  // portrait, when asked for
  await app.page.selectOption('[data-sheet=orient]', 'portrait');
  ok((await app.page.textContent('#sheetNote')).includes('A3 portrait'), 'note says portrait, got: ' + await app.page.textContent('#sheetNote'));
  await app.page.click('#sheetPdf');
  await app.page.waitForFunction(() => window.__mock.saved.length === 2 || /Couldn/.test(document.getElementById('presMsg').textContent), null, { timeout: 30000 });
  const ptext = (await app.savedBytes(1)).toString('latin1');
  ok(/\/MediaBox \[0 0 841\.8\d* 1190\.5\d*\]/.test(ptext), 'A3 portrait page, got ' + (ptext.match(/\/MediaBox[^\]]*\]/) || [''])[0]);
  await app.page.selectOption('[data-sheet=orient]', 'auto');
  // if poppler is installed, measure the printed rulers: 12 m at 1:50 must be 240 mm
  let words = null;
  try { const f = path.join(os.tmpdir(), 'sl-sheet-' + process.pid + '.pdf'); fs.writeFileSync(f, pdf); words = execFileSync('pdftotext', ['-bbox', f, '-'], { encoding: 'utf8' }); fs.unlinkSync(f); } catch {}
  if (words) {
    const mid = w => { const m = words.match(new RegExp('xMin="([\\d.]+)" yMin="[\\d.]+" xMax="([\\d.]+)" yMax="[\\d.]+">' + w + '<')); return m ? (+m[1] + +m[2]) / 2 : null; };
    const mm = (mid('12') - mid('0')) * 25.4 / 72;
    ok(Math.abs(mm - 240) < 0.5, '12 m printing as 240 mm, got ' + mm.toFixed(2) + ' mm');
    console.log(`     (measured on the PDF: 12 m prints as ${mm.toFixed(2)} mm at 1:50)`);
  } else console.log('     (pdftotext not installed, so the printed scale was not measured)');
  // too large for the sheet at the chosen scale: fall back and say so
  await app.page.selectOption('[data-sheet=paper]', 'A4'); 
  ok(/Too large for A4 at 1:50, so it will print at 1:100/.test(await app.page.textContent('#sheetNote')), 'fallback note, got: ' + await app.page.textContent('#sheetNote'));
});

test('booklet PDF: searchable text and a vector plan', async open => {
  const app = await open(sample(), { hash: '#presentation' });
  await app.page.waitForSelector('.bpage');
  await app.page.click('#presPdf');
  await app.page.waitForFunction(() => /PDF saved|Couldn/.test(document.getElementById('presMsg').textContent), null, { timeout: 60000 });
  eq(await app.page.textContent('#presMsg'), 'PDF saved.', 'export finished');
  const pdf = await app.savedBytes(0), text = pdf.toString('latin1');
  eq((text.match(/\/Type \/Page\b/g) || []).length, 6, 'six pages');
  ok(/\/BaseFont \/(Helvetica|IBMPlex|plex)/i.test(text) || /FontFile2/.test(text), "a text layer is embedded");
  let plain = null;
  try { const fs = require('fs'), os = require('os'), path = require('path'), f = path.join(os.tmpdir(), 'sl-booklet-' + process.pid + '.pdf'); fs.writeFileSync(f, pdf); plain = require('child_process').execFileSync('pdftotext', [f, '-'], { encoding: 'utf8' }); fs.unlinkSync(f); } catch {}
  if (plain) ok(plain.includes('Plant schedule') && plain.includes("Lavandula angustifolia 'Hidcote'") && plain.includes('Mr & Mrs Hart'), 'the text can be searched and copied');
  else console.log('     (pdftotext not installed, so the text layer was not read back)');
});

test('one plan, three layers: structure placed freely, planting on the grid, bulbs over the top', async open => {
  const seed = sample(); seed['gardens/g1'].plantings = [];
  const app = await open(seed);
  ok(!(await app.page.$('#vSpacing')) && !(await app.page.$('#modeSeg')), 'no separate modes or Spacing view');
  await app.page.click('#lib [data-pid=p1]');                       // salvia, herbaceous: 0.3 m spacing by default
  eq(await app.page.inputValue('#pg-space'), '0.3', 'grid starts at 30 cm');
  const row = n => +(n * 0.3 * Math.sqrt(3) / 2).toFixed(3);         // y of a row of the staggered grid
  await app.dragPlan(2, row(15), 4.4, row(15));                      // paint a row along the border
  await app.page.waitForTimeout(900);
  let pl = (await app.store('gardens/g1')).plantings;
  ok(pl.length >= 8 && pl.length <= 10, 'about one plant every 30 cm over 2.4 m, got ' + pl.length);
  const xs = pl.map(q => q.x).sort((a, b) => a - b), gaps = xs.slice(1).map((x, i) => +(x - xs[i]).toFixed(3));
  ok(gaps.every(g => Math.abs(g - 0.3) < 0.002), 'evenly 30 cm apart, got ' + JSON.stringify(gaps));
  await app.dragPlan(2, row(15), 4.4, row(15));                      // painting again over the same row adds nothing
  await app.page.waitForTimeout(900);
  eq((await app.store('gardens/g1')).plantings.length, pl.length, 'occupied grid points are skipped');
  const nSalvia = pl.length;
  // a second species in the next row of the staggered grid
  await app.page.click('#lib [data-pid=p4]');
  await app.dragPlan(2, row(16), 4.4, row(16));
  await app.page.waitForTimeout(900);
  pl = (await app.store('gardens/g1')).plantings;
  const row2 = pl.filter(q => q.plantId === 'p4');
  ok(row2.length >= 7 && row2.every(q => Math.abs(q.y - 0.3 * Math.sqrt(3) / 2 * Math.round(q.y / (0.3 * Math.sqrt(3) / 2))) < 0.002), 'second row sits on the staggered grid');
  ok(row2.every(q => Math.abs(((q.x / 0.15) % 2) - 1) < 0.02 || Math.abs(((q.x / 0.15) % 2) - 1) > 0.98), 'offset by half a spacing from the first row');
  // trees, shrubs and existing plants go exactly where you click
  await app.page.click('#lib [data-pid=ex1]'); await app.clickPlan(7.13, 6.21);
  await app.page.click('#lib [data-pid=p2]'); await app.clickPlan(9.07, 6.53); await app.page.waitForTimeout(900);
  pl = (await app.store('gardens/g1')).plantings;
  const tree = pl.find(q => q.plantId === 'ex1'), rose = pl.find(q => q.plantId === 'p2');
  ok(tree && Math.abs(tree.x - 7.13) < 0.06 && Math.abs(tree.y - 6.21) < 0.06, 'existing tree placed freely, got ' + JSON.stringify(tree));
  ok(rose && Math.abs(rose.x - 9.07) < 0.06 && Math.abs(rose.y - 6.53) < 0.06, 'shrub placed freely, got ' + JSON.stringify(rose));
  // bulbs: their own layer, painted in among the salvias on a 15 cm grid
  await app.page.click('#lib [data-pid=p3]');
  ok(!(await app.page.$('#pg-space')), 'no planting-grid box for bulbs');
  await app.dragPlan(2, row(15), 3.2, row(15)); await app.page.waitForTimeout(900);
  pl = (await app.store('gardens/g1')).plantings;
  const bulbs = pl.filter(q => q.plantId === 'p3');
  ok(bulbs.length >= 7, 'bulbs painted among the perennials, got ' + bulbs.length);
  eq(pl.filter(q => q.plantId === 'p1').length, nSalvia, 'the perennials are untouched');
  // Alt-drag rubs out only the layer you are working on
  await app.page.click('#lib [data-pid=p4]');
  await app.page.keyboard.down('Alt'); await app.dragPlan(2, row(15), 2.8, row(15)); await app.dragPlan(2, row(16), 2.8, row(16)); await app.page.keyboard.up('Alt'); await app.page.waitForTimeout(900);
  pl = (await app.store('gardens/g1')).plantings;
  ok(pl.filter(q => q.plantId === 'p4').length < row2.length, 'Alt-drag removed some geraniums');
  eq(pl.filter(q => q.plantId === 'p3').length, bulbs.length, 'but no bulbs');
  // drawing: perennials at their spacing with species colours; one label per block; structure under the planting
  const sid = pl.find(q => q.plantId === 'p1').id;
  const r = await app.page.evaluate(id => +document.querySelector(`#map [data-kind=planting][data-id="${id}"] circle`).getAttribute('r'), sid);
  eq(r, 0.15, 'circle radius is half the spacing');
  await app.page.click('#vPlanted');
  eq(await app.page.evaluate(id => +document.querySelector(`#map [data-kind=planting][data-id="${id}"] circle`).getAttribute('r'), sid), 0.15, 'perennials keep their size in As planted');
  await app.page.click('#vPlanted');
  const fills = await app.page.evaluate(() => [...new Set([...document.querySelectorAll('#map [data-kind=planting] circle')].map(c => c.style.fill))]);
  ok(fills.length >= 4, 'each species its own fill, got ' + fills.length);
  const order = await app.page.evaluate(ids => { const all = [...document.querySelectorAll('#map [data-kind=planting]')].map(g => g.dataset.id); return ids.map(id => all.indexOf(id)); }, [rose.id, sid, bulbs[0].id]);
  ok(order[0] < order[1] && order[1] < order[2], 'drawn structure, then planting, then bulbs, got ' + order);
  const cols = (await app.store('gardens/g1')).colors; ok(cols.p1 === 0 && cols.p4 === 1 && cols.p2 != null && cols.ex1 != null && new Set(Object.values(cols)).size === Object.keys(cols).length, 'every species its own colour, trees and shrubs too, got ' + JSON.stringify(cols));
  const ctr = await app.page.evaluate(id => document.querySelectorAll(`#map [data-kind=planting][data-id="${id}"] path.ctr`).length, rose.id);
  ok(ctr === 1, 'the rose is marked at its centre with a cross');
});

test('drawing style: flat colours, open trees with a cross, one line through a run of shrubs, no decorative textures', async open => {
  const seed = sample(), g = seed['gardens/g1'];
  g.underlay = null;
  g.plantings.push({ id: 'r1', plantId: 'p2', x: 2, y: 7, qty: 1 }, { id: 'r2', plantId: 'p2', x: 2.9, y: 7.3, qty: 1 }, { id: 'r3', plantId: 'p2', x: 3.9, y: 7, qty: 1 });
  g.beds = [{ id: 'bWd', pts: [[6, 5.5], [9, 5.5], [9, 8], [6, 8]], ox: 7.5, oy: 6.7, wood: { h: 12 } },
    { id: 'bPond', kind: 'water', pts: [[10, 6], [11.5, 6], [11.5, 8], [10, 8]] }, { id: 'bLawn', kind: 'path', surface: 'grass', pts: [[0.2, 6], [1.2, 6], [1.2, 8], [0.2, 8]] },
    { id: 'bHedge', kind: 'hedge', pts: [[4.5, 7.8], [5.8, 7.8], [5.8, 8.4], [4.5, 8.4]] }];
  const app = await open(seed); await app.page.waitForTimeout(300);
  const r = await app.page.evaluate(() => {
    const m = document.querySelector('#map'), html = m.innerHTML;
    const apple = m.querySelector('[data-kind=planting][data-id="f"] circle');
    return {
      speciesPats: [...m.querySelectorAll('pattern')].map(p => p.id).filter(id => id.startsWith('pat-')),
      appleOp: +apple.getAttribute('fill-opacity'), appleCross: !!m.querySelector('[data-kind=planting][data-id="f"] path.ctr'),
      drifts: [...m.querySelectorAll('path.drift')].map(p => (p.getAttribute('d').match(/M/g) || []).length),
      texts: [...m.querySelectorAll('text')].map(t => t.textContent),
      arcs: [...m.querySelectorAll('[data-kind=bed] path')].some(p => /A/.test(p.getAttribute('d') || '')),
      water: html.includes('apat-water'), grass: html.includes('apat-grass'), hedge: html.includes('apat-hedge'), wood: html.includes('woodpat')
    };
  });
  eq(r.speciesPats, [], 'no automatic hatching while colours remain');
  ok(r.appleOp < 0.25 && r.appleCross, 'the apple tree is an open crown with a cross, got ' + r.appleOp);
  ok(r.drifts.includes(2), 'the three roses are joined by one two-segment line, got ' + JSON.stringify(r.drifts));
  ok(!r.arcs, 'woodland drawn with its plain outline');
  ok(!r.water && !r.grass && !r.hedge && !r.wood, 'no water, lawn, hedge or woodland textures');
});

test('Oudolf mode: areas that share borders, counted from plants per square metre', async open => {
  const seed = sample(); seed['gardens/g1'].plantings = []; seed['settings/prefs'] = { oudolf: true };
  const app = await open(seed);
  const row = n => +(n * 0.3 * Math.sqrt(3) / 2).toFixed(3);
  await app.page.click('#lib [data-pid=p1]');
  for (let n = 10; n < 16; n++) await app.dragPlan(1, row(n), 3, row(n));
  await app.page.click('#lib [data-pid=p4]');
  for (let n = 10; n < 16; n++) await app.dragPlan(3.3, row(n), 5, row(n));
  await app.page.waitForTimeout(900);
  const regions = () => app.page.evaluate(() => [...document.querySelectorAll('#map [data-kind=region]')].map(g => g.dataset.ids.split(',').length));
  eq((await regions()).length, 2, 'one area per species');
  eq(await app.page.evaluate(() => document.querySelectorAll('#map [data-kind=planting] circle').length), 0, 'no circles for the planting');
  // counted from area × plants per m²
  await app.page.fill('#pt-dens', '9'); await app.page.press('#pt-dens', 'Enter'); await app.page.waitForTimeout(400);
  eq((await app.store('plants/p4')).density, 9, 'plants per m² kept with the species');
  const cells = (await app.store('gardens/g1')).plantings.filter(q => q.plantId === 'p4').length;
  const want = Math.round(cells * 0.09 * Math.sqrt(3) / 2 * 9);
  await app.go('schedule');
  const srow = await app.page.evaluate(() => [...document.querySelectorAll('#sched tr')].map(r => [...r.cells].map(c => c.textContent.trim())).find(t => t.some(c => /Geranium/.test(c))) || []);
  ok(srow.includes(String(want)), `geranium count is area × 9 = ${want}, row: ${srow.join(' | ')}`);
  await app.go('plan');
  // painting over a neighbour moves the border; the areas stay two
  await app.page.click('#lib [data-pid=p1]');
  await app.dragPlan(3.2, row(12), 3.9, row(12)); await app.page.waitForTimeout(900);
  const pl = (await app.store('gardens/g1')).plantings;
  ok(pl.filter(q => q.plantId === 'p4').length < cells, 'geranium cells taken over');
  eq((await regions()).length, 2, 'still two areas');
  // a single plant on its own stays a circle, and the area round it carries on unbroken
  await app.page.click('#lib [data-pid=p4]'); await app.clickPlan(1.8, row(12)); await app.page.waitForTimeout(900);
  eq(await app.page.evaluate(() => document.querySelectorAll('#map [data-kind=planting] circle').length >= 1), true, 'the single geranium is a circle');
  eq((await regions()).length, 2, 'still two areas, the salvia unbroken');
  await app.page.keyboard.press('Control+z'); await app.page.waitForTimeout(600);
  // Shift-click on an area only selects it; it never drops a plant into it
  const n0 = (await app.store('gardens/g1')).plantings.length;
  await app.page.click('#lib [data-pid=p4]');
  await app.page.keyboard.down('Shift'); await app.clickPlan(1.5, row(13)); await app.page.keyboard.up('Shift'); await app.page.waitForTimeout(900);
  eq((await app.store('gardens/g1')).plantings.length, n0, 'Shift-click leaves the planting alone');
  ok(/m² ·/.test(await app.page.textContent('#inspector')), 'and selects the area');
  // clicking an area selects all of it, and it moves as one, staying on the grid
  await app.page.keyboard.press('v');
  await app.clickPlan(4.6, row(14));
  ok(/m² ·/.test(await app.page.textContent('#inspector')), 'area shown with its size');
  const before = (await app.store('gardens/g1')).plantings.filter(q => q.plantId === 'p4').map(q => q.x).sort((a, b) => a - b);
  await app.dragPlan(4.6, row(14), 5.2, row(14)); await app.page.waitForTimeout(900);
  const after = (await app.store('gardens/g1')).plantings.filter(q => q.plantId === 'p4').map(q => q.x).sort((a, b) => a - b);
  eq(after.map((x, i) => +(x - before[i]).toFixed(3)).every(d => d === 0.6), true, 'every cell moved 0.6 m (two grid steps)');
});

test('beds: drawn with the Bed tool, the grid centred on them, planting kept inside, locked to other tools', async open => {
  const seed = sample(); seed['gardens/g1'].plantings = []; seed['gardens/g1'].underlay = null; seed['settings/prefs'] = { oudolf: true };
  const app = await open(seed);
  await app.page.keyboard.press('b');
  for (const [x, y] of [[1, 1], [6.2, 1], [6.2, 3.1], [1, 3.1], [1, 1]]) await app.clickPlan(x, y);
  let g = await app.store('gardens/g1'); await app.page.waitForTimeout(900); g = await app.store('gardens/g1');
  eq(g.beds?.length, 1, 'one bed saved'); eq(g.beds[0].pts.length, 4, 'with four corners');
  eq(await app.page.inputValue('#area-draw'), 'circles', 'a new bed starts with tight circles');
  await app.page.selectOption('#area-draw', 'oudolf'); await app.page.waitForTimeout(900);
  eq((await app.store('gardens/g1')).beds[0].oudolf, true, 'set to Oudolf drawing, for this bed');
  // paint across the bed and well beyond it
  await app.page.click('#lib [data-pid=p1]');
  for (let y = 0.6; y < 3.6; y += 0.13) await app.dragPlan(0.4, y, 7, y);
  await app.page.waitForTimeout(900);
  const pl = (await app.store('gardens/g1')).plantings;
  ok(pl.length > 40, 'bed filled, got ' + pl.length);
  ok(await app.page.evaluate(pts => { const path = document.querySelector('#map [data-kind=bed] path'); return pts.every(([x, y]) => path.isPointInFill(new DOMPoint(x, y))); }, pl.map(q => [q.x, q.y])), 'nothing planted outside the bed’s curved edge');
  ok(/C/.test(await app.page.getAttribute('#map [data-kind=bed] path', 'd')), 'the bed edge is a curve');
  const xs = pl.map(q => q.x), ys = pl.map(q => q.y), r3 = v => +v.toFixed(2);
  // the grid is anchored on the bed's centre (3.6, 2.05), so it sits evenly within it
  const onLattice = (v, o, step) => Math.abs((v - o) / step - Math.round((v - o) / step)) < 0.02;
  ok(xs.every(x => onLattice(x, 3.6 - 0.075, 0.15)) && ys.every(y => onLattice(y, 2.05, 0.3 * Math.sqrt(3) / 2)), 'grid centred on the bed');
  ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 3.6) < 0.16, 'planting balanced left to right');
  // the Oudolf area reaches the bed's edge and is clipped to it
  const box = await app.page.evaluate(() => { const g = document.querySelector('#map [data-kind=region]'); const b = g.querySelector('path').getBBox(); return { clip: g.getAttribute('clip-path'), x0: b.x, x1: b.x + b.width }; });
  ok(/bedclip/.test(box.clip || ''), 'area clipped to the bed');
  ok(box.x0 <= 1.0 && box.x1 >= 6.2, 'area runs out to the bed edge, got ' + JSON.stringify(box));
  // with Select, the bed can't be picked up or moved
  await app.page.keyboard.press('v'); await app.page.keyboard.press('Escape');
  await app.dragPlan(1.02, 2, 2, 2); await app.page.waitForTimeout(600);
  eq((await app.store('gardens/g1')).beds[0].pts[0], [1, 1], 'bed unmoved by Select');
  // with the Bed tool it moves, and Delete removes it
  await app.page.keyboard.press('b');
  await app.dragPlan(3, 1.05, 3.5, 1.05); await app.page.waitForTimeout(900);
  eq((await app.store('gardens/g1')).beds[0].pts[0], [1.5, 1], 'bed moved with the Bed tool');
  await app.page.keyboard.press('Delete'); await app.page.waitForTimeout(900);
  eq((await app.store('gardens/g1')).beds, [], 'bed removed');
});

test('plant photos from Wikimedia Commons: cultivar first, only usable licences, credited in the booklet', async open => {
  const app = await open(sample(), { hash: '#presentation' });
  await app.page.waitForSelector('.bpage');
  await app.page.click('[data-findphoto=p1]');                        // Salvia nemorosa 'Caradonna'
  await app.page.waitForSelector('#photoModal [data-pick]');
  const groups = await app.page.$$eval('#photoModal .pgroup', g => g.map(x => x.textContent));
  ok(/Caradonna/.test(groups[0]) && /species/.test(groups[1] || ''), 'cultivar first, then the species, got ' + JSON.stringify(groups));
  const credits = await app.page.$$eval('#photoModal [data-pick] small', s => s.map(x => x.textContent));
  ok(credits.length === 3 && !credits.some(c => /NC/.test(c)), 'the non-commercial photo is left out, got ' + JSON.stringify(credits));
  await app.page.click('#photoModal [data-pick="0:0"]');
  await app.page.waitForFunction(() => document.getElementById('photoModal').hidden);
  await app.page.waitForTimeout(500);
  const p1 = await app.store('plants/p1');
  ok(p1.photoId, 'photo saved with the species');
  eq([p1.photoCredit.by, p1.photoCredit.licence], ['Fern Gardener', 'CC BY-SA 4.0'], 'with its credit');
  await app.page.waitForFunction(() => /Fern Gardener/.test(document.getElementById('presPages').textContent));
  ok(/Photo: Fern Gardener, CC BY-SA 4.0, Wikimedia Commons/.test(await app.page.textContent('#presPages')), 'credit printed in the booklet');
  // Find missing photos steps through the rest; Skip moves on, Stop closes
  await app.page.click('#findMissing');
  await app.page.waitForSelector('#photoModal:not([hidden]) h2');
  ok(/1 of \d/.test(await app.page.textContent('#photoH')), 'counts through the plants without photos');
  await app.page.click('#photoModal [data-ph=skip]');
  ok(/2 of \d/.test(await app.page.textContent('#photoH')), 'skip moves on');
  await app.page.keyboard.press('Escape');
  ok(await app.page.evaluate(() => document.getElementById('photoModal').hidden), 'Escape stops');
  // existing plants can have one too, from the species form
  await app.go('plan'); await app.page.click('#lib [data-edit=ex1]');
  ok(await app.page.isVisible('[data-act=findPhotoEdit]'), 'Find a photo online offered for an existing plant');
});

test('species pop-up saves when you click off it', async open => {
  const app = await open(sample(), { hash: '#database' });
  const off = () => app.page.mouse.click(8, 450);                     // the dimmed backdrop beside the pop-up
  // opened and closed with nothing changed: no save, nothing to undo
  await app.page.click('#dbMine [data-edit=p0]'); await app.page.waitForSelector('#plantModal:not([hidden])');
  await off(); await app.page.waitForTimeout(300);
  ok(await app.page.evaluate(() => document.getElementById('plantModal').hidden), 'closes');
  ok(await app.page.isDisabled('#undoBtn'), 'nothing to undo');
  // a change is kept
  await app.page.click('#dbMine [data-edit=p0]'); await app.page.waitForSelector('#plantModal:not([hidden])');
  await app.page.fill('#sp-common', 'English lavender'); await off(); await app.page.waitForTimeout(500);
  ok(await app.page.evaluate(() => document.getElementById('plantModal').hidden), 'closes after saving');
  eq((await app.store('plants/p0')).common, 'English lavender', 'change saved');
  // a change that can't be saved keeps the pop-up open and says why
  await app.page.click('#dbMine [data-edit=p0]'); await app.page.waitForSelector('#plantModal:not([hidden])');
  await app.page.fill('#sp-common', ''); await app.page.fill('#sp-bot', ''); await off(); await app.page.waitForTimeout(300);
  ok(!(await app.page.evaluate(() => document.getElementById('plantModal').hidden)), 'stays open');
  ok(/name/.test(await app.page.textContent('#plantErr')), 'and says what is missing');
  await app.page.keyboard.press('Escape');
  eq((await app.store('plants/p0')).common, 'English lavender', 'Escape discards');
});

test('beds: reshaping keeps the grid still, moving takes the planting, points can be added and double-clicked away, old beds are repaired', async open => {
  const seed = sample(); seed['gardens/g1'].plantings = []; seed['gardens/g1'].underlay = null; seed['settings/prefs'] = { oudolf: true };
  // an older bed with no anchor, and planting painted on two different grids (as reshaping used to cause)
  seed['gardens/g1'].beds = [{ id: 'bedOld', pts: [[1, 1], [6, 1], [6, 4], [1, 4]] }];
  const dy = 0.3 * Math.sqrt(3) / 2; let n = 0;
  for (let j = 0; j < 6; j++) for (let i = 0; i < 8; i++) seed['gardens/g1'].plantings.push({ id: 'q' + (n++), plantId: 'p1', x: +(2 + i * 0.3 + (j & 1 ? 0.15 : 0)).toFixed(3), y: +(1.8 + j * dy).toFixed(3), qty: 1 });
  for (let i = 0; i < 4; i++) seed['gardens/g1'].plantings.push({ id: 'stray' + i, plantId: 'p1', x: +(2.07 + i * 0.3).toFixed(3), y: 3.43, qty: 1 });
  const app = await open(seed);
  await app.page.waitForTimeout(1200);
  let g = await app.store('gardens/g1');
  ok(Number.isFinite(g.beds[0].ox), 'the old bed now keeps an anchor');
  const s = 0.3, f = { ox: g.beds[0].ox - s / 4, oy: g.beds[0].oy }, onGrid = q => { const jj = Math.round((q.y - f.oy) / dy), off = (jj & 1) ? s / 2 : 0; return Math.abs((q.x - f.ox - off) / s - Math.round((q.x - f.ox - off) / s)) < 0.02 && Math.abs((q.y - f.oy) / dy - jj) < 0.02; };
  ok(g.plantings.every(onGrid), 'every plant snapped onto one grid');
  eq(g.plantings.filter(q => /^q/.test(q.id)).every(q => seed['gardens/g1'].plantings.find(o => o.id === q.id).x === q.x), true, 'the main block was already on it and did not move');
  // reshape the bed: the grid stays put, and painting next to the block still works
  const anchor = [g.beds[0].ox, g.beds[0].oy];
  await app.page.keyboard.press('b'); await app.clickPlan(3.5, 2.5);
  await app.dragPlan(6, 4, 7.2, 4.6); await app.page.waitForTimeout(900);
  g = await app.store('gardens/g1');
  eq([g.beds[0].ox, g.beds[0].oy], anchor, 'reshaping leaves the anchor');
  ok(g.beds[0].pts[2][0] === 7.2 && g.beds[0].pts[2][1] === 4.6, 'the corner moved, on a 2 cm snap, got ' + JSON.stringify(g.beds[0].pts[2]));
  const before = g.plantings.length;
  await app.page.click('#lib [data-pid=p4]'); await app.dragPlan(4.6, 2.3, 5.6, 2.3); await app.page.waitForTimeout(900);
  g = await app.store('gardens/g1');
  ok(g.plantings.length >= before + 3 && g.plantings.every(onGrid), 'new planting sits on the same grid, right beside the old');
  // add a point by dragging a halfway handle, then remove it with Alt-click
  await app.page.keyboard.press('b'); await app.clickPlan(3.5, 2.5);
  const mid = await app.page.$eval('#map [data-kind=bedm][data-i="0"]', c => [+c.dataset.x, +c.dataset.y]);
  await app.dragPlan(mid[0], mid[1], mid[0], mid[1] - 0.4); await app.page.waitForTimeout(900);
  eq((await app.store('gardens/g1')).beds[0].pts.length, 5, 'a point added');
  const p1 = (await app.store('gardens/g1')).beds[0].pts[1], h = await app.planXY(p1[0], p1[1]);
  await app.page.mouse.dblclick(h.x, h.y); await app.page.waitForTimeout(900);
  eq((await app.store('gardens/g1')).beds[0].pts.length, 4, 'and removed again with a double-click');
  // move the whole bed: its planting and its grid come too
  const pl0 = (await app.store('gardens/g1')).plantings.find(q => q.id === 'q0');
  await app.clickPlan(3.5, 2.5); await app.dragPlan(3.3, 3.9, 3.9, 3.9); await app.page.waitForTimeout(900);
  g = await app.store('gardens/g1');
  const pl1 = g.plantings.find(q => q.id === 'q0');
  eq([+(pl1.x - pl0.x).toFixed(2), +(pl1.y - pl0.y).toFixed(2)], [0.6, 0], 'planting moved with the bed');
  eq([+(g.beds[0].ox - anchor[0]).toFixed(2), +(g.beds[0].oy - anchor[1]).toFixed(2)], [0.6, 0], 'and so did its grid');
});

test('existing perennials behave like new ones, but are not bought', async open => {
  const seed = sample(); seed['gardens/g1'].plantings = []; seed['gardens/g1'].underlay = null;
  seed['gardens/g1'].palette.push('ex2'); seed['plants/ex2'] = { common: 'Old geranium', botanical: 'Geranium macrorrhizum', role: 'ground', existing: true, spread: 0.5, height: 0.3 };
  const app = await open(seed);
  const row = n => +(n * 0.3 * Math.sqrt(3) / 2).toFixed(3);
  await app.page.click('#lib [data-pid=ex2]');
  ok(await app.page.isVisible('#pg-space'), 'painted on the planting grid');
  await app.dragPlan(2, row(10), 3.5, row(10)); await app.page.waitForTimeout(900);
  const pl = (await app.store('gardens/g1')).plantings.filter(q => q.plantId === 'ex2');
  ok(pl.length >= 5, 'a row of existing geraniums, got ' + pl.length);
  ok(pl.every(q => Math.abs(q.y - row(10)) < 0.002), 'on the grid');
  const look = await app.page.evaluate(id => { const c = document.querySelector(`#map [data-kind=planting][data-id="${id}"] circle`); return [c.getAttribute('r'), c.getAttribute('stroke-dasharray'), c.style.fill]; }, pl[0].id);
  eq(look[0], '0.15', 'drawn at its spacing'); eq(look[1], null, 'not dashed'); ok(/url\(#pat-ex2\)|rgb/.test(look[2]), 'in its species colour, got ' + look[2]);
  // Oudolf mode: an area, but not counted as plants to buy
  await app.page.click('#oudolfBtn'); await app.page.waitForTimeout(300);
  eq(await app.page.evaluate(() => document.querySelectorAll('#map [data-kind=region]').length), 1, 'drawn as an area');
  await app.go('schedule');
  const sched = await app.page.textContent('#sched');
  ok(!/Old geranium/.test(sched), 'not in the plant schedule');
  ok(/Old geranium/.test(await app.page.textContent('#existingT')), 'listed with the existing plants');
});

test('Oudolf mode from the toolbar: flicking back and forth moves nothing', async open => {
  const seed = sample(); seed['gardens/g1'].plantings = []; seed['gardens/g1'].underlay = null;
  const app = await open(seed);
  const row = n => +(n * 0.3 * Math.sqrt(3) / 2).toFixed(3);
  await app.page.click('#lib [data-pid=p1]'); for (let n = 10; n < 14; n++) await app.dragPlan(1, row(n), 3, row(n));
  await app.page.click('#lib [data-pid=p4]'); for (let n = 10; n < 14; n++) await app.dragPlan(3.3, row(n), 5, row(n));
  await app.page.waitForTimeout(900);
  const before = JSON.stringify((await app.store('gardens/g1')).plantings);
  const regions = () => app.page.evaluate(() => document.querySelectorAll('#map [data-kind=region]').length);
  eq(await app.page.getAttribute('#oudolfBtn', 'aria-pressed'), 'false', 'off to start');
  eq(await regions(), 0, 'circles');
  // with a plant being placed
  await app.page.click('#oudolfBtn');
  eq(await app.page.getAttribute('#oudolfBtn', 'aria-pressed'), 'true', 'on');
  eq(await regions(), 2, 'areas');
  ok(await app.page.isVisible('#pt-dens'), 'plants per m² offered for the plant being placed');
  await app.page.keyboard.press('o');
  eq(await regions(), 0, 'O key flicks back');
  ok(!(await app.page.isVisible('#pt-dens')), 'and the box goes');
  // with an area selected
  await app.page.keyboard.press('o'); await app.page.keyboard.press('v'); await app.clickPlan(2, row(12));
  ok(/m² ·/.test(await app.page.textContent('#inspector')), 'area selected');
  await app.page.click('#oudolfBtn');
  ok(/selected/.test(await app.page.textContent('#inspector')), 'still selected, now as plants');
  await app.page.click('#oudolfBtn');
  await app.page.waitForTimeout(900);
  eq(JSON.stringify((await app.store('gardens/g1')).plantings), before, 'no plant moved, added or lost');
  // with no beds drawn, the setting is the garden's own, and is remembered with it
  await app.page.waitForTimeout(900);
  eq((await app.store('gardens/g1')).oudolf, true, 'remembered with the garden');
  ok(!(await app.page.$('#pf-oudolf')), 'no app-wide switch left in Preferences');
});

test('booklet PDF: drawn as real text and shapes, photos cropped to their frame, never stretched', async open => {
  const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process'), zlib = require('zlib');
  const app = await open(sample(), { hash: '#presentation' });
  await app.page.waitForSelector('.bpage');
  // a wide photo, 3 : 1, on a card that is nearly square
  const png = (w, h) => { const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x < w / 2 ? 200 : 60; raw[o + 1] = 120; raw[o + 2] = 90; }
    const crc = b => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
    const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
    const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); };
  await app.page.setInputFiles('[data-photo-for=p1]', { name: 'wide.png', mimeType: 'image/png', buffer: png(600, 200) });
  await app.page.waitForFunction(() => /Photo added/.test(document.getElementById('presMsg').textContent));
  const card = await app.page.$eval('.bcard .ph img', im => { const r = im.parentElement.getBoundingClientRect(); return r.width / r.height; });
  const t0 = Date.now(); await app.page.click('#presPdf');
  await app.page.waitForFunction(() => /PDF saved|Couldn/.test(document.getElementById('presMsg').textContent), null, { timeout: 60000 });
  ok(/PDF saved/.test(await app.page.textContent('#presMsg')), 'saved');
  console.log(`     (booklet made in ${Date.now() - t0} ms)`);
  const pdf = await app.savedBytes(0);
  ok(!/\/Width 3369/.test(pdf.toString('latin1')), 'no whole-page pictures');
  let list = null; const f = path.join(os.tmpdir(), 'sl-crop-' + process.pid + '.pdf'); fs.writeFileSync(f, pdf);
  try { list = execFileSync('pdfimages', ['-list', f]).toString(); } catch { list = null; } finally { fs.unlinkSync(f); }
  if (list) {
    const sizes = list.split('\n').slice(2).map(l => l.trim().split(/\s+/)).filter(c => c.length > 4).map(c => [+c[3], +c[4]]);
    const photo = sizes.find(([w, h]) => Math.abs(w / h - card) < 0.06);
    ok(photo, `the photo is cropped to its frame's shape (${card.toFixed(2)} : 1), got ${JSON.stringify(sizes)}`);
    ok(!sizes.some(([w, h]) => Math.abs(w / h - 3) < 0.05), 'and is not the stretched 3 : 1 original');
  } else console.log('     (pdfimages not installed: crop not measured)');
});

test('aerial photo: find the garden on the map, frame it, draw over it; the key stays private', async open => {
  const seed = sample(); seed['gardens/g1'].underlay = null; seed['gardens/g1'].north = 0; delete seed['gardens/g1'].lat;
  const app = await open(seed);
  const menu = async () => { if (await app.page.isHidden('#ulMenu')) await app.page.click('#ulMenuBtn'); };
  await menu(); await app.page.click('#aerPick');
  ok(await app.page.isVisible('#mp-key'), 'asks for an Esri key first');
  await app.page.fill('#mp-key', 'TEST-KEY-123'); await app.page.click('[data-mp-key] button');
  await app.page.waitForFunction(() => window.L && document.querySelector('#mp-map .leaflet-tile'), null, { timeout: 10000 });
  await app.page.fill('#mp-q', 'Bath'); await app.page.click('[data-mp-search] button'); await app.page.waitForTimeout(500);
  ok(/12 × 8.6 m/.test(await app.page.textContent('#mp-size')), 'the frame is the garden at its size');
  await app.page.click('[data-mp=use]'); await app.page.waitForTimeout(900);
  const g = await app.store('gardens/g1');
  ok(g.aerial && Math.abs(g.aerial.lat - 51.3811) < 0.001 && Math.abs(g.aerial.lon + 2.359) < 0.001, 'position kept with the garden, got ' + JSON.stringify(g.aerial));
  ok(Math.abs(g.lat - 51.38) < 0.01, 'the sun study location filled in');
  ok(!JSON.stringify(g).includes('data:image') && !JSON.stringify(g).includes('TEST-KEY'), 'no photo and no key stored with the garden');
  const tiles = await app.page.$$eval('#map .aer image', im => im.map(i => i.getAttribute('href')));
  ok(tiles.length >= 1 && tiles.every(h => /World_Imagery\/MapServer\/tile\/\d+\/\d+\/\d+\?token=TEST-KEY-123/.test(h)), 'Esri tiles under the plan, got ' + tiles.length);
  await app.page.waitForTimeout(800);
  const zs = await app.page.$$eval('#map .aer image', im => [...new Set(im.map(i => +i.getAttribute('href').match(/\/tile\/(\d+)\//)[1]))]);
  eq(zs, [19], 'uses the most detailed level that has a real photo (Esri has none at 20 here)');
  ok((await app.page.textContent('#map')).includes('Powered by Esri'), 'Esri credited on the plan');
  // planting still works on top
  await app.page.click('#lib [data-pid=p0]'); await app.clickPlan(3, 3); await app.page.waitForTimeout(1200);
  { const n = (await app.store('gardens/g1')).plantings.length; ok(n === 8, 'plants go on as usual, got ' + n + ' · ' + await app.status() + ' · hit ' + await app.page.evaluate(() => { const p = document.querySelector('#map').createSVGPoint(); return 'tool:' + document.querySelector('[data-tool][aria-pressed=true]')?.dataset.tool; })); }
  // hide, show and remove
  await menu(); await app.page.click('#aerToggle');
  eq(await app.page.$$eval('#map .aer', x => x.length), 0, 'hidden'); await menu(); await app.page.click('#aerToggle');
  eq(await app.page.$$eval('#map .aer', x => x.length), 1, 'shown');
  // the plan sheet carries the photo but never the key
  await app.go('presentation'); await app.page.waitForSelector('.bpage'); await app.page.click('#sheetPdf');
  await app.page.waitForFunction(() => window.__mock.saved.length === 1 || /Couldn/.test(document.getElementById('presMsg').textContent), null, { timeout: 30000 });
  const raw = await app.savedBytes(0), zlib = require('zlib');
  let pdf = raw.toString('latin1');   // with every compressed stream opened up
  for (const m of pdf.matchAll(/stream\r?\n/g)) { const st = m.index + m[0].length, en = pdf.indexOf('endstream', st); try { pdf += zlib.inflateSync(raw.subarray(st, en)).toString('latin1'); } catch {} }
  ok(!pdf.includes('TEST-KEY'), 'the key is not in the PDF');
  ok(/Powered by Esri/.test(pdf) || /\(Powered by Esri/.test(pdf), 'the credit is');
  // backups leave the key out
  await app.go('preferences'); await app.page.click('[data-act=bkpAll]'); await app.page.waitForFunction(() => window.__mock.saved.length === 2);
  ok(!(await app.savedBytes(1)).toString('utf8').includes('TEST-KEY'), 'the key is not in a backup');
  await app.go('plan'); await menu(); await app.page.click('#aerRemove'); await app.page.waitForTimeout(900);
  ok(!(await app.store('gardens/g1')).aerial, 'removed');
});

test('beds can be named and coloured', async open => {
  const seed = sample(); seed['gardens/g1'].underlay = null; seed['gardens/g1'].plantings = [];
  seed['gardens/g1'].beds = [{ id: 'bA', pts: [[1, 1], [6, 1], [6, 4], [1, 4]], ox: 3.5, oy: 2.5 }];
  const app = await open(seed);
  await app.page.keyboard.press('b'); await app.clickPlan(3.5, 2.5);
  await app.page.fill('#bed-name', 'Front border');
  await app.page.$eval('#bed-col', el => { el.value = '#c98a5a'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await app.page.waitForTimeout(900);
  const b = (await app.store('gardens/g1')).beds[0];
  eq([b.name, b.color], ['Front border', '#c98a5a'], 'name and colour saved');
  ok((await app.page.textContent('#map')).includes('FRONT BORDER'), 'the name is on the plan');
  eq(await app.page.$eval('#map [data-kind=bed] path', p => p.style.fill), 'rgb(201, 138, 90)', 'the bed is coloured');
  // undo takes the colour back, then the name, one step each
  await app.page.evaluate(() => document.activeElement.blur()); await app.page.keyboard.press('Control+z'); await app.page.waitForTimeout(300);
  ok(!(await app.page.$eval('#map [data-kind=bed] path', p => p.style.fill)).includes('201'), 'undo takes the colour off');
  await app.page.keyboard.press('Control+z'); await app.page.waitForTimeout(300);
  ok(!(await app.page.textContent('#map')).includes('FRONT BORDER'), 'and then the name');
  await app.page.keyboard.press('Control+y'); await app.page.keyboard.press('Control+y'); await app.page.waitForTimeout(900);
  await app.clickPlan(3.5, 2.5); await app.page.click('[data-act=bedNoCol]'); await app.page.waitForTimeout(900);
  const b2 = (await app.store('gardens/g1')).beds[0];
  eq([b2.name, b2.color], ['Front border', undefined], 'No colour clears it, the name stays');
});

test('plant library filters: by layer, in this garden, grouped, remembered', async open => {
  const seed = sample(); seed['gardens/g1'].plantings = seed['gardens/g1'].plantings.filter(p => ['p0', 'p1'].includes(p.plantId));
  const app = await open(seed);
  const names = () => app.page.$$eval('#lib li[data-pid]', l => l.map(x => x.dataset.pid));
  eq((await names()).length, 7, 'all seven to start');
  ok((await app.page.$$eval('#lib li.lh', l => l.map(x => x.textContent))).includes('Herbaceous'), 'grouped under layer headings');
  await app.page.click('#libChips [data-lf=shrub]');
  eq((await names()).sort(), ['p0', 'p2'], 'Shrub shows the lavender and the rose');
  await app.page.click('#libChips [data-lf=herbaceous]');
  eq((await names()).sort(), ['p0', 'p1', 'p2'], 'and adding Herbaceous shows the salvia too');
  await app.page.click('#libChips [data-lf=used]');
  eq((await names()).sort(), ['p0', 'p1'], 'In this garden narrows to what is planted');
  await app.page.click('#libChips [data-lf=all]'); await app.page.click('#libChips [data-lf=used]');
  eq((await names()).length, 7, 'All clears the layers; In this garden off again');
  await app.page.click('#libChips [data-lf=tuber]'); eq(await names(), ['p3'], 'bulbs only');
  await app.page.reload(); await app.page.waitForTimeout(600);
  eq(await names(), ['p3'], 'the filter is remembered');
});

test('each garden has its own plant library; the database stays whole; existing plants stay with their garden', async open => {
  const app = await open(sample());
  // a new garden starts with an empty library
  await app.page.click('#detailsBtn'); await app.page.click('#newGardenBtn');
  await app.page.fill('#ng-name', 'Back border'); await app.page.click('#newGardenForm button[type=submit]'); await app.page.waitForTimeout(400);
  eq(await app.page.$$eval('#lib li[data-pid]', l => l.length), 0, 'new garden: empty library');
  ok(/library is empty/.test(await app.page.textContent('#lib')), 'and says how to add plants');
  // Add plants: pick two from the database; the existing birch from Elm Road is not offered
  await app.page.click('#addPlantBtn');
  const offered = await app.page.$$eval('#addModal [data-ap]', l => l.map(x => x.dataset.ap));
  ok(offered.length === 6 && !offered.includes('ex1'), 'database species offered, not another site’s existing plant, got ' + offered);
  await app.page.check('#addModal [data-ap=p1]'); await app.page.check('#addModal [data-ap=p4]'); await app.page.click('[data-apx=add]');
  eq((await app.page.$$eval('#lib li[data-pid]', l => l.map(x => x.dataset.pid))).sort(), ['p1', 'p4'], 'just those two in this garden');
  // a new species made here joins this garden's library and the database
  await app.page.click('#addPlantBtn'); await app.page.click('[data-apx=new]');
  await app.page.fill('#sp-common', 'Sesleria'); await app.page.click('[data-act=savePlant]'); await app.page.waitForTimeout(900);
  eq(await app.page.$$eval('#lib li[data-pid]', l => l.length), 3, 'the new species joins it');
  const all = await app.keys('plants/'); ok(all.length === 8, 'and the database, got ' + all.length);
  // the other garden is untouched
  await app.page.selectOption('#gardenSel', { label: 'Elm Road' }); await app.page.waitForTimeout(400);
  const elm = await app.page.$$eval('#lib li[data-pid]', l => l.map(x => x.dataset.pid));
  ok(elm.length === 7 && !elm.some(id => !/^(p[0-5]|ex1)$/.test(id)), 'Elm Road keeps its own seven, got ' + elm);
  // take one out of a garden's library (only when it isn't on the plan)
  await app.page.selectOption('#gardenSel', { label: 'Back border' }); await app.page.waitForTimeout(400);
  await app.page.click('#lib [data-edit=p4]'); await app.page.click('[data-act=unLibrary]'); await app.page.waitForTimeout(900);
  eq((await app.page.$$eval('#lib li[data-pid]', l => l.map(x => x.dataset.pid))).includes('p4'), false, 'removed from this garden');
  ok(await app.store('plants/p4'), 'but still in the database');
});

test('found in hands-on testing: moved areas never stack or leave a bed; schedule readable; centimetre sizes; tidy rulers', async open => {
  const seed = sample(); seed['gardens/g1'].plantings = []; seed['gardens/g1'].underlay = null; seed['settings/prefs'] = { oudolf: true };
  const app = await open(seed, { viewport: { width: 1400, height: 900 } });
  const row = n => +(n * 0.3 * Math.sqrt(3) / 2).toFixed(3);
  await app.page.click('#lib [data-pid=p1]'); for (let n = 14; n < 22; n++) await app.dragPlan(1, row(n), 3.9, row(n));
  await app.page.click('#lib [data-pid=p4]'); for (let n = 14; n < 22; n++) await app.dragPlan(4.1, row(n), 7, row(n));
  await app.page.waitForTimeout(900);
  const stacked = async () => { const pl = (await app.store('gardens/g1')).plantings; const seen = new Map(); let n = 0; for (const q of pl) { const k = q.x + ',' + q.y; if (seen.has(k)) n++; seen.set(k, 1); } return n; };
  await app.page.keyboard.press('v'); await app.clickPlan(2, row(17)); await app.dragPlan(2, row(17), 3.2, row(17)); await app.page.waitForTimeout(900);
  eq(await stacked(), 0, 'no two plants share a spot after moving an area onto its neighbour');
  ok(/Moved over/.test(await app.status()), 'and it says the neighbour gave way, got ' + await app.status());
  // a bed: moving an area out of it keeps every plant, just where it was put
  await app.page.keyboard.press('Control+z'); await app.page.waitForTimeout(400);
  await app.page.keyboard.press('b'); for (const [x, y] of [[0.5, 3.4], [7.5, 3.4], [7.5, 6], [0.5, 6], [0.5, 3.4]]) await app.clickPlan(x, y);
  await app.page.waitForTimeout(900); const n0 = (await app.store('gardens/g1')).plantings.length;
  await app.page.keyboard.press('v'); await app.clickPlan(5.5, row(18)); await app.dragPlan(5.5, row(18), 5.5, row(18) - 1.4); await app.page.waitForTimeout(900);
  const g = await app.store('gardens/g1'), outside = await app.page.evaluate(pts => { const path = document.querySelector('#map [data-kind=bed] path'); return pts.filter(([x, y]) => !path.isPointInFill(new DOMPoint(x, y))).length; }, g.plantings.map(q => [q.x, q.y]));
  eq(g.plantings.length, n0, 'no plant lost');
  ok(outside > 0, 'the part moved out of the bed stays out');
  // the schedule shows every species without a squashed box
  seed['gardens/g1'].plantings = sample()['gardens/g1'].plantings;
  await app.go('schedule');
  const h = await app.page.$eval('#sched', t => [t.parentElement.clientHeight, t.scrollHeight]);
  ok(h[0] >= h[1] - 2, 'the schedule table is not squashed, got box ' + h[0] + ' for ' + h[1]);
  // garden sizes to the centimetre
  await app.go('plan'); await app.page.click('#detailsBtn'); await app.page.fill('#g-w', '12.35'); await app.page.click('#detailsDone'); await app.page.waitForTimeout(900);
  eq((await app.store('gardens/g1')).width, 12.35, 'a width of 12.35 m is kept');
});

test('large plans: thousands of plants save and redraw', async open => {
  const seed = sample(), g = seed['gardens/g1'];
  for (let i = 0; i < 4000; i++) g.plantings.push({ id: 'mw6prrcs' + String(i).padStart(6, '0'), plantId: 'p' + (i % 5), x: (i % 60) * 0.15, y: Math.round(Math.floor(i / 60) * 0.1 * 100) / 100, qty: 1 });
  const app = await open(seed);
  const t0 = Date.now(); await app.page.evaluate(() => document.getElementById('zIn').click()); const ms = Date.now() - t0;
  await app.page.click('#zFit');
  await app.page.click('#lib [data-pid=p1]'); await app.clickPlan(11.7, 8.4); await app.page.waitForTimeout(1200);
  eq(await app.status(), 'Saved', 'saved');
  eq((await app.store('gardens/g1')).plantings.length, 4008, 'every plant stored');
  console.log(`     (4,008 placements; one redraw took about ${ms} ms)`);
});

test('works on its own: saved in the browser, kept after a reload, files downloaded', async open => {
  const app = await open({}, { real: true });
  ok(await app.page.evaluate(() => !window.claude && !window.__mock), 'no outside runtime on the page');
  await app.page.fill('#ng-name', 'Back border'); await app.page.click('#newGardenForm button[type=submit]');
  await app.page.waitForTimeout(300);
  await app.page.click('#addPlantBtn'); await app.page.click('[data-apx=new]'); await app.page.fill('#sp-common', 'Salvia'); await app.page.click('[data-act=savePlant]'); await app.page.waitForTimeout(300);
  await app.page.click('#lib li'); await app.clickPlan(2, 2); await app.page.waitForTimeout(1200);
  await app.reload();
  eq(await app.page.$eval('#gardenSel', s => s.selectedOptions[0].textContent), 'Back border', 'garden still there after a reload');
  eq(await app.page.evaluate(() => document.querySelectorAll('#map [data-kind=planting]').length), 1, 'its plant too');
  await app.go('preferences');
  const [dl] = await Promise.all([app.page.waitForEvent('download'), app.page.click('[data-act=bkpAll]')]);
  ok(/^SevenLayers backup - everything - .*\.json$/.test(dl.suggestedFilename()), 'backup downloaded as a file, got ' + dl.suggestedFilename());
});

test('labels: a row is labelled once, crowded labels never overlap, and winter runs into December', async open => {
  const seed = sample(); seed['gardens/g1'].underlay = null;
  const row = Array.from({ length: 8 }, (_, i) => ({ id: 'r' + i, plantId: 'p2', x: 2 + i * 0.9, y: 7, qty: 1, row: 'R1', rowI: i }));
  const crowd = Array.from({ length: 12 }, (_, i) => ({ id: 'k' + i, plantId: ['p0', 'p2', 'p5'][i % 3], x: 3 + (i % 4) * 0.35, y: 3.5 + Math.floor(i / 4) * 0.3, qty: 1 }));
  seed['gardens/g1'].rows = [{ id: 'R1', a: [2, 7], b: [8.3, 7], c: [5.15, 7], gap: 0.9 }];
  seed['gardens/g1'].plantings.push(...row, ...crowd); seed['settings/prefs'] = { labelPlace: 'plan' };
  const app = await open(seed);
  const texts = await app.page.$$eval('#map text', ts => ts.map(t => t.textContent));
  eq(texts.filter(t => /Ros/.test(t) && /^8 /.test(t)).length, 1, 'the row of eight roses has one label with its count');
  const boxes = await app.page.$$eval('#map text', ts => ts.filter(t => /Lav|Ros|Mal|Sal|Ger|Tul|Bet/.test(t.textContent)).map(t => { const w = t.getComputedTextLength(), x = +t.getAttribute('x'), h = +t.getAttribute('font-size'); return { t: t.textContent, x0: x - w / 2, x1: x + w / 2, y0: +t.getAttribute('y') - h * 0.72, y1: +t.getAttribute('y') + h * 0.05, e: h * 0.02 }; }));
  const bad = [];
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach(b => { if (a.x0 < b.x1 - a.e && b.x0 < a.x1 - a.e && a.y0 < b.y1 - a.e && b.y0 < a.y1 - a.e) bad.push(a.t + ' / ' + b.t); }));
  if (process.env.SHOT) await app.page.locator('#map').screenshot({ path: process.env.SHOT });
  eq(bad, [], 'no two plant labels overlap');
  ok(await app.page.locator('#map path.lead[stroke-width="0.8"]').count() > 0, 'labels moved well away get a leader line');
  await app.page.click('#navCal'); await app.page.waitForTimeout(200);
  const html = await app.page.evaluate(() => document.querySelector('.cal-seasons')?.innerHTML || '');
  ok(/grid-column:12\/13[^>]*>Winter</.test(html), 'December sits under Winter, got ' + html);
});

test('labels around the edge: one per species, in columns outside the plan, joined by metro-style lines', async open => {
  const seed = sample(); seed['gardens/g1'].underlay = null;
  seed['gardens/g1'].plantings.push({ id: 'z1', plantId: 'p2', x: 9, y: 7, qty: 1 }, { id: 'z2', plantId: 'p2', x: 11, y: 6, qty: 1 });
  const app = await open(seed);
  if (process.env.SHOT) await app.page.locator('#map').screenshot({ path: process.env.SHOT });
  const labs = await app.page.$$eval('#map text[pointer-events=auto]', ts => ts.map(t => ({ t: t.textContent, x: +t.getAttribute('x'), a: t.getAttribute('text-anchor') })));
  ok(labs.length > 0 && labs.every(l => (l.a === 'end' && l.x < 0) || (l.a === 'start' && l.x > 12)), 'every plant label sits outside the plan, got ' + JSON.stringify(labs));
  eq(labs.filter(l => /Ros oli/.test(l.t)).map(l => l.t), ['3 Ros oli'], 'the three roses on the right share one label with their total');
  const d = await app.page.$eval('#map g.leaders path', p => p.getAttribute('d'));
  const segs = d.split('M').filter(Boolean).flatMap(m => { const n = m.split('L').map(q => q.trim().split(' ').map(Number)); return n.slice(1).map((q, i) => [q[0] - n[i][0], q[1] - n[i][1]]); });
  ok(segs.length && segs.every(([dx, dy]) => Math.abs(dx) < 1e-3 || Math.abs(dy) < 1e-3 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 2e-3), 'leader lines only run level, upright or at 45°');
  ok(d.split('M').filter(Boolean).length <= labs.length, `at most one line per edge label, got ${d.split('M').filter(Boolean).length} lines for ${labs.length} labels`);
  await app.page.click('#navPrefs'); await app.page.selectOption('#pf-place', 'plan'); await app.page.click('#navPlan'); await app.page.waitForTimeout(200);
  ok(await app.page.$$eval('#map text[pointer-events=auto]', ts => ts.some(t => +t.getAttribute('x') > 0 && +t.getAttribute('x') < 12)), 'Preferences can put them back on the plan');
});

test('busy plan: one edge label and one line per species, its code small on its other patches', async open => {
  const seed = sample(); const g = seed['gardens/g1']; g.underlay = null;
  g.plantings = g.plantings.filter(q => q.plantId !== 'p2');
  let k = 0; const add = (x, y, qty) => g.plantings.push({ id: 'r' + k++, plantId: 'p2', x, y, qty });
  add(6, 5, 6);                     // the biggest patch, deep in the middle
  add(11.2, 7, 3);                  // half its size, close to the right edge: this one gets the line
  for (const [x, y] of [[2.5, 6.5], [4, 3], [8.5, 3], [9.5, 7.8]]) add(x, y, 1);
  const app = await open(seed); await app.page.waitForTimeout(300);
  if (process.env.SHOT) await app.page.locator('#map').screenshot({ path: process.env.SHOT });
  const labs = await app.page.$$eval('#map text[pointer-events=auto]', ts => ts.map(t => ({ t: t.textContent, x: +t.getAttribute('x'), y: +t.getAttribute('y') })));
  const ros = labs.filter(l => /Ros oli/.test(l.t));
  eq(ros.map(l => l.t), ['13 Ros oli'], 'one edge label for the species, with its whole-plan total');
  ok(ros[0].x > 12, 'on the side of its lead patch (the right)');
  const lines = await app.page.$eval('#map g.leaders path', p => p.getAttribute('d').split('M').filter(Boolean).map(m => m.split('L').map(q => q.trim().split(' ').map(Number))));
  ok(lines.length <= labs.length, `one line per edge label at most, got ${lines.length} for ${labs.length}`);
  const ends = lines.map(n => n[n.length - 1]);
  ok(ends.some(([x, y]) => Math.hypot(x - 11.2, y - 7) < 0.6), 'its line goes to the half-size patch near the edge, ends ' + JSON.stringify(ends));
  ok(!ends.some(([x, y]) => Math.hypot(x - 6, y - 5) < 0.6), 'not to the big patch in the middle');
  const codes = await app.page.$$eval('#map text:not([pointer-events=auto])', ts => ts.filter(t => /^Ros oli$/.test(t.textContent.trim())).map(t => { const b = t.getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }));
  eq(codes.length, 5, 'its five other patches carry its code, small');
  ok(codes.every(b => b.x > 0 && b.x + b.width < 12), 'the codes sit on the plan, got ' + JSON.stringify(codes.map(b => [b.x, b.width])));
  ok(codes.every((a, i) => codes.every((b, j) => i >= j || a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)), 'no two codes overlap');
  eq(app.errors, [], 'no page errors');
});

test('large plan: lines come from the nearest side, top or bottom; a species deep inside still goes to a side column', async open => {
  const seed = sample(); const g = seed['gardens/g1']; Object.assign(g, { underlay: null, width: 40, depth: 25 });
  g.plantings = [['p2', 20, 2, 3], ['p3', 22, 23, 20], ['p0', 20, 12, 6], ['p0', 14, 9, 2], ['p4', 3, 10, 5], ['p1', 12, 1.5, 4], ['p5', 30, 3, 1]].map(([plantId, x, y, qty], i) => ({ id: 'z' + i, plantId, x, y, qty }));
  const app = await open(seed); await app.page.waitForTimeout(300);
  const labs = await app.page.$$eval('#map text[pointer-events=auto]', ts => ts.map(t => { const b = t.getBBox(), w = t.getComputedTextLength(), x0 = t.getStartPositionOfChar(0).x; return { t: t.textContent, x: +t.getAttribute('x'), y: +t.getAttribute('y'), b: { x: x0, y: b.y, w, h: b.height } }; }));
  const one = re => { const m = labs.filter(l => re.test(l.t)); ok(m.length === 1, re + ' labelled once, got ' + JSON.stringify(m)); return m[0]; };
  const ros = one(/Ros oli/), tul = one(/Tul bal/), lav = one(/Lav ang/), ger = one(/Ger roz/);
  ok(ros.t === '3 Ros oli' && ros.y < 0 && Math.abs(ros.x - 20) < 2, 'near the top: in the row along the top, above its plants, got ' + JSON.stringify(ros));
  ok(tul.y > 25 && tul.x > 0 && tul.x < 40, 'near the bottom: in the row along the bottom, got ' + JSON.stringify(tul));
  ok(lav.t === '8 Lav ang' && (lav.x < 0 || lav.x > 40), 'deep inside: still at the edge (never beside its plants), with its total, got ' + JSON.stringify(lav));
  ok(ger.x < 0, 'near a side: in the side column, got ' + JSON.stringify(ger));
  const top = labs.filter(l => l.y < 0);
  ok(top.every((a, i) => top.every((c, j) => i >= j || a.b.x + a.b.w <= c.b.x || c.b.x + c.b.w <= a.b.x)), 'the top row labels do not overlap');
  const d = await app.page.$eval('#map g.leaders path', p => p.getAttribute('d'));
  const segs = d.split('M').filter(Boolean).flatMap(m => { const n = m.split('L').map(q => q.trim().split(' ').map(Number)); return n.slice(1).map((q, i) => [q[0] - n[i][0], q[1] - n[i][1]]); });
  ok(segs.every(([dx, dy]) => Math.abs(dx) < 1e-3 || Math.abs(dy) < 1e-3 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 2e-3), 'lines only run level, upright or at 45°');
  ok(await app.page.$$eval('#map text:not([pointer-events=auto])', ts => ts.some(t => t.textContent.trim() === 'Lav ang')), 'its other patch carries its code');
  eq(app.errors, [], 'no page errors');
});

test('reload: the chosen theme is set before the page is first drawn, so the base Eiderdown look never flashes', async open => {
  const early = () => { new MutationObserver((ms, o) => { if (document.body) { window.__skinAtBody = document.documentElement.dataset.skin || ''; window.__fontAtBody = !!document.querySelector('link[data-theme-font]'); o.disconnect(); } }).observe(document, { childList: true, subtree: true }); };
  let app = await open(sample(), { theme: 'woodwork' });
  await app.page.addInitScript(early); await app.page.reload(); await app.page.waitForTimeout(300);
  eq(await app.page.evaluate(() => window.__skinAtBody), 'woodwork', 'the saved theme is on the page before the body is drawn');
  eq(app.errors, [], 'no page errors');
  await app.close();
  app = await open(sample());
  await app.page.addInitScript(early); await app.page.evaluate(() => localStorage.removeItem('gpm.theme')); await app.page.reload(); await app.page.waitForTimeout(300);
  eq(await app.page.evaluate(() => window.__skinAtBody), 'drafting', 'with nothing saved, the default Drafting table, never Eiderdown');
  ok(await app.page.evaluate(() => window.__fontAtBody), 'its font starts loading from the head');
  eq(await app.page.$$eval('link[data-theme-font]', ls => ls.length), 1, 'the font link is added once');
  eq(app.errors, [], 'no page errors');
});

test('labels: a tight halo over the photo; on screen they stay one size when zooming, or grow with the plan if chosen', async open => {
  const sizes = app => app.page.$$eval('#map text[pointer-events=auto]', ts => { const k = document.getElementById('map').getScreenCTM().a; return ts.map(t => +t.getAttribute('font-size') * k); });
  let app = await open(sample());
  const halo = await app.page.evaluate(() => { const m = document.getElementById('map'); m.classList.add('over-photo'); const t = m.querySelector('text[pointer-events=auto]'), cs = getComputedStyle(t); const r = parseFloat(cs.strokeWidth) / parseFloat(cs.fontSize); m.classList.remove('over-photo'); return r; });
  ok(halo > 0 && halo <= 0.12, 'the halo over the photo is tight, got ' + halo.toFixed(3) + ' of the type size');
  const a = await sizes(app); await app.page.click('#zIn'); await app.page.click('#zIn'); await app.page.waitForTimeout(200); const b = await sizes(app);
  ok(a.length && Math.abs(Math.min(...a) - 10) < 0.2 && Math.abs(Math.min(...b) - 10) < 0.2, `by default labels stay 10 px on screen, got ${Math.min(...a)} then ${Math.min(...b)}`);
  await app.close();
  app = await open({ ...sample(), 'settings/prefs': { labelZoom: 'plan', themeV: 1 } });
  const c = await sizes(app); await app.page.click('#zIn'); await app.page.click('#zIn'); await app.page.waitForTimeout(200); const d = await sizes(app);
  ok(Math.abs(Math.min(...c) - 10) < 0.2, 'at 100% they start the same size, got ' + Math.min(...c));
  ok(Math.abs(Math.min(...d) / Math.min(...c) - 1.96) < 0.05, `grown with the plan, two zoom-ins make them 1.96 times larger, got ${(Math.min(...d) / Math.min(...c)).toFixed(2)}`);
  await app.page.evaluate(() => { location.hash = '#preferences'; }); await app.page.waitForTimeout(300);
  eq(await app.page.$eval('#pf-zoom', s => s.value), 'plan', 'the preference shows the choice');
  eq(app.errors, [], 'no page errors');
});

test('plan lettering: Drafting table (the default) letters the plan in Plex Sans Condensed, other themes keep Georgia', async open => {
  let app = await open(sample());
  const fam = () => app.page.$eval('#map text[pointer-events=auto]', t => getComputedStyle(t).fontFamily);
  ok(/IBM Plex Sans Condensed/.test(await fam()), 'Drafting table: Plex, got ' + await fam());
  ok(await app.page.$$eval('#map text[pointer-events=auto]', ts => ts.some(t => t.querySelector('tspan')?.style.fontWeight === '500' && getComputedStyle(t).fontWeight === '600')), 'the count in medium, the code in semibold');
  await app.close();
  // a saved Eiderdown from before Drafting table existed was only ever the default, so it moves over; one chosen since stays
  app = await open({ ...sample(), 'settings/prefs': { theme: 'eiderdown' } });
  ok(/IBM Plex/.test(await fam()), 'an old default Eiderdown moves to Drafting table, got ' + await fam());
  await app.close();
  app = await open({ ...sample(), 'settings/prefs': { theme: 'eiderdown', themeV: 1 } });
  ok(/^Georgia/.test(await fam()), 'Eiderdown chosen: Georgia, got ' + await fam());
  eq(app.errors, [], 'no page errors');
});

test('large plan: a full row along the top sends the rest to the side columns, never onto the plan, nothing overlapping', async open => {
  const seed = sample(); const g = seed['gardens/g1']; Object.assign(g, { underlay: null, width: 14, depth: 25 });
  for (let i = 0; i < 12; i++) seed['plants/t' + i] = { common: 'Test ' + i, botanical: 'Testus longnamius' + i, role: 'herbaceous', spread: 0.4, potSpread: 0.15, height: 0.5, cost: 1 };
  g.palette = [...g.palette, ...Array.from({ length: 12 }, (_, i) => 't' + i)];
  g.plantings = Array.from({ length: 12 }, (_, i) => ({ id: 'w' + i, plantId: 't' + i, x: 6.2 + i * 0.15, y: 1 + (i % 3) * 0.6, qty: 3 }));
  const app = await open(seed); await app.page.waitForTimeout(300);
  const labs = await app.page.$$eval('#map text[pointer-events=auto]', ts => ts.map(t => ({ t: t.textContent, y: +t.getAttribute('y'), x: t.getStartPositionOfChar(0).x, w: t.getComputedTextLength() })));
  const top = labs.filter(l => l.y < 0), side = labs.filter(l => l.y >= 0 && (l.x + l.w <= 1e-3 || l.x >= 14 - 1e-3)), inPlan = labs.filter(l => l.y > 0 && l.y < 25 && l.x > 0 && l.x + l.w < 14);
  ok(top.length >= 2 && side.length >= 1 && inPlan.length === 0 && top.length + side.length === 12, `some in the top row, the rest in the side columns, got ${top.length}, ${side.length} and ${inPlan.length} on the plan of ${labs.length}`);
  ok(side.every((a, i) => side.every((c, j) => i >= j || Math.abs(a.x - c.x) > 0.5 || Math.abs(a.y - c.y) > 0.2)), 'the side column labels do not overlap');
  ok(top.every(l => l.x >= -1e-3 && l.x + l.w <= 14 + 1e-3), 'the row stays within the plan width');
  ok(top.every((a, i) => top.every((c, j) => i >= j || a.x + a.w <= c.x + 1e-3 || c.x + c.w <= a.x + 1e-3)), 'the top row labels do not overlap, got ' + JSON.stringify(top));
  eq(app.errors, [], 'no page errors');
});

test('existing woodland: a bed set as woodland is drawn with its plain outline, casts canopy shade, and is listed but never counted', async open => {
  const seed = sample(); Object.assign(seed['gardens/g1'], { north: 0, lat: 51.5072, lon: -0.1276, underlay: null });
  seed['gardens/g1'].plantings = seed['gardens/g1'].plantings.filter(q => q.plantId !== 'ex1');
  seed['gardens/g1'].beds = [{ id: 'bW', pts: [[0.5, 0.5], [6, 0.5], [6, 3], [0.5, 3]], ox: 3, oy: 1.5 }];
  const app = await open(seed);
  const before = await app.page.textContent('#schedSum').catch(() => '');
  await app.page.click('[data-tool=bed]'); await app.clickPlan(3, 2);
  await app.page.selectOption('#bed-type', 'wood'); await app.page.waitForTimeout(200);
  await app.page.fill('#wood-h', '15'); await app.page.selectOption('#wood-dens', 'dense'); await app.page.fill('#bed-name', 'Oak copse');
  await app.page.waitForTimeout(900);
  const b = (await app.store('gardens/g1')).beds[0];
  eq(b.wood, { h: 15, dens: 'dense', leaf: 'deciduous' }, 'saved as woodland');
  ok(/OAK COPSE/.test(await app.page.textContent('#map')) && /canopy c\. 15 m, dense, deciduous/.test(await app.page.textContent('#map')), 'named on the plan with its canopy');
  ok(!/A/.test(await app.page.$eval('#map [data-kind=bed] path', p => p.getAttribute('d'))), 'a plain outline, no scalloped crown edge');
  await app.page.click('[data-act=bedOff]').catch(() => {});
  if (process.env.SHOT) await app.page.locator('#map').screenshot({ path: process.env.SHOT });
  // shade: summer noon, the copse shades the ground to its north (up the plan); in winter out of leaf it is lighter
  await app.page.click('#sunBtn');
  const set = async (doy, mins) => { await app.page.evaluate(([d, m]) => { const a = document.getElementById('sunDoy'), c = document.getElementById('sunMin'); a.value = d; a.dispatchEvent(new Event('input', { bubbles: true })); c.value = m; c.dispatchEvent(new Event('input', { bubbles: true })); }, [doy, mins]); await app.page.waitForTimeout(80); };
  await set(172, 13 * 60);
  const summer = await app.page.$eval('#map .softshade', g => +g.getAttribute('opacity'));
  await set(15, 12 * 60);
  const winter = await app.page.$eval('#map .softshade', g => +g.getAttribute('opacity'));
  ok(summer > 0.25 && winter < summer * 0.5, `dense canopy in leaf, much lighter bare in winter, got ${summer} and ${winter}`);
  // listed as kept, not counted
  await app.go('schedule');
  ok(/Oak copse/.test(await app.page.textContent('#existingT')) && /1[3-7] m²/.test(await app.page.textContent('#existingT')), 'listed with the existing plants and its area, got ' + await app.page.textContent('#existingT'));
  eq(await app.page.textContent('#schedSum'), before, 'the plant count and cost are unchanged');
});

test('areas: the Area tool makes beds, buildings, paths and water; plants can go on any of them; buildings cast shade', async open => {
  const seed = sample(); Object.assign(seed['gardens/g1'], { north: 0, lat: 51.5072, lon: -0.1276, underlay: null });
  seed['gardens/g1'].plantings = [];
  seed['gardens/g1'].beds = [
    { id: 'bB', pts: [[0.5, 4.5], [11.5, 4.5], [11.5, 8.2], [0.5, 8.2]], ox: 6, oy: 6.3 },
    { id: 'bH', pts: [[0.5, 0.5], [4.5, 0.5], [4.5, 3.5], [0.5, 3.5]], ox: 2.5, oy: 2 },
    { id: 'bP', pts: [[5.5, 4.5], [6.5, 4.5], [6.5, 8.2], [5.5, 8.2]], ox: 6, oy: 6.3 },
    { id: 'bW', pts: [[7, 0.8], [11, 1], [10.5, 3.6], [7.5, 3.4]], ox: 9, oy: 2.2 },
    { id: 'bG', pts: [[0.3, 3.85], [11.7, 3.85], [11.7, 4.25], [0.3, 4.25]], ox: 6, oy: 4.05 },
    { id: 'bX', pts: [[5, 0.5], [6.6, 0.5], [6.6, 3.2], [5, 3.2]], ox: 5.8, oy: 1.8, wood: { h: 12 } }];
  const app = await open(seed);
  ok((await app.page.textContent('[data-tool=bed]')).includes('Area'), 'the tool is called Area');
  await app.page.keyboard.press('a'); ok(await app.page.getAttribute('[data-tool=bed]', 'aria-pressed') === 'true', 'A picks it');
  const kind = async (x, y, v) => { await app.clickPlan(x, y); await app.page.selectOption('#bed-type', v); await app.page.waitForTimeout(150); };
  await kind(2.5, 2, 'building'); await app.page.fill('#area-bh', '8'); await app.page.fill('#bed-name', 'House');
  ok(await app.page.isChecked('#area-straight'), 'a building has straight edges');
  await kind(6, 6, 'path'); await app.page.selectOption('#area-surf', 'gravel');
  await kind(9, 2.2, 'water'); await app.page.selectOption('#area-water', 'pond');
  await kind(3, 4.05, 'hedge'); await app.page.selectOption('#area-leaf', 'deciduous');
  await app.page.waitForTimeout(900);
  const g = (await app.store('gardens/g1')).beds;
  eq(g.map(b => [b.kind || 'bed', b.bh, b.surf, b.water, b.straight]), [['bed', undefined, undefined, undefined, undefined], ['building', 8, undefined, undefined, true], ['path', undefined, 'gravel', undefined, undefined], ['water', undefined, undefined, 'pond', undefined], ['hedge', undefined, undefined, undefined, true], ['bed', undefined, undefined, undefined, undefined]], 'kinds saved');
  eq(g[4].leaf, 'deciduous', 'hedge leaf saved');
  ok(/HEDGE/.test(await app.page.textContent('#map')) && /1\.8 m high, deciduous/.test(await app.page.textContent('#map')), 'the hedge is named with its height');
  const txt = await app.page.textContent('#map');
  ok(/HOUSE/.test(txt) && /building, 8 m high/.test(txt) && /PATH/.test(txt) && /gravel/.test(txt) && /POND/.test(txt), 'each is named on the plan, got ' + txt.slice(0, 300));
  ok(/^M[\d.]+ [\d.]+ L/.test(await app.page.$eval('#map [data-kind=bed][data-id=bH] path', p => p.getAttribute('d'))), 'drawn with straight edges');
  // paint across the bed and the path: plants can go anywhere, paths too
  await app.page.click('[data-tool=select]'); await app.page.click('#lib [data-pid=p1]');
  await app.dragPlan(3, 6.3, 9, 6.3); await app.page.waitForTimeout(900);
  const pl = (await app.store('gardens/g1')).plantings;
  ok(pl.length > 6, 'planted in the bed, got ' + pl.length);
  ok(pl.some(q => q.x > 5.4 && q.x < 6.6), 'some on the path');
  if (process.env.SHOT) await app.page.locator('#map').screenshot({ path: process.env.SHOT });
  // the house casts shade
  await app.page.click('#sunBtn');
  await app.page.evaluate(() => { const a = document.getElementById('sunDoy'), c = document.getElementById('sunMin'); a.value = 172; a.dispatchEvent(new Event('input', { bubbles: true })); c.value = 17 * 60; c.dispatchEvent(new Event('input', { bubbles: true })); });
  await app.page.waitForTimeout(150);
  ok(await app.page.$eval('#shadows', g => g.children.length) > 0, 'the house casts a shadow');
});


test('season: each plant is Flowers or Crop, with one set of months and one colour, shown the same way on the calendar and in the booklet', async open => {
  const seed = sample(); Object.assign(seed['plants/p2'], { interest: [{ kind: 'berries', from: 10, to: 1, color: '#C92F2F' }] });
  seed['plants/p4'] = { ...seed['plants/p4'], crop: true, cropFrom: 7, cropTo: 8, cropColor: '#C92F2F', cropColorName: 'Red' };   // a crop saved the earlier way
  const app = await open(seed);
  await app.page.click('#lib [data-edit=p5]');   // the apple
  ok(await app.page.isChecked('#sp-kind-fl') && !(await app.page.isVisible('[data-act=addInterest]')), 'Flowers by default; no berries or other interest');
  await app.page.check('#sp-crop'); await app.page.waitForTimeout(100);
  ok((await app.page.textContent('body')).includes('Crop colour'), 'a crop has a crop colour');
  await app.page.$eval('#sp-ff', el => { el.value = 9; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await app.page.$eval('#sp-ft', el => { el.value = 10; el.dispatchEvent(new Event('input', { bubbles: true })); });
  ok((await app.page.textContent('#msl-txt')).includes('Harvest Sep – Oct'), 'the same slider reads as the harvest');
  await app.page.click('[data-color]');
  await app.page.click('[data-act=savePlant]'); await app.page.waitForTimeout(150);
  const p5 = await app.store('plants/p5');
  eq([p5.crop, p5.flowerFrom, p5.flowerTo, !!p5.flowerColor], [true, 9, 10, true], 'saved in the one set of months and colour');
  await app.page.click('#navCal'); await app.page.waitForTimeout(200);
  const bars = await app.page.$$eval('#calView .cbar', bs => bs.map(b => [b.title.split(':')[0], b.style.gridColumn]));
  ok(bars.some(b => b[0] === 'Apple harvest' && b[1] === '9 / 11'), 'the apple harvest is a full bar, got ' + JSON.stringify(bars));
  ok(bars.some(b => b[0] === 'Geranium harvest' && b[1] === '7 / 9'), 'an older crop is folded in');
  eq(await app.page.locator('#calView .cbar.sm, #calView .cbar.ev').count(), 0, 'no berry or evergreen lines');
  eq(await app.page.locator('#calView .ex.crop').count(), 2, 'crops are marked');
  await app.page.click('#navPres'); await app.page.waitForSelector('.bpage');
  eq(await app.page.locator('.bcal .bar.thin, .bcal .bar.ever').count(), 0, 'the booklet shows one bar per plant');
});

test('beds and guilds: each bed has its own drawing, guilds are named after their tallest plant and listed together, plants go anywhere, a short species form', async open => {
  const seed = sample(), g0 = seed['gardens/g1']; g0.underlay = null; seed['plants/p5'].height = 4;
  g0.plantings = [{ id: 'ap', plantId: 'p5', x: 9, y: 5.5, qty: 1 }];
  g0.beds = [
    { id: 'bA', pts: [[0.5, 0.5], [5, 0.5], [5, 3.5], [0.5, 3.5]], ox: 2.75, oy: 2, oudolf: true },
    { id: 'bB', pts: [[0.5, 4.5], [5, 4.5], [5, 8], [0.5, 8]], ox: 2.75, oy: 6.25, oudolf: false },
    { id: 'gG', kind: 'guild', pts: [[7, 4], [11, 4], [11, 7.5], [7, 7.5]], ox: 9, oy: 5.75 }];
  const app = await open(seed);
  // paint the same plant into both beds: Oudolf areas in one, tight circles in the other
  await app.page.click('#lib [data-pid=p1]');
  for (const y of [1.5, 1.8, 2.1, 2.4]) await app.dragPlan(1, y, 4.5, y);
  for (const y of [5.5, 5.8, 6.1, 6.4]) await app.dragPlan(1, y, 4.5, y);
  // a click outside every bed places one plant just there; a drag outside paints nothing
  await app.clickPlan(6, 2);
  await app.dragPlan(5.6, 1, 6.6, 1);
  await app.page.click('#lib [data-pid=p4]'); for (const y of [6.5, 6.8]) await app.dragPlan(7.5, y, 10.5, y);
  await app.page.waitForTimeout(900);
  let g = await app.store('gardens/g1');
  const inB = g.plantings.filter(q => q.plantId === 'p1' && q.y > 4.5), out = g.plantings.filter(q => q.x > 5.2 && q.x < 6.8 && q.y < 4);
  ok(inB.length > 20, 'tight circles painted in the second bed, got ' + inB.length);
  eq(out.length, 1, 'one plant outside the beds, from the click');
  eq([out[0].x, out[0].y], [6, 2], 'placed exactly where clicked');
  eq(await app.page.evaluate(() => document.querySelectorAll('#map [data-kind=region]').length > 0), true, 'Oudolf areas in the first bed');
  eq(await app.page.evaluate(ids => ids.filter(id => document.querySelector(`#map [data-kind=planting][data-id="${id}"] circle`)).length, inB.map(q => q.id)), inB.length, 'circles in the second');
  // the toolbar button switches the bed selected with the Area tool
  await app.page.keyboard.press('a'); await app.clickPlan(2.5, 7.5);
  eq(await app.page.inputValue('#area-draw'), 'circles', 'second bed: tight circles');
  eq(await app.page.getAttribute('#oudolfBtn', 'aria-pressed'), 'false', 'button shows this bed is off');
  const spots = JSON.stringify(g.plantings.map(q => [q.x, q.y]).sort());
  await app.page.click('#oudolfBtn'); await app.page.waitForTimeout(900);
  g = await app.store('gardens/g1');
  eq(g.beds.map(b => b.oudolf), [true, true, undefined], 'only the selected bed switched');
  eq(JSON.stringify(g.plantings.map(q => [q.x, q.y]).sort()), spots, 'nothing moved');
  await app.page.click('#oudolfBtn'); await app.page.waitForTimeout(300);
  // the guild: named after its tallest plant, listed by layer
  await app.clickPlan(10.5, 4.3);
  eq(await app.page.inputValue('#bed-type'), 'guild', 'a guild');
  ok((await app.page.textContent('#map')).includes('APPLE GUILD'), 'named on the plan after its apple');
  await app.go('schedule');
  const gt = await app.page.textContent('#guildT');
  ok(/Apple guild/.test(gt) && /Understory/.test(gt) && /Malus/.test(gt) && /Geranium/.test(gt) && gt.indexOf('Malus') < gt.indexOf('Geranium'), 'the schedule lists the guild from the tallest layer down, got ' + gt);
  await app.go('presentation'); await app.page.waitForSelector('.bpage');
  ok(/Groups of plants that support each other/.test(await app.page.textContent('#bookletPages, .bpages, body')), 'a Guilds page in the presentation');
  // a name of its own wins
  await app.go('plan'); await app.page.keyboard.press('a'); await app.clickPlan(10.5, 4.3); await app.page.fill('#bed-name', 'Orchard corner'); await app.page.waitForTimeout(200);
  ok((await app.page.textContent('#map')).includes('ORCHARD CORNER'), 'renamed');
  // the species form: six fields up front, the rest folded away
  await app.page.click('#lib [data-edit=p0]');
  for (const id of ['#sp-bot', '#sp-common', '#sp-role', '#sp-kind-fl', '#sp-h', '#sp-s']) ok(await app.page.isVisible(id), id + ' shown');
  for (const id of ['#sp-cult', '#sp-fol', '#sp-sup', '#sp-cost', '#sp-supp', '#sp-existing']) ok(!(await app.page.isVisible(id)), id + ' folded away');
  ok(/Photo/.test(await app.page.textContent('#plantEditor, .card, body')), 'photo up front');
  await app.page.click('#sp-more summary');
  ok(await app.page.isVisible('#sp-cost'), 'More details opens');
});

test('busy booklet: two guilds round the same tree are numbered, long names wrap instead of clipping, nothing runs off a page', async open => {
  const seed = sample(), g0 = seed['gardens/g1']; g0.underlay = null; seed['plants/p5'].height = 4;
  // a species with a long botanical name, and enough existing plants to need their own page
  seed['plants/lng'] = { common: 'Long-named sage', botanical: "Salvia nemorosa 'Caradonna' × superba 'Rose Queen' Improved Selection", role: 'matrix', spread: 0.4, height: 0.5, flowerMonths: [5, 6, 7], flowerColor: '#ffffff' };
  g0.palette.push('lng');
  for (let i = 0; i < 14; i++) { seed['plants/ex' + i] = { common: 'Old shrub ' + i, botanical: 'Viburnum tinus ' + i, role: 'shrub', existing: true, spread: 1, height: 1.5 }; g0.palette.push('ex' + i); }
  g0.plantings = [{ id: 'a1', plantId: 'p5', x: 3, y: 3, qty: 1 }, { id: 'a2', plantId: 'p5', x: 9, y: 5.5, qty: 1 },
    ...Array.from({ length: 12 }, (_, i) => ({ id: 'l' + i, plantId: 'lng', x: 1 + (i % 6) * 0.4, y: 7 + Math.floor(i / 6) * 0.4, qty: 1 })),
    ...Array.from({ length: 14 }, (_, i) => ({ id: 'x' + i, plantId: 'ex' + i, x: 6 + (i % 7), y: 1 + Math.floor(i / 7), qty: 1 }))];
  g0.beds = [{ id: 'g1', kind: 'guild', pts: [[1.5, 1.5], [4.5, 1.5], [4.5, 4.5], [1.5, 4.5]], ox: 3, oy: 3 },
    { id: 'g2', kind: 'guild', pts: [[7.5, 4], [10.5, 4], [10.5, 7], [7.5, 7]], ox: 9, oy: 5.5 }];
  const app = await open(seed);
  const map = await app.page.textContent('#map');
  ok(map.includes('APPLE GUILD 1') && map.includes('APPLE GUILD 2'), 'two apple guilds told apart on the plan');
  await app.go('schedule');
  const gt = await app.page.textContent('#guildT');
  ok(/Apple guild 1/.test(gt) && /Apple guild 2/.test(gt), 'and in the schedule, got ' + gt);
  await app.go('presentation'); await app.page.waitForSelector('.bpage'); await app.page.waitForTimeout(500);
  const bad = await app.page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.bpage').forEach((pg, i) => {
      const pb = pg.getBoundingClientRect();
      pg.querySelectorAll('h2, h3, p, td, th, .kr, .kr i, .bcal .nm, .bf').forEach(el => {
        const b = el.getBoundingClientRect(); if (!b.width) return;
        if (b.bottom > pb.bottom + 1 || b.right > pb.right + 1) out.push(`page ${i + 1}: ${el.tagName} ${el.textContent.trim().slice(0, 40)} runs off the page`);
        const cs = getComputedStyle(el); if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible') out.push(`page ${i + 1}: ${el.textContent.trim().slice(0, 40)} clipped`);
      });
      const foot = pg.querySelector('.bf'); if (foot) { const fb = foot.getBoundingClientRect(); pg.querySelectorAll('table').forEach(t => { if (t.getBoundingClientRect().bottom > fb.top + 1) out.push(`page ${i + 1}: a table runs into the footer`); }); }
    });
    return out;
  });
  eq(bad, [], 'nothing clipped or off the page');
  const txt = await app.page.textContent('body');
  ok(txt.includes("Improved Selection"), 'the long name is written out in full');
  ok(/Existing plants/.test(txt) && txt.includes('Viburnum tinus 13'), 'every existing plant listed');
  eq(app.errors, [], 'no page errors');
});

test('Plants For A Future: look up a species as you type, fill only what you have not set, harvest months for crops, add a whole list', async open => {
  const app = await open(sample());
  await app.go('database'); await app.page.click('#dbAdd');
  await app.page.fill('#sp-h', '2.5');   // set by hand first: the lookup must leave it alone
  await app.page.fill('#sp-bot', 'Ribes nig');
  ok(await app.page.isVisible('#pfafSug'), 'matches offered');
  ok(/Ribes nigrum/.test(await app.page.textContent('#pfafSug')) && /Blackcurrant/.test(await app.page.textContent('#pfafSug')), 'blackcurrant among them');
  await app.page.click('#pfafSug [data-pfaf="0"]');
  eq(await app.page.inputValue('#sp-bot'), 'Ribes nigrum', 'botanical name filled');
  eq(await app.page.inputValue('#sp-common'), 'Blackcurrant', 'common name filled');
  eq(await app.page.inputValue('#sp-role'), 'shrub', 'layer filled');
  eq(await app.page.inputValue('#sp-h'), '2.5', 'the height typed by hand is kept');
  ok(/Flowers Apr – May/.test(await app.page.textContent('#msl-txt')), 'flowering months filled, got ' + await app.page.textContent('#msl-txt'));
  ok(/Plants For A Future/.test(await app.page.textContent('#pfafNote')) && /CC BY 4\.0/.test(await app.page.textContent('#pfafNote')), 'credited');
  await app.page.check('#sp-crop');
  ok(/Harvest Jul – Aug/.test(await app.page.textContent('#msl-txt')), 'as a crop: harvest when the fruit ripens, got ' + await app.page.textContent('#msl-txt'));
  await app.page.check('#sp-kind-fl');
  ok(/Flowers Apr – May/.test(await app.page.textContent('#msl-txt')), 'and back to flowering');
  await app.page.check('#sp-crop');
  await app.page.click('[data-act=savePlant]'); await app.page.waitForTimeout(300);
  const saved = (await app.page.evaluate(() => [...window.__mock.store.entries()].filter(([k]) => k.startsWith('plants/')).map(([, v]) => v))).find(v => v.botanical === 'Ribes nigrum');
  ok(saved && saved.pfaf === true && saved.crop === true && saved.flowerFrom === 7 && saved.flowerTo === 8 && saved.height === 2.5, 'saved as a crop with its harvest, got ' + JSON.stringify(saved));
  ok(!('_touched' in saved) && !('_pfafGot' in saved), 'nothing temporary saved');
  // a cultivar keeps its name and takes its species' details
  await app.page.click('#dbAdd'); await app.page.fill('#sp-bot', "Malus domestica 'Sunset'");
  await app.page.click('#pfafSug [data-pfaf="0"]');
  eq(await app.page.inputValue('#sp-bot'), "Malus domestica 'Sunset'", 'cultivar name kept');
  eq([await app.page.inputValue('#sp-common'), await app.page.inputValue('#sp-role')], ['Apple', 'understory'], 'apple details');
  await app.page.click('[data-act=cancelPlant]');
  // add a list
  await app.page.click('#dbListBtn');
  await app.page.fill('#dbListText', "Corylus avellana\nSanguisorba 'Red Thunder'\nRibes nigrum\n");
  await app.page.click('#dbListGo'); await app.page.waitForTimeout(400);
  const msg = await app.page.textContent('#dbListMsg');
  ok(/Added 2 species, 1 filled in from Plants For A Future/.test(msg) && /1 already in your database/.test(msg) && /Sanguisorba 'Red Thunder'/.test(msg), 'reports what it did, got ' + msg);
  const all = await app.page.evaluate(() => [...window.__mock.store.entries()].filter(([k]) => k.startsWith('plants/')).map(([, v]) => v));
  const hz = all.find(v => v.botanical === 'Corylus avellana'), sv = all.find(v => /Red Thunder/.test(v.botanical || ''));
  ok(hz && hz.common === 'Common Hazel' && hz.role === 'understory' && hz.height === 6 && hz.spread === 3 && hz.pfaf, 'hazel filled in, got ' + JSON.stringify(hz));
  ok(sv && !sv.pfaf, 'the sanguisorba added with just its name');
  ok(/Common Hazel/.test(await app.page.textContent('#dbTable')), 'listed in the database');
});

test('plan colour, pattern and size in the bar beside the plant name', async open => {
  const app = await open(sample());
  // the plant being placed: colour and pattern
  await app.page.click('#lib [data-pid=p1]');
  ok(await app.page.isVisible('#inspector [data-sp=planColor]') && await app.page.isVisible('#inspector [data-sp=planPattern]'), 'colour and pattern offered');
  await app.page.fill('#inspector [data-sp=planColor]', '#123456'); await app.page.waitForTimeout(300);
  eq((await app.store('plants/p1')).planColor, '#123456', 'colour kept with the species');
  ok(/#123456/i.test(await app.page.innerHTML('#map')), 'and drawn on the plan');
  await app.page.selectOption('#inspector [data-sp=planPattern]', 'dots'); await app.page.waitForTimeout(300);
  eq((await app.store('plants/p1')).planPattern, 'dots', 'pattern kept');
  await app.page.click('#undoBtn'); await app.page.waitForTimeout(300);
  eq((await app.store('plants/p1')).planPattern ?? null, null, 'undone one step at a time');
  eq((await app.store('plants/p1')).planColor, '#123456', 'the colour stays');
  await app.page.click('#inspector [data-act=spAutoStyle]'); await app.page.waitForTimeout(300);
  eq((await app.store('plants/p1')).planColor ?? null, null, 'Automatic puts it back');
  // a selected tree: spread and height; a bulb: spacing and no pattern
  await app.page.keyboard.press('v'); await app.clickPlan(10, 4.4);
  ok(/Apple/.test(await app.page.textContent('#inspector')), 'apple selected');
  await app.page.fill('#inspector [data-sp=spread]', '3.5'); await app.page.press('#inspector [data-sp=spread]', 'Enter'); await app.page.waitForTimeout(300);
  eq((await app.store('plants/p5')).spread, 3.5, 'spread kept');
  await app.page.click('#lib [data-pid=p3]');
  ok(await app.page.isVisible('#inspector [data-sp=spacing]') && !(await app.page.$('#inspector [data-sp=planPattern]')), 'bulb: spacing, no pattern');
  eq(app.errors, [], 'no errors');
});

test('plant database: rows ruled in their layer colour, the species form grouped under headings (Drafting table only)', async open => {
  let app = await open(sample());
  await app.go('database');
  const rule = await app.page.$eval('#dbMine tbody tr', tr => ({ sh: getComputedStyle(tr.cells[0]).boxShadow, col: getComputedStyle(tr).getPropertyValue('--lc').trim() }));
  ok(/inset/.test(rule.sh) && /rgb/.test(rule.sh), 'a coloured rule on the first cell, got ' + rule.sh);
  const hex = rule.col.replace('#', ''), rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ');
  ok(rule.sh.includes(rgb), 'the rule is the layer colour ' + rule.col + ', got ' + rule.sh);
  await app.page.click('#dbMine [data-edit=p0]'); await app.page.waitForSelector('#plantModal:not([hidden])');
  for (const h of ['Identity', 'Season and interest', 'Size']) ok(await app.page.isVisible(`#plantModalBody .fgrp:text-is("${h}")`), h + ' heading shown');
  eq(app.errors, [], 'no errors');
  await app.close();
  app = await open({ ...sample(), 'settings/prefs': { theme: 'eiderdown', themeV: 1 } });
  await app.go('database');
  await app.page.click('#dbMine [data-edit=p0]'); await app.page.waitForSelector('#plantModal:not([hidden])');
  ok(await app.page.$$eval('#plantModalBody .fgrp', hs => hs.length > 0 && hs.every(h => getComputedStyle(h).display === 'none')), 'Eiderdown: headings hidden');
  eq(app.errors, [], 'no errors');
});

test('any plant label can be dragged, hidden and put back', async open => {
  const app = await open(sample());
  const pg = app.page, g = async () => { await pg.waitForTimeout(900); return app.store('gardens/g1'); };
  const lbl = k => pg.locator(`#map text[data-kind=lbl][data-lk="${k}"]`), hit = k => pg.locator(`#map rect.lblhit[data-lk="${k}"]`);   // the clear box over each label is what you grab
  const keys = await pg.$$eval('#map text[data-kind=lbl]', ts => ts.map(t => t.dataset.lk));
  const sk = keys.find(k => k[0] === 's'); ok(sk, 'an edge label can be grabbed, got ' + JSON.stringify(keys));
  const pid = sk.slice(1), before = (await app.store('gardens/g1')).plantings.map(p => [p.x, p.y]);
  const drag = async (loc, to) => { const b = await loc.boundingBox(); await pg.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await pg.mouse.down(); await pg.mouse.move(to.x, to.y, { steps: 6 }); await pg.mouse.up(); };
  const to = await app.planXY(6, 4);
  await drag(hit(sk), to);
  let gd = await g();
  ok(gd.labelAt && gd.labelAt[pid], 'position stored, got ' + JSON.stringify(gd.labelAt));
  eq(gd.plantings.map(p => [p.x, p.y]), before, 'no plant moved');
  const bb = await hit(sk).boundingBox();
  ok(Math.abs(bb.x + bb.width / 2 - to.x) < 6 && Math.abs(bb.y + bb.height / 2 - to.y) < 12, 'label drawn where it was dropped');
  const hits = await pg.evaluate(k => { const r = t => t.getBoundingClientRect(), a = r(document.querySelector(`#map text[data-kind=lbl][data-lk="${k}"]`));
    return [...document.querySelectorAll('#map text')].filter(t => t.dataset.lk !== k && t.textContent.trim()).map(r).filter(b => b.width && b.left < a.right - 1 && b.right > a.left + 1 && b.top < a.bottom - 1 && b.bottom > a.top + 1).length; }, sk);
  eq(hits, 0, 'no other label overlaps the moved one');
  await pg.click('#undoBtn');
  eq((await g()).labelAt, undefined, 'undone');
  await pg.click('#redoBtn'); gd = await g();
  ok(gd.labelAt?.[pid], 'redone');
  // double-click puts it back
  await hit(sk).dblclick(); gd = await g();
  eq(gd.labelAt, undefined, 'double-click puts it back');
  // click and Delete hides the label, never the plant
  const n0 = gd.plantings.length;
  await hit(sk).click(); await pg.waitForTimeout(100);
  eq(await pg.locator('#map rect.lblsel').count(), 1, 'the clicked label is outlined');
  ok(await pg.isVisible('[data-act=hideLabel]'), 'Hide label offered');
  await pg.keyboard.press('Delete'); gd = await g();
  eq(gd.labelHide, { [pid]: true }, 'hidden');
  eq(gd.plantings.length, n0, 'plants kept');
  eq(await lbl(sk).count(), 0, 'label gone');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
  ok(await pg.isVisible('[data-act=showAllLabels]'), 'Show hidden labels offered');
  await pg.click('[data-act=showAllLabels]'); gd = await g();
  eq(gd.labelHide, undefined, 'shown again');
  await pg.click('#undoBtn'); await pg.waitForTimeout(150);
  eq(await lbl(sk).count(), 0, 'undo hides it again');
  await pg.click('#undoBtn'); await pg.waitForTimeout(150);
  eq(await lbl(sk).count(), 1, 'and undo once more shows it');
  // a planting's own label (a code, or its label on the plan) moves with an offset
  const pk = (await pg.$$eval('#map text[data-kind=lbl]', ts => ts.map(t => t.dataset.lk))).find(k => k[0] === 'p');
  if (pk) {
    const b = await lbl(pk).boundingBox(); await drag(hit(pk), { x: b.x + b.width / 2 + 40, y: b.y + b.height / 2 + 30 });
    gd = await g(); const pl = gd.plantings.find(p => p.id === pk.slice(1));
    ok(pl.kx != null || pl.lx != null, 'offset stored for the planting label, got ' + JSON.stringify(pl));
  }
  await drag(hit(sk), to); await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
  ok(await pg.isVisible('[data-act=resetAllLabels]'), 'Reset all labels offered');
  await pg.click('[data-act=resetAllLabels]'); gd = await g();
  eq([gd.labelAt, gd.plantings.some(p => p.kx != null || p.lx != null)], [undefined, false], 'all reset');
  eq(app.errors, [], 'no errors');
});

test('the plot can be cropped to a box, or trimmed to the design, and undone', async open => {
  const seed = sample(), g0 = seed['gardens/g1'];
  g0.plantings.push({ id: 'z', plantId: 'p1', x: 11.6, y: 8.2, qty: 1 });
  g0.aerial = { lat: 51.38, lon: -2.36, opacity: 0.9 }; g0.north = 0;
  const app = await open(seed), pg = app.page, g = async () => { await pg.waitForTimeout(900); return app.store('gardens/g1'); };
  await pg.click('#ulMenuBtn'); await pg.click('#cropTool');
  ok((await pg.textContent('#hint')).startsWith('Crop the plot'), 'the hint explains the crop');
  const a = await app.planXY(1, 1), b = await app.planXY(11, 7);
  await pg.mouse.move(a.x, a.y); await pg.mouse.down(); await pg.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  ok(await pg.locator('#map path[fill-rule=evenodd]').count() >= 1, 'outside the box is shaded while dragging');
  await pg.mouse.move(b.x, b.y, { steps: 4 }); await pg.mouse.up();
  const said = await pg.textContent('#status');
  let gd = await g();
  eq([gd.width, gd.depth], [10, 6], 'the plot is the box');
  eq(gd.plantings.find(p => p.id === 'a'), { id: 'a', plantId: 'p0', x: 3, y: 0.4, qty: 5 }, 'plants moved with the new corner');
  ok(!gd.plantings.some(p => p.id === 'z'), 'a plant left outside is removed');
  eq([gd.underlay.ox, gd.underlay.oy], [-1, -1], 'the site plan moves with it');
  ok(gd.aerial.lat < 51.38 && gd.aerial.lon > -2.36, 'the aerial photo anchor moves to the new corner, got ' + JSON.stringify(gd.aerial));
  eq(await pg.getAttribute('#map image.ul', 'x'), '-1', 'the site plan is drawn shifted');
  ok(said.includes('10 × 6 m') && said.includes('1 item'), 'the new size is reported, got ' + said);
  await pg.keyboard.press('Control+z'); gd = await g();
  eq([gd.width, gd.depth, gd.plantings.length, gd.underlay.ox], [12, 8.6, 8, undefined], 'undo puts the plot back');
  eq(app.errors, [], 'no errors');
  await app.close?.();
  // a big empty plot is trimmed down to the planting on it, with a margin
  const s2 = sample(), g2 = s2['gardens/g1']; g2.width = 30; g2.depth = 20; delete g2.underlay;
  for (const p of g2.plantings) { p.x += 6; p.y += 5; }
  const app2 = await open(s2), p2 = app2.page;
  await p2.click('#ulMenuBtn'); await p2.click('#cropTrim'); await p2.waitForTimeout(900);
  gd = await app2.store('gardens/g1');
  ok(gd.width < 14 && gd.depth < 12 && gd.plantings.every(p => p.x > 0 && p.x < gd.width && p.y > 0 && p.y < gd.depth), 'trimmed round the design, got ' + gd.width + ' × ' + gd.depth);
  eq(gd.plantings.length, 7, 'trimming keeps every plant');
  eq(app2.errors, [], 'no errors');
});

test('labels stack: drop one label on another and both plants lead to one place; pull it away to undo', async open => {
  let app = await open(sample());
  let pg = app.page;
  const g = async () => { await pg.waitForTimeout(900); return app.store('gardens/g1'); };
  const lbl = k => pg.locator(`#map rect.lblhit[data-lk="${k}"]`).first();   // measured by the box over each label: the browser's box for tiny scaled text is far too big
  const txt = k => pg.locator(`#map text[data-kind=lbl][data-lk="${k}"]`).first();
  const keys = () => pg.$$eval('#map text[data-kind=lbl]', ts => ts.map(t => t.dataset.lk));
  const ctr = async loc => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, h: b.height }; };
  const drag = async (loc, to) => { const a = await ctr(loc); await pg.mouse.move(a.x, a.y); await pg.mouse.down(); await pg.mouse.move(to.x, to.y, { steps: 8 }); await pg.mouse.up(); };
  /* onto another label: once the dragged one leaves its column the rest close up, so aim again at where the target is now */
  const dropOn = async (loc, k) => { const a = await ctr(loc); await pg.mouse.move(a.x, a.y); await pg.mouse.down(); await pg.mouse.move(a.x + 30, a.y + 30, { steps: 4 }); await pg.waitForTimeout(100);
    const t = await ctr(lbl(k)); await pg.mouse.move(t.x, t.y, { steps: 6 }); await pg.waitForTimeout(100); const t2 = await ctr(lbl(k)); await pg.mouse.move(t2.x, t2.y, { steps: 2 });
    eq(await pg.locator('#map rect.lbldrop').count(), 1, 'the label it will join is marked'); await pg.mouse.up(); };
  // around the edge: one species' label dropped on another's stacks under it
  let ks = (await keys()).filter(k => k[0] === 's');
  ok(ks.length >= 2, 'two edge labels, got ' + JSON.stringify(ks));
  const [a, b] = ks;
  await dropOn(lbl(a), b);
  let gd = await g();
  eq(gd.labelJoin, { [a]: b }, 'joined');
  ok(!gd.labelAt?.[a.slice(1)], 'no position of its own');
  let A = await ctr(lbl(a)), B = await ctr(lbl(b));
  ok(Math.abs(A.y - B.y) < B.h * 2.2 && Math.abs(A.y - B.y) > B.h * 0.5 && Math.abs(A.x - B.x) < 200, 'stacked next to it, got ' + JSON.stringify([A, B]));
  await pg.click('#undoBtn'); eq((await g()).labelJoin, undefined, 'undone');
  await pg.click('#redoBtn'); eq((await g()).labelJoin, { [a]: b }, 'redone');
  // dragging the label it was dropped on carries the stack along
  const to = await app.planXY(6, 4);
  await drag(lbl(b), to); gd = await g();
  ok(gd.labelAt?.[b.slice(1)] && gd.labelJoin?.[a] === b, 'the stack moved together, got ' + JSON.stringify([gd.labelAt, gd.labelJoin]));
  A = await ctr(lbl(a)); B = await ctr(lbl(b));
  ok(A.y > B.y && Math.abs(A.x - B.x) < 3 && A.y - B.y < B.h * 2, 'drawn on the line under it, got ' + JSON.stringify([A, B]));
  // pulled away, it stands alone again
  await drag(lbl(a), { x: to.x - 120, y: to.y + 90 }); gd = await g();
  eq(gd.labelJoin, undefined, 'unjoined');
  ok(gd.labelAt?.[a.slice(1)], 'and placed where dropped');
  // a patch's code dropped on its own species' label becomes a line to it
  const codes = await pg.$$eval('#map text[data-kind=lbl]', ts => ts.filter(t => t.dataset.lk[0] === 'p').map(t => t.dataset.plid));
  const code = codes.map(id => ({ id, pid: gd.plantings.find(p => p.id === id)?.plantId })).find(c => c.pid != null && ks.includes('s' + c.pid));
  if (code) {
    const paths = async () => (await pg.$eval('#map g.leaders path', p => p.getAttribute('d'))).split('M').length;
    const n0 = await paths();
    await dropOn(lbl('p' + code.id), 's' + code.pid); gd = await g();
    eq(gd.labelJoin?.['p' + code.id], 's' + code.pid, 'code joined to its label');
    eq(await pg.locator(`#map text[data-lk="p${code.id}"]`).count(), 0, 'code no longer drawn');
    ok(await paths() > n0, 'a line runs to it instead');
  }
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(100); await pg.click('[data-act=resetAllLabels]'); gd = await g();
  eq([gd.labelJoin, gd.labelAt], [undefined, undefined], 'Reset all labels unstacks too');
  eq(app.errors, [], 'no errors');
  await app.close();
  // on the plan: one planting's label dropped on another's
  app = await open({ ...sample(), 'settings/prefs': { labelPlace: 'plan' } }); pg = app.page;
  ks = (await keys()).filter(k => k[0] === 'p');
  gd = await app.store('gardens/g1');
  const sp = k => gd.plantings.find(p => p.id === k.slice(1))?.plantId;
  const [p1, p2] = [ks[0], ks.find(k => sp(k) !== sp(ks[0]))];
  ok(p1 && p2, 'two plantings of different plants, got ' + JSON.stringify(ks));
  const lines0 = await pg.locator('#map path.lead').count();
  await dropOn(lbl(p1), p2); gd = await g();
  eq(gd.labelJoin, { [p1]: p2 }, 'joined on the plan');
  A = await ctr(lbl(p1)); B = await ctr(lbl(p2));
  ok(A.y > B.y && Math.abs(A.x - B.x) < 3 && A.y - B.y < B.h * 2, 'stacked on the line below, got ' + JSON.stringify([A, B]));
  ok(await pg.locator('#map path.lead').count() > lines0, 'with a leader back to its plant');
  const same = ks.find(k => k !== p2 && k !== p1 && sp(k) === sp(p2));
  if (same) {
    const t0 = await txt(p2).textContent();
    await dropOn(lbl(same), p2); await g();
    eq(await pg.locator(`#map text[data-lk="${same}"]`).count(), 0, 'the same plant merges into one label');
    ok(/^\d+ /.test(await txt(p2).textContent()) && (await txt(p2).textContent()) !== t0, 'with its total, got ' + t0 + ' → ' + (await txt(p2).textContent()));
  }
  await pg.locator(`#map rect.lblhit[data-lk="${p1}"]`).first().dblclick(); gd = await g();
  ok(!gd.labelJoin?.[p1], 'double-click unstacks it');
  eq(app.errors, [], 'no errors');
});

test('a stacked label leaves no line or handle of its own behind on its plant', async open => {
  const s = sample(), g0 = s['gardens/g1'];
  // a second lavender, its label once dragged aside, then dropped on the first lavender's label
  const g = { ...g0, plantings: [...g0.plantings, { ...g0.plantings[0], id: 'h', x: 9, y: 7, lx: 1.2, ly: -0.8 }], labelJoin: { ph: 'pa' } };
  const app = await open({ ...s, 'gardens/g1': g, 'settings/prefs': { labelPlace: 'plan' } }), pg = app.page;
  const from = () => pg.$$eval('#map path.lead', ls => ls.filter(l => { const P = l.getAttribute('d').match(/-?[\d.]+/g).map(Number); return Math.hypot(P[P.length - 2] - 9, P[P.length - 1] - 7) < 0.8; }).map(l => l.getAttribute('stroke-opacity')));
  eq(await from(), ['0.55'], 'one line from the plant, to the label it joined');
  ok((await pg.textContent('#map text[data-lk="pa"]')).includes('10 '), 'the label counts both');
  eq(await pg.locator('#map text[data-lk="ph"]').count(), 0, 'not drawn on its own');
  await app.clickPlan(9, 7);
  eq(await pg.locator('#map [data-kind=lblh]').count(), 0, 'no handle for a label drawn elsewhere');
  eq(await from(), ['0.55'], 'still one line once selected');
  eq(app.errors, [], 'no errors');
});

test('leader lines from labels on the plan run like a metro map: level, upright or at 45°', async open => {
  const s = sample(), g0 = s['gardens/g1'];
  const g = { ...g0, plantings: g0.plantings.map(p => p.id === 'c' ? { ...p, lx: 2.6, ly: 1.7 } : p.id === 'e' ? { ...p, lx: -1.3, ly: 2.4 } : p),
    labelJoin: { pb: 'pf' } };
  const app = await open({ ...s, 'gardens/g1': g, 'settings/prefs': { labelPlace: 'plan' } }), pg = app.page;
  const leads = await pg.$$eval('#map path.lead', ls => ls.map(l => l.getAttribute('d').split('L').map(q => q.replace('M', '').trim().split(' ').map(Number))));
  ok(leads.length >= 3, 'two dragged labels and a stacked one each get a line, got ' + leads.length);
  const bad = leads.filter(P => P.slice(1).some((q, i) => { const dx = q[0] - P[i][0], dy = q[1] - P[i][1]; return !(Math.abs(dx) < 1e-3 || Math.abs(dy) < 1e-3 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 2e-3); }));
  eq(bad, [], 'every leg level, upright or at 45°');
  ok(leads.some(P => P.length >= 3), 'a diagonal drag bends rather than running straight');
  const end = P => P[P.length - 1], near = (P, x, y, r) => Math.hypot(end(P)[0] - x, end(P)[1] - y) < r;
  ok(leads.some(P => near(P, 8, 1.4, 0.8) && !near(P, 8, 1.4, 0.01)), 'the dragged rose label\'s line stops at its ring');
  ok(leads.some(P => near(P, 6, 1.4, 0.05)), 'the stacked salvia keeps a line to the apple label');
  eq(app.errors, [], 'no errors');
});

run();
