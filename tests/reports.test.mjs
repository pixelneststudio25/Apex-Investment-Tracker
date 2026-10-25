// Phase 7 tests: projections, CSV export and the statement data. Figures are checked against independent
// arithmetic (BigInt integers or hand-counted payments), never against the code under test.
import { generateDek } from '../js/core/crypto.js';
import { createMemoryBackend } from '../js/core/db.js';
import { createStore } from '../js/core/store.js';
import { createPortfolio } from '../js/models/portfolio.js';
import { findTemplate } from '../js/models/templates.js';
import { applyTemplate, buildPlan, newDraft, savePlan } from '../js/models/wizard.js';
import { InputError } from '../js/models/inputs.js';
import { SAMPLE_AS_OF, seedSamplePortfolio } from '../js/models/sample.js';
import { compareScenarios } from '../js/engine/index.js';
import { dueUnrecorded } from '../js/models/manage.js';
import { HORIZON_YEARS, blankScenario, buildScenario, dueNotCounted, explain, expectedPayments, horizonList, parseYears, projectScenario, runProjection, scenarioFromRate, startingScenario } from '../js/models/projections.js';
import { runPortfolioProjection, splitItems } from '../js/models/portfolio-projection.js';
import { buildStatement, csvCell, csvName, koboPlain, ledgerCsv, loadReport, pctPlain, summaryCsv, toCsv, valuationsCsv } from '../js/models/export.js';

const TODAY = '2026-04-15', USER = 'u1';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
const throwsInput = (fn, re) => { try { fn(); } catch (e) { if (e instanceof InputError) { if (re) ok(re.test(e.message), `message "${e.message}"`); return e; } throw e; } throw new Error('expected an InputError'); };

let n = 0;
async function fresh() {
  const dek = await generateDek();
  const store = createStore({ backend: createMemoryBackend(), getDek: () => dek, userId: USER, uuid: () => `r-${++n}` });
  return { store, pf: createPortfolio(store) };
}
const tpl = (id) => findTemplate(id);
async function make(store, id, over = {}, tweak = () => {}) {
  const d = applyTemplate(newDraft(TODAY), tpl(id), TODAY); Object.assign(d, { name: 'Test', openedOn: '2025-01-01', capital: { amount: '10,000,000', date: '', note: '' } }, over); tweak(d);
  return (await savePlan(store, buildPlan(d, tpl(id), { today: TODAY }))).investmentId;
}
// An investment worth exactly ₦10,000,000 today (a valuation), so every projection starts from a known figure.
async function worthTenMillion(store, pf, id = 'land', over = {}) {
  const inv = await make(store, id, over, (d) => { d.income = 'none'; });
  await store.create('valuation', { investmentId: inv, date: '2026-04-01', valueKobo: 1000000000, source: 'own_estimate', note: '' });
  return inv;
}
const sc = (percent, extra = {}) => buildScenario({ ...blankScenario('S'), percent, ...extra });
// BigInt rounding of num/den, half away from zero (positive numbers only here).
const roundDiv = (num, den) => (2n * num + den) / (2n * den);

// ---------- projections: the growth figures ----------
test('projection: 12% simple on ₦10,000,000 for 1 year is ₦11,200,000 and for 5 years matches independent integer arithmetic', async () => {
  const { store, pf } = await fresh(); const id = await worthTenMillion(store, pf);
  const r = await pf.metrics(id, TODAY), out = runProjection({ bundle: r.bundle, startKobo: r.metrics.valueKobo, asOf: TODAY, a: sc('12'), years: horizonList() });
  eq(r.metrics.valueKobo, 1000000000, 'starts from the valuation');
  const [y1, , y5] = out.a.rows;
  eq(y1.valueKobo, 1120000000, '365 days: 10,000,000 x (1 + 0.12 x 365/365)');
  eq([y5.days, y5.endDate], [1826, '2031-04-15'], 'five calendar years include one leap day');
  const expected = roundDiv(1000000000n * (36500n + 12n * 1826n), 36500n); // P x (1 + 12/100 x 1826/365)
  eq(String(y5.valueKobo), String(expected), 'worth after 5 years');
  eq(y5.valueKobo, 1600328767, '₦16,003,287.67');
  ok(out.isProjection && out.a.rows.every((x) => x.isProjection), 'always marked as a projection');
});
test('projection: compounded once a year at 10% is exactly ₦11,000,000 after 365 days; monthly compounding is higher', async () => {
  const { store, pf } = await fresh(); const id = await worthTenMillion(store, pf); const r = await pf.metrics(id, TODAY);
  const run = (method) => runProjection({ bundle: r.bundle, startKobo: 1000000000, asOf: TODAY, a: sc('10', { method }), years: [1] }).a.rows[0];
  eq(run('compound1').valueKobo, 1100000000, '10,000,000 x 1.10');
  // (1 + 0.10/12)^12 = 1.104713067..., so about ₦11,047,130.67; compare against an independent floating-point check within a kobo of rounding
  const monthly = run('compound12').valueKobo, indep = Math.round(1000000000 * Math.pow(1 + 0.1 / 12, 12));
  ok(Math.abs(monthly - indep) <= 1, `monthly ${monthly} vs ${indep}`);
  ok(monthly > 1100000000, 'monthly compounding beats yearly');
});
test('projection: losing value takes the rate off, and never goes below zero', async () => {
  const { store, pf } = await fresh(); const id = await worthTenMillion(store, pf, 'vehicle'); const r = await pf.metrics(id, TODAY);
  const out = runProjection({ bundle: { ...r.bundle, schedules: [] }, startKobo: 1000000000, asOf: TODAY, a: sc('15', { direction: 'loses' }), years: [1, 10] }).a.rows;
  eq(out[0].valueKobo, 850000000, '₦8,500,000 after a year at 15% simple');
  eq(out[1].valueKobo, 0, 'ten years of 15% simple would pass zero, so it stops at zero');
  eq(out[0].gainKobo, -150000000, 'a loss shows as a negative gain');
});
test('projection: a zero start stays zero, and a shorter-than-a-year hold is flagged only for under 365 days', async () => {
  const rows = projectScenario({ bundle: { schedules: [], entries: [] }, startKobo: 0, asOf: TODAY, scenario: sc('12'), years: [1] });
  eq([rows[0].valueKobo, rows[0].annualRate, rows[0].shortHold], [0, null, false]);
});

// ---------- projections: regular payments ----------
test('projection: expected rent and costs follow the saved plans (increase, skipped month, stop date), counted from tomorrow', async () => {
  const { store, pf } = await fresh(); const id = await worthTenMillion(store, pf, 'property-rental');
  await store.create('schedule', { investmentId: id, kind: 'income', label: 'Rent', amountKobo: 50000000, frequency: 'monthly', startDate: '2026-05-01', adjustments: [{ from: '2026-11-01', amountKobo: 60000000 }], skippedDates: ['2026-07-01'] });
  await store.create('schedule', { investmentId: id, kind: 'cost', label: 'Service charge', amountKobo: 25000000, frequency: 'yearly', startDate: '2026-09-15' });
  const r = await pf.metrics(id, TODAY);
  const row = runProjection({ bundle: r.bundle, startKobo: 1000000000, asOf: TODAY, a: sc('12'), years: [1] }).a.rows[0];
  // Counted by hand for 15 Apr 2026 to 15 Apr 2027: rent 1 May, 1 Jun, (1 Jul skipped), 1 Aug, 1 Sep, 1 Oct at ₦500,000 = 5 x 500,000;
  // 1 Nov, 1 Dec, 1 Jan, 1 Feb, 1 Mar, 1 Apr at ₦600,000 = 6 x 600,000. Service charge ₦250,000 once, on 15 Sep.
  eq(row.incomeKobo, (5 * 500000 + 6 * 600000) * 100, 'rent in 12 months: ₦6,100,000');
  eq(row.costsKobo, 25000000, 'one service charge');
  eq([row.incomeCount, row.costsCount], [11, 1]);
  eq(row.gainKobo, row.valueKobo + row.incomeKobo - row.costsKobo - 1000000000, 'gain = worth then + income - costs - worth today');
  const off = runProjection({ bundle: r.bundle, startKobo: 1000000000, asOf: TODAY, a: sc('12'), years: [1], includePayments: false }).a.rows[0];
  eq([off.incomeKobo, off.costsKobo, off.incomeCount], [0, 0, 0], 'switching payments off leaves only the growth');
});
test('projection: payments already due and not recorded are never assumed received, and recorded future dates are not counted twice', async () => {
  const bundle = { entries: [{ linkedScheduleId: 's1', date: '2026-06-01' }], schedules: [{ id: 's1', status: 'active', kind: 'income', amountKobo: 100000, frequency: 'monthly', startDate: '2026-01-01', adjustments: [], skippedDates: [], endDate: null }] };
  const p = expectedPayments(bundle, TODAY, '2026-08-31');
  eq(p.income.map((e) => e.date), ['2026-05-01', '2026-07-01', '2026-08-01'], 'June is already in the ledger');
  eq(dueNotCounted(bundle, TODAY, dueUnrecorded), 4, '1 Jan to 1 Apr are due and unrecorded: Apex says so instead of counting them');
  const stopped = { ...bundle, schedules: [{ ...bundle.schedules[0], status: 'stopped' }] };
  eq(expectedPayments(stopped, TODAY, '2026-08-31').income.length, 0, 'a stopped plan expects nothing');
});
test('projection: with payments, the yearly return is the XIRR of the dated flows (checked by making NPV zero)', async () => {
  const bundle = { entries: [], schedules: [{ id: 's', status: 'active', kind: 'income', amountKobo: 50000000, frequency: 'monthly', startDate: '2026-05-01', adjustments: [], skippedDates: [], endDate: null }] };
  const row = projectScenario({ bundle, startKobo: 1000000000, asOf: TODAY, scenario: sc('10'), years: [1] })[0];
  const flows = [[TODAY, -row.startKobo], ...expectedPayments(bundle, TODAY, row.endDate).income.map((e) => [e.date, e.amountKobo]), [row.endDate, row.valueKobo]];
  const day = (s) => Date.UTC(...s.split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x)))) / 86400000;
  const npv = flows.reduce((t, [d, a]) => t + a / Math.pow(1 + row.annualRate, (day(d) - day(TODAY)) / 365), 0);
  ok(Math.abs(npv) < 1, `NPV at the reported rate should be about zero, got ${npv}`);
  ok(row.annualRate > 0.1, 'rent on top of 10% growth gives more than 10% a year');
});

// ---------- projections: two scenarios ----------
test('projection: comparing two scenarios gives B minus A, and the value gap matches the engine\'s own compareScenarios', async () => {
  const { store, pf } = await fresh(); const id = await worthTenMillion(store, pf); const r = await pf.metrics(id, TODAY);
  const out = runProjection({ bundle: { ...r.bundle, schedules: [] }, startKobo: 1000000000, asOf: TODAY, a: sc('10'), b: sc('15'), years: [1, 3, 5, 10] });
  const rate = (x) => [{ type: 'assumed', rate: x, rateUnit: 'year', method: 'simple' }];
  const ref = compareScenarios({ principalKobo: 1000000000, startDate: TODAY, rates: rate(0.10), horizons: [{ years: 1 }, { years: 3 }, { years: 5 }, { years: 10 }] }, { principalKobo: 1000000000, startDate: TODAY, rates: rate(0.15), horizons: [{ years: 1 }, { years: 3 }, { years: 5 }, { years: 10 }] });
  eq(out.diff.map((d) => d.valueKobo), ref.map((x) => x.deltaValueKobo));
  eq(out.diff[0].valueKobo, 50000000, '15% against 10% for 365 days is ₦500,000 more');
  eq(out.diff.map((d) => d.gainKobo), out.diff.map((d) => d.valueKobo), 'with no payments, gain differences equal worth differences');
  ok(runProjection({ bundle: r.bundle, startKobo: 1000000000, asOf: TODAY, a: sc('10'), years: [1] }).diff === null, 'one scenario has no difference');
});

// ---------- projections: what people type ----------
test('scenario input: text is read exactly, blank means off, and bad input is refused with a sentence', () => {
  eq(sc('12.5').rate, 0.125, '12.5 becomes 0.125 through Decimal'); eq(sc('12.5%').rate, 0.125); eq(sc(' 7 ').percentText, '7');
  eq(sc('15', { direction: 'loses' }).rate, -0.15);
  eq(buildScenario(blankScenario('S')), null, 'an empty rate box switches the scenario off');
  throwsInput(() => sc('-5'), /positive number/); throwsInput(() => sc('abc'), /positive number/); throwsInput(() => sc('1,5'), /positive number/);
  throwsInput(() => sc('1001'), /more than 1000%/); throwsInput(() => sc('101', { direction: 'loses' }), /more than 100%/);
  throwsInput(() => sc('5', { direction: 'sideways' }), /grows or loses/); throwsInput(() => sc('5', { method: 'weekly' }), /how the rate/i);
  throwsInput(() => sc('5', { label: 'x'.repeat(41) }), /40 characters/);
  eq(sc('5', { label: '   ' }).label, 'Scenario', 'a blank name falls back');
});
test('scenario input: years are whole numbers from 1 to 50, added to 1, 3, 5 and 10 without repeats', () => {
  eq(parseYears(''), null); eq(parseYears(' 7 '), 7); throwsInput(() => parseYears('0'), /between 1 and 50/); throwsInput(() => parseYears('51'), /between 1 and 50/); throwsInput(() => parseYears('2.5'), /whole number/); throwsInput(() => parseYears('-3'), /whole number/);
  eq(horizonList(), [...HORIZON_YEARS]); eq(horizonList(7), [1, 3, 5, 7, 10]); eq(horizonList(5), [1, 3, 5, 10]); eq(horizonList(30), [1, 3, 5, 10, 30]);
});
test('scenario input: a saved rate is offered as the starting answer only when this screen can apply it the same way', () => {
  eq(scenarioFromRate({ type: 'assumed', rate: 0.19, rateUnit: 'year', method: 'compound', compoundsPerYear: 1 }), { label: 'Assumed rate', percent: '19', direction: 'grows', method: 'compound1' });
  eq(scenarioFromRate({ type: 'agreed', rate: 0.125, rateUnit: 'year', method: 'simple', compoundsPerYear: null }), { label: 'Agreed rate', percent: '12.5', direction: 'grows', method: 'simple' });
  eq(scenarioFromRate({ type: 'assumed', rate: 0.01, rateUnit: 'month', method: 'simple' }).percent, '12', 'a monthly rate is a nominal yearly rate of 12 times');
  eq(scenarioFromRate({ type: 'assumed', rate: -0.15, rateUnit: 'year', method: 'simple' }), { label: 'Assumed rate', percent: '15', direction: 'loses', method: 'simple' });
  eq(scenarioFromRate({ type: 'assumed', rate: 0.1, rateUnit: 'year', method: 'compound', compoundsPerYear: 4 }), null, 'quarterly compounding cannot be shown, so nothing is guessed');
  eq(scenarioFromRate(null), null);
  const inv = { rates: [{ type: 'assumed', rate: 0.1, rateUnit: 'year', method: 'simple', effectiveTo: '2026-01-01' }, { type: 'assumed', rate: 0.08, rateUnit: 'year', method: 'simple', effectiveFrom: '2026-01-01' }, { type: 'agreed', rate: 0.2, rateUnit: 'year', method: 'simple', effectiveFrom: '2026-01-01' }] };
  eq(startingScenario(inv, TODAY).percent, '20', 'the rate in force today, agreed before assumed');
  eq(startingScenario({ rates: [] }, TODAY), null);
});

// ---------- projections: wording and purity ----------
test('projection: the working is plain words, names every figure, and its arithmetic reproduces the answer', async () => {
  const bundle = { schedules: [], entries: [] }, scenario = sc('12');
  const row = projectScenario({ bundle, startKobo: 1000000000, asOf: TODAY, scenario, years: [1] })[0];
  const lines = explain({ row, scenario, startKobo: 1000000000, fmt: (k) => `₦${(k / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, startNote: 'your latest valuation' });
  ok(lines[0].includes('₦10,000,000.00') && lines[2].includes('₦11,200,000.00'), lines.join(' | '));
  for (const s of lines) { ok(!/\w'\w/.test(s), `contraction in: ${s}`); ok(!/[\u2014\u2013<>]/.test(s), `dash or bracket in: ${s}`); }
  ok(explain({ row: { ...row, years: 5 }, scenario: sc('10', { method: 'compound12' }), startKobo: 1, fmt: String })[1].includes('compounded monthly'));
});
test('projection: nothing is saved (the model has no storage, and the store is untouched by a full run)', async () => {
  const { store, pf } = await fresh(); const id = await worthTenMillion(store, pf); const r = await pf.metrics(id, TODAY);
  const count = async () => (await Promise.all(['investment', 'entry', 'valuation', 'schedule', 'settings'].map((t) => store.list(t)))).flat().length;
  const before = await count();
  runProjection({ bundle: r.bundle, startKobo: 1000000000, asOf: TODAY, a: sc('12'), b: sc('9'), years: horizonList(7) });
  eq(await count(), before, 'no record created');
  if (typeof process !== 'undefined' && process.versions?.node) {
    const fs = await import('node:fs/promises'); const src = await fs.readFile(new URL('../js/models/projections.js', import.meta.url), 'utf8');
    ok(!/core\/store|core\/db|indexedDB|localStorage|fetch\(/.test(src), 'projections.js must not touch storage or the network');
  }
});

// ---------- export: CSV building ----------
test('csv: kobo become plain naira with integer arithmetic, including negatives and small amounts', () => {
  eq([koboPlain(125050), koboPlain(0), koboPlain(5), koboPlain(-5), koboPlain(-1800000000), koboPlain(99999999999)], ['1250.50', '0.00', '0.05', '-0.05', '-18000000.00', '999999999.99']);
  let threw = false; try { koboPlain(1.5); } catch { threw = true; } ok(threw, 'fractional kobo refused');
  eq([pctPlain(0.12345), pctPlain(-0.05), pctPlain(null), pctPlain(NaN), pctPlain(0)], ['12.35', '-5.00', null, null, '0.00']);
});
test('csv: commas, quotes and line breaks are quoted, and anything a spreadsheet could run as a formula is defused', () => {
  eq(csvCell('Plot, Ibeju'), '"Plot, Ibeju"'); eq(csvCell('He said "yes"'), '"He said ""yes"""'); eq(csvCell('two\nlines'), '"two\nlines"');
  for (const bad of ['=1+1', '+234803', '-5 note', '@SUM(A1)', '\tx', '\rx']) ok(csvCell(bad).replace(/^"/, '').startsWith("'"), `${JSON.stringify(bad)} should be prefixed`);
  eq(csvCell({ num: '-1250.50' }), '-1250.50', 'a real number keeps its minus sign');
  eq(csvCell(null), ''); eq(csvCell(undefined), '');
  const csv = toCsv(['A', 'B'], [['x', { num: '1.00' }]]);
  ok(csv.startsWith('\ufeff') && csv.endsWith('\r\n') && csv.includes('\r\n'), 'byte-order mark and CRLF so Excel reads naira signs');
  eq(csvName('ledger', '2026-04-15'), 'apex-ledger-2026-04-15.csv');
});

// A small, strict CSV reader for the tests (handles quotes, doubled quotes and line breaks in cells).
function readCsv(text) {
  const rows = [[]]; let cell = '', q = false; const s = text.replace(/^\ufeff/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { rows.at(-1).push(cell); cell = ''; }
    else if (c === '\r' && s[i + 1] === '\n') { rows.at(-1).push(cell); cell = ''; rows.push([]); i++; }
    else cell += c;
  }
  if (cell || rows.at(-1).length) rows.at(-1).push(cell);
  if (!rows.at(-1).length) rows.pop();
  return rows;
}
const toKoboFromPlain = (t) => { const neg = t.startsWith('-'), [w, f = '00'] = t.replace('-', '').split('.'); const k = Number(w) * 100 + Number(f); return neg ? -k : k; };
const cat = (id) => ({ name: (findTemplate(id)?.name) || 'Other' });

// ---------- export: the three files ----------
test('export: ledger file has one row per live entry and its amounts add up to the ledger, to the kobo', async () => {
  const { store, pf } = await fresh(); await seedSamplePortfolio(store);
  const items = await loadReport(pf, SAMPLE_AS_OF), rows = readCsv(ledgerCsv(items, (id) => cat(id).name));
  const all = (await store.list('entry')); ok(all.length > 10, 'the sample has a real ledger');
  eq(rows.length - 1, all.length, 'one data row per entry'); eq(rows[0].length, 6);
  for (const r of rows) eq(r.length, 6, 'every row has six cells');
  const SIGN = { capital_in: -1, cost: -1 }, expected = all.reduce((t, e) => t + (SIGN[e.kind] ?? 1) * e.amountKobo, 0);
  eq(rows.slice(1).reduce((t, r) => t + toKoboFromPlain(r[4]), 0), expected, 'signed amounts sum to the same total');
  const land = rows.find((r) => r[0] === 'Plot at Ibeju-Lekki' && r[2] === '2023-02-10');
  eq([land[3], land[4], land[5]], ['Money put in', '-18000000.00', 'Purchase price'], 'a purchase is minus ₦18,000,000.00');
});
test('export: valuations and summary files match the engine, with a fixed number of cells on every row', async () => {
  const { store, pf } = await fresh(); await seedSamplePortfolio(store);
  const items = await loadReport(pf, SAMPLE_AS_OF);
  const vals = readCsv(valuationsCsv(items, (id) => cat(id).name)); eq(vals.length - 1, (await store.list('valuation')).length);
  const sum = readCsv(summaryCsv(items, (id) => cat(id).name, SAMPLE_AS_OF)); eq(sum.length - 1, items.length, 'one row per live investment');
  for (const r of sum) eq(r.length, 16, 'sixteen cells on every summary row');
  const flat = sum.find((r) => r[0] === '3-bedroom flat, Yaba'), m = (await pf.metrics(items.find((i) => i.investment.name === flat[0]).investment.id, SAMPLE_AS_OF)).metrics;
  eq([toKoboFromPlain(flat[5]), toKoboFromPlain(flat[6]), toKoboFromPlain(flat[7]), toKoboFromPlain(flat[9]), toKoboFromPlain(flat[10])], [m.investedKobo, m.costsKobo, m.incomeKobo, m.currentValueKobo, m.netGainKobo]);
  eq(flat[11], pctPlain(m.roi), 'return on investment as a plain percentage');
  const bad = summaryCsv([{ investment: { name: 'Broken', categoryId: 'land', openedOn: '2025-01-01', closedOn: null }, bundle: { entries: [], valuations: [] }, metrics: null, error: { code: 'RATE_OVERLAP', message: 'Two rates apply on the same days' } }], (id) => cat(id).name, SAMPLE_AS_OF);
  eq(readCsv(bad)[1].length, 16, 'a row that cannot be calculated still lines up'); ok(bad.includes('Cannot be calculated'));
});
test('export: deleted investments and their entries are left out, and hostile text cannot become a formula', async () => {
  const { store, pf } = await fresh();
  const a = await make(store, 'land', { name: '=HYPERLINK("http://x","click")' }), b = await make(store, 'land', { name: 'Gone' });
  await store.create('entry', { investmentId: a, date: '2026-01-02', kind: 'cost', amountKobo: 12345, note: '@cmd, "quoted"' });
  await store.create('entry', { investmentId: b, date: '2026-01-02', kind: 'cost', amountKobo: 999, note: 'hidden' });
  await store.remove(b);
  const items = await loadReport(pf, TODAY), text = ledgerCsv(items, (id) => cat(id).name), rows = readCsv(text);
  ok(!text.includes('Gone') && !text.includes('hidden'), 'deleted investment and its entries are not exported');
  const cost = rows.find((r) => r[3] === 'Cost');
  eq(cost[0], `'=HYPERLINK("http://x","click")`, 'name is defused'); eq(cost[5], `'@cmd, "quoted"`, 'note is defused and quoting survives a round trip'); eq(cost[4], '-123.45');
});

// ---------- export: the statement ----------
test('statement: each column adds up to its total, and the total matches the portfolio summary', async () => {
  const { store, pf } = await fresh(); await seedSamplePortfolio(store);
  const items = await loadReport(pf, SAMPLE_AS_OF), st = await buildStatement(pf, items, SAMPLE_AS_OF);
  const rows = st.sections.filter((x) => !x.error).map((x) => x.metrics), s = st.summary, tot = (f) => rows.reduce((t, m) => t + f(m), 0);
  eq(tot((m) => m.investedKobo + m.costsKobo), s.investedKobo + s.costsKobo); eq(tot((m) => m.incomeKobo), s.incomeKobo);
  eq(tot((m) => m.proceedsKobo + m.repaidKobo), s.proceedsKobo + s.repaidKobo); eq(tot((m) => m.valueKobo), s.valueKobo, 'worth today');
  eq(tot((m) => m.netGainKobo), s.netGainKobo); eq(s.netGainKobo, (await pf.summary(SAMPLE_AS_OF)).netGainKobo, 'same as the Home figure');
  eq(st.sections.every((x) => x.entries.length === 0), true, 'no ledger unless asked');
});
test('statement: one investment on its own, and the ledger stops at the chosen date', async () => {
  const { store, pf } = await fresh(); await seedSamplePortfolio(store);
  const items = await loadReport(pf, '2024-01-01'), land = items.find((i) => i.investment.name === 'Plot at Ibeju-Lekki').investment.id;
  const st = await buildStatement(pf, items, '2024-01-01', { investmentId: land, includeLedger: true });
  eq(st.sections.length, 1); eq(st.sections[0].entries.map((e) => e.date), ['2023-02-10', '2023-02-12', '2023-02-20'], 'entries after the date are left out');
  eq(st.sections[0].valuations.length, 0, 'the 2025 valuation is after the date');
  eq(st.summary.investedKobo, 1800000000, 'the summary covers only that investment');
  const all = await buildStatement(pf, items, '2024-01-01'); ok(all.sections.length > 1);
});


// ---------- whole portfolio ----------
async function twoInvestments(store) {
  const a = await make(store, 'land', { name: 'Plot' }, (d) => { d.rate.percent = '12'; });           // saved rate 12% a year
  await store.create('valuation', { investmentId: a, date: '2026-04-01', valueKobo: 1000000000, source: 'own_estimate', note: '' });
  const b = await make(store, 'precious-metals', { name: 'Gold' }, (d) => { d.income = 'none'; });   // no saved rate
  await store.create('valuation', { investmentId: b, date: '2026-04-01', valueKobo: 500000000, source: 'own_estimate', note: '' });
  return { a, b };
}
test('portfolio: each at its own saved rate adds up by hand, and an investment with no rate is held flat and named', async () => {
  const { store, pf } = await fresh(); const { a } = await twoInvestments(store);
  eq((await store.get(a)).rates[0].rate, 0.12, 'the plot really has a saved 12% rate');
  const items = await loadReport(pf, TODAY), out = runPortfolioProjection({ items, asOf: TODAY, a: null, years: [1, 3] });
  eq(out.startKobo, 1500000000, '₦10,000,000 + ₦5,000,000');
  eq(out.startKobo, (await pf.summary(TODAY)).valueKobo, 'the same total as Home shows today');
  eq(out.a.rows[0].valueKobo, 1120000000 + 500000000, 'plot at 12% for 365 days = ₦11,200,000, gold flat at ₦5,000,000');
  eq(out.a.rows[0].gainKobo, 120000000, 'gain is ₦1,200,000');
  eq(out.flat, ['Gold'], 'named, never guessed');
  ok(Math.abs(out.a.rows[0].annualRate - 0.08) < 1e-9, `16.2M / 15M over exactly one year is 8% a year, got ${out.a.rows[0].annualRate}`);
  eq(out.a.rows[1].valueKobo, out.a.parts.reduce((t, p) => t + p.rows[1].valueKobo, 0), 'the total is the sum of the parts');
  ok(out.isProjection && out.a.rows.every((r) => r.isProjection));
});
test('portfolio: one typed rate applies to every open investment, and two scenarios give B minus A', async () => {
  const { store, pf } = await fresh(); await twoInvestments(store);
  const items = await loadReport(pf, TODAY), out = runPortfolioProjection({ items, asOf: TODAY, a: sc('10'), b: sc('20'), years: [1] });
  eq(out.a.rows[0].valueKobo, 1650000000, '₦15,000,000 at 10%'); eq(out.b.rows[0].valueKobo, 1800000000, '₦15,000,000 at 20%');
  eq(out.diff[0].valueKobo, 150000000); eq(out.flat, [], 'nothing is held flat when one rate is typed');
});
test('portfolio: closed and uncalculable investments are left out, and nothing open means a clear refusal', async () => {
  const { store, pf } = await fresh(); const { b } = await twoInvestments(store);
  await store.update(b, { status: 'closed', closedOn: '2026-03-01' });
  let items = await loadReport(pf, TODAY); const parts = splitItems(items);
  eq([parts.open.length, parts.closedCount, parts.broken], [1, 1, []]);
  eq(runPortfolioProjection({ items, asOf: TODAY, a: sc('10'), years: [1] }).startKobo, 1000000000, 'only the open plot');
  items = [{ investment: { name: 'Broken' }, bundle: null, metrics: null, error: { message: 'x' } }];
  throwsInput(() => runPortfolioProjection({ items, asOf: TODAY, a: sc('10'), years: [1] }), /no open investment/);
  eq(splitItems(items).broken, ['Broken']);
});
test('portfolio: regular payments from every investment are added in, and can be switched off', async () => {
  const { store, pf } = await fresh(); const { a } = await twoInvestments(store);
  await store.create('schedule', { investmentId: a, kind: 'income', label: 'Rent', amountKobo: 10000000, frequency: 'monthly', startDate: '2026-05-01', adjustments: [], skippedDates: [] });
  const items = await loadReport(pf, TODAY);
  const on = runPortfolioProjection({ items, asOf: TODAY, a: sc('10'), years: [1] }).a.rows[0], off = runPortfolioProjection({ items, asOf: TODAY, a: sc('10'), years: [1], includePayments: false }).a.rows[0];
  eq([on.incomeKobo, on.incomeCount], [12 * 10000000, 12], '1 May 2026 to 1 Apr 2027 is twelve rents of ₦100,000');
  eq([off.incomeKobo, off.incomeCount], [0, 0]); eq(on.valueKobo, off.valueKobo, 'payments never change the worth, only the income');
  eq(on.gainKobo - off.gainKobo, 120000000, 'gain differs by exactly the rent');
});

export async function runReportTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) { try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); } }
  log(`\n${passed} passed, ${failed} failed (projections, export, statement).`);
  return { passed, failed };
}
