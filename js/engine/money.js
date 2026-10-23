// Decimal arithmetic. Money is integer kobo; intermediate maths uses 60 significant digits and is rounded
// ONCE, at the end of each reported figure, half away from zero to the kobo.
import DecimalBase from '../../vendor/decimal.mjs';
import { EngineError } from './errors.js';

export const D = DecimalBase.clone({ precision: 60, rounding: DecimalBase.ROUND_HALF_UP, toExpNeg: -40, toExpPos: 40 });
export const dec = (x) => (D.isDecimal(x) ? x : new D(typeof x === 'number' ? String(x) : x));

export function toKobo(x) {
  const n = dec(x).toDecimalPlaces(0, D.ROUND_HALF_UP).toNumber();
  if (!Number.isSafeInteger(n)) throw new EngineError('OVERFLOW', 'Amount too large');
  return n + 0; // normalises -0
}

// Splits totalKobo by weights (e.g. basis points) so the parts add up to the total EXACTLY (largest remainder).
export function allocate(totalKobo, weights) {
  const total = BigInt(totalKobo), sign = total < 0n ? -1n : 1n, abs = total < 0n ? -total : total;
  const w = weights.map((x) => BigInt(x)), sum = w.reduce((a, b) => a + b, 0n);
  if (sum <= 0n) throw new EngineError('BAD_WEIGHTS', 'Weights must add up to more than zero');
  const parts = w.map((x) => (abs * x) / sum);
  const rems = w.map((x, i) => ({ i, r: (abs * x) % sum }));
  let left = abs - parts.reduce((a, b) => a + b, 0n);
  rems.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of rems) { if (left <= 0n) break; parts[i] += 1n; left -= 1n; }
  return parts.map((p) => Number(p * sign) + 0);
}
