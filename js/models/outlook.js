// Outlook engine (Phase 12-i). The whole-portfolio "what could it be worth later" calculation behind the Outlook tab.
// It has no screen and saves nothing; every figure it returns is a projection (isProjection: true).
//
// Rules (see docs/phase12-i-notes.md):
//  - Each open investment starts from what it is worth today (its metrics value) and its rates are used exactly as saved,
//    including quarterly, daily or any other compounding. Nothing is ever turned into a different kind of rate.
//  - Rate changes already saved with a future start date are replayed on their dates.
//  - A term investment stops growing at its maturity date and then sits at its maturity value.
//  - An investment with no rate after today is held flat and labelled "none". Apex never invents a rate.
//  - An edited rate (override) replaces the saved rates from today onward for that investment only.
//  - A nudge adds the same number of points to every rate that exists (never to a held-flat investment).
//  - Full value (the default, same as Home) or My share (only the person's own percentage of a shared investment).
//  - Real terms: every future figure is divided by (1 + inflation) for the days between today and its date. The
//    inflation figure is whatever the person types; none is built in.
//  - Regular payments follow the saved payment plans, counted from tomorrow, exactly like the single projection.
import { D, addDays, addMonths, compareDates, daysBetween, ownershipOn, toKobo, valueAfter } from '../engine/index.js';
import { InputError, parsePercent } from './inputs.js';
import { splitItems } from './portfolio-projection.js';
import { expectedPayments } from './projections.js';

export const SHARE_MODES = Object.freeze(['full', 'mine']);
export const MAX_OUTLOOK_YEARS = 50;
export const NUDGE_LIMIT = 0.5; // a portfolio-wide nudge is limited to 50 points either way

// "4.5" -> 0.045. Blank -> null (real terms off). 0 is allowed. Throws InputError.
export function parseInflation(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  return parsePercent(s, { max: 100 });
}

// "3" -> 0.03, with a direction: nudge points are a number of percentage points added to every rate.
export function parseNudge(text, direction = 'up') {
  const s = String(text ?? '').trim();
  if (!s) return 0;
  const f = parsePercent(s, { max: NUDGE_LIMIT * 100 });
  return direction === 'down' ? -f : f;
}

// The person's own share of an investment on `asOf`, in basis points (10000 = all of it).
export function myShareBp(bundle, asOf) {
  if (bundle.investment?.behaviors?.ownership !== 'shared' || !bundle.ownership?.length) return 10000;
  return ownershipOn(bundle.ownership, asOf).filter((o) => o.partnerId === 'me').reduce((t, o) => t + o.percentage, 0);
}

export const maturityOf = (investment) => investment.behaviors?.term?.maturityDate || null;

// Saved rates that still matter after `asOf` (a rate that ended on or before today is history).
export function savedRatesAfter(investment, asOf) {
  return (investment.rates || []).filter((r) => !r.effectiveTo || compareDates(r.effectiveTo, asOf) > 0);
}

// An edited rate (what buildScenario returns) as an engine rate that applies from today onward.
export function overrideRate(sc) {
  return { type: 'assumed', rate: sc.rate, rateUnit: 'year', method: sc.method === 'simple' ? 'simple' : 'compound',
    ...(sc.method === 'compound12' ? { compoundsPerYear: 12 } : sc.method === 'compound1' ? { compoundsPerYear: 1 } : {}) };
}

// Add `nudge` (a fraction, so 0.03 is three points) to every rate. A monthly rate moves by a twelfth, because it is
// a yearly rate of twelve times.
export function nudgeRates(rates, nudge) {
  if (!nudge) return rates;
  return rates.map((r) => ({ ...r, rate: new D(String(r.rate)).plus(new D(String(nudge)).div((r.rateUnit || 'year') === 'month' ? 12 : 1)).toNumber() }));
}

// Which rates apply to one investment, and where they came from: 'edited', 'saved' or 'none' (held flat).
export function ratesFor({ investment, asOf, override = null, nudge = 0 }) {
  if (override) return { source: 'edited', rates: nudgeRates([overrideRate(override)], nudge) };
  const saved = savedRatesAfter(investment, asOf);
  if (!saved.length) return { source: 'none', rates: [] };
  return { source: 'saved', rates: nudgeRates(saved, nudge) };
}

// Exact worth on `date`: grown only up to maturity, and held there afterwards. Returns a Decimal.
function worthOn({ startKobo, asOf, date, rates, maturity }) {
  const end = maturity && compareDates(maturity, date) < 0 ? maturity : date;
  if (compareDates(end, asOf) <= 0 || !rates.length) return new D(startKobo);
  return valueAfter(startKobo, asOf, end, rates);
}

// Today's money: divide by (1 + inflation) for the years between today and `date`.
export function deflator(inflation, asOf, date) {
  if (inflation == null || inflation === 0) return new D(1);
  return new D(1).plus(new D(String(inflation))).pow(new D(daysBetween(asOf, date)).div(365));
}

const scale = (x, bp) => (bp === 10000 ? x : x.times(bp).div(10000));

// One investment on a list of ascending dates (each on or after asOf). Returns per-date cumulative figures.
function seriesFor({ item, asOf, dates, override, nudge, share, inflation }) {
  const { investment, bundle, metrics } = item;
  const bp = share === 'mine' ? myShareBp(bundle, asOf) : 10000;
  const { source, rates } = ratesFor({ investment, asOf, override, nudge });
  const maturity = maturityOf(investment);
  const last = dates[dates.length - 1];
  const pay = expectedPayments(bundle, asOf, last);
  const startKobo = toKobo(scale(new D(metrics.valueKobo), bp));
  let ii = 0, ci = 0, inc = new D(0), cost = new D(0);
  const points = dates.map((date) => {
    while (ii < pay.income.length && compareDates(pay.income[ii].date, date) <= 0) { inc = inc.plus(new D(pay.income[ii].amountKobo).div(deflator(inflation, asOf, pay.income[ii].date))); ii++; }
    while (ci < pay.costs.length && compareDates(pay.costs[ci].date, date) <= 0) { cost = cost.plus(new D(pay.costs[ci].amountKobo).div(deflator(inflation, asOf, pay.costs[ci].date))); ci++; }
    const worth = worthOn({ startKobo: metrics.valueKobo, asOf, date, rates, maturity }).div(deflator(inflation, asOf, date));
    return { date, valueKobo: toKobo(scale(worth, bp)), incomeKobo: toKobo(scale(inc, bp)), costsKobo: toKobo(scale(cost, bp)) };
  });
  const matured = !!maturity && compareDates(maturity, asOf) <= 0;
  return { investment, source, startKobo, maturityDate: maturity, matured, shareBp: bp, points };
}

const sum = (xs) => { const t = xs.reduce((a, b) => a + b, 0); if (!Number.isSafeInteger(t)) throw new InputError('The portfolio total is too large to project.'); return t; };

/**
 * The Outlook projection.
 *   items      [{ investment, bundle, metrics, error }] as loadReport() returns them
 *   years      the horizon in whole years (1 to 50). Rows are returned for every whole year up to it.
 *   rowYears   optional list of years to return table rows for (default: 1, 3, 5, 10 and the horizon, up to the horizon)
 *   overrides  { [investmentId]: scenario from buildScenario() }  edited rates
 *   nudge      fraction added to every existing rate (0.03 = three points)
 *   share      'full' (default) or 'mine'
 *   inflation  fraction or null; non-null turns every future figure into today's money
 *   includePayments  add expected regular payments (default true)
 * Returns { months: [...monthly totals, index 0 = today], rows: [...], parts: [...per investment], ... }.
 */
export function projectOutlook({ items, asOf, years, rowYears = null, overrides = {}, nudge = 0, share = 'full', inflation = null, includePayments = true }) {
  if (!Number.isInteger(years) || years < 1 || years > MAX_OUTLOOK_YEARS) throw new InputError(`Years must be between 1 and ${MAX_OUTLOOK_YEARS}.`);
  if (!SHARE_MODES.includes(share)) throw new InputError('Choose Full value or My share.');
  if (!Number.isFinite(nudge) || Math.abs(nudge) > NUDGE_LIMIT) throw new InputError(`The nudge must be within ${NUDGE_LIMIT * 100} points either way.`);
  if (inflation != null && !(Number.isFinite(inflation) && inflation >= 0 && inflation <= 1)) throw new InputError('Inflation must be between 0% and 100%.');
  const { open, broken: brokenNames, closedCount } = splitItems(items);
  if (!open.length) throw new InputError('There is no open investment to project.');

  const dates = Array.from({ length: years * 12 + 1 }, (_, m) => addMonths(asOf, m));
  const broken = [...brokenNames];
  const parts = [];
  for (const item of open) {
    try {
      const noPay = includePayments ? item : { ...item, bundle: { ...item.bundle, schedules: [] } };
      parts.push(seriesFor({ item: noPay, asOf, dates, override: overrides[item.investment.id] || null, nudge, share, inflation }));
    } catch (e) {
      if (e.code === 'OWNERSHIP_TOTAL' || e.code === 'RATE_OVERLAP') { broken.push(item.investment.name); continue; }
      throw e;
    }
  }
  if (!parts.length) throw new InputError('None of your open investments can be projected yet.');

  const startKobo = sum(parts.map((p) => p.startKobo));
  const months = dates.map((date, m) => {
    const at = parts.map((p) => p.points[m]);
    const valueKobo = sum(at.map((x) => x.valueKobo)), incomeKobo = sum(at.map((x) => x.incomeKobo)), costsKobo = sum(at.map((x) => x.costsKobo));
    return { month: m, date, valueKobo, incomeKobo, costsKobo, gainKobo: valueKobo + incomeKobo - costsKobo - startKobo, byInvestment: Object.fromEntries(parts.map((p, i) => [p.investment.id, at[i].valueKobo])) };
  });
  const wanted = (rowYears || [1, 3, 5, 10, years]).filter((y) => y >= 1 && y <= years);
  const rows = [...new Set(wanted)].sort((a, b) => a - b).map((y) => ({ isProjection: true, years: y, ...months[y * 12] }));
  return {
    isProjection: true, asOf, years, share, real: inflation != null, inflation, nudge, startKobo, months, rows,
    parts: parts.map((p) => ({ investment: p.investment, source: p.source, startKobo: p.startKobo, maturityDate: p.maturityDate, matured: p.matured, shareBp: p.shareBp, endKobo: p.points[p.points.length - 1].valueKobo })),
    held: parts.filter((p) => p.source === 'none').map((p) => p.investment.name), broken, closedCount, count: parts.length,
  };
}

// Cautious, Base and Optimistic around the same inputs: the base run plus one run a few points lower and higher.
// `spread` is a fraction (0.03 = three points). The returned bands line up month by month with `base.months`.
export function projectBand(args, spread = 0.03, baseRun = null) {
  const base = baseRun || projectOutlook(args);
  const low = projectOutlook({ ...args, nudge: (args.nudge || 0) - spread });
  const high = projectOutlook({ ...args, nudge: (args.nudge || 0) + spread });
  return { base, low, high, bands: base.months.map((m, i) => ({ month: m.month, date: m.date, lowKobo: low.months[i].valueKobo, baseKobo: m.valueKobo, highKobo: high.months[i].valueKobo })) };
}

// ---------- pieces for the Outlook screen ----------
const pctText = (f) => new D(String(f)).times(100).toDecimalPlaces(6).toString();
const everyWord = (n) => ({ 1: 'once a year', 2: 'twice a year', 4: 'four times a year', 12: 'monthly', 365: 'daily' }[n] || `${n} times a year`);

// Plain words for the rates an investment would use from today, for the Assumptions list. Never a guess: no rate says so.
export function rateSentence(rates) {
  if (!rates.length) return 'No rate set, held flat';
  const one = (r) => {
    const yearly = (r.rateUnit || 'year') === 'year', nominal = yearly ? new D(String(Math.abs(r.rate))) : new D(String(Math.abs(r.rate))).times(12);
    const how = r.method === 'compound' ? `compounded ${everyWord(r.compoundsPerYear ?? (yearly ? 1 : 12))}` : 'simple';
    return `${r.rate < 0 ? 'Loses' : 'Grows'} ${pctText(nominal)}% a year, ${how}`;
  };
  const sorted = [...rates].sort((a, b) => (a.effectiveFrom || '').localeCompare(b.effectiveFrom || ''));
  return sorted.length === 1 ? one(sorted[0]) : `${one(sorted[0])}, then ${sorted.length - 1} saved ${sorted.length === 2 ? 'change' : 'changes'} later`;
}

// First month on which the total reaches `targetKobo`, or null. `months` is projectOutlook(...).months.
export function reachMonth(months, targetKobo) {
  if (!Number.isSafeInteger(targetKobo) || targetKobo <= 0) return null;
  return months.find((m) => m.valueKobo >= targetKobo) || null;
}

// What the regular payments add up to in one whole year of the projection (year 1 is the first twelve months).
export function incomeInYear(months, year) {
  const a = months[(year - 1) * 12], b = months[year * 12];
  if (!a || !b) return null;
  return { incomeKobo: b.incomeKobo - a.incomeKobo, costsKobo: b.costsKobo - a.costsKobo };
}

// Expected regular income against costs for each of the next `count` months (month 0 is the 30 days or so after today, by the calendar).
export function cashFlowByMonth({ items, asOf, count = 12, share = 'full', inflation = null }) {
  const { open } = splitItems(items);
  const edges = Array.from({ length: count + 1 }, (_, i) => addMonths(asOf, i));
  const out = edges.slice(0, count).map((from, i) => ({ month: i, from: addDays(from, 1), to: edges[i + 1], incomeKobo: 0, costsKobo: 0 }));
  const acc = out.map(() => ({ income: new D(0), costs: new D(0) }));
  for (const item of open) {
    let bp = 10000;
    try { bp = share === 'mine' ? myShareBp(item.bundle, asOf) : 10000; } catch { continue; }
    const pay = expectedPayments(item.bundle, asOf, edges[count]);
    for (const [key, list] of [['income', pay.income], ['costs', pay.costs]]) {
      for (const e of list) {
        const i = out.findIndex((w) => compareDates(e.date, w.to) <= 0);
        if (i >= 0) acc[i][key] = acc[i][key].plus(scale(new D(e.amountKobo).div(deflator(inflation, asOf, e.date)), bp));
      }
    }
  }
  return out.map((w, i) => ({ ...w, incomeKobo: toKobo(acc[i].income), costsKobo: toKobo(acc[i].costs) }));
}

// Term investments that have not matured yet, soonest first, with what each is projected to be worth that day.
export function maturities({ items, asOf, overrides = {}, nudge = 0, share = 'full', inflation = null }) {
  const out = [];
  for (const item of splitItems(items).open) {
    const date = maturityOf(item.investment);
    if (!date || compareDates(date, asOf) <= 0) continue;
    try {
      const bp = share === 'mine' ? myShareBp(item.bundle, asOf) : 10000;
      const { rates } = ratesFor({ investment: item.investment, asOf, override: overrides[item.investment.id] || null, nudge });
      const worth = worthOn({ startKobo: item.metrics.valueKobo, asOf, date, rates, maturity: date }).div(deflator(inflation, asOf, date));
      out.push({ investment: item.investment, date, days: daysBetween(asOf, date), valueKobo: toKobo(scale(worth, bp)) });
    } catch (e) { if (e.code !== 'OWNERSHIP_TOTAL' && e.code !== 'RATE_OVERLAP') throw e; }
  }
  return out.sort((a, b) => compareDates(a.date, b.date) || (a.investment.name < b.investment.name ? -1 : 1));
}
