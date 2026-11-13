# SevenLayers

SevenLayers is a planting-only design tool for garden designers. Import an existing site plan, place plants over it at true scale, study sun and shade, and get a costed plant schedule, supplier order lists, an interest calendar, a client booklet and a scaled plan sheet.

SevenLayers is a single HTML file. Download `index.html` and open it in a browser (Chrome, Edge, Firefox or Safari); there is nothing to install and no account. It can also be served from any static web host.

## What it does

- **Plan**: import a site plan (SVG, PDF page 1, PNG or JPEG) as an underlay and set its scale from two points a known distance apart. Place single plants or groups, or a row of evenly spaced plants between two points (for hedges and edging). Existing plants are drawn dashed, with Retain / Prune / Remove status, measured size and notes per plant. Design intent (mature spread) and As planted (pot size) views, a Layers menu to show any combination of the seven layers, and a Shift-drag selection box.
- **Structure, planting and bulbs in one plan**: trees, shrubs, climbers and existing plants go exactly where you click, drawn at their own size in their layer colour, light enough that the planting underneath shows through. Perennials and ground cover are painted onto a 30 cm interlocked grid (the spacing can be changed) and drawn at their planting spacing, so neighbours touch, each species in its own colour and pattern; drag to paint, Alt-drag to rub out, Shift to place one off the grid. Bulbs are a layer of their own over the top, on a finer grid (15 cm by default) among the perennials, so they can be planned after the planting; while you place bulbs the rest of the plan fades back. Touching plants of one species are labelled once as a block. Design intent and As planted change only the size of the trees and shrubs.
- **Oudolf mode** (Preferences → Planting style): the perennials and ground cover are drawn as areas that share their borders, in the manner of Piet Oudolf's and Henk Gerritsen's plans, keeping each plant's colour and pattern. You still paint them onto the grid; painting over a neighbour moves the border. Each area is labelled with its count, worked out from its size and the plant's number per square metre, which is set in the bar under the toolbar when you pick the plant or click its area, and kept with the species. Click an area to select all of it and drag to move it.
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
- `example/example-site-plan.svg`: a made-up site plan used by the tests.
- `tests/`: automated checks that open the app in a headless browser.

## Storage

Everything is saved in the browser you use, in its IndexedDB storage: gardens, the plant database, supplier availability lists, preferences, imported plans, plant photos and the logo. Nothing is sent to a server. PDFs and backups are ordinary file downloads. Two tabs open on the same copy stay in step.

Because the data lives in that browser, it stays on that computer and in that browser only; clearing the browser's site data deletes it. Use **Preferences → Backup → Download everything** regularly, and to move your work to another computer or browser, then **Restore from a backup** there. Opened from disk (`file://`), the data belongs to that file's location, so keep `index.html` in one place.

Fonts load from Google Fonts and the PDF, spreadsheet and drawing libraries from cdnjs and jsDelivr, so making PDFs and importing spreadsheets need an internet connection. Everything else works offline.

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

Most tests keep their data in memory (`tests/mock-runtime.js`), so they never touch saved gardens; one runs against the browser's real storage and checks a garden survives a reload. The PDF tests load html2canvas, jsPDF and svg2pdf.js from their CDNs; to run offline, set `SL_LIBS` to a folder holding `html2canvas.min.js`, `jspdf.umd.min.js`, `svg2pdf.umd.min.js` and `xlsx.full.min.js`. Two checks read the PDFs back with `pdftotext` (from poppler) and are skipped when it isn't installed.

## Later

- Standalone desktop app for Windows and macOS (for example with Electron), bundling the fonts and PDF libraries so it works fully offline.
