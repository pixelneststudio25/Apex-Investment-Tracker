// Whole-portfolio projection (Phase 7b). It is the single-investment projection (js/models/projections.js) run for
// every open investment and added up, so there is no second set of growth rules to get wrong.
//
// Decisions (see docs/phase7b-notes.md):
//  - Each investment starts from what it is worth today and counts at its FULL value, exactly as Home does.
//  - Scenario A with no rate typed means "each at its own saved rate". An investment with no usable saved rate is held
//    flat at today's worth and is listed as such: Apex never invents a rate.
//  - A typed rate (Scenario A or B) is applied to every open investment.
//  - Closed investments and investments that cannot be calculated are left out, and named.
//  - Nothing is saved.
import { xirr } from '../engine/index.js';
import { InputError } from './inputs.js';
import { buildScenario, expectedPayments, projectScenario, startingScenario } from './projections.js';

const FLAT = Object.freeze({ label: 'No rate set, held flat', percentText: '0', rate: 0, direction: 'grows', method: 'simple', flat: true });
const sum = (xs) => { const t = xs.reduce((a, b) => a + b, 0); if (!Number.isSafeInteger(t)) throw new InputError('The portfolio total is too large to project.'); return t; };

// One portfolio scenario. `scenario` null = each investment at its own saved rate; otherwise one built scenario for all.
export function projectPortfolioScenario({ items, asOf, scenario, years, includePayments = true }) {
  const parts = items.map(({ investment, bundle, metrics }) => {
    let sc = scenario;
    if (!sc) { const saved = startingScenario(investment, asOf); sc = saved ? buildScenario(saved, saved.label) : FLAT; }
    return { investment, scenario: sc, flat: !!sc.flat, startKobo: metrics.valueKobo, bundle,
      rows: projectScenario({ bundle, startKobo: metrics.valueKobo, asOf, scenario: sc, years, includePayments }) };
  });
  const startKobo = sum(parts.map((p) => p.startKobo));
  const rows = years.map((y, i) => {
    const at = parts.map((p) => p.rows[i]), endDate = at[0].endDate;
    const valueKobo = sum(at.map((r) => r.valueKobo)), incomeKobo = sum(at.map((r) => r.incomeKobo)), costsKobo = sum(at.map((r) => r.costsKobo));
    const flows = [{ date: asOf, amountKobo: -startKobo }, { date: endDate, amountKobo: valueKobo }];
    if (includePayments) for (const p of parts) { const pay = expectedPayments(p.bundle, asOf, endDate); for (const e of pay.income) flows.push({ date: e.date, amountKobo: e.amountKobo }); for (const e of pay.costs) flows.push({ date: e.date, amountKobo: -e.amountKobo }); }
    return { isProjection: true, years: y, endDate, days: at[0].days, valueKobo, incomeKobo, costsKobo, incomeCount: sum(at.map((r) => r.incomeCount)), costsCount: sum(at.map((r) => r.costsCount)),
      gainKobo: valueKobo + incomeKobo - costsKobo - startKobo, annualRate: startKobo > 0 ? xirr(flows) : null, shortHold: at[0].shortHold, startKobo };
  });
  return { scenario: scenario || { label: 'Each at its own rate', percentText: '', own: true }, rows, parts, startKobo };
}

// Open investments that can be projected, and the ones left out (closed ones are not "left out": they are simply finished).
export function splitItems(items) {
  const open = items.filter((it) => it.metrics && it.metrics.basis !== 'realized');
  return { open, broken: items.filter((it) => it.error).map((it) => it.investment.name), closedCount: items.filter((it) => it.metrics && it.metrics.basis === 'realized').length };
}

export function runPortfolioProjection({ items, asOf, a, b = null, years, includePayments = true }) {
  const { open, broken, closedCount } = splitItems(items);
  if (!open.length) throw new InputError('There is no open investment to project.');
  const A = projectPortfolioScenario({ items: open, asOf, scenario: a, years, includePayments });
  const B = b ? projectPortfolioScenario({ items: open, asOf, scenario: b, years, includePayments }) : null;
  const diff = B ? A.rows.map((r, i) => ({ years: r.years, endDate: r.endDate, valueKobo: B.rows[i].valueKobo - r.valueKobo, gainKobo: B.rows[i].gainKobo - r.gainKobo })) : null;
  return { isProjection: true, asOf, startKobo: A.startKobo, a: A, b: B, diff, flat: A.parts.filter((p) => p.flat).map((p) => p.investment.name), broken, closedCount, count: open.length };
}
