// Phase 12-i tests: the Outlook engine. Expected figures come from hand-worked BigInt or fraction arithmetic,
// never from the code under test.
import { generateDek } from '../js/core/crypto.js';
import { createMemoryBackend } from '../js/core/db.js';
import { createStore } from '../js/core/store.js';
import { createPortfolio } from '../js/models/portfolio.js';
import { findTemplate } from '../js/models/templates.js';
import { applyTemplate, buildPlan, newDraft, savePlan } from '../js/models/wizard.js';
import { InputError } from '../js/models/inputs.js';
import { SAMPLE_AS_OF, seedSamplePortfolio } from '../js/models/sample.js';
import { blankScenario, buildScenario } from '../js/models/projections.js';
import { loadReport } from '../js/models/export.js';
import { MAX_OUTLOOK_YEARS, cashFlowByMonth, incomeInYear, maturities, maturityOf, myShareBp, parseInflation, parseNudge, projectBand, projectOutlook, rateSentence, ratesFor, reachMonth } from '../js/models/outlook.js';

const TODAY = '2026-04-15', USER = 'u1';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
const throwsInput = (fn, re) => { try { fn(); } catch (e) { if (e instanceof InputError) { if (re) ok(re.test(e.message), `message "${e.message}"`); return; } throw e; } throw new Error('expected an InputError'); };
const roundDiv = (num, den) => Number((2n * num + den) / (2n * den));

let n = 0;
async function fresh() {
  const dek = await generateDek();
  const store = createStore({ backend: createMemoryBackend(), getDek: () => dek, userId: USER, uuid: () => `o-${++n}` });
  return { store, pf: createPortfolio(store) };
}
// An investment worth exactly ₦10,000,000 today with the given saved rates (no payments), optionally with a maturity date.
async function worth10m(store, { name = 'Test', template = 'land', rates = [], maturity = null } = {}) {
  const t = findTemplate(template), d = applyTemplate(newDraft(TODAY), t, TODAY);
  Object.assign(d, { name, openedOn: '2025-01-01', capital: { amount: '10,000,000', date: '', note: '' } }); d.income = 'none';
  const id = (await savePlan(store, buildPlan(d, t, { today: TODAY }))).investmentId;
  await store.create('valuation', { investmentId: id, date: '2026-04-01', valueKobo: 1000000000, source: 'own_estimate', note: '' });
  await store.update(id, (f) => { f.rates = rates; if (maturity) f.behaviors.term = { maturityDate: maturity }; });
  return id;
}
const rate = (r, extra = {}) => ({ type: 'assumed', rate: r, rateUnit: 'year', method: 'simple', ...extra });
const run = async (pf, args) => projectOutlook({ items: await loadReport(pf, args.asOf || TODAY), asOf: TODAY, includePayments: false, ...args });

test('a quarterly compounding rate projects at that rate, not flat: 10% four times a year on ₦10,000,000 is ₦11,038,128.91 after a year', async () => {
  const { store, pf } = await fresh(); await worth10m(store, { rates: [rate(0.1, { method: 'compound', compoundsPerYear: 4 })] });
  const out = await run(pf, { years: 1 });
  eq(out.rows[0].valueKobo, 1103812891, '10,000,000 x 1.025^4 = 11,038,128.90625'); eq(out.held, []); eq(out.parts[0].source, 'saved'); ok(out.isProjection && out.rows.every((r) => r.isProjection));
});
test('a daily compounding rate is used as saved (365 times a year)', async () => {
  const { store, pf } = await fresh(); await worth10m(store, { rates: [rate(0.1, { method: 'compound', compoundsPerYear: 365 })] });
  const v = (await run(pf, { years: 1 })).rows[0].valueKobo;
  ok(v > 1105000000 && v < 1105200000, `10% daily is about 10.5156% a year, got ${v}`);
});
test('a term investment stops growing at maturity and sits at its maturity value; before maturity it grows by the day', async () => {
  const { store, pf } = await fresh(); await worth10m(store, { rates: [rate(0.12)], maturity: '2027-04-15' });
  const out = await run(pf, { years: 3 }), M = out.months;
  eq(M[12].valueKobo, 1120000000, 'one year at 12% simple');
  eq([M[13].valueKobo, M[24].valueKobo, M[36].valueKobo], [1120000000, 1120000000, 1120000000], 'flat after maturity');
  eq(M[6].valueKobo, 1000000000 + roundDiv(1000000000n * 12n * 183n, 100n * 365n), '183 days from 15 April to 15 October');
  eq(out.parts[0].maturityDate, '2027-04-15');
});
test('an investment already past its maturity date is held at today\'s worth', async () => {
  const { store, pf } = await fresh(); await worth10m(store, { rates: [rate(0.12)], maturity: '2026-04-15' });
  const out = await run(pf, { years: 2 }); eq(out.rows[1].valueKobo, 1000000000); eq(out.parts[0].matured, true);
});
test('a rate change already saved for the future is replayed on its date', async () => {
  const { store, pf } = await fresh();
  await worth10m(store, { rates: [rate(0.1, { effectiveTo: '2027-04-15' }), rate(0.2, { effectiveFrom: '2027-04-15' })] });
  const out = await run(pf, { years: 2 });
  eq(out.months[12].valueKobo, 1100000000, '10% for the first year');
  eq(out.months[24].valueKobo, roundDiv(1100000000n * 43820n, 36500n), '20% simple for the 366 days to 15 April 2028');
});
test('a rate that ended before today is history and is ignored; with nothing left the investment is held flat and named', async () => {
  const { store, pf } = await fresh(); await worth10m(store, { name: 'Old', rates: [rate(0.1, { effectiveTo: '2026-01-01' })] });
  const out = await run(pf, { years: 1 }); eq(out.rows[0].valueKobo, 1000000000); eq(out.held, ['Old']); eq(out.parts[0].source, 'none');
});
test('an edited rate replaces the saved rates from today for that investment only', async () => {
  const { store, pf } = await fresh(); const a = await worth10m(store, { name: 'A', rates: [rate(0.12)] }); await worth10m(store, { name: 'B', rates: [rate(0.12)] });
  const out = await run(pf, { years: 1, overrides: { [a]: buildScenario({ ...blankScenario('x'), percent: '20' }) } });
  const by = Object.fromEntries(out.parts.map((p) => [p.investment.name, p]));
  eq([by.A.source, by.B.source], ['edited', 'saved']); eq([by.A.endKobo, by.B.endKobo], [1200000000, 1120000000]);
});
test('a nudge moves every existing rate by the same points and never gives a held-flat investment a rate', async () => {
  const { store, pf } = await fresh(); await worth10m(store, { name: 'Rated', rates: [rate(0.12)] }); await worth10m(store, { name: 'Flat' });
  const out = await run(pf, { years: 1, nudge: -0.03 }), by = Object.fromEntries(out.parts.map((p) => [p.investment.name, p.endKobo]));
  eq(by.Rated, 1090000000, '12% less 3 points is 9% simple'); eq(by.Flat, 1000000000);
  const monthly = ratesFor({ investment: { rates: [{ rate: 0.01, rateUnit: 'month', method: 'simple' }] }, asOf: TODAY, nudge: 0.03 }).rates[0];
  eq(monthly.rate, 0.0125, 'a monthly rate moves by a twelfth of the points');
});
test('real terms: every future figure is divided by the inflation over the days between, and today stays unchanged', async () => {
  const { store, pf } = await fresh(); await worth10m(store, { rates: [rate(0.12)] });
  const out = await run(pf, { years: 1, inflation: 0.1 });
  eq(out.months[0].valueKobo, 1000000000, 'today is today'); eq(out.rows[0].valueKobo, roundDiv(112000000000n, 110n), '11,200,000 / 1.1 = 10,181,818.18'); ok(out.real);
  eq((await run(pf, { years: 1, inflation: 0 })).rows[0].valueKobo, 1120000000, 'zero inflation changes nothing');
});
test('the inflation figure is only what the person types: blank is off, bad input is refused with a sentence', () => {
  eq(parseInflation(''), null); eq(parseInflation(' 4.5% '), 0.045); eq(parseInflation('0'), 0);
  throwsInput(() => parseInflation('abc'), /positive number/); throwsInput(() => parseInflation('-2'), /positive number/); throwsInput(() => parseInflation('101'), /more than 100%/);
  eq(parseNudge('3', 'down'), -0.03); eq(parseNudge('', 'up'), 0); throwsInput(() => parseNudge('51'), /more than 50%/);
});
test('monthly sampling: 12 points a year plus today, the table rows are the same points, and the parts add up to the total every month', async () => {
  const { store, pf } = await fresh(); await worth10m(store, { name: 'A', rates: [rate(0.12)] }); await worth10m(store, { name: 'B', rates: [rate(0.08, { method: 'compound', compoundsPerYear: 12 })] });
  const out = await run(pf, { years: 5 });
  eq(out.months.length, 61); eq(out.months[0].valueKobo, out.startKobo); eq(out.months[0].gainKobo, 0);
  eq(out.rows.map((r) => r.years), [1, 3, 5]); for (const r of out.rows) eq(r.valueKobo, out.months[r.years * 12].valueKobo, `row ${r.years} is month ${r.years * 12}`);
  for (const m of out.months) eq(Object.values(m.byInvestment).reduce((t, x) => t + x, 0), m.valueKobo, `month ${m.month} parts add up`);
  for (let i = 1; i < out.months.length; i++) ok(out.months[i].valueKobo >= out.months[i - 1].valueKobo, 'growth never goes backwards at positive rates');
});
test('sample portfolio on Full value starts at exactly Home\'s total; My share counts only the person\'s own percentage', async () => {
  const { store, pf } = await fresh(); await seedSamplePortfolio(store);
  const items = await loadReport(pf, SAMPLE_AS_OF), home = await pf.summary(SAMPLE_AS_OF);
  const full = projectOutlook({ items, asOf: SAMPLE_AS_OF, years: 1 }), mine = projectOutlook({ items, asOf: SAMPLE_AS_OF, years: 1, share: 'mine' });
  eq(full.startKobo, home.valueKobo, 'matches Home'); eq(full.share, 'full');
  const venture = items.find((i) => i.investment.name.includes('Last') || i.investment.behaviors.ownership === 'shared');
  eq(myShareBp(venture.bundle, SAMPLE_AS_OF), 5000); eq(mine.startKobo, full.startKobo - Math.floor(venture.metrics.valueKobo / 2), 'only the shared one is halved (₦15,600,000 worth, half is mine)');
  const v = (o) => o.parts.find((p) => p.investment.id === venture.investment.id);
  eq([v(full).shareBp, v(mine).shareBp], [10000, 5000]); eq(myShareBp(items.find((i) => i.investment.behaviors.ownership !== 'shared').bundle, SAMPLE_AS_OF), 10000);
});
test('cautious, base and optimistic bands bracket the base line and the base matches a plain run', async () => {
  const { store, pf } = await fresh(); await worth10m(store, { rates: [rate(0.12)] });
  const items = await loadReport(pf, TODAY), args = { items, asOf: TODAY, years: 5, includePayments: false }, b = projectBand(args, 0.03);
  eq(b.base.rows, projectOutlook(args).rows); eq(b.bands.length, 61);
  const last = b.bands[60]; ok(last.lowKobo < last.baseKobo && last.baseKobo < last.highKobo, 'low < base < high'); eq(b.bands[0].lowKobo, b.bands[0].highKobo, 'all three start at today');
  eq(last.lowKobo, 1000000000 + roundDiv(1000000000n * 9n * 1826n, 100n * 365n), '9% simple over 1,826 days'); eq(last.highKobo, 1000000000 + roundDiv(1000000000n * 15n * 1826n, 100n * 365n));
});
test('expected rent follows the saved payment plans and is counted in today\'s money when real terms is on', async () => {
  const { store, pf } = await fresh(); await seedSamplePortfolio(store);
  const items = await loadReport(pf, SAMPLE_AS_OF), a = projectOutlook({ items, asOf: SAMPLE_AS_OF, years: 2 }), off = projectOutlook({ items, asOf: SAMPLE_AS_OF, years: 2, includePayments: false }), real = projectOutlook({ items, asOf: SAMPLE_AS_OF, years: 2, inflation: 0.1 });
  ok(a.rows[1].incomeKobo > 0 && off.rows[1].incomeKobo === 0, 'income only with payments on'); eq(a.rows[1].valueKobo, off.rows[1].valueKobo, 'payments never change worth');
  ok(real.rows[1].incomeKobo < a.rows[1].incomeKobo, 'later rent is worth less in today\'s money');
});
test('bad input is refused with a sentence, closed or empty portfolios are explained, and a broken investment is named, not fatal', async () => {
  const { store, pf } = await fresh(); await worth10m(store, { rates: [rate(0.1)] }); const items = await loadReport(pf, TODAY);
  throwsInput(() => projectOutlook({ items, asOf: TODAY, years: 0 }), /between 1 and 50/); throwsInput(() => projectOutlook({ items, asOf: TODAY, years: MAX_OUTLOOK_YEARS + 1 }), /between 1 and 50/);
  throwsInput(() => projectOutlook({ items, asOf: TODAY, years: 1, share: 'half' }), /Full value or My share/); throwsInput(() => projectOutlook({ items, asOf: TODAY, years: 1, nudge: 0.9 }), /nudge/); throwsInput(() => projectOutlook({ items, asOf: TODAY, years: 1, inflation: 2 }), /Inflation/);
  throwsInput(() => projectOutlook({ items: [], asOf: TODAY, years: 1 }), /no open investment/);
  const bad = items.map((it) => ({ ...it, bundle: { ...it.bundle, investment: { ...it.bundle.investment, behaviors: { ...it.bundle.investment.behaviors, ownership: 'shared' } }, ownership: [{ partnerId: 'me', percentage: 4000, contributionKobo: 1, effectiveFrom: '2020-01-01' }] } }));
  throwsInput(() => projectOutlook({ items: bad, asOf: TODAY, years: 1, share: 'mine' }), /None of your open investments/);
});
test('it handles 30 investments over 10 years in a few seconds, and saves nothing', async () => {
  const { store, pf } = await fresh(); for (let i = 0; i < 30; i++) await worth10m(store, { name: `Inv ${i}`, rates: [rate(0.1, { method: 'compound', compoundsPerYear: 4 })] });
  const items = await loadReport(pf, TODAY), count = async () => (await Promise.all(['investment', 'entry', 'valuation', 'schedule', 'settings'].map((t) => store.list(t)))).flat().length, before = await count();
  const t0 = Date.now(), out = projectOutlook({ items, asOf: TODAY, years: 10, includePayments: false }), ms = Date.now() - t0;
  eq(out.count, 30); ok(ms < 8000, `took ${ms} ms`); eq(await count(), before, 'no record created');
  if (typeof process !== 'undefined' && process.versions?.node) {
    const fs = await import('node:fs/promises'); const src = await fs.readFile(new URL('../js/models/outlook.js', import.meta.url), 'utf8');
    ok(!/core\/store|core\/db|indexedDB|localStorage|fetch\(/.test(src), 'outlook.js must not touch storage or the network');
  }
});

test('rate words: say exactly what the saved rate is, and never invent one', () => {
  eq(rateSentence([]), 'No rate set, held flat');
  eq(rateSentence([rate(0.12)]), 'Grows 12% a year, simple');
  eq(rateSentence([rate(0.1, { method: 'compound', compoundsPerYear: 4 })]), 'Grows 10% a year, compounded four times a year');
  eq(rateSentence([rate(0.01, { rateUnit: 'month', method: 'compound' })]), 'Grows 12% a year, compounded monthly');
  eq(rateSentence([rate(-0.15)]), 'Loses 15% a year, simple');
  eq(rateSentence([rate(0.125, { effectiveTo: '2027-01-01' }), rate(0.2, { effectiveFrom: '2027-01-01' })]), 'Grows 12.5% a year, simple, then 1 saved change later');
});
test('goals: the first month the total reaches a target, or none; and the regular payments in one whole year', async () => {
  const { store, pf } = await fresh(); await worth10m(store, { rates: [rate(0.12)] });
  const out = await run(pf, { years: 5 });
  eq(reachMonth(out.months, 1120000000).month, 12, '12% simple reaches ₦11,200,000 on the first anniversary'); eq(reachMonth(out.months, 1119999999).month, 12);
  eq(reachMonth(out.months, 1000000000).month, 0, 'already there today'); eq(reachMonth(out.months, 99900000000), null); eq(reachMonth(out.months, 0), null); eq(reachMonth(out.months, -5), null);
  const { store: s2, pf: p2 } = await fresh(); await seedSamplePortfolio(s2);
  const sm = projectOutlook({ items: await loadReport(p2, SAMPLE_AS_OF), asOf: SAMPLE_AS_OF, years: 3 });
  const y2 = incomeInYear(sm.months, 2); eq(y2.incomeKobo, sm.months[24].incomeKobo - sm.months[12].incomeKobo); ok(y2.incomeKobo > 0); eq(incomeInYear(sm.months, 9), null);
});
test('cash flow: twelve months of expected rent and costs that add up to the projection\'s own totals, and My share scales them', async () => {
  const { store, pf } = await fresh(); await seedSamplePortfolio(store);
  const items = await loadReport(pf, SAMPLE_AS_OF), cf = cashFlowByMonth({ items, asOf: SAMPLE_AS_OF }), p = projectOutlook({ items, asOf: SAMPLE_AS_OF, years: 1 });
  eq(cf.length, 12); eq(cf[0].from > SAMPLE_AS_OF, true); eq(cf[11].to, p.months[12].date);
  const tot = (k) => cf.reduce((t, w) => t + w[k], 0);
  ok(Math.abs(tot('incomeKobo') - p.months[12].incomeKobo) <= 12 && Math.abs(tot('costsKobo') - p.months[12].costsKobo) <= 12, `income ${tot('incomeKobo')} vs ${p.months[12].incomeKobo}`);
  ok(tot('incomeKobo') > 0); ok(cashFlowByMonth({ items, asOf: SAMPLE_AS_OF, inflation: 0.1 }).reduce((t, w) => t + w.incomeKobo, 0) < tot('incomeKobo'));
});
test('maturities: only term investments still to mature, soonest first, with the worth on the day and edits respected', async () => {
  const { store, pf } = await fresh(); const a = await worth10m(store, { name: 'Soon', rates: [rate(0.12)], maturity: '2027-04-15' }); await worth10m(store, { name: 'Later', rates: [rate(0.12)], maturity: '2028-04-15' });
  await worth10m(store, { name: 'Past', rates: [rate(0.12)], maturity: '2026-04-15' }); await worth10m(store, { name: 'NoTerm', rates: [rate(0.12)] });
  const items = await loadReport(pf, TODAY), m = maturities({ items, asOf: TODAY });
  eq(m.map((x) => x.investment.name), ['Soon', 'Later']); eq(m[0].valueKobo, 1120000000); eq(m[0].days, 365); eq(m[1].valueKobo, 1000000000 + roundDiv(1000000000n * 12n * 731n, 100n * 365n), '731 days at 12% simple');
  eq(maturities({ items, asOf: TODAY, overrides: { [a]: buildScenario({ ...blankScenario('x'), percent: '20' }) } })[0].valueKobo, 1200000000);
});

export async function runOutlookTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) { try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); } }
  log(`\n${passed} passed, ${failed} failed (outlook engine).`);
  return { passed, failed };
}
