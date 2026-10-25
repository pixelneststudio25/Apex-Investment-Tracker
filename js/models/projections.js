// Projections (Phase 7). A projection is a "what if", never a fact: nothing here is saved, and every row carries
// isProjection: true. The growth maths is the engine's project() (the same Decimal code as everywhere else); this
// file only (1) turns what people type into a scenario, text first, never floating-point multiplication, (2) adds the
// regular payments that are still expected, and (3) words the working.
//
// Conventions chosen (see docs/phase7-notes.md):
//  - The starting point is what the investment is worth TODAY (its latest valuation, or its estimate, or cost).
//  - One yearly rate applies from today to the end of every horizon. Rates saved on the investment are not
//    replayed; they are only offered as the starting answer for Scenario A.
//  - Regular payments are counted only from tomorrow on. A payment that is already due but not recorded is never
//    assumed to have arrived, so it is left out (the screen says how many).
//  - Horizons are whole years counted by the calendar, then actual days / 365 (engine rule).
import { D, compareDates, project, scheduleEntries, xirr } from '../engine/index.js';
import { InputError, parsePercent } from './inputs.js';

export const HORIZON_YEARS = Object.freeze([1, 3, 5, 10]);
export const MAX_YEARS = 50;
export const METHODS = Object.freeze([
  ['simple', 'Simple (the same amount each year)'],
  ['compound1', 'Compounded once a year'],
  ['compound12', 'Compounded monthly'],
]);
export const DIRECTIONS = Object.freeze([['grows', 'Grows'], ['loses', 'Loses value']]);

export const blankScenario = (label = '') => ({ label, percent: '', direction: 'grows', method: 'simple' });

// 0.19 -> "19", 0.125 -> "12.5". Decimal text, so no floating-point noise such as 12.500000000000002.
const fractionToPercentText = (f) => new D(String(f)).times(100).toDecimalPlaces(6).toString();

// A rate saved on the investment, offered as Scenario A's starting answer. Null when it cannot be shown faithfully
// in the three ways this screen can compound (so Apex never offers a number it would then calculate differently).
export function scenarioFromRate(rate) {
  if (!rate || !Number.isFinite(rate.rate) || rate.rate === 0) return null;
  const yearly = (rate.rateUnit || 'year') === 'year';
  const n = rate.method === 'compound' ? (rate.compoundsPerYear ?? (yearly ? 1 : 12)) : null;
  let method;
  if (rate.method !== 'compound') method = 'simple';
  else if (n === 1 && yearly) method = 'compound1';
  else if (n === 12) method = 'compound12';
  else return null;
  const nominal = yearly ? new D(String(Math.abs(rate.rate))) : new D(String(Math.abs(rate.rate))).times(12);
  return { label: rate.type === 'agreed' ? 'Agreed rate' : 'Assumed rate', percent: nominal.times(100).toDecimalPlaces(6).toString(), direction: rate.rate < 0 ? 'loses' : 'grows', method };
}

// The rate that applies today (or, failing that, the latest one), preferring an agreed rate over an assumed one.
export function startingScenario(investment, asOf) {
  const rates = (investment.rates || []).filter((r) => (!r.effectiveFrom || r.effectiveFrom <= asOf) && (!r.effectiveTo || r.effectiveTo > asOf));
  const pick = rates.find((r) => r.type === 'agreed') || rates[0];
  return scenarioFromRate(pick);
}

// Form text -> a clean scenario, or null when the rate box is empty (the scenario is simply off). Throws InputError.
export function buildScenario(form, fallbackLabel = 'Scenario') {
  const text = String(form?.percent ?? '').trim();
  if (!text) return null;
  const fraction = parsePercent(text, { max: 1000 });
  const label = String(form.label ?? '').trim() || fallbackLabel;
  if (label.length > 40) throw new InputError('Give the scenario a name of 40 characters or fewer.');
  if (!['grows', 'loses'].includes(form.direction)) throw new InputError('Choose whether it grows or loses value.');
  if (!METHODS.some(([v]) => v === form.method)) throw new InputError('Choose how the rate is applied.');
  if (form.direction === 'loses' && fraction > 1) throw new InputError('Something cannot lose more than 100% a year. Use a figure up to 100.');
  return { label, percentText: text.replace(/[%\s]/g, ''), rate: form.direction === 'loses' ? -fraction : fraction, direction: form.direction, method: form.method };
}

// "7" -> 7. Blank -> null. Whole years only, because a horizon is counted by the calendar.
export function parseYears(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) throw new InputError('Years must be a whole number, for example 7.');
  const n = Number(s);
  if (n < 1 || n > MAX_YEARS) throw new InputError(`Years must be between 1 and ${MAX_YEARS}.`);
  return n;
}
export const horizonList = (extra) => [...new Set([...HORIZON_YEARS, ...(extra ? [extra] : [])])].sort((a, b) => a - b);

const rateFor = (sc) => ({ type: 'assumed', rate: sc.rate, rateUnit: 'year', method: sc.method === 'simple' ? 'simple' : 'compound', ...(sc.method === 'compound12' ? { compoundsPerYear: 12 } : sc.method === 'compound1' ? { compoundsPerYear: 1 } : {}) });

// Payments still expected after `asOf`, up to `endDate`: from every active regular-payment schedule, skipping dates
// that already have a recorded entry. Returns { income: [{date, amountKobo}], costs: [...] } in date order.
export function expectedPayments(bundle, asOf, endDate) {
  const out = { income: [], costs: [] };
  for (const s of bundle.schedules || []) {
    if (s.status !== 'active') continue;
    for (const e of scheduleEntries(s, endDate, { after: asOf })) {
      if (bundle.entries.some((x) => x.linkedScheduleId === s.id && x.date === e.date)) continue;
      (s.kind === 'cost' ? out.costs : out.income).push({ date: e.date, amountKobo: e.amountKobo });
    }
  }
  for (const k of ['income', 'costs']) out[k].sort((a, b) => compareDates(a.date, b.date));
  return out;
}
const total = (list) => list.reduce((s, e) => s + e.amountKobo, 0);

// One scenario for several horizons. `startKobo` is what the investment is worth today.
export function projectScenario({ bundle, startKobo, asOf, scenario, years, includePayments = true }) {
  if (!Number.isSafeInteger(startKobo) || startKobo < 0) throw new InputError('There is no worth to start from yet.');
  const horizons = years.map((y) => ({ years: y }));
  const base = project({ principalKobo: startKobo, startDate: asOf, rates: [rateFor(scenario)], horizons });
  return base.map((row, i) => {
    const pay = includePayments ? expectedPayments(bundle, asOf, row.endDate) : { income: [], costs: [] };
    const incomeKobo = total(pay.income), costsKobo = total(pay.costs);
    const gainKobo = row.valueKobo + incomeKobo - costsKobo - startKobo;
    const flows = [{ date: asOf, amountKobo: -startKobo }, ...pay.income.map((e) => ({ date: e.date, amountKobo: e.amountKobo })), ...pay.costs.map((e) => ({ date: e.date, amountKobo: -e.amountKobo })), { date: row.endDate, amountKobo: row.valueKobo }];
    const annualRate = startKobo > 0 ? (pay.income.length || pay.costs.length ? xirr(flows) : row.annualizedRate) : null;
    return { isProjection: true, years: years[i], endDate: row.endDate, days: row.days, valueKobo: row.valueKobo, incomeKobo, costsKobo, incomeCount: pay.income.length, costsCount: pay.costs.length, gainKobo, annualRate, shortHold: row.shortHold, startKobo };
  });
}

// Scenario A, and Scenario B when it was filled in, with the difference (B minus A) at each horizon.
export function runProjection({ bundle, startKobo, asOf, a, b = null, years, includePayments = true }) {
  const rowsA = projectScenario({ bundle, startKobo, asOf, scenario: a, years, includePayments });
  const rowsB = b ? projectScenario({ bundle, startKobo, asOf, scenario: b, years, includePayments }) : null;
  const diff = rowsB ? rowsA.map((r, i) => ({ years: r.years, endDate: r.endDate, valueKobo: rowsB[i].valueKobo - r.valueKobo, gainKobo: rowsB[i].gainKobo - r.gainKobo })) : null;
  return { isProjection: true, asOf, startKobo, a: { scenario: a, rows: rowsA }, b: rowsB ? { scenario: b, rows: rowsB } : null, diff };
}

// Payments already due but not recorded: not counted, and the screen says so.
export function dueNotCounted(bundle, asOf, dueFn) {
  return (bundle.schedules || []).filter((s) => s.status === 'active').reduce((n, s) => n + dueFn(s, bundle.entries, asOf).length, 0);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const every = (m) => (m === 'compound12' ? 'monthly' : 'once a year');

// Plain-language working for one scenario and one horizon. `fmt` formats kobo (the screen passes its own, which honours
// "hide amounts"); `pctText` is how the rate was typed.
export function explain({ row, scenario, startKobo, fmt, startNote }) {
  const rate = `${scenario.percentText}%`, days = plural(row.days, 'day', 'days');
  const lines = [`Starting point: ${fmt(startKobo)}, ${startNote || 'what it is worth today'}.`];
  const verb = scenario.direction === 'loses' ? 'loses' : 'grows';
  if (scenario.method === 'simple') lines.push(`Worth after ${plural(row.years, 'year', 'years')} = start × (${scenario.direction === 'loses' ? '1 − ' : '1 + '}${rate} × ${row.days} ÷ 365). It ${verb} by the same amount each year: ${rate} a year, over ${days}.`);
  else lines.push(`Worth after ${plural(row.years, 'year', 'years')} = start × (1 ${scenario.direction === 'loses' ? '−' : '+'} ${rate} ÷ ${scenario.method === 'compound12' ? 12 : 1}) ^ (${scenario.method === 'compound12' ? 12 : 1} × ${row.days} ÷ 365). It ${verb} ${rate} a year, compounded ${every(scenario.method)}, over ${days}.`);
  lines.push(`That gives ${fmt(row.valueKobo)}. Days are counted from today to ${row.endDate}, which is ${plural(row.years, 'year', 'years')} by the calendar.`);
  if (row.incomeCount || row.costsCount) lines.push(`Regular payments still expected: ${plural(row.incomeCount, 'payment', 'payments')} in, ${fmt(row.incomeKobo)} in all${row.costsCount ? `, and ${plural(row.costsCount, 'cost', 'costs')} out, ${fmt(row.costsKobo)} in all` : ''}. They follow your saved payment plans, including any increases and skipped months.`);
  lines.push(`Gain from today = worth then + income − costs − worth today = ${fmt(row.valueKobo)} + ${fmt(row.incomeKobo)} − ${fmt(row.costsKobo)} − ${fmt(startKobo)} = ${fmt(row.gainKobo)}.`);
  if (row.annualRate != null) lines.push(`Yearly return is the single yearly rate at which the worth today, the payments and the final worth balance.${row.shortHold ? ' Under a year, treat it as a rough guide.' : ''}`);
  return lines;
}
