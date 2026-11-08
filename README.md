# Garden Planting Map

A planting-only design tool for garden designers. Import an existing site plan, draw plants, drifts and curved beds over it at true scale, and get a costed plant schedule and a flowering calendar.

The live version runs as a claude.ai artifact:
https://claude.ai/artifact/2aTBjBBXxP2rNoepiPnhLe

## What it does

- **Plan**: import a site plan (SVG, PDF page 1, PNG or JPEG) as an underlay and set its scale from two points a known distance apart. Place single plants or groups, draw curved drifts (plant count worked out from area and density). Existing plants are drawn dashed, with Retain / Prune / Remove status, measured size and notes per plant. Design intent (mature spread) and As planted (pot-size plants at their spacing) views, a Layers menu to show any combination of the seven layers, and a Shift-drag selection box.
- **Plant schedule**: new plants with layer, supply, supplier, quantity and cost, plus a separate table of existing plants. Copies straight into a spreadsheet.
- **Flowering calendar**: months across, species down, bars in each plant's flower colour, with a month-by-month colour strip showing interest and gaps.
- **Plant database**: every species entered, shared across all gardens. Searchable, filterable by layer, sortable.
- **Supplier availability**: import a nursery's availability list (Excel, CSV or pasted rows), kept separate from your plants. Tick lines to add them to your plant database with price, supplier, pot size and code; matching plants have their price and supplier updated. Claude can fill in height, spread, flowering, flower colour and layer for the plants you add.
- **Presentation**: a client booklet (A4 landscape PDF) with a cover, the planting plan numbered to the palette, a numbered plant palette of close-up photos, the plant schedule, the flowering calendar and a pricing page with your own lines and optional VAT. Pages can be switched on or off.
- **Preferences**: label size and text, grid, rulers, snap spacing (5 cm–1 m), default view, currency, and colours for each layer.

Plants are grouped by the seven-layer system: Canopy, Understory, Shrub, Herbaceous, Ground cover, Tubers & bulbs, Climbers.

## Allotment Plot Planner

`allotment/index.html` is a separate, simpler tool built from the same layout, for vegetable plots and allotments.

- **Plan**: set the plot size, draw beds, paths, sheds, compost bays and water butts as rectangles, then drag out blocks of a crop inside a bed. Plant numbers come from the crop's in-row and between-row spacing, and rows can be turned. Moving a bed moves its crops with it.
- **Crop list & rotation**: crops, varieties, beds, rows, plant numbers and area, with a copy for spreadsheets. Each bed is compared with the previous year's plan on a four-course rotation (Peas & beans → Brassicas → Potatoes → Roots & onions) and clashes are flagged on the plan.
- **Sowing calendar**: this month's jobs (sow under cover, sow outside, plant out, harvest) and a year chart for every crop on the plan.
- **Next season**: Plot details › Start next year's plan copies the beds and perennials into a new year so rotation can be checked.

It saves plots and crops through the artifact `db` capability. `allotment/starter-data.json` holds the starter crop list (typical UK spacings and months) and the example plot that were loaded into the live version.


- `index.html`: the whole app (HTML, CSS and JavaScript in one file).
- `allotment/index.html`: the Allotment Plot Planner (one file).
- `allotment/starter-data.json`: starter crops and the example plot for the allotment planner.
- `example/example-site-plan.svg`: the example site plan used by the example garden.

## Storage

The app is written for the claude.ai artifact runtime. Gardens, the plant database, supplier availability lists and preferences are saved through its `db` capability, imported plans and plant photos through its `assets` capability, plant details are looked up through its `sample` capability, and the booklet PDF is saved through its `downloads` capability. Opened as a plain local file, the app still works but nothing is saved.

## Later

- Standalone desktop app for Windows and macOS (for example with Electron), saving everything locally with export/import backups and a bundled PDF reader so it works fully offline.
