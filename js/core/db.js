// Local storage backends for the data layer. Both implement the same small interface, so the store is
// tested in Node against the memory backend and runs on IndexedDB in the browser.
// Only ciphertext and sync bookkeeping live here; the store (store.js) does all encryption.
//
// Interface (all async):
//   get(store, key) -> value | undefined
//   getAll(store, index?, value?) -> values (optionally filtered by an exact index match)
//   commit(ops, { expect }?) -> atomic batch of { store, put } | { store, delete }.
//     expect = { id, version } makes the batch conditional: the records row must currently have that
//     version (null = must not exist), otherwise nothing is written and DbError('CONFLICT') is thrown.
//   close(), destroy()

export class DbError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

export const DB_VERSION = 1;
export const SCHEMA = {
  records: { keyPath: 'id', indexes: ['dirty'] },              // dirty: 1 = not yet pushed to the server
  history: { keyPath: 'key', indexes: ['recordId', 'pushed'] }, // key = `${recordId}:${version}`; pushed: 0 | 1
  meta: { keyPath: 'key', indexes: [] },                       // small device-level values (sync cursor, ...)
};

const clone = (v) => (v === undefined ? v : structuredClone(v));

// ---------- memory backend (tests) ----------
export function createMemoryBackend() {
  const data = { records: new Map(), history: new Map(), meta: new Map() };
  const api = {
    failNextCommit: false, // test hook: simulate a storage failure
    async get(store, key) { return clone(data[store].get(key)); },
    async getAll(store, index, value) {
      const all = [...data[store].values()];
      return clone(index ? all.filter((r) => r[index] === value) : all);
    },
    async commit(ops, { expect } = {}) {
      if (api.failNextCommit) { api.failNextCommit = false; throw new DbError('COMMIT_FAILED', 'Simulated storage failure'); }
      if (expect) {
        const cur = data.records.get(expect.id);
        if ((cur ? cur.version : null) !== expect.version) throw new DbError('CONFLICT', 'The record changed in the meantime');
      }
      for (const op of ops) {
        if ('put' in op) data[op.store].set(op.put[SCHEMA[op.store].keyPath], clone(op.put));
        else data[op.store].delete(op.delete);
      }
    },
    async close() {},
    async destroy() { for (const m of Object.values(data)) m.clear(); },
  };
  return api;
}

// ---------- IndexedDB backend (browser) ----------
export function openIdbBackend(name, { idb = globalThis.indexedDB } = {}) {
  if (!idb) throw new DbError('NO_IDB', 'This browser does not support local storage for Apex');
  let opening = null;
  const open = () => (opening ||= new Promise((resolve, reject) => {
    const r = idb.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const [store, def] of Object.entries(SCHEMA)) {
        const os = db.createObjectStore(store, { keyPath: def.keyPath });
        for (const i of def.indexes) os.createIndex(i, i);
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { opening = null; reject(r.error); };
    r.onblocked = () => { opening = null; reject(new DbError('BLOCKED', 'Close other Apex tabs and try again')); };
  }));
  const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

  return {
    async get(store, key) { const db = await open(); return wrap(db.transaction(store).objectStore(store).get(key)); },
    async getAll(store, index, value) {
      const db = await open(); const os = db.transaction(store).objectStore(store);
      return wrap(index ? os.index(index).getAll(value) : os.getAll());
    },
    async commit(ops, { expect } = {}) {
      const db = await open();
      const names = [...new Set([...ops.map((o) => o.store), ...(expect ? ['records'] : [])])];
      return new Promise((resolve, reject) => {
        const t = db.transaction(names, 'readwrite'); let failure = null;
        t.oncomplete = () => resolve();
        t.onerror = () => reject(failure || t.error);
        t.onabort = () => reject(failure || t.error || new DbError('ABORTED', 'Storage transaction was aborted'));
        const apply = () => {
          for (const op of ops) {
            const os = t.objectStore(op.store);
            if ('put' in op) os.put(op.put); else os.delete(op.delete);
          }
        };
        if (!expect) { apply(); return; }
        const g = t.objectStore('records').get(expect.id);
        g.onsuccess = () => {
          const cur = g.result;
          if ((cur ? cur.version : null) !== expect.version) { failure = new DbError('CONFLICT', 'The record changed in the meantime'); t.abort(); } else apply();
        };
      });
    },
    async close() { if (opening) { (await opening).close(); opening = null; } },
    async destroy() {
      await this.close();
      await new Promise((res, rej) => { const r = idb.deleteDatabase(name); r.onsuccess = () => res(); r.onerror = () => rej(r.error); r.onblocked = () => res(); });
    },
  };
}
