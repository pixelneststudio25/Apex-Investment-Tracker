// Phase 5 tests: sync between devices, conflicts, interrupted pushes, verification, encrypted backup and restore.
// The server is simulated in memory with the same rules as Supabase (own rows only, version-guarded updates,
// history that ignores duplicates). Two or three "devices" share one account key but have separate local databases.
import { decryptRecord, generateDek } from '../js/core/crypto.js';
import { createMemoryBackend } from '../js/core/db.js';
import { createStore } from '../js/core/store.js';
import { SyncError, createSync } from '../js/core/sync.js';
import { BackupError, createBackup, parseBackup, restoreBackup } from '../js/core/backup.js';

const USER = 'user-1';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
async function rejects(p, pred) { try { await p; } catch (e) { if (!pred || pred(e)) return e; throw new Error(`wrong error: ${e.code || e.message}`); } throw new Error('expected failure but it succeeded'); }

// ---------- a simulated server ----------
function createServer() {
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 0, 1) + (++tick) * 1000).toISOString();
  const s = { records: new Map(), history: new Map(), down: null, loseNextReply: false, rejectId: null, calls: { pull: 0, insert: 0, update: 0, get: 0, history: 0, list: 0 }, online: true };
  const guard = () => { if (s.down === 'offline') throw new SyncError('OFFLINE', 'offline'); if (s.down === 'auth') throw new SyncError('AUTH', 'expired'); };
  const reply = (v) => { if (s.loseNextReply) { s.loseNextReply = false; throw new SyncError('OFFLINE', 'reply lost'); } return v; };
  const copy = (v) => structuredClone(v);
  s.remoteFor = (userId) => ({
    async pull({ since, limit }) {
      s.calls.pull++; guard();
      return copy([...s.records.values()].filter((r) => r.user_id === userId && r.updated_at >= since).sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.id < b.id ? -1 : 1)).slice(0, limit));
    },
    async insert(row) {
      s.calls.insert++; guard();
      if (row.id === s.rejectId) throw Object.assign(new SyncError('SERVER', 'row refused'), { code: 'SERVER' });
      if (s.records.has(row.id)) return { ok: false };
      s.records.set(row.id, { ...copy(row), user_id: userId, updated_at: stamp() });
      return reply({ ok: true });
    },
    async update(id, expected, fields) {
      s.calls.update++; guard();
      const cur = s.records.get(id);
      if (!cur || cur.user_id !== userId || cur.version !== expected) return null;
      s.records.set(id, { ...cur, ...copy(fields), updated_at: stamp() });
      return reply(copy(s.records.get(id)));
    },
    async get(id) { s.calls.get++; guard(); const r = s.records.get(id); return r && r.user_id === userId ? copy(r) : null; },
    async pushHistory(rows) {
      s.calls.history++; guard();
      for (const r of rows) { const k = `${r.user_id}:${r.record_id}:${r.version}`; if (!s.history.has(k)) s.history.set(k, copy(r)); }
    },
    async listVersions() { s.calls.list++; guard(); return [...s.records.values()].filter((r) => r.user_id === userId).map((r) => ({ id: r.id, version: r.version })); },
  });
  return s;
}

let uid = 0;
function clockAt(iso) { let t = Date.parse(iso); const f = () => new Date(t).toISOString(); f.set = (v) => { t = Date.parse(v); }; return f; }
async function device(server, { dek, name, start = '2026-03-01T09:00:00.000Z', pageSize = 200, canRun = () => true } = {}) {
  const clock = clockAt(start), backend = createMemoryBackend();
  const timers = [];
  let sync = null;
  const store = createStore({ backend, getDek: () => dek, userId: USER, now: clock, uuid: () => `${name}-${++uid}`, onWrite: () => sync?.touch() });
  sync = createSync({ getStore: async () => store, remote: server.remoteFor(USER), pageSize, canRun, online: () => server.online,
    setTimer: (f) => { timers.push(f); return timers.length; }, clearTimer: () => {}, setRepeat: () => 0, clearRepeat: () => {} });
  return { store, sync, backend, clock, timers, name };
}
async function pair(opts = {}) { const server = createServer(), dek = await generateDek(); return { server, dek, A: await device(server, { dek, name: 'A', ...opts }), B: await device(server, { dek, name: 'B', ...opts }) }; }
const land = (name = 'Land') => ({ name, categoryId: 'land', openedOn: '2026-01-01', behaviors: { valueChange: 'appreciation' } });
const serverName = async (dek, server, id) => (await decryptRecord(dek, USER, id, server.records.get(id).payload)).name;
const historyNames = async (dek, server, id) => {
  const out = [];
  for (const h of [...server.history.values()].filter((x) => x.record_id === id).sort((a, b) => a.version - b.version)) out.push([h.version, (await decryptRecord(dek, USER, id, h.payload)).name]);
  return out;
};

// ---------- basics ----------
test('push: new records reach the server as ciphertext, and the device remembers what the server has', async () => {
  const { A, server } = await pair();
  const inv = await A.store.create('investment', land('Plot Lekki'));
  await A.store.create('entry', { investmentId: inv.id, date: '2026-01-01', kind: 'capital_in', amountKobo: 1000000 });
  const s = await A.sync.run();
  eq(s.state, 'synced'); eq(s.pending, 0); ok(s.lastSyncedAt, 'last synced time set');
  eq(server.records.size, 2);
  const row = server.records.get(inv.id); eq([row.version, row.user_id], [1, USER]);
  ok(!row.payload.includes('Lekki') && !JSON.stringify([...server.records.values()]).includes('capital_in'), 'server holds no plaintext');
  eq((await A.store.pending()).count, 0);
});
test('pull: a second device receives everything after unlocking, ready to read', async () => {
  const { A, B, server } = await pair();
  const inv = await A.store.create('investment', land('Plot Lekki'));
  await A.store.create('entry', { investmentId: inv.id, date: '2026-01-01', kind: 'capital_in', amountKobo: 1000000 });
  await A.sync.run(); await B.sync.run();
  eq((await B.store.list('investment')).map((r) => r.name), ['Plot Lekki']); eq((await B.store.list('entry')).length, 1);
  eq((await B.store.pending()).count, 0, 'pulled rows are not queued to be pushed back');
  const calls = server.calls.insert + server.calls.update; await B.sync.run(); eq(server.calls.insert + server.calls.update, calls, 'nothing to push');
});
test('edit: a change made on one device appears on the other, and the old version is kept in server history', async () => {
  const { A, B, server, dek } = await pair();
  const inv = await A.store.create('investment', land('Plot'));
  await A.sync.run(); await B.sync.run();
  await A.store.update(inv.id, { name: 'Plot (fenced)' }); await A.sync.run(); await B.sync.run();
  eq((await B.store.get(inv.id)).name, 'Plot (fenced)'); eq((await B.store.get(inv.id)).version, 2);
  eq(await historyNames(dek, server, inv.id), [[1, 'Plot']]);
});
test('several edits made offline arrive as one push, with every earlier version in history', async () => {
  const { A, server, dek } = await pair();
  const inv = await A.store.create('investment', land('v1'));
  await A.store.update(inv.id, { name: 'v2' }); await A.store.update(inv.id, { name: 'v3' });
  await A.sync.run();
  eq(server.records.get(inv.id).version, 3); eq(await serverName(dek, server, inv.id), 'v3');
  eq(await historyNames(dek, server, inv.id), [[1, 'v1'], [2, 'v2']]);
});
test('delete and restore travel too', async () => {
  const { A, B } = await pair();
  const inv = await A.store.create('investment', land());
  await A.sync.run(); await B.sync.run();
  await A.store.remove(inv.id); await A.sync.run(); await B.sync.run();
  eq(await B.store.get(inv.id), null); ok((await B.store.get(inv.id, { includeDeleted: true })).deletedAt, 'deleted on B');
  await A.store.restore(inv.id); await A.sync.run(); await B.sync.run();
  eq((await B.store.get(inv.id)).name, 'Land');
});
test('pulling many records works in pages', async () => {
  const { A, B } = await pair({ pageSize: 2 });
  for (let i = 0; i < 7; i++) await A.store.create('partner', { name: `P${i}` });
  await A.sync.run(); await B.sync.run();
  eq((await B.store.list('partner')).length, 7);
});

// ---------- conflicts ----------
test('conflict: the later change wins, and the other change is kept in history (nothing is lost)', async () => {
  const { A, B, server, dek } = await pair();
  const inv = await A.store.create('investment', land('Land'));
  await A.sync.run(); await B.sync.run();
  A.clock.set('2026-03-02T10:00:00.000Z'); await A.store.update(inv.id, { name: 'Land A' });
  B.clock.set('2026-03-02T11:00:00.000Z'); await B.store.update(inv.id, { name: 'Land B' });
  await A.sync.run(); await B.sync.run(); await A.sync.run();
  eq((await A.store.get(inv.id)).name, 'Land B'); eq((await B.store.get(inv.id)).name, 'Land B');
  eq(await serverName(dek, server, inv.id), 'Land B'); eq(server.records.get(inv.id).version, 3);
  eq(await historyNames(dek, server, inv.id), [[1, 'Land'], [2, 'Land A']]);
  eq((await A.store.pending()).count + (await B.store.pending()).count, 0, 'both devices fully backed up');
});
test('conflict: when the device that syncs LAST made the older change, the newer change still wins', async () => {
  const { A, B, server, dek } = await pair();
  const inv = await A.store.create('investment', land('Land'));
  await A.sync.run(); await B.sync.run();
  A.clock.set('2026-03-02T11:00:00.000Z'); await A.store.update(inv.id, { name: 'Land A' });
  B.clock.set('2026-03-02T10:00:00.000Z'); await B.store.update(inv.id, { name: 'Land B' });
  await A.sync.run(); await B.sync.run(); await A.sync.run();
  eq((await A.store.get(inv.id)).name, 'Land A'); eq((await B.store.get(inv.id)).name, 'Land A'); eq(await serverName(dek, server, inv.id), 'Land A');
  const names = (await historyNames(dek, server, inv.id)).map((x) => x[1]);
  ok(names.includes('Land B') && names.includes('Land A') && names.includes('Land'), `history keeps every state: ${names}`);
});
test('conflict: several offline edits on one device are all kept, in order', async () => {
  const { A, B, server, dek } = await pair();
  const inv = await A.store.create('investment', land('base'));
  await A.sync.run(); await B.sync.run();
  A.clock.set('2026-03-02T10:00:00.000Z'); await A.store.update(inv.id, { name: 'A1' });
  B.clock.set('2026-03-02T10:30:00.000Z'); await B.store.update(inv.id, { name: 'B1' });
  B.clock.set('2026-03-02T10:40:00.000Z'); await B.store.update(inv.id, { name: 'B2' });
  B.clock.set('2026-03-02T10:50:00.000Z'); await B.store.update(inv.id, { name: 'B3' });
  await A.sync.run(); await B.sync.run(); await A.sync.run();
  eq(await serverName(dek, server, inv.id), 'B3'); eq((await A.store.get(inv.id)).name, 'B3');
  const names = (await historyNames(dek, server, inv.id)).map((x) => x[1]);
  for (const n of ['base', 'A1', 'B1', 'B2']) ok(names.includes(n), `history has ${n}: ${names}`);
  eq(new Set((await historyNames(dek, server, inv.id)).map((x) => x[0])).size, names.length, 'no two history rows share a version');
});
test('conflict: a delete on one device against an edit on another keeps the newer action, and the edit stays in history', async () => {
  const { A, B, server, dek } = await pair();
  const inv = await A.store.create('investment', land('Land'));
  await A.sync.run(); await B.sync.run();
  A.clock.set('2026-03-02T10:00:00.000Z'); await A.store.update(inv.id, { name: 'Edited' });
  B.clock.set('2026-03-02T12:00:00.000Z'); await B.store.remove(inv.id);
  await A.sync.run(); await B.sync.run(); await A.sync.run();
  eq(await A.store.get(inv.id), null, 'the later delete won on A'); eq(await B.store.get(inv.id), null);
  ok((await historyNames(dek, server, inv.id)).some((x) => x[1] === 'Edited'), 'the other device\'s edit is kept in history');
});

// ---------- interruptions ----------
test('offline: nothing is lost, status says so, and the next cycle backs everything up', async () => {
  const { A, server } = await pair();
  server.down = 'offline';
  const inv = await A.store.create('investment', land());
  let s = await A.sync.run(); eq(s.state, 'offline'); ok(s.pending >= 1, 'changes are waiting');
  server.down = null; s = await A.sync.run(); eq(s.state, 'synced'); eq(s.pending, 0); ok(server.records.has(inv.id), 'arrived');
});
test('offline by the browser flag: no server calls are made at all', async () => {
  const { A, server } = await pair(); server.online = false;
  await A.store.create('investment', land());
  const s = await A.sync.run(); eq(s.state, 'offline'); eq(server.calls.pull + server.calls.insert, 0);
});
test('expired sign-in is reported as such and recovers', async () => {
  const { A, server } = await pair(); server.down = 'auth';
  await A.store.create('investment', land());
  eq((await A.sync.run()).state, 'auth'); server.down = null; eq((await A.sync.run()).state, 'synced');
});
test('a lost reply (the server saved it, the device never heard) is recognised, not treated as a conflict or duplicated', async () => {
  const { A, server } = await pair();
  const inv = await A.store.create('investment', land('Plot'));
  server.loseNextReply = true; eq((await A.sync.run()).state, 'offline'); eq(server.records.get(inv.id).version, 1, 'the server did save it');
  const s = await A.sync.run(); eq(s.state, 'synced'); eq(s.pending, 0); eq(server.records.get(inv.id).version, 1, 'no duplicate or extra version');
  await A.store.update(inv.id, { name: 'Plot 2' }); server.loseNextReply = true; await A.sync.run();
  const s2 = await A.sync.run(); eq(s2.state, 'synced'); eq(s2.pending, 0); eq(server.records.get(inv.id).version, 2);
});
test('one record the server refuses does not stop the others, and is reported', async () => {
  const { A, server } = await pair();
  const bad = await A.store.create('partner', { name: 'Bad' }); const good = await A.store.create('partner', { name: 'Good' });
  server.rejectId = bad.id; const s = await A.sync.run();
  ok(server.records.has(good.id) && !server.records.has(bad.id), 'the good one arrived'); eq(s.failed.length, 1); ok(/could not be backed up/.test(s.error), s.error);
  server.rejectId = null; eq((await A.sync.run()).failed.length, 0); ok(server.records.has(bad.id), 'and the refused one goes through once the server accepts');
});
test('history is sent safely twice: the server never holds duplicates', async () => {
  const { A, server } = await pair();
  const inv = await A.store.create('investment', land('a')); await A.store.update(inv.id, { name: 'b' }); await A.sync.run();
  const n = server.history.size; eq(n, 1);
  const rows = await A.store.sync.dirtyHistory(); eq(rows.length, 0);
  await server.remoteFor(USER).pushHistory([{ record_id: inv.id, user_id: USER, version: 1, payload: 'x', saved_at: 'now' }]); eq(server.history.size, n, 'a repeat is ignored');
});
test('a row the server holds that this account cannot read never breaks syncing', async () => {
  const { A, B, server } = await pair();
  await A.store.create('partner', { name: 'Fine' });
  server.records.set('weird', { id: 'weird', user_id: USER, payload: 'AAAA', schema_version: 1, version: 1, created_at: 'x', updated_at: '2026-01-05T00:00:00.000Z', deleted_at: null });
  await A.sync.run(); const s = await B.sync.run();
  eq(s.state, 'synced'); eq((await B.store.list('partner')).map((p) => p.name), ['Fine']); eq(B.store.problems().length, 1);
});

// ---------- engine behaviour ----------
test('only one cycle runs at a time; a request during a cycle causes exactly one more', async () => {
  const { A, server } = await pair();
  await A.store.create('partner', { name: 'x' });
  const p1 = A.sync.run(), p2 = A.sync.run(), p3 = A.sync.run();
  await Promise.all([p1, p2, p3]); ok(server.calls.pull <= 2, `pulls: ${server.calls.pull}`);
});
test('does nothing while locked', async () => {
  const { A, server } = await pair({ canRun: () => false });
  await A.store.create('partner', { name: 'x' }); await A.sync.run(); eq(server.calls.pull + server.calls.insert, 0);
});
test('a change schedules a backup shortly after (debounced), only while started', async () => {
  const { A, server } = await pair();
  await A.store.create('partner', { name: 'before start' }); eq(A.timers.length, 0, 'not started, no timer');
  A.sync.start(); await new Promise((r) => setTimeout(r, 20)); const base = server.records.size;
  await A.store.create('partner', { name: 'one' }); await A.store.create('partner', { name: 'two' });
  ok(A.timers.length >= 1, 'a timer was set'); await A.timers[A.timers.length - 1](); await new Promise((r) => setTimeout(r, 20));
  eq(server.records.size, base + 2); A.sync.stop();
});
test('subscribers hear about status changes', async () => {
  const { A } = await pair(); const seen = []; A.sync.subscribe((s) => seen.push(s.state));
  await A.store.create('partner', { name: 'x' }); await A.sync.run(); ok(seen.includes('syncing') && seen[seen.length - 1] === 'synced', seen.join());
});
test('verify: finds what is not backed up yet, then confirms when it is', async () => {
  const { A, B } = await pair();
  await A.store.create('partner', { name: 'x' });
  let v = await A.sync.verify(); eq([v.local, v.server, v.notBackedUp], [1, 0, 1]);
  await A.sync.run(); v = await A.sync.verify(); eq([v.notBackedUp, v.historyPending], [0, 0]);
  v = await B.sync.verify(); eq([v.local, v.server, v.toDownload], [0, 1, 1]);
});

// ---------- backup and restore ----------
test('backup: a file made on one device restores on a fresh one, and the next sync adds nothing new to the server', async () => {
  const { A, server, dek } = await pair();
  const inv = await A.store.create('investment', land('Plot')); await A.store.update(inv.id, { name: 'Plot 2' });
  await A.store.create('entry', { investmentId: inv.id, date: '2026-01-01', kind: 'capital_in', amountKobo: 5000 });
  await A.sync.run();
  const { text, filename, records } = await createBackup(A.store, { userId: USER, now: () => '2026-03-05T08:00:00.000Z' });
  eq([filename, records], ['apex-backup-2026-03-05.json', 2]);
  ok(!text.includes('Plot') && !text.includes('capital_in'), 'the file holds only ciphertext');
  const C = await device(server, { dek, name: 'C' });
  const res = await restoreBackup(C.store, text, { userId: USER });
  eq([res.added, res.total], [2, 2]); eq((await C.store.get(inv.id)).name, 'Plot 2'); eq((await C.store.list('entry')).length, 1);
  const before = JSON.stringify([...server.records.values()].map((r) => [r.id, r.version]));
  const s = await C.sync.run(); eq(s.state, 'synced'); eq(s.pending, 0);
  eq(JSON.stringify([...server.records.values()].map((r) => [r.id, r.version])), before, 'server unchanged');
});
test('backup: restoring into a device that has newer work keeps the newer work', async () => {
  const { A } = await pair();
  const inv = await A.store.create('investment', land('old'));
  const file = (await createBackup(A.store, { userId: USER })).text;
  await A.store.update(inv.id, { name: 'newer' });
  const res = await restoreBackup(A.store, file, { userId: USER }); eq([res.added, res.updated, res.skipped], [0, 0, 1]);
  eq((await A.store.get(inv.id)).name, 'newer');
});
test('backup: after a total loss, restore then sync rebuilds the account without conflicts', async () => {
  const { A, server, dek } = await pair();
  const inv = await A.store.create('investment', land('Plot')); await A.sync.run();
  const file = (await createBackup(A.store, { userId: USER })).text;
  server.records.clear(); server.history.clear();           // the server lost everything
  const C = await device(server, { dek, name: 'C' }); await restoreBackup(C.store, file, { userId: USER });
  const s = await C.sync.run(); eq(s.state, 'synced'); eq(await serverName(dek, server, inv.id), 'Plot');
});
test('backup: the wrong account, other files and damaged files are refused, and nothing is restored', async () => {
  const { A, dek, server } = await pair();
  await A.store.create('partner', { name: 'x' });
  const good = (await createBackup(A.store, { userId: USER })).text;
  const C = await device(server, { dek, name: 'C' });
  await rejects(restoreBackup(C.store, good, { userId: 'someone-else' }), (e) => e instanceof BackupError && /different account/.test(e.message));
  await rejects(restoreBackup(C.store, 'not json', { userId: USER }), (e) => e instanceof BackupError);
  await rejects(restoreBackup(C.store, JSON.stringify({ hello: 1 }), { userId: USER }), (e) => /not an Apex backup/.test(e.message));
  const broken = JSON.parse(good); broken.records[0].version = 'one';
  await rejects(restoreBackup(C.store, JSON.stringify(broken), { userId: USER }), (e) => /damaged/.test(e.message));
  eq((await C.store.sync.allRows()).length, 0, 'nothing was restored');
  eq(parseBackup(good, { userId: USER }).records.length, 1);
});

export async function runSyncTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) { try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); } }
  log(`\n${passed} passed, ${failed} failed (sync and backup).`);
  return { passed, failed };
}
