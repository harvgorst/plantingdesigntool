// Injected into the page before the app starts. With window.__mock present, the app keeps its records,
// files and downloads in these maps instead of the browser's IndexedDB, so a test never touches real saved gardens.
window.__mock = { store: new Map(), blobs: new Map(), saved: [] };
