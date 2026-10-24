// Phase 4b tests: text-safe input parsing, the add-investment wizard (rules, records, saving, rollback),
// and the single-record forms. Everything is checked against the real validation, the real encrypted store
// (in memory) and the calculation engine.
import { generateDek } from '../js/core/crypto.js';
import { createMemoryBackend } from '../js/core/db.js';
import { createStore } from '../js/core/store.js';
import { createPortfolio } from '../js/models/portfolio.js';
import { BUILT_IN_TEMPLATES, findTemplate } from '../js/models/templates.js';
import { InputError, bpToInput, koboToInput, parseNaira, parsePercent, parseShareBp, wholeNumber } from '../js/models/inputs.js';
import { applyTemplate, buildPlan, newDraft, savePlan, stepErrors, stepsFor } from '../js/models/wizard.js';
import { buildClose, buildEntry, buildValuation } from '../js/models/records.js';

const TODAY = '2026-04-15';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
const throwsInput = (fn, m) => { try { fn(); } catch (e) { if (e instanceof InputError) return e; throw e; } throw new Error(m || 'expected an input error'); };

let n = 0;
async function fresh() {
  const state = { dek: await generateDek() };
  const store = createStore({ backend: createMemoryBackend(), getDek: () => state.dek, userId: 'u1', uuid: () => `r-${++n}` });
  return { store, pf: createPortfolio(store) };
}
const tpl = (id) => findTemplate(id);
function draftFor(id, over = {}) {
  const d = applyTemplate(newDraft(TODAY), tpl(id), TODAY);
  d.name = 'Test investment'; d.openedOn = '2025-01-01'; d.capital.amount = '10,000,000';
  return Object.assign(d, over);
}

// ---------- parsing ----------
test('naira: commas, symbol and spaces are read as digits; whole kobo comes out', () => {
  eq(parseNaira('₦18,000,000'), 1800000000); eq(parseNaira('250000'), 25000000); eq(parseNaira(' 1 250 000.5 '), 125000050);
  eq(parseNaira('5922465.75'), 592246575); eq(parseNaira('0.01'), 1); eq(parseNaira('0', { allowZero: true }), 0);
  eq(parseNaira('19.99'), 1999); eq(parseNaira('1.1'), 110);
});
test('naira: rubbish is refused with a sentence, never guessed', () => {
  for (const bad of ['', 'abc', '12,34', '1,2,3', '1.234', '-5', '1e6', '0', '12.', '₦', '90071992547409.92']) throwsInput(() => parseNaira(bad), `should refuse "${bad}"`);
});
test('naira: amounts never drift through floating point (every kobo value round-trips)', () => {
  for (let k = 1; k < 20000; k += 7) eq(parseNaira(koboToInput(k)), k, `kobo ${k}`);
  eq(koboToInput(1800000000), '18000000'); eq(koboToInput(592246575), '5922465.75'); eq(koboToInput(110), '1.1');
});
test('percent: "12.5%" is exactly 0.125, read as text and not by multiplying floats', () => {
  eq(parsePercent('12.5%'), 0.125); eq(parsePercent('12.5'), 0.125); eq(parsePercent('19'), 0.19); eq(parsePercent('18.5%'), 0.185);
  eq(parsePercent('0.3'), 0.003); eq(parsePercent('7.35'), 0.0735); eq(parsePercent('0.1'), 0.001);
  ok(parsePercent('0.07') === 0.0007 && parsePercent('1.1') === 0.011, 'matches the number written out');
});
test('percent: negatives, junk and absurd rates are refused', () => {
  for (const bad of ['', '-5', 'abc', '1,5', '12.1234567', '1001']) throwsInput(() => parsePercent(bad), `should refuse "${bad}"`);
  eq(parsePercent('1000'), 10);
});
test('shares: exact to the hundredth of a percent, as basis points', () => {
  eq(parseShareBp('50'), 5000); eq(parseShareBp('33.33%'), 3333); eq(parseShareBp('0.01'), 1); eq(parseShareBp('100'), 10000);
  for (const bad of ['', '0', '100.01', '33.333', '-1', 'x']) throwsInput(() => parseShareBp(bad), `should refuse "${bad}"`);
  eq(bpToInput(3333), '33.33'); eq(bpToInput(5000), '50'); eq(bpToInput(250), '2.5');
});
test('whole numbers: range checked', () => {
  eq(wholeNumber('45'), 45); throwsInput(() => wholeNumber('0')); throwsInput(() => wholeNumber('4.5')); throwsInput(() => wholeNumber('99999'));
});

// ---------- the wizard: rules ----------
test('steps: the list follows the category and the answers', () => {
  const land = draftFor('land'); eq(stepsFor(land, tpl('land')), ['category', 'basics', 'details', 'money', 'value', 'income', 'review']);
  const other = draftFor('other'); eq(stepsFor(other, tpl('other')), ['category', 'basics', 'money', 'value', 'income', 'review']);
  const partner = draftFor('partnership'); ok(stepsFor(partner, tpl('partnership')).includes('people'), 'shared adds the people step');
  partner.ownership = 'sole'; ok(!stepsFor(partner, tpl('partnership')).includes('people'), 'and sole removes it');
});
test('a category fills in the presets; every one of the 16 templates builds a valid investment', () => {
  eq(BUILT_IN_TEMPLATES.length, 16);
  for (const t of BUILT_IN_TEMPLATES) {
    const d = draftFor(t.id);
    if (t.defaultBehaviors.term) d.maturityDate = '2026-12-31';
    if (d.valueChange === 'interest') d.rate.percent = '18';
    if (d.income === 'schedule') { d.schedule.amount = '100000'; d.schedule.start = '2025-02-01'; }
    if (d.ownership === 'shared') { d.people[0].share = '60'; d.people[0].putIn = '6000000'; d.people[1].name = 'Ade'; d.people[1].share = '40'; d.people[1].putIn = '4000000'; }
    const plan = buildPlan(d, t, { today: TODAY });
    eq(plan.investment.categoryId, t.id, t.id); eq(plan.investment.behaviors.valueChange, t.defaultBehaviors.valueChange, t.id);
  }
});
test('basics: a name and a real date are needed; term investments need a maturity date after the start', () => {
  const d = draftFor('fixed-income'); d.name = '  ';
  eq(stepErrors(d, 'basics', tpl('fixed-income')).map((e) => e.field), ['name', 'maturityDate']);
  d.name = 'T-bill'; d.maturityDate = '2024-12-31'; eq(stepErrors(d, 'basics', tpl('fixed-income')).map((e) => e.field), ['maturityDate'], 'before start');
  d.maturityDate = '2025-12-31'; d.openedOn = '2025-02-30'; ok(stepErrors(d, 'basics', tpl('fixed-income')).some((e) => e.field === 'openedOn'), 'not a real date');
});
test('money: the amount is required and checked; a bad date is caught', () => {
  const d = draftFor('land'); d.capital.amount = ''; eq(stepErrors(d, 'money', tpl('land')).map((e) => e.field), ['capital.amount']);
  d.capital.amount = '1.234'; ok(stepErrors(d, 'money', tpl('land'))[0].message.includes('kobo'));
  d.capital.amount = '5000'; d.capital.date = '2025-13-01'; eq(stepErrors(d, 'money', tpl('land')).map((e) => e.field), ['capital.date']);
});
test('value: interest needs a rate; an optional current value needs a date', () => {
  const d = draftFor('fixed-income'); eq(stepErrors(d, 'value', tpl('fixed-income')).map((e) => e.field), ['rate.percent']);
  d.rate.percent = '18'; eq(stepErrors(d, 'value', tpl('fixed-income')), []);
  d.current.amount = '5,000,000'; d.current.date = ''; eq(stepErrors(d, 'value', tpl('fixed-income')).map((e) => e.field), ['current.date']);
  const manual = draftFor('crypto'); eq(stepErrors(manual, 'value', tpl('crypto')), [], 'manual valuation needs no rate');
});
test('income: a regular schedule needs an amount, a start, and a day count when custom', () => {
  const d = draftFor('property-rental'); eq(stepErrors(d, 'income', tpl('property-rental')).map((e) => e.field), ['schedule.amount']);
  d.schedule.amount = '3600000'; d.schedule.frequency = 'custom'; eq(stepErrors(d, 'income', tpl('property-rental')).map((e) => e.field), ['schedule.everyDays']);
  d.schedule.everyDays = '45'; d.schedule.end = '2024-01-01'; eq(stepErrors(d, 'income', tpl('property-rental')).map((e) => e.field), ['schedule.end']);
});
test('people: shares must total exactly 100% and what people put in must equal the money put in', () => {
  const d = draftFor('partnership'); d.capital.amount = '12,000,000';
  d.people = [{ ref: 'me', name: 'You', share: '50', putIn: '6,000,000' }, { ref: '', name: 'Ade', share: '30', putIn: '3,600,000' }, { ref: '', name: 'Bola', share: '19.99', putIn: '2,400,000' }];
  const e1 = stepErrors(d, 'people', tpl('partnership')); eq(e1.length, 1); ok(e1[0].message.includes('99.99%'), e1[0].message);
  d.people[2].share = '20'; d.people[2].putIn = '2,000,000';
  const e2 = stepErrors(d, 'people', tpl('partnership')); eq(e2.length, 1); ok(e2[0].message.includes('₦12,000,000.00') && e2[0].message.includes('₦11,600,000.00'), e2[0].message);
  d.people[2].putIn = '2,400,000'; eq(stepErrors(d, 'people', tpl('partnership')), []);
  d.people[1].name = ''; eq(stepErrors(d, 'people', tpl('partnership')).map((e) => e.field), ['people.1.name']);
  d.people[1].name = 'Ade'; d.people[1].ref = 'me'; ok(stepErrors(d, 'people', tpl('partnership')).some((e) => e.message.includes('twice')), 'same person twice');
});
test('review: finds the first problem in any earlier step, labelled with the step', () => {
  const d = draftFor('land'); d.capital.amount = 'lots'; d.name = '';
  const errs = stepErrors(d, 'review', tpl('land'), { today: TODAY }); eq(errs.map((e) => [e.step, e.field]), [['basics', 'name'], ['money', 'capital.amount']]);
  throwsInput(() => buildPlan(d, tpl('land'), { today: TODAY }));
});

// ---------- the wizard: what gets saved, and what it calculates ----------
test('land at 12% simple for a year: saved encrypted, then worth exactly ₦11,200,000 and gaining ₦1,200,000', async () => {
  const { store, pf } = await fresh();
  const d = draftFor('land'); d.valueChange = 'appreciation'; d.rate.percent = '12%'; d.fields.location = 'Lekki'; d.fields.plotSize = '600 sqm';
  const plan = buildPlan(d, tpl('land'), { today: TODAY });
  eq(plan.investment.rates[0].rate, 0.12); eq(plan.investment.rates[0].effectiveFrom, '2025-01-01'); eq(plan.investment.customFields, { location: 'Lekki', plotSize: '600 sqm' });
  const { investmentId } = await savePlan(store, plan);
  const m = (await pf.metrics(investmentId, '2026-01-01')).metrics;
  eq(m.currentValueKobo, 1120000000); eq(m.netGainKobo, 120000000); eq(m.investedKobo, 1000000000);
});
test('a car at 15% depreciation is saved as a negative rate and loses value', async () => {
  const { store, pf } = await fresh();
  const d = draftFor('vehicle'); d.income = 'none'; d.rate.percent = '15'; d.rate.method = 'compound'; d.capital.amount = '4,000,000';
  const plan = buildPlan(d, tpl('vehicle'), { today: TODAY }); eq(plan.investment.rates[0].rate, -0.15); eq(plan.investment.rates[0].compoundsPerYear, 1);
  const { investmentId } = await savePlan(store, plan);
  eq((await pf.metrics(investmentId, '2026-01-01')).metrics.currentValueKobo, 340000000, '₦4M less 15% over exactly one year');
});
test('monthly rates: a month unit with compounding defaults to twelve times a year', () => {
  const d = draftFor('land'); d.valueChange = 'appreciation'; d.rate.percent = '1'; d.rate.unit = 'month'; d.rate.method = 'compound';
  const r = buildPlan(d, tpl('land'), { today: TODAY }).investment.rates[0]; eq([r.rateUnit, r.compoundsPerYear], ['month', 12]);
});
test('treasury bill: agreed rate, maturity date kept, and the placeholder maturity never leaks in', () => {
  const d = draftFor('fixed-income'); d.rate.percent = '18.5'; d.maturityDate = '2025-12-31';
  const inv = buildPlan(d, tpl('fixed-income'), { today: TODAY }).investment;
  eq([inv.rates[0].type, inv.rates[0].rate, inv.behaviors.term], ['agreed', 0.185, { maturityDate: '2025-12-31' }]);
});
test('a manual valuation entered in the wizard is saved and used instead of any assumption', async () => {
  const { store, pf } = await fresh();
  const d = draftFor('crypto'); d.current.amount = '12,500,000'; d.current.date = '2026-03-01'; d.current.source = 'other';
  const { investmentId } = await savePlan(store, buildPlan(d, tpl('crypto'), { today: TODAY }));
  const m = (await pf.metrics(investmentId, TODAY)).metrics; eq(m.currentValueKobo, 1250000000); eq(m.valueSource, 'valuation');
});
test('rent schedule: past payments are recorded only when asked, and each is linked to the schedule', async () => {
  const mk = async (recordPast) => {
    const { store, pf } = await fresh();
    const d = draftFor('property-rental'); d.valueChange = 'none'; d.schedule = { ...d.schedule, amount: '100,000', frequency: 'monthly', start: '2026-01-01', recordPast };
    const plan = buildPlan(d, tpl('property-rental'), { today: TODAY });
    eq([plan.pastCount, plan.pastTotalKobo], [4, 40000000]);
    const { investmentId } = await savePlan(store, plan);
    return { store, pf, investmentId };
  };
  const off = await mk(false); eq((await off.store.list('entry')).filter((e) => e.kind === 'income').length, 0); eq((await off.store.list('schedule')).length, 1);
  const on = await mk(true); const inc = (await on.store.list('entry')).filter((e) => e.kind === 'income');
  eq(inc.map((e) => e.date).sort(), ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
  const schedId = (await on.store.list('schedule'))[0].id; ok(inc.every((e) => e.linkedScheduleId === schedId), 'linked');
  eq((await on.pf.metrics(on.investmentId, TODAY)).metrics.incomeKobo, 40000000);
});
test('shared: the 50/30/20 partnership on ₦12M saves two new people and splits to the kobo', async () => {
  const { store, pf } = await fresh();
  const d = draftFor('partnership'); d.capital.amount = '12,000,000'; d.current.amount = '15,600,000'; d.current.date = '2026-03-01';
  d.people = [{ ref: 'me', name: 'You', share: '50', putIn: '6,000,000' }, { ref: '', name: 'Ade', share: '30', putIn: '3,600,000' }, { ref: '', name: 'Bola', share: '20', putIn: '2,400,000' }];
  const { investmentId } = await savePlan(store, buildPlan(d, tpl('partnership'), { today: TODAY }));
  eq((await store.list('partner')).map((p) => p.name).sort(), ['Ade', 'Bola']);
  const r = await pf.metrics(investmentId, TODAY);
  eq(r.partners.partners.map((p) => p.valueShareKobo), [780000000, 468000000, 312000000]); eq(r.partners.partners.reduce((a, p) => a + p.valueShareKobo, 0), 1560000000);
});
test('shared: an existing person is reused, not created twice', async () => {
  const { store } = await fresh(); const ade = await store.create('partner', { name: 'Ade' });
  const d = draftFor('partnership'); d.capital.amount = '1,000,000';
  d.people = [{ ref: 'me', name: 'You', share: '50', putIn: '500,000' }, { ref: ade.id, name: 'Ade', share: '50', putIn: '500,000' }];
  const { investmentId } = await savePlan(store, buildPlan(d, tpl('partnership'), { today: TODAY }));
  eq((await store.list('partner')).length, 1); eq((await store.list('ownership')).filter((o) => o.investmentId === investmentId).map((o) => o.partnerId).sort(), ['me', ade.id].sort());
});
test('saving that fails half-way leaves nothing behind on the list', async () => {
  const { store, pf } = await fresh();
  let calls = 0; const flaky = { create: (...a) => (++calls === 3 ? Promise.reject(new Error('disk full')) : store.create(...a)), remove: (id) => store.remove(id) };
  const d = draftFor('property-rental'); d.valueChange = 'none'; d.schedule.amount = '100000'; d.schedule.start = '2026-01-01'; d.current.amount = '';
  const plan = buildPlan(d, tpl('property-rental'), { today: TODAY });
  try { await savePlan(flaky, plan); throw new Error('should have failed'); } catch (e) { eq(e.message, 'disk full'); }
  eq((await pf.investments()).length, 0); eq((await store.list('entry')).length, 0); eq((await store.list('schedule')).length, 0);
});

// ---------- single-record forms ----------
test('entry form: kind, date and amount are checked; the record passes the real schema', async () => {
  const { store } = await fresh(); const inv = await store.create('investment', buildPlan(draftFor('land'), tpl('land'), { today: TODAY }).investment);
  const e = buildEntry({ kind: 'cost', date: '2025-03-02', amount: '₦350,000', note: ' Survey plan ' }, inv.id);
  eq([e.kind, e.amountKobo, e.note], ['cost', 35000000, 'Survey plan']); await store.create('entry', e);
  throwsInput(() => buildEntry({ kind: 'gift', date: '2025-03-02', amount: '5' }, inv.id)); throwsInput(() => buildEntry({ kind: 'cost', date: '2025-02-30', amount: '5' }, inv.id)); throwsInput(() => buildEntry({ kind: 'cost', date: '2025-03-02', amount: '0' }, inv.id));
});
test('valuation form: a value of zero is allowed, a missing date is not', () => {
  eq(buildValuation({ date: '2026-01-05', amount: '0', source: 'agent' }, 'x').valueKobo, 0);
  throwsInput(() => buildValuation({ date: '', amount: '5', source: 'agent' }, 'x'));
});
test('closing: the investment closes on the date, proceeds become an entry, and figures become realized', async () => {
  const { store, pf } = await fresh();
  const d = draftFor('land'); d.valueChange = 'appreciation'; d.rate.percent = '12';
  const { investmentId } = await savePlan(store, buildPlan(d, tpl('land'), { today: TODAY }));
  const inv = await store.get(investmentId);
  const c = buildClose({ date: '2026-01-01', amount: '11,500,000', note: '' }, inv);
  await store.update(investmentId, c.change); await store.create('entry', c.proceeds);
  const m = (await pf.metrics(investmentId, TODAY)).metrics; eq(m.basis, 'realized'); eq(m.currentValueKobo, 1150000000); eq(m.netGainKobo, 150000000);
  throwsInput(() => buildClose({ date: '2024-01-01', amount: '' }, inv), 'before the start date');
  eq(buildClose({ date: '2026-01-01', amount: '' }, inv).proceeds, null, 'closing with no proceeds is allowed');
});
test('deleting an investment and undoing it brings everything back (what the Undo button does)', async () => {
  const { store, pf } = await fresh();
  const { investmentId } = await savePlan(store, buildPlan(draftFor('land'), tpl('land'), { today: TODAY }));
  await store.remove(investmentId); eq((await pf.investments()).length, 0);
  await store.restore(investmentId); eq((await pf.metrics(investmentId, TODAY)).metrics.investedKobo, 1000000000);
});

export async function runFormTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) { try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); } }
  log(`\n${passed} passed, ${failed} failed (forms and wizard).`);
  return { passed, failed };
}
