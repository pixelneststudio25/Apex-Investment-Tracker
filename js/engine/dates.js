// Calendar-date helpers. Dates are ISO strings (YYYY-MM-DD); day numbers are whole days since 1970-01-01 (UTC),
// so there are no time-zone or daylight-saving effects.
import { EngineError } from './errors.js';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n, w = 2) => String(n).padStart(w, '0');
const DAY_MS = 86400000;
const daysInMonth = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

export function dayNumber(iso) {
  const m = ISO.exec(String(iso));
  if (!m) throw new EngineError('BAD_DATE', `Invalid date: ${iso}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) throw new EngineError('BAD_DATE', `Invalid date: ${iso}`);
  return Math.round(t.getTime() / DAY_MS);
}
export const fromDayNumber = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a, b) => dayNumber(b) - dayNumber(a);
export const addDays = (iso, n) => fromDayNumber(dayNumber(iso) + n);

// Same day-of-month n months later; clamps to the month's last day (31 Jan + 1 month = 28/29 Feb).
export function addMonths(iso, n) {
  dayNumber(iso); // validates
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = ((total % 12) + 12) % 12;
  return `${pad(ny, 4)}-${pad(nm + 1)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}
export const compareDates = (a, b) => dayNumber(a) - dayNumber(b);
