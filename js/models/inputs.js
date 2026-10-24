// Text-safe parsing of what people type into forms. Nothing here uses floating-point multiplication on
// money or percentages: amounts are read as digits and become whole kobo, and "12.5%" becomes 0.125 through
// the same Decimal library the calculation engine uses. Every parser either returns a clean value or throws
// InputError with a sentence that can be shown to the person as it is.
import { D } from '../engine/index.js';
import { dayNumber } from '../engine/dates.js';

export class InputError extends Error {
  constructor(message) { super(message); this.code = 'INPUT'; }
}

// "₦18,000,000", "18000000.50", "18 000 000" -> 1800000000 / 1800000050 (whole kobo)
export function parseNaira(text, { allowZero = false } = {}) {
  let s = String(text ?? '').replace(/[₦\s]/g, '').replace(/^NGN/i, '');
  if (!s) throw new InputError('Enter an amount.');
  if (s.includes(',') && !/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) throw new InputError('Check the commas in this amount. Use them only between groups of three digits, like 1,250,000.');
  s = s.replaceAll(',', '');
  if (!/^\d+(\.\d+)?$/.test(s)) throw new InputError('Use digits only, for example 250000 or 250,000.50.');
  const [whole, frac = ''] = s.split('.');
  if (frac.length > 2) throw new InputError('Naira has only two decimal places (kobo).');
  const kobo = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0') || '0');
  if (kobo > BigInt(Number.MAX_SAFE_INTEGER)) throw new InputError('That amount is too large.');
  if (kobo === 0n && !allowZero) throw new InputError('The amount must be more than zero.');
  return Number(kobo);
}

// 1800000050 -> "18000000.5"; 5000000 -> "50000". Used to fill an edit form with the stored amount.
export function koboToInput(kobo) {
  const whole = Math.floor(kobo / 100), frac = kobo % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

// "12.5%" or "12.5" -> 0.125, read as text through Decimal (never 12.5 / 100 in floating point).
export function parsePercent(text, { max = 1000 } = {}) {
  const s = String(text ?? '').replace(/[%\s]/g, '');
  if (!s) throw new InputError('Enter a percentage.');
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new InputError('Use a positive number like 12 or 12.5.');
  const fraction = new D(s).div(100);
  if (fraction.gt(new D(max).div(100))) throw new InputError(`A rate cannot be more than ${max}%.`);
  return fraction.toNumber();
}

// A person's share: "30" or "33.33%" -> basis points (3000, 3333). More than two decimals is refused,
// because a share must be exact to the hundredth of a percent.
export function parseShareBp(text) {
  const s = String(text ?? '').replace(/[%\s]/g, '');
  if (!s) throw new InputError('Enter a share.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new InputError('Use a number like 50 or 33.33 (at most two decimals).');
  const bp = new D(s).times(100).toNumber();
  if (bp < 1 || bp > 10000) throw new InputError('A share must be between 0.01% and 100%.');
  return bp;
}
export const bpToInput = (bp) => (bp % 100 === 0 ? String(bp / 100) : (bp / 100).toFixed(2).replace(/0$/, ''));

export function checkDate(text, label = 'This date') {
  const s = String(text ?? '').trim();
  if (!s) throw new InputError(`${label} is required.`);
  try { dayNumber(s); } catch { throw new InputError(`${label} is not a real date.`); }
  const y = Number(s.slice(0, 4));
  if (y < 1900 || y > 2200) throw new InputError(`${label} is outside the supported years (1900 to 2200).`);
  return s;
}
export const optionalDate = (text, label) => (String(text ?? '').trim() ? checkDate(text, label) : null);

export function wholeNumber(text, { min = 1, max = 3650, label = 'This number' } = {}) {
  const s = String(text ?? '').trim();
  if (!/^\d+$/.test(s)) throw new InputError(`${label} must be a whole number.`);
  const n = Number(s);
  if (n < min || n > max) throw new InputError(`${label} must be between ${min} and ${max}.`);
  return n;
}
