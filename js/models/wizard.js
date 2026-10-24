// The add-investment wizard, without any screen code: the draft the person is filling in, which steps apply,
// what is wrong with a step, the records the draft turns into, and saving them. Keeping this separate from
// the screens means every rule here is covered by tests that run in Node.
import { formatNaira, scheduleEntries } from '../engine/index.js';
import { dayNumber } from '../engine/dates.js';
import { validate } from './schemas.js';
import { findTemplate } from './templates.js';
import { InputError, checkDate, optionalDate, parseNaira, parsePercent, parseShareBp, wholeNumber } from './inputs.js';

export const VALUE_CHOICES = [
  ['appreciation', 'Grows in value', 'Land, property, anything you expect to be worth more over time.'],
  ['depreciation', 'Loses value', 'Cars and equipment that are worth less each year.'],
  ['interest', 'Earns interest', 'Treasury bills, fixed deposits and loans with an agreed rate.'],
  ['manualOnly', 'I will update the value myself', 'Businesses, crypto, stocks, farms: you enter a valuation when you know it.'],
  ['none', 'Stays at what I paid', 'The value does not change unless you say so.'],
];
export const INCOME_CHOICES = [
  ['none', 'No income', 'It does not pay anything.'],
  ['schedule', 'Regular payments', 'Rent or a fixed amount that arrives on a set pattern.'],
  ['irregular', 'Now and then', 'Payouts or income that come at no fixed time. You add each one when it arrives.'],
];
export const FREQUENCY_CHOICES = [['monthly', 'Every month'], ['quarterly', 'Every 3 months'], ['yearly', 'Every year'], ['custom', 'Every so many days']];
export const COMPOUND_CHOICES = [['1', 'Yearly'], ['2', 'Half-yearly'], ['4', 'Quarterly'], ['12', 'Monthly'], ['365', 'Daily']];
export const RATE_BASED = ['appreciation', 'depreciation', 'interest'];
export const SOURCE_CHOICES = [['own_estimate', 'My own estimate'], ['agent', 'An agent'], ['comparable_sale', 'A similar sale'], ['bank', 'A bank'], ['other', 'Another source']];

export function newDraft(today) {
  return {
    templateId: null, name: '', openedOn: today, maturityDate: '', ownership: 'sole', notes: '', fields: {},
    capital: { amount: '', date: '', note: '' },
    valueChange: 'manualOnly',
    rate: { type: 'assumed', percent: '', unit: 'year', method: 'simple', per: '', from: '' },
    current: { amount: '', date: today, source: 'own_estimate' },
    income: 'none',
    schedule: { label: '', amount: '', frequency: 'monthly', everyDays: '', start: today, end: '', recordPast: false },
    people: [{ ref: 'me', name: 'You', share: '', putIn: '' }, { ref: '', name: '', share: '', putIn: '' }],
  };
}

// Starting a draft from a category: its presets become the first answers, and every one can be changed.
export function applyTemplate(draft, template, today) {
  const b = template.defaultBehaviors;
  return {
    ...newDraft(today), name: draft.name, openedOn: draft.openedOn, templateId: template.id,
    valueChange: b.valueChange, income: b.income, ownership: b.ownership,
    rate: { ...newDraft(today).rate, type: b.valueChange === 'interest' ? 'agreed' : 'assumed' },
  };
}

export const hasTerm = (template) => !!template?.defaultBehaviors?.term;

export function stepsFor(draft, template) {
  const steps = ['category', 'basics'];
  if (template?.customFieldDefs?.length) steps.push('details');
  steps.push('money', 'value', 'income');
  if (draft.ownership === 'shared') steps.push('people');
  steps.push('review');
  return steps;
}
export const STEP_TITLES = { category: 'What kind of investment is it?', basics: 'The basics', details: 'More details', money: 'Money put in', value: 'How its value changes', income: 'Income it pays', people: 'Who shares it', review: 'Check and save' };

// ---------- checking a step ----------
// Returns a list of { field, message }. Empty means the step is fine.
export function stepErrors(draft, step, template, { today } = {}) {
  const errs = [];
  const check = (field, fn) => { try { return fn(); } catch (e) { if (e instanceof InputError) { errs.push({ field, message: e.message }); return undefined; } throw e; } };
  const fail = (field, message) => errs.push({ field, message });

  if (step === 'category') { if (!draft.templateId) fail('templateId', 'Choose a category to continue.'); }

  if (step === 'basics') {
    const name = draft.name.trim();
    if (!name) fail('name', 'Give the investment a name.'); else if (name.length > 120) fail('name', 'The name can be at most 120 characters.');
    const opened = check('openedOn', () => checkDate(draft.openedOn, 'The start date'));
    if (hasTerm(template)) {
      const m = check('maturityDate', () => checkDate(draft.maturityDate, 'The maturity date'));
      if (m && opened && dayNumber(m) < dayNumber(opened)) fail('maturityDate', 'The maturity date cannot be before the start date.');
    }
    if (draft.notes.length > 5000) fail('notes', 'Notes can be at most 5000 characters.');
  }

  if (step === 'details') {
    for (const d of template?.customFieldDefs || []) {
      const v = (draft.fields[d.key] ?? '').trim();
      if (!v) continue;
      if (v.length > 500) fail(d.key, 'This is too long (500 characters at most).');
      if (d.type === 'number' && !(Number.isFinite(Number(v)) && Math.abs(Number(v)) <= 1e15)) fail(d.key, 'Enter a number.');
      if (d.type === 'date') check(d.key, () => checkDate(v, d.label));
    }
  }

  if (step === 'money') {
    check('capital.amount', () => parseNaira(draft.capital.amount));
    check('capital.date', () => optionalDate(draft.capital.date, 'The date'));
    if (draft.capital.note.length > 1000) fail('capital.note', 'The note can be at most 1000 characters.');
  }

  if (step === 'value') {
    if (RATE_BASED.includes(draft.valueChange)) {
      const r = draft.rate;
      if (r.percent.trim() === '') { if (draft.valueChange === 'interest') fail('rate.percent', 'Enter the interest rate, or choose another way its value changes.'); }
      else check('rate.percent', () => parsePercent(r.percent));
      check('rate.from', () => optionalDate(r.from, 'The date the rate starts'));
      if (r.method === 'compound' && r.per !== '' && !COMPOUND_CHOICES.some(([v]) => v === r.per)) fail('rate.per', 'Choose how often it compounds.');
    }
    if (draft.valueChange !== 'none' && draft.current.amount.trim() !== '') {
      check('current.amount', () => parseNaira(draft.current.amount, { allowZero: true }));
      check('current.date', () => checkDate(draft.current.date, 'The valuation date'));
    }
  }

  if (step === 'income' && draft.income === 'schedule') {
    const s = draft.schedule;
    check('schedule.amount', () => parseNaira(s.amount));
    const start = check('schedule.start', () => checkDate(s.start, 'The first payment date'));
    const end = check('schedule.end', () => optionalDate(s.end, 'The last payment date'));
    if (start && end && dayNumber(end) < dayNumber(start)) fail('schedule.end', 'The last payment cannot be before the first.');
    if (s.frequency === 'custom') check('schedule.everyDays', () => wholeNumber(s.everyDays, { label: 'The number of days' }));
    if (s.label.length > 120) fail('schedule.label', 'The label can be at most 120 characters.');
  }

  if (step === 'people' && draft.ownership === 'shared') {
    const rows = draft.people;
    if (rows.length < 2) fail('people', 'A shared investment needs at least two people (you and one more).');
    let totalBp = 0, totalPutIn = 0, allShares = true, allPutIns = true;
    rows.forEach((p, i) => {
      if (p.ref !== 'me' && p.ref === '' && !p.name.trim()) fail(`people.${i}.name`, 'Enter this person’s name.');
      const bp = check(`people.${i}.share`, () => parseShareBp(p.share));
      if (bp === undefined) allShares = false; else totalBp += bp;
      const k = check(`people.${i}.putIn`, () => parseNaira(p.putIn || '0', { allowZero: true }));
      if (k === undefined) allPutIns = false; else totalPutIn += k;
    });
    const refs = rows.map((p) => p.ref).filter((r) => r);
    if (new Set(refs).size !== refs.length) fail('people', 'The same person is listed twice.');
    if (allShares && totalBp !== 10000) fail('people', `Shares must add up to 100%. They add up to ${(totalBp / 100).toFixed(2).replace(/\.?0+$/, '')}%.`);
    let capital; try { capital = parseNaira(draft.capital.amount); } catch { capital = null; }
    if (allPutIns && capital != null && totalPutIn !== capital) {
      fail('people', `What everyone put in must equal the money put in for the investment (${formatNaira(capital)}). It adds up to ${formatNaira(totalPutIn)}.`);
    }
  }

  if (step === 'review') {
    for (const s of stepsFor(draft, template)) if (s !== 'review') errs.push(...stepErrors(draft, s, template, { today }).map((e) => ({ ...e, step: s })));
  }
  return errs;
}

// ---------- the records a draft becomes ----------
export function buildPlan(draft, template, { today }) {
  const errs = stepErrors(draft, 'review', template, { today });
  if (errs.length) throw new InputError(errs[0].message);
  const opened = draft.openedOn;
  const rateBased = RATE_BASED.includes(draft.valueChange);

  const rates = [];
  if (rateBased && draft.rate.percent.trim() !== '') {
    const f = parsePercent(draft.rate.percent);
    const compound = draft.rate.method === 'compound';
    rates.push({
      type: draft.rate.type, rate: draft.valueChange === 'depreciation' ? -f : f, rateUnit: draft.rate.unit,
      method: draft.rate.method, compoundsPerYear: compound ? Number(draft.rate.per || (draft.rate.unit === 'month' ? '12' : '1')) : null,
      effectiveFrom: optionalDate(draft.rate.from) || opened, effectiveTo: null, label: '',
    });
  }
  const customFields = {};
  for (const d of template.customFieldDefs || []) {
    const v = (draft.fields[d.key] ?? '').trim();
    if (v) customFields[d.key] = d.type === 'number' ? Number(v) : v;
  }
  const investment = {
    name: draft.name.trim(), categoryId: template.id, status: 'active', openedOn: opened, closedOn: null, notes: draft.notes.trim(),
    behaviors: { valueChange: draft.valueChange, income: draft.income, ownership: draft.ownership, term: hasTerm(template) ? { maturityDate: draft.maturityDate } : null },
    rates, customFields, coverImageRef: null,
  };
  const entries = [{ date: optionalDate(draft.capital.date) || opened, kind: 'capital_in', amountKobo: parseNaira(draft.capital.amount), note: draft.capital.note.trim() }];

  let valuation = null;
  if (draft.valueChange !== 'none' && draft.current.amount.trim() !== '') {
    valuation = { date: draft.current.date, valueKobo: parseNaira(draft.current.amount, { allowZero: true }), source: draft.current.source, note: '' };
  }
  let schedule = null, pastCount = 0, pastTotalKobo = 0;
  if (draft.income === 'schedule') {
    const s = draft.schedule, custom = s.frequency === 'custom';
    schedule = {
      kind: 'income', label: s.label.trim() || 'Regular income', amountKobo: parseNaira(s.amount), frequency: s.frequency,
      everyDays: custom ? wholeNumber(s.everyDays, { label: 'The number of days' }) : null, startDate: s.start, endDate: optionalDate(s.end),
      adjustments: [], skippedDates: [], status: 'active',
    };
    const due = scheduleEntries(schedule, today);
    pastCount = due.length; pastTotalKobo = due.reduce((a, e) => a + e.amountKobo, 0);
  }
  const partners = [], ownership = [];
  if (draft.ownership === 'shared') {
    draft.people.forEach((p, i) => {
      let partnerRef;
      if (p.ref === 'me') partnerRef = { me: true };
      else if (p.ref) partnerRef = { id: p.ref };
      else { partners.push({ key: `new${i}`, name: p.name.trim() }); partnerRef = { newKey: `new${i}` }; }
      ownership.push({ partnerRef, contributionKobo: parseNaira(p.putIn || '0', { allowZero: true }), percentage: parseShareBp(p.share), effectiveFrom: opened, effectiveTo: null });
    });
  }
  const plan = { investment, entries, valuation, schedule, recordPast: !!(schedule && draft.schedule.recordPast && pastCount > 0), pastCount, pastTotalKobo, partners, ownership, today };

  // Run every record through the real validation now, so a mistake is found before anything is saved.
  validate('investment', investment);
  for (const e of entries) validate('entry', { ...e, investmentId: 'pending' });
  if (valuation) validate('valuation', { ...valuation, investmentId: 'pending' });
  if (schedule) validate('schedule', { ...schedule, investmentId: 'pending' });
  for (const p of partners) validate('partner', { name: p.name });
  for (const o of ownership) validate('ownership', { investmentId: 'pending', partnerId: o.partnerRef.me ? 'me' : 'pending', contributionKobo: o.contributionKobo, percentage: o.percentage, effectiveFrom: o.effectiveFrom, effectiveTo: o.effectiveTo });
  return plan;
}

// Saves a plan. The store saves one record at a time, so if anything fails part-way the records already made
// are removed again (soft delete) and the error is passed on: no half-made investment is left on the list.
export async function savePlan(store, plan) {
  const made = [];
  const mk = async (type, data) => { const r = await store.create(type, data); made.push(r.id); return r; };
  try {
    const partnerIds = new Map();
    for (const p of plan.partners) partnerIds.set(p.key, (await mk('partner', { name: p.name })).id);
    const inv = await mk('investment', plan.investment);
    for (const e of plan.entries) await mk('entry', { ...e, investmentId: inv.id });
    if (plan.valuation) await mk('valuation', { ...plan.valuation, investmentId: inv.id });
    if (plan.schedule) {
      const s = await mk('schedule', { ...plan.schedule, investmentId: inv.id });
      if (plan.recordPast) {
        for (const d of scheduleEntries(s, plan.today)) await mk('entry', { investmentId: inv.id, date: d.date, kind: 'income', amountKobo: d.amountKobo, note: '', linkedScheduleId: s.id });
      }
    }
    for (const o of plan.ownership) {
      const partnerId = o.partnerRef.me ? 'me' : o.partnerRef.id || partnerIds.get(o.partnerRef.newKey);
      await mk('ownership', { investmentId: inv.id, partnerId, contributionKobo: o.contributionKobo, percentage: o.percentage, effectiveFrom: o.effectiveFrom, effectiveTo: o.effectiveTo });
    }
    return { investmentId: inv.id };
  } catch (e) {
    for (const id of made.reverse()) { try { await store.remove(id); } catch { /* best effort */ } }
    throw e;
  }
}

export { findTemplate };
