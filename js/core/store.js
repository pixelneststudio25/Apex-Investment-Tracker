// Encrypted record store (General System Plan sections 5, 6, 7 and 9, Phase 3).
//
// Every record is one encrypted blob (AES-GCM via crypto.js). What is stored on the device, and later on the
// server, is only: id, owner, ciphertext, record schema version, version number, timestamps, deletedAt and a
// "dirty" flag. The record TYPE (investment, entry, ...) and every field live INSIDE the ciphertext.
//
// - Edits never overwrite: the outgoing version goes to `history`, then the record becomes version + 1.
// - Deletes are soft (deletedAt); a deleted record can be restored.
// - Writes are atomic (record + history in one batch) and serialised, and also guarded by a version check so
//   a second tab cannot silently overwrite a newer version.
// - Locked (no key) means every call throws LOCKED and the in-memory plaintext cache is dropped.
import { decryptRecord, encryptRecord } from './crypto.js';
import { RECORD_SCHEMA_VERSION, fieldsOf, validate } from '../models/schemas.js';

export class StoreError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

const out = (o) => structuredClone(o);

export function createStore({ backend, getDek, userId, now = () => new Date().toISOString(), uuid = () => globalThis.crypto.randomUUID() }) {
  const cache = new Map();  // id -> { version, obj }; plaintext, in memory only, cleared when the key changes
  const problems = new Map(); // id -> code, for records that could not be read
  let cacheKey = null;
  let chain = Promise.resolve();
  const serial = (fn) => { const run = chain.then(() => fn()); chain = run.catch(() => {}); return run; };

  function key() {
    const k = getDek();
    if (!k) throw new StoreError('LOCKED', 'Unlock Apex first.');
    if (k !== cacheKey) { cache.clear(); problems.clear(); cacheKey = k; }
    return k;
  }

  // Decrypts one stored row (using the cache when the version matches).
  async function open(row, k) {
    const hit = cache.get(row.id);
    if (hit && hit.version === row.version) return hit.obj;
    let o;
    try { o = await decryptRecord(k, userId, row.id, row.payload); }
    catch { problems.set(row.id, 'CORRUPT'); throw new StoreError('CORRUPT', 'A record could not be read. It may be damaged or belong to another account.'); }
    if (!(o.schemaVersion <= RECORD_SCHEMA_VERSION)) {
      problems.set(row.id, 'TOO_NEW');
      throw new StoreError('TOO_NEW', 'A record was saved by a newer version of Apex. Please refresh the app.');
    }
    problems.delete(row.id);
    const obj = { id: row.id, version: row.version, ...o };
    cache.set(row.id, { version: row.version, obj });
    return obj;
  }

  // Writes `next` (a full plaintext object without id/version) as the new version of an existing row.
  async function writeNext(k, row, next) {
    const ts0 = now(), ts = ts0 < row.updatedAt ? row.updatedAt : ts0; // never let updatedAt go backwards
    const obj = { ...next, schemaVersion: RECORD_SCHEMA_VERSION, updatedAt: ts };
    const payload = await encryptRecord(k, userId, row.id, obj);
    const version = row.version + 1;
    await backend.commit([
      { store: 'history', put: { key: `${row.id}:${row.version}`, recordId: row.id, userId, version: row.version, payload: row.payload, savedAt: row.updatedAt, pushed: 0 } },
      { store: 'records', put: { ...row, payload, version, schemaVersion: RECORD_SCHEMA_VERSION, updatedAt: ts, deletedAt: obj.deletedAt, dirty: 1 } },
    ], { expect: { id: row.id, version: row.version } });
    const full = { id: row.id, version, ...obj };
    cache.set(row.id, { version, obj: full });
    return full;
  }

  // Read-change-write for one record. `change(current, ts)` returns { fields, deletedAt } or null for "nothing to do".
  function mutate(id, change, { allowDeleted = false } = {}) {
    return serial(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const k = key();
        const row = await backend.get('records', id);
        if (!row) throw new StoreError('NOT_FOUND', 'Record not found.');
        const cur = await open(row, k);
        if (cur.deletedAt && !allowDeleted) throw new StoreError('DELETED', 'This record is deleted. Restore it first.');
        const next = await change(out(cur), now());
        if (!next) return out(cur);
        try {
          return out(await writeNext(k, row, {
            type: cur.type, createdAt: cur.createdAt, deletedAt: next.deletedAt, ...next.fields,
          }));
        } catch (e) { if (e.code === 'CONFLICT') continue; throw e; } // another tab saved first: re-read and retry
      }
      throw new StoreError('CONFLICT', 'Could not save because the record kept changing. Please try again.');
    });
  }

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  return {
    // ---------- create / read ----------
    create(type, data, { id = uuid() } = {}) {
      return serial(async () => {
        const k = key();
        const fields = validate(type, data);
        const ts = now();
        const obj = { type, schemaVersion: RECORD_SCHEMA_VERSION, createdAt: ts, updatedAt: ts, deletedAt: null, ...fields };
        const payload = await encryptRecord(k, userId, id, obj);
        try {
          await backend.commit([{ store: 'records', put: { id, userId, payload, schemaVersion: RECORD_SCHEMA_VERSION, version: 1, createdAt: ts, updatedAt: ts, deletedAt: null, dirty: 1 } }],
            { expect: { id, version: null } });
        } catch (e) { throw e.code === 'CONFLICT' ? new StoreError('EXISTS', 'A record with this id already exists.') : e; }
        const full = { id, version: 1, ...obj };
        cache.set(id, { version: 1, obj: full });
        return out(full);
      });
    },

    async get(id, { includeDeleted = false } = {}) {
      const k = key();
      const row = await backend.get('records', id);
      if (!row) return null;
      const o = await open(row, k);
      return o.deletedAt && !includeDeleted ? null : out(o);
    },

    // Unreadable records are skipped (never break the whole list) and reported by problems().
    async list(type, { includeDeleted = false } = {}) {
      const k = key();
      const rows = await backend.getAll('records');
      const result = [];
      for (const row of rows) {
        let o;
        try { o = await open(row, k); } catch (e) { if (e instanceof StoreError) continue; throw e; }
        if (o.type === type && (includeDeleted || !o.deletedAt)) result.push(out(o));
      }
      return result.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
    },
    problems() { return [...problems].map(([id, code]) => ({ id, code })); },

    // ---------- change ----------
    // `change` is an object of fields to replace, or a function that edits (or returns) a copy of the fields.
    update(id, change) {
      return mutate(id, (cur) => {
        const current = fieldsOf(cur);
        let before = null; try { before = validate(cur.type, current); } catch { /* stored data predates a stricter rule */ }
        let draft;
        if (typeof change === 'function') { const copy = structuredClone(current); const r = change(copy); draft = r === undefined ? copy : r; }
        else draft = { ...current, ...change };
        const after = validate(cur.type, draft);
        return before && same(before, after) ? null : { fields: after, deletedAt: cur.deletedAt };
      });
    },
    remove(id) { return mutate(id, (cur, ts) => (cur.deletedAt ? null : { fields: fieldsOf(cur), deletedAt: ts }), { allowDeleted: true }); },
    restore(id) { return mutate(id, (cur) => (cur.deletedAt ? { fields: fieldsOf(cur), deletedAt: null } : null), { allowDeleted: true }); },

    // ---------- history ----------
    // Oldest first; the last entry is the current version. An unreadable old version is marked, not thrown.
    async history(id) {
      const k = key();
      const row = await backend.get('records', id);
      if (!row) throw new StoreError('NOT_FOUND', 'Record not found.');
      const current = await open(row, k);
      const old = await backend.getAll('history', 'recordId', id);
      const versions = [];
      for (const h of old) {
        try { versions.push({ version: h.version, savedAt: h.savedAt, current: false, record: { id, version: h.version, ...(await decryptRecord(k, userId, id, h.payload)) } }); }
        catch { versions.push({ version: h.version, savedAt: h.savedAt, current: false, unreadable: true }); }
      }
      versions.push({ version: row.version, savedAt: row.updatedAt, current: true, record: out(current) });
      return versions.sort((a, b) => a.version - b.version);
    },

    // Copies the fields of an older version into a NEW version (history is never rewound). Keeps deleted state.
    revertTo(id, version) {
      return mutate(id, async (cur) => {
        if (version === cur.version) return null;
        const h = await backend.get('history', `${id}:${version}`);
        if (!h) throw new StoreError('NO_SUCH_VERSION', 'That version does not exist.');
        const old = await decryptRecord(cacheKey, userId, id, h.payload);
        return { fields: validate(cur.type, fieldsOf(old)), deletedAt: cur.deletedAt };
      }, { allowDeleted: true });
    },

    // ---------- sync contract (used by Phase 6) ----------
    // Ciphertext rows waiting to be pushed. Nothing here is plaintext.
    async pending() {
      key();
      const [records, history] = await Promise.all([backend.getAll('records', 'dirty', 1), backend.getAll('history', 'pushed', 0)]);
      return { records, history, count: records.length + history.length };
    },
    // Marks rows as pushed. A record edited while the push was running stays dirty (its version moved on).
    markPushed({ records = [], history = [] } = {}) {
      return serial(async () => {
        for (const { id, version } of records) {
          const row = await backend.get('records', id);
          if (!row || row.version !== version || !row.dirty) continue;
          try { await backend.commit([{ store: 'records', put: { ...row, dirty: 0 } }], { expect: { id, version } }); }
          catch (e) { if (e.code !== 'CONFLICT') throw e; }
        }
        for (const hkey of history) {
          const h = await backend.get('history', hkey);
          if (h && !h.pushed) await backend.commit([{ store: 'history', put: { ...h, pushed: 1 } }]);
        }
      });
    },
    meta: {
      get: async (name) => (await backend.get('meta', name))?.value,
      set: (name, value) => backend.commit([{ store: 'meta', put: { key: name, value } }]),
    },

    // ---------- housekeeping ----------
    lock() { cache.clear(); problems.clear(); cacheKey = null; },
    async destroy() { this.lock(); await backend.destroy(); },
  };
}
