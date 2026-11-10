// Injected into the page before the app starts: a stand-in for the claude.ai artifact runtime.
// Like the real one it deep-freezes everything it hands back, and it refuses records over 256 KiB.
window.__mock = (() => {
  const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
  const clone = o => JSON.parse(JSON.stringify(o));
  const store = new Map(), subs = [], blobs = new Map();
  const LIMIT = 256 * 1024;
  const check = data => { if (new Blob([JSON.stringify(data)]).size > LIMIT) throw Object.assign(new Error('document is over 256 KiB'), { code: 'invalid_argument' }); };
  const parent = p => p.split('/').slice(0, -1).join('/');
  const meta = { fromCache: false, hasPendingWrites: false };
  const snapDoc = path => deepFreeze({ id: path.split('/').pop(), exists: store.has(path), data: () => (store.has(path) ? deepFreeze(clone(store.get(path))) : undefined), metadata: meta });
  const snapCol = col => { const docs = Object.freeze([...store.keys()].filter(k => parent(k) === col).sort().map(snapDoc)); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: meta }; };
  const notify = () => setTimeout(() => subs.forEach(s => s()), 0);
  const doc = path => ({ id: path.split('/').pop(), path,
    get: async () => snapDoc(path),
    set: async data => { check(data); deepFreeze(data); store.set(path, clone(data)); notify(); },
    update: async data => { const next = { ...store.get(path), ...clone(data) }; check(next); store.set(path, next); notify(); },
    delete: async () => { store.delete(path); notify(); },
    onSnapshot: next => { const f = () => next(snapDoc(path)); subs.push(f); setTimeout(f, 0); return () => {}; },
    collection: c => col(path + '/' + c) });
  const col = path => ({ path, doc: id => doc(path + '/' + (id || Math.random().toString(36).slice(2))),
    get: async () => snapCol(path),
    onSnapshot: next => { const f = () => next(snapCol(path)); subs.push(f); setTimeout(f, 0); return () => {}; } });
  const db = Object.freeze({ doc, collection: col });
  let upN = 0;
  const assets = Object.freeze({
    upload: async (b, o) => { const id = 'up' + String(upN++).padStart(30, '0'); blobs.set(id, new Blob([b], { type: o?.type || b.type })); return { id, url: '/_blob/' + id, sizeBytes: b.size, contentType: o?.type || b.type }; },
    delete: async id => ({ deleted: blobs.delete(id) }),
    list: async () => ({ assets: [...blobs.entries()].map(([id, b]) => ({ id, url: '/_blob/' + id, contentType: b.type, sizeBytes: b.size, createdAt: '' })), usage: {} }) });
  const sample = async () => ({ text: '', truncated: false });
  sample.json = async prompt => deepFreeze([...prompt.matchAll(/^\d+\. (.+?) \|/gm)].map(m => ({ botanical: m[1], layer: 'shrub', height_m: 0.6, spread_m: 0.5, planted_spread_m: 0.15, flower_from: 5, flower_to: 7, flower_colour: 'Pink', foliage: 'evergreen', interest: [{ kind: 'berries', from: 9, to: 11, colour: 'Red' }] })));
  Object.freeze(sample);
  const saved = [];
  const downloads = Object.freeze({ save: async ({ filename, data }) => { const blob = data instanceof Blob ? data : new Blob([data]); saved.push({ filename, blob }); return { status: 'saved' }; } });
  window.claude = Object.freeze({ use: async n => ({ db, assets, sample, downloads }[n] || null) });
  return { store, blobs, saved };
})();
