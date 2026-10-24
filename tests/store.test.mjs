// Data-layer tests (Phase 3): encrypted store, history, soft delete, sync bookkeeping, schemas, templates,
// the portfolio join to the calculation engine, and the vault. The real IndexedDB backend is tested too,
// wherever IndexedDB exists (the browser test page).
import { decryptRecord, encryptRecord, generateDek } from '../js/core/crypto.js';
import { createMemoryBackend, openIdbBackend } from '../js/core/db.js';
import { createStore, StoreError } from '../js/core/store.js';
import { createVault } from '../js/core/vault.js';
import { createPortfolio } from '../js/models/portfolio.js';
import { BUILT_IN_TEMPLATES, findTemplate } from '../js/models/templates.js';
import { ModelError, validate } from '../js/models/schemas.js';
import { formatNaira, formatPercent, scheduleEntries } from '../js/engine/index.js';

const N = (naira) => Math.round(naira * 100);
const USER = 'user-1';
const tests = [];
const test = (name, fn, opts = {}) => tests.push({ name, fn, ...opts });
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
async function rejects(p, code) {
  try { await p; } catch (e) { if (!code || e.code === code) return e; throw new Error(`wrong error: ${e.code || e.message} (wanted ${code})`); }
  throw new Error('expected failure but it succeeded');
}

// A clock that moves one minute per call, so timestamps are predictable and strictly increasing.
function clock() { let t = Date.UTC(2026, 0, 1); return () => new Date((t += 60000)).toISOString(); }
let idCounter = 0;
async function fresh({ dek = null } = {}) {
  const backend = createMemoryBackend();
  const state = { dek: dek || await generateDek() };
  const store = createStore({ backend, getDek: () => state.dek, userId: USER, now: clock(), uuid: () => `rec-${++idCounter}` });
  return { backend, state, store, portfolio: createPortfolio(store) };
}
const land = (extra = {}) => ({ name: 'Lekki Land ₦', categoryId: 'land', openedOn: '2026-01-01', behaviors: { valueChange: 'appreciation' }, notes: 'secret-note', ...extra });
const entry = (investmentId, over = {}) => ({ investmentId, date: '2026-01-01', kind: 'capital_in', amountKobo: N(10000000), ...over });

// ---------- storage backends ----------
async function backendContract(backend) {
  await backend.commit([{ store: 'records', put: { id: 'a', version: 1, dirty: 1, payload: 'x' } }, { store: 'history', put: { key: 'a:1', recordId: 'a', pushed: 0 } }]);
  eq((await backend.get('records', 'a')).payload, 'x');
  eq((await backend.getAll('records', 'dirty', 1)).length, 1);
  eq((await backend.getAll('records', 'dirty', 0)).length, 0);
  eq((await backend.getAll('history', 'recordId', 'a')).length, 1);
  await rejects(backend.commit([{ store: 'records', put: { id: 'a', version: 2, dirty: 1 } }, { store: 'meta', put: { key: 'k', value: 1 } }], { expect: { id: 'a', version: 7 } }), 'CONFLICT');
  eq((await backend.get('records', 'a')).version, 1, 'conflict wrote nothing');
  eq(await backend.get('meta', 'k'), undefined, 'conflict wrote nothing at all');
  await rejects(backend.commit([{ store: 'records', put: { id: 'b', version: 1, dirty: 1 } }], { expect: { id: 'b', version: 3 } }), 'CONFLICT');
  await backend.commit([{ store: 'records', put: { id: 'b', version: 1, dirty: 1 } }], { expect: { id: 'b', version: null } });
  await backend.commit([{ store: 'records', delete: 'b' }]);
  eq(await backend.get('records', 'b'), undefined);
  await backend.destroy();
}
test('backend contract: memory backend (get, index lookups, atomic and conditional commits)', () => backendContract(createMemoryBackend()));
test('backend contract: real IndexedDB, plus a full store round trip on it', async () => {
  const name = `apex-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await backendContract(openIdbBackend(name));
  const backend = openIdbBackend(`${name}-store`);
  const dek = await generateDek();
  const store = createStore({ backend, getDek: () => dek, userId: USER });
  const inv = await store.create('investment', land());
  await store.update(inv.id, { notes: 'edited' });
  await store.remove(inv.id);
  eq((await store.list('investment')).length, 0);
  const again = createStore({ backend, getDek: () => dek, userId: USER }); // a fresh store reads what the first one saved
  const all = await again.list('investment', { includeDeleted: true });
  eq(all.length, 1); eq(all[0].notes, 'edited'); eq(all[0].version, 3);
  eq((await again.history(inv.id)).length, 3);
  eq((await again.pending()).count, 3, 'one dirty record and two history rows');
  await store.destroy();
}, { needs: 'indexedDB' });

// ---------- encryption at rest ----------
test('records: round trip with ₦ and unicode; returned objects are copies', async () => {
  const { store } = await fresh();
  const inv = await store.create('investment', land());
  eq([inv.type, inv.version, inv.name, inv.deletedAt], ['investment', 1, 'Lekki Land ₦', null]);
  inv.name = 'tampered in memory';
  eq((await store.get(inv.id)).name, 'Lekki Land ₦', 'mutating a result does not change the store');
  eq((await store.list('investment')).length, 1);
});
test('at rest: no plaintext anywhere (not names, notes, amounts, types or kinds)', async () => {
  const { store, backend } = await fresh();
  const inv = await store.create('investment', land());
  await store.create('entry', entry(inv.id, { amountKobo: 1245000000 }));
  await store.update(inv.id, { notes: 'second secret' });
  const dump = JSON.stringify([await backend.getAll('records'), await backend.getAll('history')]);
  for (const leak of ['Lekki', 'secret', '1245000000', 'investment', 'capital_in', 'entry', 'appreciation']) ok(!dump.includes(leak), `leaked: ${leak}`);
  eq(Object.keys((await backend.getAll('records'))[0]).sort(), ['createdAt', 'deletedAt', 'dirty', 'id', 'payload', 'schemaVersion', 'updatedAt', 'userId', 'version']);
});
test('locked: every call refuses; the same key reads again; a different key cannot read and is reported', async () => {
  const { store, state, backend } = await fresh();
  const dekA = state.dek;
  const inv = await store.create('investment', land());
  const before = JSON.stringify(await backend.getAll('records'));
  state.dek = null;
  await rejects(store.list('investment'), 'LOCKED'); await rejects(store.get(inv.id), 'LOCKED'); await rejects(store.create('investment', land()), 'LOCKED');
  await rejects(store.pending(), 'LOCKED');
  state.dek = dekA; eq((await store.list('investment')).length, 1);
  state.dek = await generateDek(); // someone else's key: cached plaintext must NOT be served
  eq((await store.list('investment')).length, 0);
  eq(store.problems(), [{ id: inv.id, code: 'CORRUPT' }]);
  await rejects(store.get(inv.id), 'CORRUPT');
  eq(JSON.stringify(await backend.getAll('records')), before, 'ciphertext untouched');
});
test('tampering: swapped payloads and records from a newer app version are refused, not shown', async () => {
  const { store, backend, state } = await fresh();
  const a = await store.create('investment', land({ name: 'A' })), b = await store.create('investment', land({ name: 'B' }));
  const ra = await backend.get('records', a.id), rb = await backend.get('records', b.id);
  await backend.commit([{ store: 'records', put: { ...ra, payload: rb.payload } }, { store: 'records', put: { ...rb, payload: ra.payload } }]);
  store.lock();
  eq((await store.list('investment')).length, 0);
  eq(store.problems().map((p) => p.code), ['CORRUPT', 'CORRUPT']);
  const future = await encryptRecord(state.dek, USER, 'rec-future', { type: 'investment', schemaVersion: 99, createdAt: 'x', updatedAt: 'x', deletedAt: null });
  await backend.commit([{ store: 'records', put: { id: 'rec-future', userId: USER, payload: future, schemaVersion: 99, version: 1, createdAt: 'x', updatedAt: 'x', deletedAt: null, dirty: 0 } }]);
  await rejects(store.get('rec-future'), 'TOO_NEW');
});

// ---------- changing records ----------
test('update: new version, history keeps the old one, createdAt stays, no-op does not bump', async () => {
  const { store } = await fresh();
  const v1 = await store.create('investment', land());
  const v2 = await store.update(v1.id, { notes: 'changed' });
  eq([v2.version, v2.notes, v2.createdAt === v1.createdAt, v2.updatedAt > v1.updatedAt], [2, 'changed', true, true]);
  eq((await store.update(v1.id, { notes: 'changed' })).version, 2, 'identical change is a no-op');
  const v3 = await store.update(v1.id, (f) => { f.name = 'Renamed'; f.customFields.plotSize = '600 sqm'; });
  eq([v3.version, v3.name, v3.customFields.plotSize], [3, 'Renamed', '600 sqm']);
  await rejects(store.update(v1.id, { nonsense: 1 }), 'INVALID');
  await rejects(store.update(v1.id, { type: 'entry' }), 'INVALID');
  eq((await store.get(v1.id)).version, 3, 'failed updates change nothing');
});
test('history: every version is kept in order, the last one is current', async () => {
  const { store } = await fresh();
  const r = await store.create('investment', land({ notes: 'one' }));
  await store.update(r.id, { notes: 'two' }); await store.update(r.id, { notes: 'three' });
  const h = await store.history(r.id);
  eq(h.map((x) => [x.version, x.current, x.record.notes]), [[1, false, 'one'], [2, false, 'two'], [3, true, 'three']]);
  await rejects(store.history('nope'), 'NOT_FOUND');
});
test('soft delete: hidden from get and list, kept in history, restorable, idempotent', async () => {
  const { store } = await fresh();
  const r = await store.create('investment', land());
  const gone = await store.remove(r.id);
  ok(gone.deletedAt && gone.version === 2);
  eq(await store.get(r.id), null); eq((await store.list('investment')).length, 0);
  eq((await store.get(r.id, { includeDeleted: true })).id, r.id); eq((await store.list('investment', { includeDeleted: true })).length, 1);
  eq((await store.remove(r.id)).version, 2, 'second delete is a no-op');
  await rejects(store.update(r.id, { notes: 'x' }), 'DELETED');
  const back = await store.restore(r.id);
  eq([back.deletedAt, back.version], [null, 3]);
  eq((await store.restore(r.id)).version, 3, 'restoring a live record is a no-op');
  eq((await store.list('investment')).length, 1);
});
test('revert: copies an old version into a NEW version; history is never rewound; deleted state kept', async () => {
  const { store } = await fresh();
  const r = await store.create('investment', land({ notes: 'original' }));
  await store.update(r.id, { notes: 'mistake' });
  const fixed = await store.revertTo(r.id, 1);
  eq([fixed.version, fixed.notes], [3, 'original']);
  eq((await store.history(r.id)).map((x) => x.version), [1, 2, 3]);
  eq((await store.revertTo(r.id, 3)).version, 3, 'reverting to the current version does nothing');
  await rejects(store.revertTo(r.id, 42), 'NO_SUCH_VERSION');
  await store.remove(r.id);
  const still = await store.revertTo(r.id, 2);
  ok(still.deletedAt && still.notes === 'mistake', 'reverting content does not undelete');
});

// ---------- safe writes ----------
test('20 simultaneous updates: none lost, versions and history exact', async () => {
  const { store } = await fresh();
  const r = await store.create('investment', land());
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.update(r.id, { notes: `note ${i}` })));
  const h = await store.history(r.id);
  eq(h.length, 21); eq(h[20].version, 21); eq(new Set(h.map((x) => x.record?.notes)).size, 21);
});
test('failed storage write changes nothing (record and history are one atomic batch)', async () => {
  const { store, backend } = await fresh();
  const r = await store.create('investment', land({ notes: 'safe' }));
  backend.failNextCommit = true;
  await rejects(store.update(r.id, { notes: 'lost' }), 'COMMIT_FAILED');
  eq((await store.get(r.id)).notes, 'safe'); eq((await store.history(r.id)).length, 1); eq((await backend.getAll('history')).length, 0);
  eq((await store.update(r.id, { notes: 'later' })).version, 2, 'the store still works afterwards');
});
test('second tab saving first: the stale write is detected, re-read and applied on top (nothing overwritten)', async () => {
  const { store, backend, state } = await fresh();
  const r = await store.create('investment', land());
  const other = createStore({ backend, getDek: () => state.dek, userId: USER, now: clock() });
  let raced = false;
  const racing = { ...backend, get: async (s, k) => { const row = await backend.get(s, k); if (!raced && s === 'records') { raced = true; await other.update(r.id, { notes: 'from the other tab' }); } return row; } };
  const mine = createStore({ backend: racing, getDek: () => state.dek, userId: USER, now: clock() });
  const saved = await mine.update(r.id, (f) => { f.name = 'my rename'; });
  eq([saved.version, saved.name, saved.notes], [3, 'my rename', 'from the other tab']);
  eq((await store.history(r.id)).length, 3);
});
test('creating with an id that exists is refused', async () => {
  const { store } = await fresh();
  const r = await store.create('investment', land());
  await rejects(store.create('investment', land(), { id: r.id }), 'EXISTS');
});

// ---------- sync bookkeeping (used by Phase 6) ----------
test('pending/markPushed: new and edited rows are queued; an edit made during a push stays queued', async () => {
  const { store } = await fresh();
  const r = await store.create('investment', land());
  let p = await store.pending();
  eq([p.records.length, p.history.length, p.count], [1, 0, 1]);
  const snapshot = p.records[0];
  await store.update(r.id, { notes: 'edited while pushing' });
  await store.markPushed({ records: [{ id: snapshot.id, version: snapshot.version }] }); // pushed version 1, but the record is at 2
  p = await store.pending();
  eq([p.records.length, p.history.length], [1, 1], 'record is still dirty; the old version waits in history');
  await store.markPushed({ records: p.records.map((x) => ({ id: x.id, version: x.version })), history: p.history.map((h) => h.key) });
  eq((await store.pending()).count, 0);
  await store.meta.set('lastPull', '2026-01-02T00:00:00Z'); eq(await store.meta.get('lastPull'), '2026-01-02T00:00:00Z');
});

// ---------- schemas ----------
test('validation: money is whole kobo, dates are real, enums and unknown fields are refused', async () => {
  const bad = (type, data, field) => { try { validate(type, data); } catch (e) { if (e instanceof ModelError && (!field || e.field === field)) return; throw new Error(`wrong error for ${type}: ${e.field || e.message}`); } throw new Error(`accepted bad ${type}: ${JSON.stringify(data)}`); };
  const e = entry('i1');
  bad('entry', { ...e, amountKobo: 1.5 }, 'amountKobo'); bad('entry', { ...e, amountKobo: 0 }, 'amountKobo'); bad('entry', { ...e, amountKobo: -5 }, 'amountKobo');
  bad('entry', { ...e, amountKobo: '100' }, 'amountKobo'); bad('entry', { ...e, date: '2026-02-30' }, 'date'); bad('entry', { ...e, date: '0206-01-01' }, 'date');
  bad('entry', { ...e, kind: 'gift' }, 'kind'); bad('entry', { ...e, extra: 1 }, 'extra'); bad('entry', { date: '2026-01-01', kind: 'cost', amountKobo: 5 }, 'investmentId');
  bad('valuation', { investmentId: 'i1', date: '2026-01-01', valueKobo: -1 }, 'valueKobo');
  bad('ownership', { investmentId: 'i1', partnerId: 'me', contributionKobo: 0, percentage: 10001 }, 'percentage');
  bad('ownership', { investmentId: 'i1', partnerId: 'me', contributionKobo: 0, percentage: 5000, effectiveFrom: '2026-02-01', effectiveTo: '2026-01-01' }, 'effectiveTo');
  bad('schedule', { investmentId: 'i1', amountKobo: 5, frequency: 'custom', startDate: '2026-01-01' }, 'everyDays');
  bad('schedule', { investmentId: 'i1', amountKobo: 5, frequency: 'monthly', everyDays: 3, startDate: '2026-01-01' }, 'everyDays');
  bad('schedule', { investmentId: 'i1', amountKobo: 5, frequency: 'monthly', startDate: '2026-02-01', endDate: '2026-01-01' }, 'endDate');
  bad('investment', land({ status: 'active', closedOn: '2026-05-01' }), 'closedOn');
  bad('investment', land({ status: 'closed', closedOn: '2025-05-01' }), 'closedOn');
  bad('investment', land({ rates: [{ type: 'assumed', rate: 0.1 }], behaviors: { valueChange: 'manualOnly' } }), 'rates');
  bad('investment', land({ rates: [{ type: 'assumed', rate: 0.1, method: 'simple', compoundsPerYear: 4 }] }), 'rates[0].compoundsPerYear');
  bad('investment', land({ rates: [{ type: 'magic', rate: 0.1 }] }), 'rates[0].type');
  bad('investment', land({ rates: [{ type: 'assumed', rate: 'ten' }] }), 'rates[0].rate');
  bad('investment', land({ customFields: { 'Bad Key': 'x' } }), 'customFields.Bad Key');
  bad('nothing', {}, 'type'); bad('entry', null); bad('entry', [1]);
});
test('validation: overlapping rates are refused at save, not discovered later', async () => {
  const rates = [{ type: 'assumed', rate: 0.1, effectiveFrom: '2026-01-01', effectiveTo: '2027-01-01' }, { type: 'agreed', rate: 0.2, effectiveFrom: '2026-06-01' }];
  try { validate('investment', land({ rates })); } catch (e) { eq(e.field, 'rates[1]'); }
  validate('investment', land({ rates: [rates[0], { ...rates[1], effectiveFrom: '2027-01-01' }] })); // back to back is fine
});
test('validation: strings are trimmed, defaults filled, schedules tidied', async () => {
  const v = validate('investment', land({ name: '  Plot 7  ' }));
  eq([v.name, v.status, v.closedOn, v.rates, v.customFields, v.coverImageRef, v.behaviors.income, v.behaviors.term], ['Plot 7', 'active', null, [], {}, null, 'none', null]);
  const s = validate('schedule', { investmentId: 'i1', amountKobo: 5, frequency: 'monthly', startDate: '2026-01-01', skippedDates: ['2026-03-01', '2026-02-01', '2026-03-01'], adjustments: [{ from: '2026-06-01', amountKobo: 9 }, { from: '2026-04-01', amountKobo: 7 }] });
  eq(s.skippedDates, ['2026-02-01', '2026-03-01']); eq(s.adjustments.map((a) => a.from), ['2026-04-01', '2026-06-01']);
  eq(validate('settings', {}).lockTimeoutMin, 2); eq(validate('settings', {}).defaultHorizons, ['1M', '6M', '1Y', '5Y']);
});
test('templates: 16 built-ins, unique ids, every preset passes the same validation as user data', async () => {
  eq(BUILT_IN_TEMPLATES.length, 16);
  eq(new Set(BUILT_IN_TEMPLATES.map((t) => t.id)).size, 16);
  for (const t of BUILT_IN_TEMPLATES) {
    validate('categoryTemplate', { name: t.name, icon: t.icon, defaultBehaviors: t.defaultBehaviors, customFieldDefs: t.customFieldDefs });
    eq(new Set(t.customFieldDefs.map((f) => f.key)).size, t.customFieldDefs.length, `${t.id} has duplicate field keys`);
  }
  eq(findTemplate('vehicle').defaultBehaviors.valueChange, 'depreciation');
  eq(findTemplate('land').defaultBehaviors.valueChange, 'appreciation');
  eq(findTemplate('nope', [{ id: 'mine', name: 'Mine' }]), null); eq(findTemplate('mine', [{ id: 'mine', name: 'Mine' }]).name, 'Mine');
});

// ---------- store + engine together ----------
test('portfolio: the car golden case, stored encrypted then calculated, matches the plan (₦3,400,000 value, ₦600,000 gain, 15.00%)', async () => {
  const { store, portfolio } = await fresh();
  const car = await store.create('investment', { name: 'Toyota Camry', categoryId: 'vehicle', openedOn: '2026-01-01',
    behaviors: { valueChange: 'depreciation', income: 'schedule' },
    rates: [{ type: 'assumed', rate: -0.15, rateUnit: 'year', method: 'compound', compoundsPerYear: 1, effectiveFrom: '2026-01-01' }] });
  await store.create('entry', entry(car.id, { amountKobo: N(4000000) }));
  const sched = await store.create('schedule', { investmentId: car.id, amountKobo: N(100000), frequency: 'monthly', startDate: '2026-02-01', label: 'Rent' });
  for (const e of scheduleEntries(sched, '2027-01-01')) await store.create('entry', { investmentId: car.id, date: e.date, kind: 'income', amountKobo: e.amountKobo, linkedScheduleId: sched.id });
  const { metrics } = await portfolio.metrics(car.id, '2027-01-01');
  eq([formatNaira(metrics.valueKobo), formatNaira(metrics.incomeKobo), formatNaira(metrics.netGainKobo), formatPercent(metrics.roi)], ['₦3,400,000.00', '₦1,200,000.00', '₦600,000.00', '15.00%']);
});
test('portfolio: shared land splits 50/30/20 to the kobo; ownership that does not total 100% is reported', async () => {
  const { store, portfolio } = await fresh();
  const a = await store.create('partner', { name: 'Ade' }), b = await store.create('partner', { name: 'Bola' });
  const inv = await store.create('investment', land({ behaviors: { valueChange: 'appreciation', ownership: 'shared' } }));
  await store.create('entry', entry(inv.id, { amountKobo: N(12000000) }));
  await store.create('valuation', { investmentId: inv.id, date: '2026-12-31', valueKobo: N(14000001) + 7 });
  const rows = [['me', 5000, 6000000], [a.id, 3000, 3600000], [b.id, 2000, 2400000]];
  for (const [partnerId, percentage, c] of rows.slice(0, 2)) await store.create('ownership', { investmentId: inv.id, partnerId, percentage, contributionKobo: N(c) });
  await rejects(portfolio.metrics(inv.id, '2026-12-31'), 'OWNERSHIP_TOTAL');
  await store.create('ownership', { investmentId: inv.id, partnerId: b.id, percentage: 2000, contributionKobo: N(2400000) });
  const r = await portfolio.metrics(inv.id, '2026-12-31');
  eq(r.partners.partners.reduce((t, p) => t + p.valueShareKobo, 0), r.metrics.totalValueKobo);
  eq(r.partners.partners.reduce((t, p) => t + p.netGainKobo, 0), r.metrics.netGainKobo);
});
test('portfolio: a deleted investment hides everything that belongs to it; restoring brings it all back unchanged', async () => {
  const { store, portfolio } = await fresh();
  const inv = await store.create('investment', land());
  await store.create('entry', entry(inv.id)); await store.create('valuation', { investmentId: inv.id, date: '2026-06-01', valueKobo: N(11000000) });
  const before = JSON.stringify((await portfolio.metrics(inv.id, '2026-12-31')).metrics);
  const versionsBefore = (await store.list('entry'))[0].version;
  await store.remove(inv.id);
  eq(await portfolio.bundle(inv.id), null); eq((await portfolio.investments()).length, 0);
  eq((await portfolio.summary('2026-12-31')).count, { active: 0, closed: 0 });
  await rejects(portfolio.metrics(inv.id, '2026-12-31'), 'NOT_FOUND');
  eq((await store.list('entry'))[0].version, versionsBefore, 'child records were not rewritten');
  await store.restore(inv.id);
  eq(JSON.stringify((await portfolio.metrics(inv.id, '2026-12-31')).metrics), before);
});
test('portfolio summary: totals add up; one broken investment is reported, never blocks the rest', async () => {
  const { store, portfolio, backend, state } = await fresh();
  const a = await store.create('investment', land({ name: 'A' }));
  await store.create('entry', entry(a.id, { amountKobo: N(10000000) })); await store.create('valuation', { investmentId: a.id, date: '2026-12-31', valueKobo: N(12000000) });
  const b = await store.create('investment', land({ name: 'B', closedOn: '2026-06-01', status: 'closed' }));
  await store.create('entry', entry(b.id, { amountKobo: N(5000000) })); await store.create('entry', entry(b.id, { date: '2026-06-01', kind: 'proceeds', amountKobo: N(6000000) }));
  let s = await portfolio.summary('2026-12-31');
  eq([s.investedKobo, s.valueKobo, s.proceedsKobo, s.netGainKobo], [N(15000000), N(12000000), N(6000000), N(3000000)]);
  eq(s.count, { active: 1, closed: 1 }); eq(s.errors, []);
  eq(formatPercent(s.roi), '20.00%');
  // Old or hand-edited data can break a rule the validator now enforces (two rates on the same days). Write one directly.
  const c = await store.create('investment', land({ name: 'C' }));
  await store.create('entry', entry(c.id, { amountKobo: N(1000000) }));
  const row = await backend.get('records', c.id);
  const broken = { ...(await decryptRecord(state.dek, USER, c.id, row.payload)), rates: [{ type: 'assumed', rate: 0.1 }, { type: 'agreed', rate: 0.2 }] };
  await backend.commit([{ store: 'records', put: { ...row, version: row.version + 1, payload: await encryptRecord(state.dek, USER, c.id, broken) } }]);
  s = await portfolio.summary('2026-12-31');
  eq(s.errors.map((e) => [e.investmentId, e.code]), [[c.id, 'RATE_OVERLAP']], 'the broken one is named');
  eq([s.investedKobo, s.netGainKobo, s.count], [N(15000000), N(3000000), { active: 1, closed: 1 }], 'totals ignore it');
});
test('settings: created once with defaults, edits persist, the newest wins if two exist', async () => {
  const { store, portfolio } = await fresh();
  const s1 = await portfolio.settings(), s2 = await portfolio.settings();
  eq([s1.id === s2.id, s1.displayName, s1.theme], [true, '', 'system']);
  eq((await portfolio.updateSettings({ displayName: 'Tunde', portfolioName: 'Tunde Holdings' })).displayName, 'Tunde');
  const dup = await store.create('settings', { displayName: 'Newer' });
  eq((await portfolio.settings()).id, dup.id);
});

// ---------- vault ----------
test('vault: one store per account, refuses while signed out, switches accounts, wipes one account only', async () => {
  const dek = await generateDek(); const auth = { state: { userId: null, dek: null } };
  const backends = new Map();
  const vault = createVault({ auth, openBackend: async (name) => { if (!backends.has(name)) backends.set(name, createMemoryBackend()); return backends.get(name); }, uuid: () => `v-${++idCounter}` });
  await rejects(vault.store(), 'LOCKED');
  auth.state = { userId: 'u1', dek };
  const s1 = await vault.store(); eq(await vault.store(), s1);
  await s1.create('investment', land());
  auth.state.dek = null; await rejects(s1.list('investment'), 'LOCKED'); // locking the app locks the store
  auth.state = { userId: 'u2', dek };
  const s2 = await vault.store(); ok(s2 !== s1); eq((await s2.list('investment')).length, 0, 'accounts never share data');
  eq([...backends.keys()].sort(), ['apex-data-u1', 'apex-data-u2']);
  auth.state = { userId: 'u1', dek };
  await vault.wipe();
  eq((await backends.get('apex-data-u1').getAll('records')).length, 0);
  eq((await (await vault.store()).list('investment')).length, 0, 'the wiped account starts empty and the vault still works');
});

export async function runStoreTests(log = console.log) {
  let passed = 0, failed = 0, skipped = 0;
  for (const t of tests) {
    if (t.needs && !globalThis[t.needs]) { skipped++; log(`SKIP  ${t.name}  (no ${t.needs} here)`); continue; }
    try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); }
  }
  log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''} (data layer).`);
  return { passed, failed };
}
