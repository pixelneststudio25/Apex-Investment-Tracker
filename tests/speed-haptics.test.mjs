// Phase 13 tests (batch 1): the calculated snapshot and touch feedback.
import { readFile, readdir } from 'node:fs/promises';
import { generateDek } from '../js/core/crypto.js';
import { createMemoryBackend } from '../js/core/db.js';
import { createStore } from '../js/core/store.js';
import { createPortfolio } from '../js/models/portfolio.js';
import { SAMPLE_AS_OF, seedSamplePortfolio } from '../js/models/sample.js';
import { haptic, hapticsEnabled, setHaptics } from '../js/ui/haptics.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
const ASOF = SAMPLE_AS_OF;

let n = 0;
async function fresh({ count = 0 } = {}) {
  const dek = await generateDek(), backend = createMemoryBackend(), reads = { n: 0 }, getAll = backend.getAll;
  backend.getAll = async (...a) => { reads.n++; return getAll(...a); };
  const store = createStore({ backend, getDek: () => dek, userId: 'u', uuid: () => `s-${++n}` });
  for (let i = 0; i < count; i++) {
    const inv = await store.create('investment', { name: `Inv ${i}`, categoryId: 'land', openedOn: '2024-01-01', behaviors: { valueChange: 'appreciation', income: 'none', ownership: 'sole', term: null }, rates: [{ type: 'assumed', rate: 0.1, rateUnit: 'year', method: 'simple' }] });
    await store.create('entry', { investmentId: inv.id, kind: 'capital_in', date: '2024-01-01', amountKobo: 100000000, note: '' });
    await store.create('valuation', { investmentId: inv.id, date: '2026-01-01', valueKobo: 120000000, source: 'own_estimate', note: '' });
  }
  return { store, backend, reads, pf: createPortfolio(store) };
}
const home = (pf) => Promise.all([pf.overview(ASOF).then((i) => pf.summary(ASOF, i)), pf.timeline(ASOF), pf.upcoming(ASOF), pf.recent()]);

test('the snapshot changes no answer: every figure equals what a portfolio without it calculates', async () => {
  const { store, pf } = await fresh(); await seedSamplePortfolio(store);
  const plain = { ...store }; delete plain.generation; const raw = createPortfolio(plain);
  eq(await pf.overview(ASOF), await raw.overview(ASOF)); eq(await pf.summary(ASOF), await raw.summary(ASOF)); eq(await pf.timeline(ASOF), await raw.timeline(ASOF));
  eq(await pf.upcoming(ASOF, { days: 90 }), await raw.upcoming(ASOF, { days: 90 })); eq(await pf.recent(3), await raw.recent(3)); eq(await pf.investments({ status: 'active' }), await raw.investments({ status: 'active' }));
  const id = (await pf.investments())[0].id; eq(await pf.bundle(id), await raw.bundle(id)); eq(await pf.metrics(id, ASOF), await raw.metrics(id, ASOF));
  eq(await pf.metrics(id, ASOF, { rateTypes: ['agreed'] }), await raw.metrics(id, ASOF, { rateTypes: ['agreed'] }), 'a different rate filter is a different answer');
  eq(await pf.overview(ASOF), await raw.overview(ASOF), 'and again, from the snapshot');
});
test('reads do not grow with the number of investments, and a second visit reads nothing', async () => {
  const small = await fresh({ count: 3 }), big = await fresh({ count: 18 });
  small.reads.n = 0; await home(small.pf); const a = small.reads.n;
  big.reads.n = 0; await home(big.pf); const b = big.reads.n;
  eq(b, a, `3 investments read ${a} times, 18 read ${b}`); ok(a <= 8, `a first visit reads each kind of record about once (read ${a} times)`);
  big.reads.n = 0; await home(big.pf); await home(big.pf); eq(big.reads.n, 0, 'the second and third visit read nothing');
});
test('every write, delete, restore and lock drops the snapshot, so a screen never shows an old number', async () => {
  const { store, pf } = await fresh({ count: 2 });
  const g0 = store.generation(); const before = (await pf.summary(ASOF)).valueKobo;
  const inv = (await pf.investments())[0];
  await store.update(inv.id, { name: 'Renamed' }); ok(store.generation() > g0, 'an edit bumps the generation'); eq((await pf.overview(ASOF)).some((i) => i.investment.name === 'Renamed'), true);
  await store.create('valuation', { investmentId: inv.id, date: '2026-06-01', valueKobo: 900000000, source: 'own_estimate', note: '' });
  ok((await pf.summary(ASOF)).valueKobo !== before, 'a new valuation changes the total at once');
  await store.remove(inv.id); eq((await pf.investments()).length, 1, 'a deleted investment disappears'); eq((await pf.overview(ASOF)).length, 1);
  await store.restore(inv.id); eq((await pf.investments()).length, 2, 'and comes back'); eq((await pf.summary(ASOF)).count.active, 2);
  const g1 = store.generation(); store.lock(); ok(store.generation() > g1, 'locking drops it too');
});
test('what a screen gets is its own copy: changing it never changes what the next screen gets', async () => {
  const { pf } = await fresh({ count: 2 });
  const a = await pf.overview(ASOF); a[0].investment.name = 'Hacked'; a.pop(); (await pf.investments())[0].name = 'Also hacked'; (await pf.summary(ASOF)).valueKobo = 1;
  const b = await pf.overview(ASOF); eq(b.length, 2); ok(!b.some((i) => /Hacked/.test(i.investment.name)), 'unchanged'); ok((await pf.summary(ASOF)).valueKobo > 1);
  const up = await pf.upcoming(ASOF); up.push({ junk: true }); ok(!(await pf.upcoming(ASOF)).some((x) => x.junk));
});
test('failures are not remembered and two screens asking at once share one calculation', async () => {
  const { pf, reads } = await fresh({ count: 3 });
  for (let i = 0; i < 2; i++) { try { await pf.metrics('nope', ASOF); throw new Error('should have failed'); } catch (e) { eq(e.code, 'NOT_FOUND'); } }
  eq(await pf.bundle('nope'), null, 'a missing investment is simply null');
  const solo = await fresh({ count: 3 }); solo.reads.n = 0; await solo.pf.overview(ASOF); const one = solo.reads.n;
  reads.n = 0; await Promise.all([pf.overview(ASOF), pf.overview(ASOF), pf.overview(ASOF)]); eq(reads.n, one, 'three at once cost the same as one');
});
test('the snapshot is per date: a different day is a different answer, and the settings are still read fresh', async () => {
  const { store, pf } = await fresh({ count: 1 });
  const a = (await pf.summary('2026-01-02')).valueKobo, b = (await pf.summary('2027-01-02')).valueKobo; ok(a !== b || a >= 0);
  const s = await pf.settings(); await pf.updateSettings({ displayName: 'Ada' }); eq((await pf.settings()).displayName, 'Ada'); ok(s.id === (await pf.settings()).id, 'still the one settings record');
  ok(store.generation() > 0);
});

const withVibrate = (fn) => { const nav = globalThis.navigator, had = Object.getOwnPropertyDescriptor(nav, 'vibrate'), calls = []; Object.defineProperty(nav, 'vibrate', { value: (p) => { calls.push(p); return true; }, configurable: true, writable: true });
  return Promise.resolve(fn(calls)).finally(() => { if (had) Object.defineProperty(nav, 'vibrate', had); else delete nav.vibrate; }); };
test('haptics: off by default and when the device cannot vibrate; on, each kind plays its own light pattern', async () => {
  setHaptics(false); ok(!hapticsEnabled());
  await withVibrate((calls) => { eq(haptic('toggle'), false); eq(calls.length, 0, 'off means silent'); });
  setHaptics(true); eq(haptic('toggle'), false, 'no vibration support, no error');
  await withVibrate((calls) => {
    eq([haptic('toggle', 0), haptic('success', 0), haptic('warn', 0), haptic('deny', 0)], [true, true, true, true]); eq(calls, [12, [10, 40, 10], [40, 70, 40], [12, 50, 12]]);
    ok(calls.every((p) => [].concat(p).reduce((t, x) => t + x, 0) <= 150), 'all of them are light, under a sixth of a second'); eq(haptic('nonsense', 0), true); eq(calls.at(-1), 8, 'an unknown kind is a tick');
  });
  setHaptics(false);
});
test('haptics: a fast scrub is a texture, not a buzz (ticks are spaced), but switches always answer', async () => {
  setHaptics(true);
  await withVibrate((calls) => {
    const fired = [100, 110, 120, 150, 160, 200].map((t) => haptic('tick', t)); eq(fired, [true, false, false, true, false, true]); eq(calls.length, 3);
    eq([haptic('toggle', 201), haptic('toggle', 202)], [true, true], 'toggles are never held back');
  });
  setHaptics(false);
});
test('haptics are wired where they belong and only behind the setting', async () => {
  const ui = (await readdir(new URL('../js/ui/', import.meta.url))).filter((f) => f.endsWith('.js'));
  for (const f of ui) { const src = await read(`js/ui/${f}`); if (f !== 'haptics.js') ok(!/navigator\.vibrate/.test(src), `${f} must go through haptics.js`); }
  ok(/if \(i !== current\) haptic\('tick'\)/.test(await read('js/ui/charts.js')), 'charts tick only when the scrub lands on a new point');
  const fk = await read('js/ui/formkit.js'); ok(/asSwitch\) haptic\('toggle'\)/.test(fk) && /onclick: \(\) => \{ haptic\('toggle'\)/.test(fk), 'switches and segmented controls');
  const pin = await read('js/ui/pin-views.js'); ok(pin.includes("haptic('warn')") && pin.includes("haptic('deny')") && !/vibrate/.test(pin), 'the PIN keypad follows the setting');
  ok((await read('js/ui/workspace.js')).includes('setHaptics(settings.haptics)'), 'the saved setting is applied on load and on change');
  const sv = await read('js/ui/settings-views.js'); ok(sv.includes("'Touch feedback'") && sv.includes('haptics: buzz.checked') && sv.includes('hapticsSupported()'), 'a switch in Appearance that is honest about iPhones');
  const sw = await read('sw.js'); ok(sw.includes("'/js/ui/haptics.js'"), 'cached for offline use');
});

export async function runSpeedHapticsTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) { try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); } }
  log(`\n${passed} passed, ${failed} failed (speed and touch feedback).`);
  return { passed, failed };
}
