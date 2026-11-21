# Working on SevenLayers

- The user tests the tool live from GitHub (served from `main`) and refreshes after each change.
  So commit finished changes straight to `main` and push, unless told otherwise; do not leave them on a side branch.
- Run the tests with `node tests/smoke.js` (or a name filter as the argument). The PDF and aerial-photo tests need network access to CDNs and fail without it.
- `allotment/index.html` is root, the crop planner (the name is always lower case, with “crop planner” as its tag line), a simpler vegetable-plot tool on the same template and themes. Test it with `node tests/allotment.js`; keep its themes in step when SevenLayers' themes change.
