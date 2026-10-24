// Simulation tests: a realistic sample portfolio is stored encrypted, read back, and calculated by the app.
// The expected figures were produced by a SEPARATE calculation (an independent Python script using exact
// decimals and its own XIRR), not by this code, so a shared misunderstanding cannot hide in both.
import { generateDek } from '../js/core/crypto.js';
import { createMemoryBackend } from '../js/core/db.js';
import { createStore } from '../js/core/store.js';
import { createPortfolio } from '../js/models/portfolio.js';
import { SAMPLE_AS_OF, seedSamplePortfolio } from '../js/models/sample.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m || 'not near'}: got ${a}, expected ${b} (tolerance ${tol})`); };

// Expected values (kobo) from the independent script, as of 2026-10-23.
const EXPECT = {
  land: { invested: 1800000000, costs: 125000000, income: 0, value: 2950000000, net: 1025000000, roi: 0.5324675324675324 },
  flat: { invested: 4200000000, costs: 380000000, income: 1560000000, value: 5800000000, net: 2780000000, roi: 0.6069868995633187, xirr: 0.13265183273462522 },
  car: { invested: 400000000, costs: 18000000, income: 180000000, value: 302293282, net: 64293282, roi: 0.15381167942583732, xirr: 0.11064950706138565, days: 629 },
  bill: { invested: 500000000, proceeds: 592246575, net: 92246575, roi: 0.18449315, xirr: 0.18504424632687078 },
  venture: { invested: 1200000000, income: 240000000, value: 1560000000, net: 600000000, roi: 0.5,
    valueShare: [780000000, 468000000, 312000000], incomeShare: [120000000, 72000000, 48000000], netShare: [300000000, 180000000, 120000000], mePosition: 300000000 },
  total: { invested: 8100000000, costs: 523000000, income: 1980000000, value: 10612293282, proceeds: 592246575, net: 4561539857 },
};

async function seeded() {
  const dek = await generateDek();
  const store = createStore({ backend: createMemoryBackend(), getDek: () => dek, userId: 'sim-user' });
  const portfolio = createPortfolio(store);
  const ids = await seedSamplePortfolio(store);
  const byName = {}; for (const i of await portfolio.investments()) byName[i.name.split(/[ ,]/)[0] + (i.name.includes('treasury') ? 'bill' : '')] = i;
  const get = async (key) => portfolio.metrics(byName[key].id, SAMPLE_AS_OF);
  return { store, portfolio, ids, byName, get };
}

test('sample portfolio: 5 investments and 2 partners are created with no validation errors', async () => {
  const { portfolio, ids, store } = await seeded();
  eq((await portfolio.investments()).length, 5); eq(ids.investments.length, 5); eq(ids.partners.length, 2);
  // land 3, flat 1+1+4 rent+4 service+0, car 1+18+1, bill 2, venture 1+2 = 3+10+20+2+3
  eq((await store.list('entry')).length, 38, 'entry count');
});
test('land: bought, two costs, agent valuation beats the assumed growth rate', async () => {
  const { get } = await seeded(); const { metrics: m } = await get('Plot');
  const e = EXPECT.land;
  eq([m.investedKobo, m.costsKobo, m.incomeKobo, m.valueKobo, m.netGainKobo, m.valueSource], [e.invested, e.costs, e.income, e.value, e.net, 'valuation']);
  near(m.roi, e.roi, 1e-12);
});
test('rental flat: rent with an increase, yearly service charge, comparable-sale valuation (net gain and XIRR)', async () => {
  const { get } = await seeded(); const { metrics: m } = await get('3-bedroom'); const e = EXPECT.flat;
  eq([m.investedKobo, m.costsKobo, m.incomeKobo, m.valueKobo, m.netGainKobo], [e.invested, e.costs, e.income, e.value, e.net]);
  near(m.roi, e.roi, 1e-12); eq(m.annualized.method, 'xirr'); near(m.annualized.rate, e.xirr, 1e-6, 'XIRR vs independent bisection');
});
test('car: 18 rent payments (two months unpaid), value from 15% yearly depreciation over 629 days', async () => {
  const { get, store, byName } = await seeded(); const { metrics: m } = await get('Toyota'); const e = EXPECT.car;
  eq([m.investedKobo, m.costsKobo, m.incomeKobo, m.valueKobo, m.netGainKobo, m.valueSource, m.daysHeld], [e.invested, e.costs, e.income, e.value, e.net, 'assumed', e.days]);
  near(m.roi, e.roi, 1e-12); near(m.annualized.rate, e.xirr, 1e-6);
  eq((await store.list('entry')).filter((x) => x.investmentId === byName.Toyota.id && x.kind === 'income').length, 18);
});
test('treasury bill: closed, realized figures from the proceeds', async () => {
  const { get } = await seeded(); const { metrics: m } = await get('FGNbill'); const e = EXPECT.bill;
  eq([m.basis, m.investedKobo, m.proceedsKobo, m.netGainKobo, m.currentValueKobo], ['realized', e.invested, e.proceeds, e.net, e.proceeds]);
  near(m.roi, e.roi, 1e-12); near(m.annualized.rate, e.xirr, 1e-6);
});
test('partnership: 50/30/20 shares match the independent split to the kobo, and my own position', async () => {
  const { get } = await seeded(); const r = await get('Logistics'); const e = EXPECT.venture; const m = r.metrics;
  eq([m.investedKobo, m.incomeKobo, m.valueKobo, m.netGainKobo], [e.invested, e.income, e.value, e.net]); near(m.roi, e.roi, 1e-12);
  const p = r.partners.partners;
  eq(p.map((x) => x.valueShareKobo), e.valueShare); eq(p.map((x) => x.incomeShareKobo), e.incomeShare); eq(p.map((x) => x.netGainKobo), e.netShare);
  eq(p[0].partnerId, 'me'); eq(p[0].netPositionKobo, e.mePosition);
});
test('portfolio totals: the dashboard figures equal the independent totals, with no errors', async () => {
  const { portfolio } = await seeded(); const s = await portfolio.summary(SAMPLE_AS_OF); const e = EXPECT.total;
  eq([s.investedKobo, s.costsKobo, s.incomeKobo, s.valueKobo, s.proceedsKobo, s.netGainKobo], [e.invested, e.costs, e.income, e.value, e.proceeds, e.net]);
  eq(s.count, { active: 4, closed: 1 }); eq(s.errors, []);
  near(s.roi, e.net / (e.invested + e.costs), 1e-12);
});
test('as-of dates: the same portfolio a year earlier has less income and no closed investments yet', async () => {
  const { portfolio } = await seeded(); const early = await portfolio.summary('2025-10-23');
  const now = await portfolio.summary(SAMPLE_AS_OF);
  if (!(early.incomeKobo < now.incomeKobo && early.investedKobo <= now.investedKobo)) throw new Error('earlier totals should be smaller');
  eq(early.count.closed, 0);
});
test('sample removal: deleting only the sample investments leaves real records untouched and restorable', async () => {
  const { portfolio, store, ids } = await seeded();
  const real = await store.create('investment', { name: 'My real plot', categoryId: 'land', openedOn: '2026-01-01', behaviors: { valueChange: 'appreciation' } });
  for (const id of ids.investments) await store.remove(id);
  for (const id of ids.partners) await store.remove(id);
  eq((await portfolio.investments()).map((i) => i.name), ['My real plot']);
  eq((await store.list('partner')).length, 0);
  for (const id of ids.investments) await store.restore(id);
  eq((await portfolio.investments()).length, 6); eq(real.version, 1);
});

test('timeline: ends exactly on the summary figures; a maturing bill never makes its own value dip', async () => {
  const { portfolio, byName } = await seeded(); const t = await portfolio.timeline(SAMPLE_AS_OF); const s = await portfolio.summary(SAMPLE_AS_OF);
  const last = t[t.length - 1];
  eq(last.date, SAMPLE_AS_OF); eq(last.valueKobo, s.totalValueKobo); eq(last.putInKobo, s.investedKobo + s.costsKobo);
  eq(t[0].date, '2022-08-31'); eq(t[0].valueKobo > 0, true);
  eq(t.every((p, i) => i === 0 || p.date > t[i - 1].date), true);
  // The bill: accrued interest rises right up to maturity, then the cash received holds the same value.
  const seen = []; for (const d of ['2026-05-01', '2026-05-30', '2026-05-31', '2026-06-30', SAMPLE_AS_OF]) seen.push((await portfolio.metrics(byName.FGNbill.id, d)).metrics.totalValueKobo);
  eq(seen.every((v, i) => i === 0 || v >= seen[i - 1]), true, 'bill value never falls'); eq(seen[2], 592246575); eq(seen[4], 592246575);
});
test('upcoming: next car rent and the reminders, soonest first; recorded items never repeat', async () => {
  const { portfolio } = await seeded(); const u = await portfolio.upcoming(SAMPLE_AS_OF, { days: 45 });
  eq(u.map((x) => [x.date, x.kind, x.title]), [['2026-11-01', 'income', 'Monthly rent'], ['2026-11-15', 'reminder', 'Service charge invoice due'], ['2026-12-01', 'income', 'Monthly rent'], ['2026-12-01', 'reminder', 'Ask the agent for an updated valuation']]);
  eq(u[0].amountKobo, 10000000);
  eq((await portfolio.upcoming(SAMPLE_AS_OF, { days: 1 })).length, 0);
});
test('recent: newest entries first, only from live investments', async () => {
  const { portfolio, ids, store } = await seeded(); const r = await portfolio.recent(3);
  eq(r.map((x) => x.date), ['2026-10-01', '2026-09-01', '2026-09-01']); eq(r[0].investmentName, 'Toyota Camry 2019');
  for (const id of ids.investments) await store.remove(id);
  eq((await portfolio.recent(3)).length, 0);
});

export async function runScenarioTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) { try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); } }
  log(`\n${passed} passed, ${failed} failed (simulation).`);
  return { passed, failed };
}
