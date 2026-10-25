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

export function createStore({ backend, getDek, userId, now = () => new Date().toISOString(), uuid = () => globalThis.crypto.randomUUID(), onWrite = null }) {
  const cache = new Map();  // id -> { version, obj }; plaintext, in memory only, cleared when the key changes
  const problems = new Map(); // id -> code, for records that could not be read
  let cacheKey = null;
  let lastStamp = '';
  // Strictly increasing creation times, so records made within the same millisecond keep their order.
  const stamp = () => { let t = now(); if (t <= lastStamp) t = new Date(Date.parse(lastStamp) + 1).toISOString(); lastStamp = t; return t; };
  // Called after every local change so the sync engine knows there is something to back up. It can never break a save.
  const wrote = () => { try { onWrite?.(); } catch { /* ignore */ } };
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
    wrote();
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
        const ts = stamp();
        const obj = { type, schemaVersion: RECORD_SCHEMA_VERSION, createdAt: ts, updatedAt: ts, deletedAt: null, ...fields };
        const payload = await encryptRecord(k, userId, id, obj);
        try {
          await backend.commit([{ store: 'records', put: { id, userId, payload, schemaVersion: RECORD_SCHEMA_VERSION, version: 1, createdAt: ts, updatedAt: ts, deletedAt: null, dirty: 1 } }],
            { expect: { id, version: null } });
        } catch (e) { throw e.code === 'CONFLICT' ? new StoreError('EXISTS', 'A record with this id already exists.') : e; }
        const full = { id, version: 1, ...obj };
        cache.set(id, { version: 1, obj: full });
        wrote();
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
    // Marks rows as pushed. A record edited while the push was running stays dirty (its version moved on), but it
    // still remembers which version the server now has (`syncedVersion`), so the next push knows what to expect.
    markPushed({ records = [], history = [] } = {}) {
      return serial(async () => {
        for (const { id, version } of records) {
          const row = await backend.get('records', id);
          if (!row) continue;
          const next = row.version === version ? { ...row, dirty: 0, syncedVersion: version } : { ...row, syncedVersion: Math.max(row.syncedVersion || 0, version) };
          try { await backend.commit([{ store: 'records', put: next }], { expect: { id, version: row.version } }); }
          catch (e) { if (e.code !== 'CONFLICT') throw e; }
        }
        for (const hkey of history) {
          const h = await backend.get('history', hkey);
          if (h && !h.pushed) await backend.commit([{ store: 'history', put: { ...h, pushed: 1 } }]);
        }
      });
    },

    // ---------- sync (Phase 5) ----------
    // Everything below handles ciphertext rows and bookkeeping. `syncedVersion` is the last version known to
    // be on the server (0 = never pushed). Conflicts keep BOTH sides: nothing a person saved is ever dropped.
    sync: {
      async dirtyRecords() { key(); return backend.getAll('records', 'dirty', 1); },
      async dirtyHistory() { key(); return backend.getAll('history', 'pushed', 0); },
      async allRows() { key(); return backend.getAll('records'); },

      // Rows that came from the server (shape: id, payload, schema_version, version, created_at, updated_at, deleted_at).
      // New or newer rows are stored as they are. A row that this device also changed is returned in `conflicts`.
      applyRemote(rows) {
        return serial(async () => {
          key();
          const res = { added: 0, updated: 0, skipped: 0, conflicts: [] };
          for (const R of rows) {
            if (!R || typeof R.id !== 'string' || typeof R.payload !== 'string' || !Number.isInteger(R.version) || R.version < 1) { res.skipped++; continue; }
            const base = { id: R.id, userId, payload: R.payload, schemaVersion: R.schema_version, version: R.version, createdAt: R.created_at, updatedAt: R.updated_at, deletedAt: R.deleted_at ?? null, dirty: 0, syncedVersion: R.version };
            try {
              const local = await backend.get('records', R.id);
              if (!local) { await backend.commit([{ store: 'records', put: base }], { expect: { id: R.id, version: null } }); res.added++; continue; }
              if (!local.dirty) {
                if (R.version > local.version) { await backend.commit([{ store: 'records', put: base }], { expect: { id: R.id, version: local.version } }); res.updated++; } else res.skipped++;
                continue;
              }
              if (R.version <= (local.syncedVersion || 0)) { res.skipped++; continue; }                 // nothing new on the server
              if (R.version === local.version && R.payload === local.payload) {                         // our own push, reply was lost
                await backend.commit([{ store: 'records', put: { ...local, dirty: 0, syncedVersion: R.version } }], { expect: { id: R.id, version: local.version } }); res.skipped++; continue;
              }
              res.conflicts.push(R);
            } catch (e) { if (e.code === 'CONFLICT') { res.skipped++; continue; } throw e; }            // a local save raced us: next round looks again
          }
          if (res.added || res.updated) wrote();
          return res;
        });
      },

      // Both sides changed the same record. The newer change (by the time saved inside the record) becomes the
      // current version; the other side is kept as a version in history. Local edits made while offline are kept
      // in order. The result is saved as new local versions on top of the server's, and is pushed next.
      resolveConflict(R) {
        return serial(async () => {
          const k = key(), id = R.id;
          const local = await backend.get('records', id);
          if (!local) throw new StoreError('NOT_FOUND', 'Record not found.');
          const b = local.syncedVersion || 0;
          if (R.version <= b) return { winner: 'local', changed: false };
          let lo, so;
          try { lo = await decryptRecord(k, userId, id, local.payload); so = await decryptRecord(k, userId, id, R.payload); }
          catch { throw new StoreError('CORRUPT', 'Two copies of a record could not be merged because one could not be read.'); }
          const S = R.version, ops = [], branch = [];
          for (let v = b + 1; v < local.version; v++) {              // the versions made on this device since the last sync
            const hk = `${id}:${v}`, h = await backend.get('history', hk);
            ops.push({ store: 'history', delete: hk });
            if (h) branch.push(h.payload);
          }
          branch.push(local.payload);
          const m = branch.length, localWins = (Date.parse(lo.updatedAt) || 0) > (Date.parse(so.updatedAt) || 0);
          const hist = (version, payload, savedAt) => ({ store: 'history', put: { key: `${id}:${version}`, recordId: id, userId, version, payload, savedAt, pushed: 0 } });
          ops.push(hist(S, R.payload, R.updated_at));
          let cur;
          if (localWins) {
            for (let i = 0; i < m - 1; i++) ops.push(hist(S + 1 + i, branch[i], local.updatedAt));
            cur = { payload: branch[m - 1], version: S + m, schemaVersion: local.schemaVersion, deletedAt: local.deletedAt ?? null };
          } else {
            for (let i = 0; i < m; i++) ops.push(hist(S + 1 + i, branch[i], local.updatedAt));
            cur = { payload: R.payload, version: S + m + 1, schemaVersion: R.schema_version, deletedAt: R.deleted_at ?? null };
          }
          const t = now(), ts = Date.parse(t) < Date.parse(local.updatedAt) ? local.updatedAt : t;
          ops.push({ store: 'records', put: { ...local, ...cur, updatedAt: ts, dirty: 1, syncedVersion: S } });
          await backend.commit(ops, { expect: { id, version: local.version } });
          cache.delete(id);
          wrote();
          return { winner: localWins ? 'local' : 'remote', changed: true };
        });
      },

      // The server no longer has a record this device thought it had: push it again as a new record.
      forgetServerVersion(id) {
        return serial(async () => {
          const row = await backend.get('records', id);
          if (!row) return;
          await backend.commit([{ store: 'records', put: { ...row, dirty: 1, syncedVersion: 0 } }], { expect: { id, version: row.version } });
        });
      },

      // Backup file support: the rows exactly as stored (ciphertext only).
      async exportRows() { key(); return { records: await backend.getAll('records'), history: await backend.getAll('history') }; },
      importRows({ records = [], history = [] }) {
        return serial(async () => {
          key();
          const res = { added: 0, updated: 0, skipped: 0, historyAdded: 0 };
          for (const r of records) {
            const local = await backend.get('records', r.id);
            const row = { id: r.id, userId, payload: r.payload, schemaVersion: r.schemaVersion, version: r.version, createdAt: r.createdAt, updatedAt: r.updatedAt, deletedAt: r.deletedAt ?? null, dirty: 1, syncedVersion: local?.syncedVersion || 0 };
            try {
              if (!local) { await backend.commit([{ store: 'records', put: row }], { expect: { id: r.id, version: null } }); res.added++; }
              else if (r.version > local.version && !local.dirty) { await backend.commit([{ store: 'records', put: row }], { expect: { id: r.id, version: local.version } }); res.updated++; }
              else res.skipped++;
            } catch (e) { if (e.code === 'CONFLICT') res.skipped++; else throw e; }
          }
          for (const h of history) {
            const hk = `${h.recordId}:${h.version}`;
            if (await backend.get('history', hk)) continue;
            await backend.commit([{ store: 'history', put: { key: hk, recordId: h.recordId, userId, version: h.version, payload: h.payload, savedAt: h.savedAt, pushed: 0 } }]);
            res.historyAdded++;
          }
          if (res.added || res.updated) cache.clear();
          wrote();
          return res;
        });
      },
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
