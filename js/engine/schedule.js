// Schedules generate EXPECTED entries. `startDate` is the first due date. Monthly/quarterly/yearly dates are
// always counted from the start date (31 Jan, 28 Feb, 31 Mar ... without drifting).
import { addDays, addMonths, compareDates } from './dates.js';
import { EngineError } from './errors.js';

const STEP_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };

export function scheduleEntries(schedule, upTo, { after = null } = {}) {
  const { startDate, endDate = null, frequency, everyDays, amountKobo, kind = 'income', id = null } = schedule;
  const months = STEP_MONTHS[frequency];
  if (!months && !(frequency === 'custom' && Number.isInteger(everyDays) && everyDays >= 1)) throw new EngineError('BAD_SCHEDULE', 'Unknown frequency');
  const skipped = new Set(schedule.skippedDates || []);
  const adj = [...(schedule.adjustments || [])].sort((a, b) => compareDates(a.from, b.from));
  const out = [];
  for (let k = 0; k < 20000; k++) {
    const date = months ? addMonths(startDate, k * months) : addDays(startDate, k * everyDays);
    if (compareDates(date, upTo) > 0 || (endDate && compareDates(date, endDate) > 0)) break;
    if (after && compareDates(date, after) <= 0) continue;
    if (skipped.has(date)) continue;
    let amt = amountKobo;
    for (const a of adj) if (compareDates(a.from, date) <= 0) amt = a.amountKobo;
    out.push({ date, amountKobo: amt, kind, scheduleId: id });
  }
  return out;
}
export const scheduleTotalKobo = (schedule, upTo, opts) => scheduleEntries(schedule, upTo, opts).reduce((s, e) => s + e.amountKobo, 0);
