// Sync engine (Phase 5). Backs up encrypted records to the server and brings in changes made on other devices.
//
// The server only ever sees ciphertext. One cycle is: PULL (bring in newer rows, resolve conflicts) -> PUSH
// (send this device's changed rows, one at a time, each guarded by the version the server is expected to have)
// -> HISTORY (send superseded versions; the server ignores duplicates, so a retry is always safe).
// A cycle can be interrupted at any point (network drop, closed tab) and the next one simply carries on.
//
// The server is reached through a small `remote` object (see remote.js), so this file is tested in Node with a
// simulated server and two simulated devices.

export class SyncError extends Error {
  constructor(code, message) { super(message || code); this.code = code; } // OFFLINE | AUTH | SERVER
}

const EPOCH = '1970-01-01T00:00:00.000Z';
const byTime = (a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : a.id < b.id ? -1 : 1);

export function createSync({
  getStore, remote, canRun = () => true,
  online = () => globalThis.navigator?.onLine !== false,
  setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t),
  setRepeat = (f, ms) => setInterval(f, ms), clearRepeat = (t) => clearInterval(t),
  now = () => Date.now(),
  intervalMs = 60000, debounceMs = 1500, overlapMs = 5 * 60 * 1000, pageSize = 200,
}) {
  let snap = { state: 'idle', pending: 0, lastSyncedAt: null, error: null, failed: [] };
  const listeners = new Set();
  const publish = (patch) => { snap = { ...snap, ...patch }; for (const fn of [...listeners]) { try { fn(snap); } catch { /* a listener must not break syncing */ } } };

  let running = false, current = null, again = false, debounce = null, repeat = null, onlineHandler = null;

  async function countPending(store) {
    try { const p = await store.pending(); return p.count; } catch { return snap.pending; }
  }

  // ---------- one record ----------
  async function pushOne(store, row) {
    const synced = row.syncedVersion || 0;
    const body = { id: row.id, payload: row.payload, schema_version: row.schemaVersion, version: row.version, deleted_at: row.deletedAt ?? null };
    let ok = false;
    if (synced === 0) ok = (await remote.insert({ ...body, created_at: row.createdAt })).ok;
    else ok = !!(await remote.update(row.id, synced, body));
    if (ok) { await store.markPushed({ records: [{ id: row.id, version: row.version }] }); return 'pushed'; }
    // Nothing matched: either another device got there first, or our own earlier push worked and its reply was lost.
    const server = await remote.get(row.id);
    if (!server) { await store.sync.forgetServerVersion(row.id); return 'retry'; }
    if (server.version === row.version && server.payload === row.payload) { await store.markPushed({ records: [{ id: row.id, version: row.version }] }); return 'pushed'; }
    await store.sync.resolveConflict(server);
    return 'resolved';
  }

  // ---------- one cycle ----------
  async function cycle() {
    if (!canRun()) { publish({ state: 'idle' }); return; }
    if (!online()) { const store = await getStore(); publish({ state: 'offline', pending: await countPending(store) }); return; }
    const store = await getStore();
    publish({ state: 'syncing', error: null });
    const failed = [];
    try {
      // PULL
      const saved = await store.meta.get('syncCursor') || null;
      let since = saved ? new Date(Date.parse(saved) - overlapMs).toISOString() : EPOCH, newest = saved;
      for (let page = 0; page < 5000; page++) {
        const rows = await remote.pull({ since, limit: pageSize });
        const { conflicts } = await store.sync.applyRemote(rows);
        for (const c of conflicts) { try { await store.sync.resolveConflict(c); } catch (e) { if (e.code === 'CORRUPT') failed.push({ id: c.id, message: e.message }); else throw e; } }
        if (rows.length) { const last = rows[rows.length - 1].updated_at; if (!newest || Date.parse(last) > Date.parse(newest)) newest = last; }
        if (rows.length < pageSize) break;
        const next = rows[rows.length - 1].updated_at;
        if (next === since) break;
        since = next;
      }
      if (newest && newest !== saved) await store.meta.set('syncCursor', newest);

      // PUSH
      for (let round = 0; round < 4; round++) {
        const dirty = (await store.sync.dirtyRecords()).sort(byTime);
        if (!dirty.length) break;
        let moved = false;
        for (const row of dirty) {
          try { const r = await pushOne(store, row); if (r !== 'pushed') moved = true; }
          catch (e) {
            if (e instanceof SyncError && (e.code === 'OFFLINE' || e.code === 'AUTH')) throw e;
            if (e.code === 'CONFLICT') { moved = true; continue; }
            failed.push({ id: row.id, message: e.message || 'Could not be backed up' });
          }
        }
        if (!moved) break;
      }

      // HISTORY
      const hist = await store.sync.dirtyHistory();
      for (let i = 0; i < hist.length; i += 100) {
        const batch = hist.slice(i, i + 100);
        await remote.pushHistory(batch.map((h) => ({ record_id: h.recordId, user_id: h.userId, version: h.version, payload: h.payload, saved_at: h.savedAt })));
        await store.markPushed({ history: batch.map((h) => h.key) });
      }
      const pending = await countPending(store);
      publish({ state: 'synced', pending, lastSyncedAt: new Date(now()).toISOString(), failed, error: failed.length ? `${failed.length} ${failed.length === 1 ? 'record' : 'records'} could not be backed up.` : null });
    } catch (e) {
      const pending = await countPending(store);
      if (e instanceof SyncError && e.code === 'OFFLINE') publish({ state: 'offline', pending, error: null });
      else if (e instanceof SyncError && e.code === 'AUTH') publish({ state: 'auth', pending, error: 'Your sign-in expired.' });
      else if (e?.code === 'LOCKED') publish({ state: 'idle' });
      else publish({ state: 'error', pending, error: e?.message || 'Backup failed.', failed });
    }
  }

  // One cycle at a time; a request that arrives during a cycle makes exactly one more follow.
  function run() {
    if (current) { again = true; return current; }
    current = (async () => { try { do { again = false; await cycle(); } while (again); } finally { current = null; } return snap; })();
    return current;
  }

  return {
    status: () => snap,
    subscribe(fn) { listeners.add(fn); fn(snap); return () => listeners.delete(fn); },
    run, flush: run,
    // Brings in the old versions of one record held by the server, so its change history is complete on this device.
    async pullHistory(recordId) {
      if (!online()) throw new SyncError('OFFLINE', 'You are offline.');
      const store = await getStore();
      return store.sync.applyHistory(await remote.getHistory(recordId));
    },
    // Resolves when no cycle is running (used before closing the local database).
    async whenIdle() { while (current) { try { await current; } catch { /* a failed cycle is already reported in the status */ } } },
    // A local change happened: back up shortly (changes made close together go in one cycle).
    touch() {
      if (!running) return;
      if (debounce) clearTimer(debounce);
      debounce = setTimer(() => { debounce = null; run(); }, debounceMs);
    },
    start() {
      if (running) return run();
      running = true;
      repeat = setRepeat(() => run(), intervalMs);
      if (globalThis.addEventListener) { onlineHandler = () => run(); globalThis.addEventListener('online', onlineHandler); }
      return run();
    },
    stop() {
      running = false;
      if (debounce) { clearTimer(debounce); debounce = null; }
      if (repeat) { clearRepeat(repeat); repeat = null; }
      if (onlineHandler && globalThis.removeEventListener) { globalThis.removeEventListener('online', onlineHandler); onlineHandler = null; }
      publish({ state: 'idle' });
    },
    // Compares this device with the server without changing anything. `notBackedUp` counts records the server
    // does not have (or has an older version of); `historyPending` counts old versions still waiting to be sent.
    async verify() {
      if (!online()) throw new SyncError('OFFLINE', 'You are offline.');
      const store = await getStore();
      const [server, rows, pending] = await Promise.all([remote.listVersions(), store.sync.allRows(), store.pending()]);
      const sv = new Map(server.map((r) => [r.id, r.version]));
      const lacking = rows.filter((r) => !sv.has(r.id) || sv.get(r.id) < r.version);
      const local = new Set(rows.map((r) => r.id));
      return { local: rows.length, server: server.length, notBackedUp: lacking.length, toDownload: server.filter((r) => !local.has(r.id)).length, historyPending: pending.history.length };
    },
  };
}
