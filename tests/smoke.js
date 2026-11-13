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
  eq((await fill('a'))[1], '0.14', 'back to the usual layer colours, light so the planting shows through');
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
  ok(/\/BaseFont \/Helvetica/.test(text), 'a text layer is embedded');
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
  await app.page.click('#vMature');
  const fills = await app.page.evaluate(() => [...new Set([...document.querySelectorAll('#map [data-kind=planting] circle')].map(c => c.style.fill))]);
  ok(fills.length >= 4, 'each species its own fill, got ' + fills.length);
  const order = await app.page.evaluate(ids => { const all = [...document.querySelectorAll('#map [data-kind=planting]')].map(g => g.dataset.id); return ids.map(id => all.indexOf(id)); }, [rose.id, sid, bulbs[0].id]);
  ok(order[0] < order[1] && order[1] < order[2], 'drawn structure, then planting, then bulbs, got ' + order);
  const cols = (await app.store('gardens/g1')).colors; ok(cols.p1 === 0 && cols.p4 === 1 && cols.p2 == null && cols.ex1 == null, 'species colours only for the planting, got ' + JSON.stringify(cols));
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
  await app.page.click('#addPlantBtn'); await app.page.fill('#sp-common', 'Salvia'); await app.page.click('[data-act=savePlant]'); await app.page.waitForTimeout(300);
  await app.page.click('#lib li'); await app.clickPlan(2, 2); await app.page.waitForTimeout(1200);
  await app.reload();
  eq(await app.page.$eval('#gardenSel', s => s.selectedOptions[0].textContent), 'Back border', 'garden still there after a reload');
  eq(await app.page.evaluate(() => document.querySelectorAll('#map [data-kind=planting]').length), 1, 'its plant too');
  await app.go('preferences');
  const [dl] = await Promise.all([app.page.waitForEvent('download'), app.page.click('[data-act=bkpAll]')]);
  ok(/^SevenLayers backup - everything - .*\.json$/.test(dl.suggestedFilename()), 'backup downloaded as a file, got ' + dl.suggestedFilename());
});

run();
