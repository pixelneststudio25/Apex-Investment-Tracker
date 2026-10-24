// Annualised return. Day count actual/365 from the earliest flow. Floating point is fine here (it is a rate,
// not money). Returns null when no sensible answer exists, never a wrong number.
import { daysBetween } from './dates.js';
import { D, dec } from './money.js';

export function cagr(startKobo, endKobo, days) {
  if (!(startKobo > 0) || !(days > 0)) return null;
  if (endKobo <= 0) return -1;
  return dec(endKobo).div(startKobo).pow(new D(365).div(days)).minus(1).toNumber();
}

export function xirr(flows) {
  const f = flows.filter((x) => x.amountKobo !== 0);
  if (!f.some((x) => x.amountKobo > 0) || !f.some((x) => x.amountKobo < 0)) return null;
  const first = f.reduce((m, x) => (x.date < m ? x.date : m), f[0].date);
  const scale = Math.max(...f.map((x) => Math.abs(x.amountKobo)));
  const pts = f.map((x) => ({ a: x.amountKobo / scale, t: daysBetween(first, x.date) / 365 }));
  const npv = (r) => pts.reduce((s, p) => s + p.a * Math.pow(1 + r, -p.t), 0);
  const dnpv = (r) => pts.reduce((s, p) => s - p.t * p.a * Math.pow(1 + r, -p.t - 1), 0);

  let r = 0.1; // Newton first
  for (let i = 0; i < 100; i++) {
    const v = npv(r), d = dnpv(r);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const next = r - v / d;
    if (!(next > -1)) break;
    if (Math.abs(next - r) < 1e-12) { if (Math.abs(npv(next)) < 1e-9) return next; break; }
    r = next;
  }
  // Fallback: find a sign change on a wide grid, then bisect.
  const grid = [-0.999999, -0.99, -0.9, -0.5, -0.2, 0, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7];
  for (let i = 1; i < grid.length; i++) {
    let lo = grid[i - 1], hi = grid[i];
    let flo = npv(lo); const fhi = npv(hi);
    if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) continue;
    for (let k = 0; k < 300; k++) {
      const mid = (lo + hi) / 2, fm = npv(mid);
      if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
      if (hi - lo < 1e-13 * Math.max(1, Math.abs(hi))) break;
    }
    return (lo + hi) / 2;
  }
  return null;
}
