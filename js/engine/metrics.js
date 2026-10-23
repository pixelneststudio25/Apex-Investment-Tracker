// Per-investment return metrics (General System Plan 8.3).
// Conventions chosen where the plan left room:
//  - Value for an ACTIVE investment: latest valuation on/before asOf; else each capital_in entry grown at the
//    assumed/agreed rates from its own date; else cost (money invested). Valuations are not extrapolated.
//  - netGain = (value + proceeds received) + income - invested - costs. For a closed investment value is 0 and
//    the proceeds are the figure.
//  - Yield = trailing 12 months of (income + payout - costs) / total invested.
import { addMonths, compareDates, daysBetween } from './dates.js';
import { dec, D, toKobo } from './money.js';
import { valueAfter } from './value.js';
import { cagr, xirr } from './xirr.js';

const sum = (arr) => arr.reduce((s, e) => s + e.amountKobo, 0);
const ratio = (num, den) => (den === 0 ? null : dec(num).div(den).toNumber());

export function investmentMetrics({ investment = {}, entries = [], valuations = [], asOf, rateTypes = null }) {
  const live = entries.filter((e) => compareDates(e.date, asOf) <= 0);
  const of = (...kinds) => live.filter((e) => kinds.includes(e.kind));
  const capital = of('capital_in').sort((a, b) => compareDates(a.date, b.date));
  const investedKobo = sum(capital), costsKobo = sum(of('cost')), incomeKobo = sum(of('income', 'payout')), proceedsKobo = sum(of('proceeds'));
  const closed = investment.status === 'closed' || (investment.closedOn && compareDates(investment.closedOn, asOf) <= 0);

  let valueKobo = 0, valueSource = 'proceeds', valuationDate = null;
  if (!closed) {
    const vals = valuations.filter((v) => compareDates(v.date, asOf) <= 0).sort((a, b) => compareDates(a.date, b.date));
    const rates = (investment.rates || []).filter((r) => !rateTypes || rateTypes.includes(r.type));
    const behaviour = investment.behaviors?.valueChange;
    if (vals.length) { const v = vals[vals.length - 1]; valueKobo = v.valueKobo; valueSource = 'valuation'; valuationDate = v.date; }
    else if (rates.length && behaviour !== 'none' && behaviour !== 'manualOnly' && capital.length) {
      valueKobo = toKobo(capital.reduce((t, c) => t.plus(valueAfter(c.amountKobo, c.date, asOf, rates)), new D(0)));
      valueSource = 'assumed';
    } else { valueKobo = investedKobo; valueSource = 'cost'; }
  }
  const totalValueKobo = valueKobo + proceedsKobo;
  const netGainKobo = totalValueKobo + incomeKobo - investedKobo - costsKobo;
  const basisKobo = investedKobo + costsKobo;

  // Annualised return
  const startDate = capital[0]?.date ?? investment.openedOn ?? null;
  const proceedDates = of('proceeds').map((e) => e.date).sort(compareDates);
  const endDate = closed ? (investment.closedOn && compareDates(investment.closedOn, asOf) <= 0 ? investment.closedOn : proceedDates[proceedDates.length - 1] ?? asOf) : asOf;
  const daysHeld = startDate ? Math.max(0, daysBetween(startDate, endDate)) : 0;
  let annualized = { method: null, rate: null, shortHold: daysHeld < 365 };
  if (startDate && daysHeld > 0 && investedKobo > 0) {
    const others = live.filter((e) => e.kind !== 'capital_in');
    if (capital.length === 1 && others.length === 0) annualized = { ...annualized, method: 'cagr', rate: cagr(investedKobo, totalValueKobo, daysHeld) };
    else {
      const flows = live.map((e) => ({ date: e.date, amountKobo: e.kind === 'capital_in' || e.kind === 'cost' ? -e.amountKobo : e.amountKobo }));
      if (!closed && valueKobo > 0) flows.push({ date: asOf, amountKobo: valueKobo });
      annualized = { ...annualized, method: 'xirr', rate: xirr(flows) };
    }
  }
  const winStart = addMonths(asOf, -12);
  const trailing = live.filter((e) => compareDates(e.date, winStart) > 0);
  const trailingNet = sum(trailing.filter((e) => e.kind === 'income' || e.kind === 'payout')) - sum(trailing.filter((e) => e.kind === 'cost'));

  return {
    asOf, daysHeld, basis: closed ? 'realized' : 'unrealized',
    investedKobo, costsKobo, incomeKobo, proceedsKobo,
    valueKobo, valueSource, valuationDate, totalValueKobo,
    currentValueKobo: closed ? proceedsKobo : valueKobo,
    netGainKobo, roi: ratio(netGainKobo, basisKobo), annualized,
    yield: { trailing12mNetIncomeKobo: trailingNet, rate: ratio(trailingNet, investedKobo) },
  };
}
