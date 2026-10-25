// Changing what is already saved (Phase 6), without any screen code: editing an investment, its rent schedules,
// reminders, who shares it, and a plain-language diff for the change history. Every builder takes what the
// person typed and returns fields to save, or throws InputError with a sentence to show as it is.
import { D, addDays, addMonths, compareDates, scheduleEntries } from '../engine/index.js';
import { dayNumber } from '../engine/dates.js';
import { META_KEYS, fieldsOf, validate } from './schemas.js';
import { InputError, bpToInput, checkDate, koboToInput, optionalDate, parseNaira, parsePercent, parseShareBp, wholeNumber } from './inputs.js';
import { COMPOUND_CHOICES, RATE_BASED, hasTerm, stepErrors } from './wizard.js';

// ================= editing an investment =================
const pctText = (fraction) => new D(fraction).times(100).toFixed();

export function editDraft(inv) {
  return {
    name: inv.name, openedOn: inv.openedOn, maturityDate: inv.behaviors.term?.maturityDate || '', notes: inv.notes || '',
    fields: Object.fromEntries(Object.entries(inv.customFields || {}).map(([k, v]) => [k, v == null ? '' : String(v)])),
    valueChange: inv.behaviors.valueChange, income: inv.behaviors.income,
    rates: inv.rates.map((r) => ({ type: r.type, percent: pctText(Math.abs(r.rate)), unit: r.rateUnit, method: r.method, per: r.compoundsPerYear ? String(r.compoundsPerYear) : '', from: r.effectiveFrom || '', to: r.effectiveTo || '' })),
  };
}
export const blankRate = (draft) => ({ type: draft.valueChange === 'interest' ? 'agreed' : 'assumed', percent: '', unit: 'year', method: 'simple', per: '', from: '', to: '' });

// [{ field, message }]. Rate fields are reported as `rates.<i>.<name>`.
export function editErrors(draft, template) {
  const errs = [...stepErrors(draft, 'basics', template), ...stepErrors(draft, 'details', template)];
  if (RATE_BASED.includes(draft.valueChange)) {
    draft.rates.forEach((r, i) => {
      const add = (name, fn) => { try { return fn(); } catch (e) { if (e instanceof InputError) { errs.push({ field: `rates.${i}.${name}`, message: e.message }); return undefined; } throw e; } };
      add('percent', () => parsePercent(r.percent));
      const from = add('from', () => optionalDate(r.from, 'The start date'));
      const to = add('to', () => optionalDate(r.to, 'The end date'));
      if (from && to && dayNumber(to) <= dayNumber(from)) errs.push({ field: `rates.${i}.to`, message: 'The end date must be after the start date.' });
      if (r.method === 'compound' && r.per !== '' && !COMPOUND_CHOICES.some(([v]) => v === r.per)) errs.push({ field: `rates.${i}.per`, message: 'Choose how often it compounds.' });
    });
    if (draft.valueChange === 'interest' && draft.rates.length === 0) errs.push({ field: 'rates', message: 'Add the interest rate.' });
  }
  return errs;
}

export function buildInvestmentChange(draft, inv, template) {
  const errs = editErrors(draft, template);
  if (errs.length) throw new InputError(errs[0].message);
  const rateBased = RATE_BASED.includes(draft.valueChange);
  const rates = rateBased ? draft.rates.map((r) => {
    const f = parsePercent(r.percent), compound = r.method === 'compound';
    return { type: r.type, rate: draft.valueChange === 'depreciation' ? -f : f, rateUnit: r.unit, method: r.method, compoundsPerYear: compound ? Number(r.per || (r.unit === 'month' ? '12' : '1')) : null,
      effectiveFrom: optionalDate(r.from) || draft.openedOn, effectiveTo: optionalDate(r.to), label: '' };
  }) : [];
  const customFields = { ...(inv.customFields || {}) };
  for (const d of template?.customFieldDefs || []) {
    const v = (draft.fields[d.key] ?? '').trim();
    if (v) customFields[d.key] = d.type === 'number' ? Number(v) : v; else delete customFields[d.key];
  }
  const term = hasTerm(template) || inv.behaviors.term ? (draft.maturityDate ? { maturityDate: draft.maturityDate } : null) : null;
  const change = {
    name: draft.name.trim(), openedOn: draft.openedOn, notes: draft.notes.trim(),
    behaviors: { ...inv.behaviors, valueChange: draft.valueChange, income: draft.income, term }, rates, customFields,
  };
  try { validate('investment', { ...fieldsOf(inv), ...change }); } // a clear refusal before anything is saved
  catch (e) {
    if (e.code !== 'INVALID') throw e;
    if (/^rates/.test(e.field || '')) throw new InputError('Two of the rates overlap. Give each rate its own dates so only one applies on any day.');
    if (e.field === 'closedOn') throw new InputError('The start date cannot be after the date this investment was closed.');
    throw new InputError(e.message);
  }
  return change;
}

// ================= regular payments (schedules) =================
export const FREQ_TEXT = { monthly: 'every month', quarterly: 'every 3 months', yearly: 'every year' };

export function scheduleDraft(s) {
  return s ? { kind: s.kind, label: s.label, amount: koboToInput(s.amountKobo), frequency: s.frequency, everyDays: s.everyDays ? String(s.everyDays) : '', start: s.startDate, end: s.endDate || '' }
    : { kind: 'income', label: '', amount: '', frequency: 'monthly', everyDays: '', start: '', end: '' };
}
export function scheduleErrors(d) {
  const errs = [], add = (field, fn) => { try { return fn(); } catch (e) { if (e instanceof InputError) { errs.push({ field, message: e.message }); return undefined; } throw e; } };
  add('amount', () => parseNaira(d.amount));
  const start = add('start', () => checkDate(d.start, 'The first payment date'));
  const end = add('end', () => optionalDate(d.end, 'The last payment date'));
  if (start && end && dayNumber(end) < dayNumber(start)) errs.push({ field: 'end', message: 'The last payment cannot be before the first.' });
  if (d.frequency === 'custom') add('everyDays', () => wholeNumber(d.everyDays, { label: 'The number of days' }));
  if (d.label.length > 120) errs.push({ field: 'label', message: 'The label can be at most 120 characters.' });
  return errs;
}
export function buildScheduleFields(d) {
  const errs = scheduleErrors(d); if (errs.length) throw new InputError(errs[0].message);
  return { kind: d.kind, label: d.label.trim(), amountKobo: parseNaira(d.amount), frequency: d.frequency, everyDays: d.frequency === 'custom' ? wholeNumber(d.everyDays) : null, startDate: d.start, endDate: optionalDate(d.end) };
}

// A new amount from a date onward (a rent increase). The same date replaces an earlier change.
export function withIncrease(s, { from, amount }) {
  const date = checkDate(from, 'The date'), amountKobo = parseNaira(amount);
  if (dayNumber(date) < dayNumber(s.startDate)) throw new InputError('The change cannot start before the first payment.');
  return [...s.adjustments.filter((a) => a.from !== date), { from: date, amountKobo }];
}
export const withoutIncrease = (s, from) => s.adjustments.filter((a) => a.from !== from);
export const withSkipToggled = (s, date) => (s.skippedDates.includes(date) ? s.skippedDates.filter((d) => d !== date) : [...s.skippedDates, date]);

// Stop (or resume) a regular payment. Stopping on a date in the past ends it now; a future date ends it then.
export function stopChange(s, dateText, today) {
  const date = checkDate(dateText, 'The last payment date');
  if (dayNumber(date) < dayNumber(s.startDate)) throw new InputError('The last payment cannot be before the first.');
  return { endDate: date, status: compareDates(date, today) <= 0 ? 'ended' : 'active' };
}
export const resumeChange = () => ({ endDate: null, status: 'active' });

const occurrences = (s, upTo) => scheduleEntries({ ...s, skippedDates: [] }, upTo);
// Payments that have fallen due (up to today), were not skipped, and have no entry yet.
export function dueUnrecorded(s, entries, today) {
  return scheduleEntries(s, today).filter((e) => !entries.some((x) => x.linkedScheduleId === s.id && x.date === e.date));
}
// Dates the person may skip: skipped ones (to undo), unrecorded due ones, and the next few to come.
export function skippableDates(s, entries, today, ahead = 3) {
  const recorded = (d) => entries.some((x) => x.linkedScheduleId === s.id && x.date === d);
  const all = occurrences(s, addDays(today, 800)), past = all.filter((e) => compareDates(e.date, today) <= 0 && !recorded(e.date)), future = all.filter((e) => compareDates(e.date, today) > 0).slice(0, ahead);
  return [...past, ...future].map((e) => ({ date: e.date, amountKobo: e.amountKobo, skipped: s.skippedDates.includes(e.date) }));
}
export const entryFromDue = (s, due) => ({ investmentId: s.investmentId, date: due.date, kind: s.kind === 'cost' ? 'cost' : 'income', amountKobo: due.amountKobo, note: '', linkedScheduleId: s.id });

// ================= reminders =================
export const RECURRENCE_CHOICES = [['none', 'Just once'], ['monthly', 'Every month'], ['quarterly', 'Every 3 months'], ['yearly', 'Every year']];
export function buildReminder(form, investmentId = null) {
  const text = (form.text || '').trim();
  if (!text) throw new InputError('Write what you want to be reminded about.');
  if (text.length > 300) throw new InputError('The reminder can be at most 300 characters.');
  if (!RECURRENCE_CHOICES.some(([k]) => k === form.recurrence)) throw new InputError('Choose how often it repeats.');
  return { investmentId, dueDate: checkDate(form.date, 'The date'), text, recurrence: form.recurrence, done: false };
}
const STEP = { monthly: 1, quarterly: 3, yearly: 12 };
// Marking done: a one-off reminder is finished; a repeating one moves to its next date after today.
export function completeChange(r, today) {
  const step = STEP[r.recurrence];
  if (!step) return { done: true };
  let k = 1;
  while (compareDates(addMonths(r.dueDate, k * step), today) <= 0 && k < 2000) k++;
  return { dueDate: addMonths(r.dueDate, k * step) };
}

// ================= who shares an investment =================
const inEffect = (o, date) => (!o.effectiveFrom || compareDates(o.effectiveFrom, date) <= 0) && (!o.effectiveTo || compareDates(date, o.effectiveTo) < 0);
export const currentOwnership = (ownership, today) => ownership.filter((o) => inEffect(o, today));

export function sharesDraft(ownership, partners, today) {
  const rows = currentOwnership(ownership, today).map((o) => ({ ref: o.partnerId, name: o.partnerId === 'me' ? 'You' : partners.find((p) => p.id === o.partnerId)?.name || 'Partner', share: bpToInput(o.percentage), putIn: koboToInput(o.contributionKobo) }));
  rows.sort((a, b) => (a.ref === 'me' ? -1 : b.ref === 'me' ? 1 : a.name.localeCompare(b.name)));
  return { mode: 'correct', date: '', rows };
}
export function sharesErrors(d) {
  const errs = [], add = (field, fn) => { try { return fn(); } catch (e) { if (e instanceof InputError) { errs.push({ field, message: e.message }); return undefined; } throw e; } };
  let total = 0, all = true;
  if (d.rows.length < 2) errs.push({ field: 'rows', message: 'A shared investment needs at least two people.' });
  d.rows.forEach((r, i) => {
    if (r.ref === '' && !r.name.trim()) errs.push({ field: `rows.${i}.name`, message: 'Enter this person’s name.' });
    const bp = add(`rows.${i}.share`, () => parseShareBp(r.share)); if (bp === undefined) all = false; else total += bp;
    add(`rows.${i}.putIn`, () => parseNaira(r.putIn || '0', { allowZero: true }));
  });
  const refs = d.rows.map((r) => r.ref).filter(Boolean);
  if (new Set(refs).size !== refs.length) errs.push({ field: 'rows', message: 'The same person is listed twice.' });
  if (all && total !== 10000) errs.push({ field: 'rows', message: `Shares must add up to 100%. They add up to ${bpToInput(total) || '0'}%.` });
  if (d.mode === 'change') add('date', () => checkDate(d.date, 'The date the shares changed'));
  return errs;
}

// What to save. 'correct' fixes the current split in place (a mistake). 'change' ends the current split on a date and
// starts the new one that day (the shares really changed). Returns { updates, creates, removes, newPartners }.
export function buildSharesPlan(d, { ownership, openedOn, today }) {
  const errs = sharesErrors(d); if (errs.length) throw new InputError(errs[0].message);
  const current = currentOwnership(ownership, today);
  const rows = d.rows.map((r) => ({ ref: r.ref, name: r.name.trim(), bp: parseShareBp(r.share), putIn: parseNaira(r.putIn || '0', { allowZero: true }) }));
  const newPartners = [], target = (r, i) => (r.ref === 'me' ? { me: true } : r.ref ? { id: r.ref } : (newPartners.push({ key: `n${i}`, name: r.name }), { newKey: `n${i}` }));
  const people = rows.map((r, i) => ({ ...r, who: target(r, i) }));
  const idOf = (w) => (w.me ? 'me' : w.id || null);
  const plan = { updates: [], creates: [], removes: [], newPartners };
  if (d.mode === 'change') {
    const date = checkDate(d.date, 'The date the shares changed');
    for (const o of current) {
      if (compareDates(date, o.effectiveFrom || openedOn) <= 0) throw new InputError(`The change date must be after ${o.effectiveFrom || openedOn}, when the current shares started.`);
      plan.updates.push({ id: o.id, change: { effectiveTo: date } });
    }
    for (const p of people) plan.creates.push({ who: p.who, contributionKobo: p.putIn, percentage: p.bp, effectiveFrom: date, effectiveTo: null });
  } else {
    const from = current.map((o) => o.effectiveFrom).filter(Boolean).sort()[0] || null, to = current.find((o) => o.effectiveTo)?.effectiveTo || null;
    const keep = new Set();
    for (const p of people) {
      const match = idOf(p.who) && current.find((o) => o.partnerId === idOf(p.who));
      if (match) { keep.add(match.id); plan.updates.push({ id: match.id, change: { contributionKobo: p.putIn, percentage: p.bp } }); }
      else plan.creates.push({ who: p.who, contributionKobo: p.putIn, percentage: p.bp, effectiveFrom: from, effectiveTo: to });
    }
    for (const o of current) if (!keep.has(o.id)) plan.removes.push(o.id);
  }
  for (const c of plan.creates) validate('ownership', { investmentId: 'pending', partnerId: c.who.me ? 'me' : 'pending', contributionKobo: c.contributionKobo, percentage: c.percentage, effectiveFrom: c.effectiveFrom, effectiveTo: c.effectiveTo });
  return plan;
}

// Saves a shares plan; if any step fails, the steps already done are undone so the split is never left half-changed.
export async function applySharesPlan(store, investmentId, plan) {
  const undo = [];
  try {
    const ids = new Map();
    for (const p of plan.newPartners) { const r = await store.create('partner', { name: p.name }); ids.set(p.key, r.id); undo.push(() => store.remove(r.id)); }
    for (const u of plan.updates) { const before = await store.get(u.id); await store.update(u.id, u.change); undo.push(() => store.update(u.id, { contributionKobo: before.contributionKobo, percentage: before.percentage, effectiveFrom: before.effectiveFrom, effectiveTo: before.effectiveTo })); }
    for (const id of plan.removes) { await store.remove(id); undo.push(() => store.restore(id)); }
    for (const c of plan.creates) {
      const r = await store.create('ownership', { investmentId, partnerId: c.who.me ? 'me' : c.who.id || ids.get(c.who.newKey), contributionKobo: c.contributionKobo, percentage: c.percentage, effectiveFrom: c.effectiveFrom, effectiveTo: c.effectiveTo });
      undo.push(() => store.remove(r.id));
    }
  } catch (e) {
    for (const fn of undo.reverse()) { try { await fn(); } catch { /* best effort */ } }
    throw e;
  }
}

// ================= change history =================
// What differs between two stored versions of one record: [{ key, from, to }], plus 'deleted' / 'restored' markers.
export function diffVersions(prev, next) {
  const out = [], keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})].filter((k) => !META_KEYS.includes(k)));
  for (const key of keys) if (JSON.stringify(prev?.[key] ?? null) !== JSON.stringify(next?.[key] ?? null)) out.push({ key, from: prev?.[key] ?? null, to: next?.[key] ?? null });
  if (!prev?.deletedAt && next?.deletedAt) out.push({ key: '_deleted', from: null, to: true });
  if (prev?.deletedAt && !next?.deletedAt) out.push({ key: '_restored', from: null, to: true });
  return out;
}

// Deleted records worth offering back: investments, and entries/valuations/reminders/schedules that were deleted
// on their own (not just hidden because their investment was deleted).
export async function deletedItems(store) {
  const [invs, ...rest] = await Promise.all(['investment', 'entry', 'valuation', 'schedule', 'reminder'].map((t) => store.list(t, { includeDeleted: true })));
  const invById = new Map(invs.map((i) => [i.id, i]));
  const items = invs.filter((i) => i.deletedAt).map((r) => ({ record: r, type: 'investment', investment: r }));
  for (const list of rest) for (const r of list) {
    if (!r.deletedAt) continue;
    const inv = r.investmentId ? invById.get(r.investmentId) : null;
    if (r.investmentId && (!inv || inv.deletedAt)) continue;
    items.push({ record: r, type: r.type, investment: inv || null });
  }
  return items.sort((a, b) => (a.record.deletedAt < b.record.deletedAt ? 1 : -1));
}
