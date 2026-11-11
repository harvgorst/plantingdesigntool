# SevenLayers

SevenLayers is a planting-only design tool for garden designers. Import an existing site plan, place plants over it at true scale, study sun and shade, and get a costed plant schedule, supplier order lists, an interest calendar, a client booklet and a scaled plan sheet.

The live version runs as a claude.ai artifact:
https://claude.ai/artifact/2aTBjBBXxP2rNoepiPnhLe

## What it does

- **Plan**: import a site plan (SVG, PDF page 1, PNG or JPEG) as an underlay and set its scale from two points a known distance apart. Place single plants or groups, or a row of evenly spaced plants between two points (for hedges and edging). Existing plants are drawn dashed, with Retain / Prune / Remove status, measured size and notes per plant. Design intent (mature spread) and As planted (pot size) views, a Layers menu to show any combination of the seven layers, and a Shift-drag selection box.
- **Two kinds of garden**: choose one when you create a garden, and change it in Garden details. A **forest garden** colours plants by their seven layers and places them exactly where you click; it opens in Design intent. A **perennial border** gives each species its own colour and pattern and opens in the Spacing view, where each plant is a circle the size of its planting spacing, so neighbours touch. The Plant tool paints onto a 30 cm interlocked grid (the spacing can be changed); drag to paint, Alt-drag to rub out, and hold Shift to place a plant off the grid. Existing plants always go exactly where you click. Touching plants of one species are labelled once as a block.
- **Editing**: undo and redo (including species edits), duplicate (Ctrl+D), copy and paste, arrow-key nudging, a measure tool, and labels that can be dragged clear of a crowded spot with a leader line back to the plant.
- **Sun study**: enter the site's latitude and longitude, pick a date and time, and see the shadows cast by plants (from their height) and by buildings, walls and fences drawn for the study. Play the day as an animation, or switch to a map of hours of direct sun (full shade to full sun).
- **Season view**: colour the plan by what is in flower or of interest in a chosen month.
- **Plant schedule**: new plants with layer, supply, supplier, quantity and cost, plus a separate table of existing plants. Copies straight into a spreadsheet.
- **Order lists**: one list per supplier, with codes and prices, flagging lines where you need more than the stock on the supplier's availability list.
- **Interest calendar**: months across, species down. Wide bars are flowers in each plant's flower colour; narrow bars are berries, autumn colour, stems, seed heads or foliage; a green line marks evergreens. A month-by-month strip shows interest and gaps.
- **Plant database**: every species entered, shared across all gardens. Searchable, filterable by layer, sortable.
- **Supplier availability**: import a nursery's availability list (Excel, CSV or pasted rows), kept separate from your plants. Tick lines to add them to your plant database with price, supplier, pot size and code; matching plants have their price and supplier updated.
- **Presentation**: a client booklet (A4 landscape PDF) with a cover and your logo, the planting plan numbered to the palette, a numbered plant palette of close-up photos, the plant schedule, the interest calendar and a pricing page with your own lines and optional VAT. The plan is drawn as vector lines and the text can be searched and copied.
- **Scaled plan sheet**: the plan on its own at a true scale (1:20 to 1:500) on A4 to A1, with a title block and plant key.
- **Backup**: download a garden, the plant library or everything as one file, and restore from it.
- **Preferences**: a theme (Eiderdown, Woodwork, 98 or root), label size and text, grid, rulers, snap spacing (5 cm–1 m), default view, currency, and colours for each layer.

Plants are grouped by the seven-layer system: Canopy, Understory, Shrub, Herbaceous, Ground cover, Tubers & bulbs, Climbers.

## Files

- `index.html`: the whole app (HTML, CSS and JavaScript in one file).
- `example/example-site-plan.svg`: the example site plan used by the example garden.
- `tests/`: automated checks that open the app in a headless browser.

## Storage

The app is written for the claude.ai artifact runtime. Gardens, the plant database, supplier availability lists and preferences are saved through its `db` capability, imported plans, plant photos and the logo through its `assets` capability, and PDFs and backups are saved through its `downloads` capability. Opened as a plain local file, the app still works but nothing is saved.

Each garden is stored as one record of at most 256 KiB, which is roughly 3,000 to 4,000 separate placements. The app warns as a plan nears that size. Groups count as one placement however many plants they hold.

## Tests

The tests need Node.js and Playwright.

```bash
npm install
```

```bash
npx playwright install chromium
```

```bash
npm test
```

To run only some tests, give part of a test's name:

```bash
node tests/smoke.js sun
```

The tests run the app against a stand-in for the claude.ai runtime (`tests/mock-runtime.js`), so they never touch saved gardens. The PDF tests load html2canvas, jsPDF and svg2pdf.js from their CDNs; to run offline, set `SL_LIBS` to a folder holding `html2canvas.min.js`, `jspdf.umd.min.js`, `svg2pdf.umd.min.js` and `xlsx.full.min.js`. Two checks read the PDFs back with `pdftotext` (from poppler) and are skipped when it isn't installed.

## Later

- Standalone desktop app for Windows and macOS (for example with Electron), saving everything locally and bundling the PDF libraries so it works fully offline. The backup files are the way to move gardens across.
