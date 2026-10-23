// Minimal IndexedDB key-value store (wrapped keys and device state only; never plaintext secrets).
const DB = 'apex', STORE = 'kv';

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req.result); };
    t.onerror = t.onabort = () => { db.close(); reject(t.error); };
  });
}
export const kv = {
  get: (k) => run('readonly', (s) => s.get(k)),
  set: (k, v) => run('readwrite', (s) => s.put(v, k)),
  delete: (k) => run('readwrite', (s) => s.delete(k)),
};
