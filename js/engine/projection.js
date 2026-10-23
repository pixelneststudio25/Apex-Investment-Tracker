// Projection tool (General System Plan 8.5). Output is always a projection, never stored as fact.
import { addMonths, compareDates, daysBetween } from './dates.js';
import { EngineError } from './errors.js';
import { toKobo, dec } from './money.js';
import { scheduleEntries } from './schedule.js';
import { valueAfter } from './value.js';
import { cagr, xirr } from './xirr.js';

// '1M', '6M', '1Y', '5Y', or { months: n } | { years: n } | { date: 'YYYY-MM-DD' } (calendar dates, then actual days)
export function horizonEnd(start, h) {
  if (typeof h === 'object' && h.date) return h.date;
  if (typeof h === 'object') return addMonths(start, (h.months || 0) + 12 * (h.years || 0));
  const m = /^(\d+)([MY])$/.exec(h);
  if (!m) throw new EngineError('BAD_HORIZON', `Unknown horizon: ${h}`);
  return addMonths(start, Number(m[1]) * (m[2] === 'Y' ? 12 : 1));
}

export function project({ principalKobo, startDate, rates = [], incomeSchedule = null, horizons }) {
  return horizons.map((h) => {
    const endDate = horizonEnd(startDate, h);
    if (compareDates(endDate, startDate) <= 0) throw new EngineError('BAD_HORIZON', 'Horizon must be after the start date');
    const days = daysBetween(startDate, endDate);
    const valueKobo = toKobo(valueAfter(principalKobo, startDate, endDate, rates));
    const income = incomeSchedule ? scheduleEntries(incomeSchedule, endDate) : [];
    const incomeKobo = income.reduce((s, e) => s + e.amountKobo, 0);
    const netGainKobo = valueKobo + incomeKobo - principalKobo;
    const rate = income.length
      ? xirr([{ date: startDate, amountKobo: -principalKobo }, ...income.map((e) => ({ date: e.date, amountKobo: e.amountKobo })), { date: endDate, amountKobo: valueKobo }])
      : cagr(principalKobo, valueKobo, days);
    return {
      isProjection: true, horizon: h, endDate, days, valueKobo, incomeKobo, netGainKobo,
      roi: principalKobo === 0 ? null : dec(netGainKobo).div(principalKobo).toNumber(),
      annualizedRate: rate, shortHold: days < 365,
    };
  });
}

// Two scenarios side by side, e.g. 10% against 15% growth.
export function compareScenarios(a, b) {
  const ra = project(a), rb = project(b);
  return ra.map((row, i) => ({ horizon: row.horizon, a: row, b: rb[i], deltaValueKobo: rb[i].valueKobo - row.valueKobo, deltaNetGainKobo: rb[i].netGainKobo - row.netGainKobo }));
}
