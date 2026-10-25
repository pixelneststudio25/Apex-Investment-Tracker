// Phase 6 tests: loan repayments in the engine, editing an investment, regular payments, reminders, shares that
// change over time, change history (including pulling old versions from the server), and recently deleted items.
import { generateDek } from '../js/core/crypto.js';
import { createMemoryBackend } from '../js/core/db.js';
import { createStore } from '../js/core/store.js';
import { createPortfolio } from '../js/models/portfolio.js';
import { findTemplate } from '../js/models/templates.js';
import { applyTemplate, buildPlan, newDraft, savePlan } from '../js/models/wizard.js';
import { InputError } from '../js/models/inputs.js';
import { investmentMetrics, scheduleEntries } from '../js/engine/index.js';
import { createSync } from '../js/core/sync.js';
import { applySharesPlan, buildInvestmentChange, buildReminder, buildScheduleFields, buildSharesPlan, completeChange, deletedItems, diffVersions, dueUnrecorded, editDraft, editErrors, entryFromDue, resumeChange, scheduleDraft, sharesDraft, sharesErrors, skippableDates, stopChange, withIncrease, withSkipToggled, withoutIncrease } from '../js/models/manage.js';

const TODAY = '2026-04-15', USER = 'u1';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
const throwsInput = (fn, re) => { try { fn(); } catch (e) { if (e instanceof InputError) { if (re) ok(re.test(e.message), `message "${e.message}"`); return e; } throw e; } throw new Error('expected an input error'); };
async function rejects(p, re) { try { await p; } catch (e) { if (!re || re.test(e.message)) return e; throw new Error(`wrong error: ${e.message}`); } throw new Error('expected failure'); }

let n = 0;
async function fresh() {
  const dek = await generateDek();
  const store = createStore({ backend: createMemoryBackend(), getDek: () => dek, userId: USER, uuid: () => `m-${++n}` });
  return { store, pf: createPortfolio(store), dek };
}
const tpl = (id) => findTemplate(id);
async function make(store, id, over = {}, tweak = () => {}) {
  const d = applyTemplate(newDraft(TODAY), tpl(id), TODAY); Object.assign(d, { name: 'Test', openedOn: '2025-01-01', capital: { amount: '10,000,000', date: '', note: '' } }, over); tweak(d);
  return (await savePlan(store, buildPlan(d, tpl(id), { today: TODAY }))).investmentId;
}
const loan = (store) => make(store, 'loan-given', { name: 'Loan to Chidi', capital: { amount: '1,000,000', date: '', note: '' } }, (d) => { d.rate.percent = '12'; d.income = 'none'; });

// ---------- loans ----------
test('loan: a repayment reduces what is owed, interest keeps running only on the rest, and nothing is counted twice', async () => {
  const { store, pf } = await fresh(); const id = await loan(store);
  await store.create('entry', { investmentId: id, date: '2025-07-02', kind: 'repayment', amountKobo: 50000000, note: '' });
  const m = (await pf.metrics(id, '2026-01-01')).metrics;
  eq([m.valueKobo, m.repaidKobo, m.totalValueKobo, m.netGainKobo], [58991781, 50000000, 108991781, 8991781], '₦1M at 12% simple; ₦500k repaid on day 182; ₦89,917.81 interest earned in all');
  const none = investmentMetrics({ investment: (await store.get(id)), entries: [{ date: '2025-01-01', kind: 'capital_in', amountKobo: 100000000 }], valuations: [], asOf: '2026-01-01' });
  eq(none.netGainKobo, 12000000, 'with no repayment the interest is ₦120,000');
});
test('loan: a loan with no rate owes the principal less repayments, and a fully repaid loan is worth nothing but gained its interest', async () => {
  const { store, pf } = await fresh();
  const id = await make(store, 'loan-given', { capital: { amount: '1,000,000', date: '', note: '' } }, (d) => { d.valueChange = 'none'; d.income = 'none'; });
  await store.create('entry', { investmentId: id, date: '2025-06-01', kind: 'repayment', amountKobo: 30000000, note: '' });
  eq((await pf.metrics(id, TODAY)).metrics.valueKobo, 70000000);
  await store.create('entry', { investmentId: id, date: '2025-07-01', kind: 'repayment', amountKobo: 90000000, note: '' });
  const m = (await pf.metrics(id, TODAY)).metrics; eq([m.valueKobo, m.netGainKobo], [0, 20000000], 'owes nothing; ₦200k more came back than went out');
});
test('loan: a manual valuation is the balance owed, and repayments still count as money received', async () => {
  const { store, pf } = await fresh(); const id = await loan(store);
  await store.create('entry', { investmentId: id, date: '2025-07-01', kind: 'repayment', amountKobo: 40000000, note: '' });
  await store.create('valuation', { investmentId: id, date: '2025-12-01', valueKobo: 65000000, source: 'own_estimate', note: '' });
  const m = (await pf.metrics(id, TODAY)).metrics; eq([m.valueSource, m.valueKobo, m.netGainKobo], ['valuation', 65000000, 5000000]);
});
test('loan: the portfolio summary totals include what was repaid', async () => {
  const { store, pf } = await fresh(); const id = await loan(store);
  await store.create('entry', { investmentId: id, date: '2025-07-02', kind: 'repayment', amountKobo: 50000000, note: '' });
  const s = await pf.summary('2026-01-01'); eq([s.repaidKobo, s.netGainKobo], [50000000, 8991781]);
});

// ---------- editing an investment ----------
test('edit: opening the form and saving without changes changes nothing, for every kind of investment', async () => {
  const { store } = await fresh();
  for (const id of ['land', 'vehicle', 'fixed-income', 'crypto', 'property-rental']) {
    const inv = await make(store, id, {}, (d) => { if (d.valueChange === 'interest') d.rate.percent = '18.5'; if (d.valueChange === 'depreciation') d.rate.percent = '15'; if (d.valueChange === 'appreciation') d.rate.percent = '12.5'; if (d.income === 'schedule') { d.schedule.amount = '100000'; d.schedule.start = '2026-02-01'; } if (tpl(id).defaultBehaviors.term) d.maturityDate = '2026-12-31'; });
    const rec = await store.get(inv), c = buildInvestmentChange(editDraft(rec), rec, tpl(id));
    const after = await store.update(inv, c); eq(after.version, rec.version, `${id}: no new version`);
  }
});
test('edit: rename, change the rate and the start date; the money figures follow', async () => {
  const { store, pf } = await fresh();
  const id = await make(store, 'land', { name: 'Plot' }, (d) => { d.valueChange = 'appreciation'; d.rate.percent = '12'; });
  const rec = await store.get(id), d = editDraft(rec); d.name = 'Plot at Lekki'; d.rates[0].percent = '15'; d.notes = 'Survey done';
  await store.update(id, buildInvestmentChange(d, rec, tpl('land')));
  const after = await store.get(id); eq([after.name, after.rates[0].rate, after.notes, after.version], ['Plot at Lekki', 0.15, 'Survey done', 2]);
  eq((await pf.metrics(id, '2026-01-01')).metrics.currentValueKobo, 1150000000);
});
test('edit: rates can be added for a later period, and overlapping or backwards periods are refused with a reason', async () => {
  const { store } = await fresh();
  const id = await make(store, 'land', {}, (d) => { d.valueChange = 'appreciation'; d.rate.percent = '12'; });
  const rec = await store.get(id), d = editDraft(rec);
  d.rates[0].to = '2026-01-01'; d.rates.push({ type: 'assumed', percent: '20', unit: 'year', method: 'simple', per: '', from: '2026-01-01', to: '' });
  const c = buildInvestmentChange(d, rec, tpl('land')); eq(c.rates.map((r) => [r.rate, r.effectiveFrom, r.effectiveTo]), [[0.12, '2025-01-01', '2026-01-01'], [0.2, '2026-01-01', null]]);
  d.rates[1].from = '2025-06-01'; throwsInput(() => buildInvestmentChange(d, rec, tpl('land')), /overlap/i);
  d.rates[1].from = '2026-01-01'; d.rates[1].to = '2025-12-01'; throwsInput(() => buildInvestmentChange(d, rec, tpl('land')), /after the start/);
  d.rates[1].to = ''; d.rates[1].percent = 'lots'; eq(editErrors(d, tpl('land')).map((e) => e.field), ['rates.1.percent']);
});
test('edit: switching to "I will update the value" drops the rates (the schema forbids them), and interest needs one', async () => {
  const { store } = await fresh();
  const id = await make(store, 'land', {}, (d) => { d.valueChange = 'appreciation'; d.rate.percent = '12'; });
  const rec = await store.get(id), d = editDraft(rec); d.valueChange = 'manualOnly';
  const c = buildInvestmentChange(d, rec, tpl('land')); eq(c.rates, []); eq(c.behaviors.valueChange, 'manualOnly');
  const d2 = editDraft(rec); d2.valueChange = 'interest'; d2.rates = []; eq(editErrors(d2, tpl('land')).map((e) => e.field), ['rates']);
});
test('edit: names, dates and details are checked like in the wizard; custom detail fields can be cleared', async () => {
  const { store } = await fresh();
  const id = await make(store, 'land', {}, (d) => { d.fields.location = 'Lekki'; });
  const rec = await store.get(id), d = editDraft(rec); eq(d.fields.location, 'Lekki');
  d.name = ' '; d.openedOn = '2025-02-30'; eq(editErrors(d, tpl('land')).map((e) => e.field), ['name', 'openedOn']);
  d.name = 'Plot'; d.openedOn = '2025-01-01'; d.fields.location = ''; const c = buildInvestmentChange(d, rec, tpl('land')); eq(c.customFields.location, undefined);
});
test('edit: a closed investment cannot be given an opening date after it closed', async () => {
  const { store } = await fresh();
  const id = await make(store, 'land'); await store.update(id, { status: 'closed', closedOn: '2025-06-01' });
  const rec = await store.get(id), d = editDraft(rec); d.openedOn = '2025-09-01';
  throwsInput(() => buildInvestmentChange(d, rec, tpl('land')), /closed/i);
});

// ---------- regular payments ----------
async function rented(store) { return make(store, 'property-rental', { name: 'Flat' }, (d) => { d.valueChange = 'none'; d.schedule.amount = '100,000'; d.schedule.start = '2026-01-01'; d.schedule.frequency = 'monthly'; }); }
test('schedule: edit the amount and dates; a bad form is refused', async () => {
  const { store } = await fresh(); const id = await rented(store);
  const s = (await store.list('schedule'))[0], d = scheduleDraft(s); eq([d.amount, d.start, d.end, d.frequency], ['100000', '2026-01-01', '', 'monthly']);
  d.amount = '120,000'; d.end = '2026-12-01'; const f = buildScheduleFields(d); eq([f.amountKobo, f.endDate], [12000000, '2026-12-01']);
  await store.update(s.id, f); eq(scheduleEntries(await store.get(s.id), '2026-03-01').map((e) => e.amountKobo), [12000000, 12000000, 12000000]);
  d.amount = ''; throwsInput(() => buildScheduleFields(d)); d.amount = '5'; d.frequency = 'custom'; d.everyDays = ''; throwsInput(() => buildScheduleFields(d), /days/);
});
test('schedule: a rent increase applies from its date, replaces one on the same date, and can be removed', async () => {
  const { store } = await fresh(); const id = await rented(store); let s = (await store.list('schedule'))[0];
  s = await store.update(s.id, { adjustments: withIncrease(s, { from: '2026-03-01', amount: '150,000' }) });
  eq(scheduleEntries(s, '2026-04-01').map((e) => e.amountKobo), [10000000, 10000000, 15000000, 15000000]);
  s = await store.update(s.id, { adjustments: withIncrease(s, { from: '2026-03-01', amount: '160,000' }) }); eq(s.adjustments.length, 1);
  throwsInput(() => withIncrease(s, { from: '2025-01-01', amount: '1' }), /before the first/); throwsInput(() => withIncrease(s, { from: '2026-03-01', amount: 'x' }));
  s = await store.update(s.id, { adjustments: withoutIncrease(s, '2026-03-01') }); eq(scheduleEntries(s, '2026-04-01').map((e) => e.amountKobo), [10000000, 10000000, 10000000, 10000000]);
});
test('schedule: due payments are listed, can be recorded as received once each, and skipped months are not due', async () => {
  const { store, pf } = await fresh(); const id = await rented(store); let s = (await store.list('schedule'))[0];
  let entries = await store.list('entry'); eq(dueUnrecorded(s, entries, TODAY).map((e) => e.date), ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
  await store.create('entry', entryFromDue(s, dueUnrecorded(s, entries, TODAY)[0]));
  s = await store.update(s.id, { skippedDates: withSkipToggled(s, '2026-02-01') });
  entries = await store.list('entry'); eq(dueUnrecorded(s, entries, TODAY).map((e) => e.date), ['2026-03-01', '2026-04-01'], 'recorded and skipped are gone');
  const sk = skippableDates(s, entries, TODAY); eq(sk.map((x) => [x.date, x.skipped]), [['2026-02-01', true], ['2026-03-01', false], ['2026-04-01', false], ['2026-05-01', false], ['2026-06-01', false], ['2026-07-01', false]]);
  s = await store.update(s.id, { skippedDates: withSkipToggled(s, '2026-02-01') }); eq(s.skippedDates, [], 'a skip can be undone');
  eq((await pf.metrics(id, TODAY)).metrics.incomeKobo, 10000000, 'only what was recorded counts as received');
  const up = await pf.upcoming(TODAY, { days: 45 }); eq(up.filter((u) => u.title === s.label || u.kind === 'income').map((u) => u.date), ['2026-05-01']);
});
test('schedule: stopping ends it from that date, a past stop ends it now, and resuming reverses it', async () => {
  const { store, pf } = await fresh(); await rented(store); let s = (await store.list('schedule'))[0];
  eq(stopChange(s, '2026-09-01', TODAY), { endDate: '2026-09-01', status: 'active' }); eq(stopChange(s, '2026-03-01', TODAY), { endDate: '2026-03-01', status: 'ended' });
  throwsInput(() => stopChange(s, '2025-01-01', TODAY), /before the first/);
  s = await store.update(s.id, stopChange(s, '2026-03-01', TODAY)); eq((await pf.upcoming(TODAY)).filter((u) => u.kind === 'income').length, 0);
  s = await store.update(s.id, resumeChange()); eq([s.status, s.endDate], ['active', null]);
});

// ---------- reminders ----------
test('reminder: build, then marking done finishes a one-off and moves a repeating one without drifting', async () => {
  const { store, pf } = await fresh(); const id = await make(store, 'land');
  const f = buildReminder({ text: ' Pay land use charge ', date: '2026-04-20', recurrence: 'yearly' }, id); eq([f.text, f.recurrence, f.done], ['Pay land use charge', 'yearly', false]);
  throwsInput(() => buildReminder({ text: '', date: '2026-04-20', recurrence: 'none' })); throwsInput(() => buildReminder({ text: 'x', date: '2026-13-01', recurrence: 'none' })); throwsInput(() => buildReminder({ text: 'x', date: '2026-04-20', recurrence: 'weekly' }));
  eq(completeChange({ recurrence: 'none', dueDate: '2026-04-01' }, TODAY), { done: true });
  eq(completeChange({ recurrence: 'yearly', dueDate: '2026-04-20' }, TODAY), { dueDate: '2027-04-20' });
  eq(completeChange({ recurrence: 'monthly', dueDate: '2026-01-31' }, TODAY), { dueDate: '2026-04-30' }, 'month ends clamp without drifting');
  eq(completeChange({ recurrence: 'quarterly', dueDate: '2025-01-10' }, TODAY), { dueDate: '2026-07-10' }, 'catches up past several missed periods');
  const r = await store.create('reminder', f); eq((await pf.upcoming(TODAY)).filter((u) => u.kind === 'reminder').map((u) => u.title), ['Pay land use charge']);
  await store.update(r.id, completeChange(r, TODAY)); eq((await pf.upcoming(TODAY)).filter((u) => u.kind === 'reminder').length, 0, 'moved a year ahead');
});

// ---------- shares ----------
async function shared(store) {
  return make(store, 'partnership', { name: 'Vans', capital: { amount: '12,000,000', date: '', note: '' } }, (d) => {
    d.people = [{ ref: 'me', name: 'You', share: '50', putIn: '6,000,000' }, { ref: '', name: 'Ade', share: '30', putIn: '3,600,000' }, { ref: '', name: 'Bola', share: '20', putIn: '2,400,000' }];
  });
}
test('shares: the form starts from the current split; wrong totals, repeats and missing names are refused', async () => {
  const { store } = await fresh(); const id = await shared(store);
  const ownership = (await store.list('ownership')).filter((o) => o.investmentId === id), d = sharesDraft(ownership, await store.list('partner'), TODAY);
  eq(d.rows.map((r) => [r.name, r.share, r.putIn]), [['You', '50', '6000000'], ['Ade', '30', '3600000'], ['Bola', '20', '2400000']]);
  d.rows[2].share = '19.5'; ok(/99\.5%/.test(sharesErrors(d)[0].message)); d.rows[2].share = '20';
  d.rows.push({ ref: '', name: '', share: '', putIn: '' }); ok(sharesErrors(d).some((e) => e.field === 'rows.3.name'));
});
test('shares: correcting a mistake changes the current split in place, from the start', async () => {
  const { store, pf } = await fresh(); const id = await shared(store);
  const ownership = (await store.list('ownership')).filter((o) => o.investmentId === id), d = sharesDraft(ownership, await store.list('partner'), TODAY);
  d.rows[0].share = '40'; d.rows[1].share = '40';
  await applySharesPlan(store, id, buildSharesPlan(d, { ownership, openedOn: '2025-01-01', today: TODAY }));
  const r = await pf.metrics(id, TODAY); eq(r.partners.partners.map((p) => p.ownershipBp), [4000, 4000, 2000]); eq((await store.list('ownership')).length, 3, 'no extra rows');
});
test('shares: a change on a date ends the old split that day and starts the new one, so earlier income keeps the old split', async () => {
  const { store, pf } = await fresh(); const id = await shared(store);
  await store.create('entry', { investmentId: id, date: '2025-06-01', kind: 'income', amountKobo: 1000000, note: '' });
  await store.create('entry', { investmentId: id, date: '2026-03-01', kind: 'income', amountKobo: 1000000, note: '' });
  const ownership = (await store.list('ownership')).filter((o) => o.investmentId === id), d = sharesDraft(ownership, await store.list('partner'), TODAY);
  d.mode = 'change'; d.date = '2026-01-01'; d.rows[0].share = '30'; d.rows[1].share = '50';
  await applySharesPlan(store, id, buildSharesPlan(d, { ownership, openedOn: '2025-01-01', today: TODAY }));
  const r = await pf.metrics(id, TODAY), me = r.partners.partners.find((p) => p.partnerId === 'me');
  eq(me.incomeShareKobo, 500000 + 300000, 'you got 50% of the 2025 income and 30% of the 2026 income'); eq(me.ownershipBp, 3000);
  const early = await pf.metrics(id, '2025-12-31'); eq(early.partners.partners.find((p) => p.partnerId === 'me').ownershipBp, 5000, 'looking back, the old split applies');
  d.date = '2025-01-01'; throwsInput(() => buildSharesPlan(d, { ownership, openedOn: '2025-01-01', today: TODAY }), /must be after/);
});
test('shares: adding a new person, and a failure part-way leaves the split exactly as it was', async () => {
  const { store, pf } = await fresh(); const id = await shared(store);
  const ownership = (await store.list('ownership')).filter((o) => o.investmentId === id), partners = await store.list('partner');
  const d = sharesDraft(ownership, partners, TODAY); d.rows[0].share = '40'; d.rows[1].share = '30'; d.rows[2].share = '20'; d.rows.push({ ref: '', name: 'Chi', share: '10', putIn: '0' });
  const plan = buildSharesPlan(d, { ownership, openedOn: '2025-01-01', today: TODAY });
  let calls = 0; const flaky = { create: (...a) => (++calls === 2 ? Promise.reject(new Error('disk full')) : store.create(...a)), update: (...a) => store.update(...a), remove: (...a) => store.remove(...a), restore: (...a) => store.restore(...a), get: (...a) => store.get(...a) };
  await rejects(applySharesPlan(flaky, id, plan), /disk full/);
  eq((await pf.metrics(id, TODAY)).partners.partners.map((p) => p.ownershipBp), [5000, 3000, 2000], 'unchanged'); eq((await store.list('partner')).length, 2, 'the new person was not left behind');
  await applySharesPlan(store, id, plan); eq((await pf.metrics(id, TODAY)).partners.partners.map((p) => p.ownershipBp), [4000, 3000, 2000, 1000]);
});

// ---------- history ----------
test('history: a diff names what changed, in order, including deletes and restores', async () => {
  const { store } = await fresh(); const id = await make(store, 'land', { name: 'Plot' });
  await store.update(id, { name: 'Plot 2', notes: 'x' }); await store.remove(id); await store.restore(id);
  const h = await store.history(id); eq(h.map((v) => v.version), [1, 2, 3, 4]);
  eq(diffVersions(h[0].record, h[1].record).map((d) => d.key).sort(), ['name', 'notes']);
  eq(diffVersions(h[1].record, h[2].record).map((d) => d.key), ['_deleted']); eq(diffVersions(h[2].record, h[3].record).map((d) => d.key), ['_restored']);
  eq(diffVersions(null, h[0].record).some((d) => d.key === 'name'), true, 'the first version lists everything');
});
test('history: restoring an old version becomes a new version, and the one it replaced can be restored too (undo)', async () => {
  const { store } = await fresh(); const id = await make(store, 'land', { name: 'Plot' });
  await store.update(id, { name: 'Plot 2' }); await store.update(id, { name: 'Plot 3' });
  await store.revertTo(id, 1); const r = await store.get(id); eq([r.name, r.version], ['Plot', 4]);
  await store.revertTo(id, 3); eq((await store.get(id)).name, 'Plot 3'); eq((await store.history(id)).length, 5);
});
test('history: a second device gets the older versions from the server on request', async () => {
  const dek = await generateDek(), mk = () => createStore({ backend: createMemoryBackend(), getDek: () => dek, userId: USER, uuid: () => `h-${++n}` });
  const A = mk(), B = mk(); const inv = await A.create('investment', { name: 'v1', categoryId: 'land', openedOn: '2026-01-01', behaviors: { valueChange: 'appreciation' } });
  await A.update(inv.id, { name: 'v2' }); await A.update(inv.id, { name: 'v3' });
  const rows = (await A.sync.exportRows()), rec = rows.records[0];
  await B.sync.applyRemote([{ id: rec.id, payload: rec.payload, schema_version: rec.schemaVersion, version: rec.version, created_at: rec.createdAt, updated_at: '2026-02-01T00:00:00.000Z', deleted_at: null }]);
  eq((await B.history(inv.id)).map((v) => v.version), [3], 'only the current version is known at first');
  const remote = { getHistory: async () => rows.history.map((h) => ({ record_id: h.recordId, version: h.version, payload: h.payload, saved_at: h.savedAt })) };
  const sync = createSync({ getStore: async () => B, remote, online: () => true });
  eq((await sync.pullHistory(inv.id)).added, 2);
  const h = await B.history(inv.id); eq(h.map((v) => v.record.name), ['v1', 'v2', 'v3']); eq((await sync.pullHistory(inv.id)).added, 0, 'repeating adds nothing');
  eq((await B.sync.dirtyHistory()).length, 0, 'pulled history is not queued to be sent back');
  await rejects(createSync({ getStore: async () => B, remote, online: () => false }).pullHistory(inv.id), /offline/i);
});

// ---------- recently deleted ----------
test('deleted: lists what was deleted on its own, not things hidden only because their investment is deleted', async () => {
  const { store } = await fresh(); const a = await make(store, 'land', { name: 'A' }), b = await make(store, 'land', { name: 'B' });
  const e1 = await store.create('entry', { investmentId: a, date: '2026-01-01', kind: 'cost', amountKobo: 100, note: '' }), e2 = await store.create('entry', { investmentId: b, date: '2026-01-01', kind: 'cost', amountKobo: 200, note: '' });
  await store.remove(e1.id); await store.remove(b);
  const items = await deletedItems(store); eq(items.map((i) => [i.type, i.record.id]).sort(), [['entry', e1.id], ['investment', b]].sort(), 'the entry under deleted B is not listed separately');
  await store.restore(b); eq((await deletedItems(store)).map((i) => i.record.id), [e1.id]); await store.restore(e1.id); eq((await deletedItems(store)).length, 0); ok(e2.id);
});

export async function runManageTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) { try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); } }
  log(`\n${passed} passed, ${failed} failed (editing, schedules, history).`);
  return { passed, failed };
}
