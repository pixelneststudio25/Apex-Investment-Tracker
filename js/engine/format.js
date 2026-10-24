// Display formatting. Pure string work (no Intl), so output is identical on every device.
import { D, dec } from './money.js';

const MINUS = '\u2212';
const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// 1245000000 -> "₦12,450,000.00"; negatives use a true minus sign: "−₦300,000.00"
export function formatNaira(kobo, { sign = false } = {}) {
  const abs = Math.abs(kobo), naira = Math.trunc(abs / 100), k = String(abs % 100).padStart(2, '0');
  const body = `₦${group(String(naira))}.${k}`;
  return kobo < 0 ? MINUS + body : sign && kobo > 0 ? '+' + body : body;
}

// For cards: ₦12.45M, ₦1.2B, ₦850K. Under ₦100,000 the full amount is shown.
export function formatNairaCompact(kobo) {
  const abs = Math.abs(kobo), naira = abs / 100;
  const units = [[1e9, 1e9, 'B'], [1e6, 1e6, 'M'], [1e5, 1e3, 'K']]; // [use from, divide by, suffix]
  const hit = units.find(([from]) => naira >= from);
  if (!hit) return formatNaira(kobo);
  const scaled = dec(naira).div(hit[1]).toDecimalPlaces(2, D.ROUND_HALF_UP).toString(); // trailing zeros drop out
  return (kobo < 0 ? MINUS : '') + `₦${scaled}${hit[2]}`;
}

// 0.15 -> "15.00%"; { sign: true } -> "+11.16%"; null -> "n/a"
export function formatPercent(fraction, { dp = 2, sign = false } = {}) {
  if (fraction == null || !Number.isFinite(fraction)) return 'n/a';
  const s = dec(fraction).times(100).toDecimalPlaces(dp, D.ROUND_HALF_UP).abs().toFixed(dp);
  const neg = dec(fraction).times(100).toDecimalPlaces(dp, D.ROUND_HALF_UP).isNegative() && Number(s) !== 0;
  return (neg ? MINUS : sign && Number(s) !== 0 ? '+' : '') + s + '%';
}
