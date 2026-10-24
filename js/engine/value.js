// Value formulas (General System Plan 8.1, 8.2). t = actual days / 365.
//   simple:    V = P (1 + R t)            compound: V = P (1 + R/n)^(n t)
// A monthly rate r is a nominal annual rate R = 12 r (so "months elapsed" = days x 12 / 365); monthly
// compounding defaults to n = 12. Negative rates depreciate. Value never goes below zero.
// A rate applies from `effectiveFrom` (inclusive) up to `effectiveTo` (the day it stops applying).
import { dayNumber } from './dates.js';
import { EngineError } from './errors.js';
import { D, dec, toKobo } from './money.js';

export function normalizeRate(r) {
  const unit = r.rateUnit || 'year', method = r.method || 'simple';
  if (unit !== 'year' && unit !== 'month') throw new EngineError('BAD_RATE', 'rateUnit must be year or month');
  if (method !== 'simple' && method !== 'compound') throw new EngineError('BAD_RATE', 'method must be simple or compound');
  const rate = dec(r.rate);
  const n = method === 'compound' ? (r.compoundsPerYear ?? (unit === 'month' ? 12 : 1)) : null;
  if (method === 'compound' && !(Number.isInteger(n) && n >= 1)) throw new EngineError('BAD_RATE', 'compoundsPerYear must be a whole number of 1 or more');
  return {
    nominal: unit === 'month' ? rate.times(12) : rate, method, n,
    from: r.effectiveFrom ? dayNumber(r.effectiveFrom) : -Infinity,
    to: r.effectiveTo ? dayNumber(r.effectiveTo) : Infinity,
  };
}

function segmentsBetween(rates, startDay, endDay) {
  const segs = rates.map(normalizeRate)
    .map((r) => ({ ...r, s: Math.max(r.from, startDay), e: Math.min(r.to, endDay) }))
    .filter((r) => r.e > r.s).sort((a, b) => a.s - b.s);
  for (let i = 1; i < segs.length; i++) if (segs[i].s < segs[i - 1].e) throw new EngineError('RATE_OVERLAP', 'Two rates apply on the same days');
  return segs;
}

function applySegment(value, seg) {
  const t = new D(seg.e - seg.s).div(365);
  let v;
  if (seg.method === 'simple') v = value.times(new D(1).plus(seg.nominal.times(t)));
  else {
    const base = new D(1).plus(seg.nominal.div(seg.n));
    v = base.lte(0) ? new D(0) : value.times(base.pow(t.times(seg.n)));
  }
  return v.lt(0) ? new D(0) : v;
}

// Exact (unrounded) value of principalKobo from `from` to `to` under the given rates, carried segment by segment.
export function valueAfter(principalKobo, from, to, rates = []) {
  const s = dayNumber(from), e = dayNumber(to);
  if (e < s) throw new EngineError('BAD_RANGE', 'End date is before start date');
  let v = dec(principalKobo);
  for (const seg of segmentsBetween(rates, s, e)) v = applySegment(v, seg);
  return v;
}
export const valueKobo = (principalKobo, from, to, rates) => toKobo(valueAfter(principalKobo, from, to, rates));
