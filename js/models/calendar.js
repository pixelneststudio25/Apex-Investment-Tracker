// Calendar export (Phase 13): the dates Apex is watching, as an .ics file any calendar app can import.
// Made on the device from your records; nothing is sent anywhere. Rules this file keeps:
//  - What goes in: reminders that are not done (a repeating one is written out date by date, exactly as Apex repeats it)
//    and payments your saved payment plans expect that have not been recorded yet. Deleted investments are left out.
//  - By default a payment is only "Payment expected" with no amount and no investment name, because a calendar app often
//    syncs to a cloud service. Amounts and investment names are written only when the person turns that on.
//  - Every event is an all-day event, marked "free" so it never blocks a meeting. Reminders get a 9 am alert on the day.
//  - Every event has a steady id (record id plus date), so importing the file again updates instead of duplicating.
//  - Text is escaped and long lines are folded the way the format requires (75 bytes, never inside a character); lines end in CRLF.
import { addDays, addMonths, compareDates, formatNaira } from '../engine/index.js';

export const CALENDAR_RANGES = Object.freeze([[3, 'Next 3 months'], [6, 'Next 6 months'], [12, 'Next 12 months']]);
const STEP = { monthly: 1, quarterly: 3, yearly: 12 };
const MAX_EVENTS = 1000; // a calendar app should never be flooded; the file says so when it was cut short
const enc = new TextEncoder();

export const calendarName = (asOf) => `apex-calendar-${asOf}.ics`;

// Reminders (and repeats of them) between today and `end`.
function reminderEvents(reminders, invById, asOf, end, { details }) {
  const out = [];
  for (const r of reminders) {
    if (r.done || r.deletedAt) continue;
    const inv = r.investmentId ? invById.get(r.investmentId) : null;
    if (r.investmentId && !inv) continue; // belongs to a deleted investment
    const step = STEP[r.recurrence];
    for (let k = 0; k < 600; k++) {
      const date = step ? addMonths(r.dueDate, k * step) : r.dueDate;
      if (compareDates(date, end) > 0) break;
      const overdue = compareDates(date, asOf) < 0;
      if (overdue && step) continue; // an old repeat that was missed is not reminded again; the next one is
      out.push({
        uid: `${r.id}-${date}`, date: overdue ? asOf : date, kind: 'reminder', alarm: true,
        title: `${overdue ? 'Overdue: ' : ''}${r.text}`,
        description: details && inv ? `Investment: ${inv.name}` : '',
      });
      if (!step) break;
    }
  }
  return out;
}

// What the payment plans expect and have not been recorded yet, from today.
function paymentEvents(upcoming, { details }) {
  return upcoming.filter((u) => u.kind === 'income' || u.kind === 'cost').map((u) => {
    const plain = u.kind === 'income' ? 'Payment expected' : 'Cost expected';
    return {
      uid: `${u.scheduleId || u.investmentId || 'plan'}-${u.date}-${u.kind}`, date: u.date, kind: u.kind, alarm: false,
      title: details ? `${u.title}: ${formatNaira(u.amountKobo)}${u.investmentName ? ` (${u.investmentName})` : ''}` : (u.title && u.title !== 'Income expected' && u.title !== 'Cost expected' ? `${plain}: ${u.title}` : plain),
      description: details ? `Expected ${u.kind === 'income' ? 'income' : 'cost'} of ${formatNaira(u.amountKobo)}${u.investmentName ? ` from ${u.investmentName}` : ''}. Worked out from your saved payment plan; not yet recorded in Apex.` : 'Worked out from a saved payment plan. Open Apex for the details.',
    };
  });
}

/**
 * The events for the next `months` months. Needs the portfolio (pf) and the store.
 * Returns { events, truncated }. `details: true` adds amounts and investment names.
 */
export async function collectCalendarEvents({ pf, store, asOf, months = 12, details = false }) {
  const end = addMonths(asOf, months), days = Math.ceil((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86400000);
  const [invs, reminders, upcoming] = await Promise.all([pf.investments(), store.list('reminder'), pf.upcoming(asOf, { days })]);
  const invById = new Map(invs.map((i) => [i.id, i]));
  const all = [...reminderEvents(reminders, invById, asOf, end, { details }), ...paymentEvents(upcoming.filter((u) => compareDates(u.date, end) <= 0), { details })]
    .sort((a, b) => compareDates(a.date, b.date) || (a.kind === 'reminder') - (b.kind === 'reminder') || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  return { events: all.slice(0, MAX_EVENTS), truncated: all.length > MAX_EVENTS };
}

// ---------- the file format ----------
export const escapeText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

// Folds one logical line at 75 bytes. A continuation line starts with one space. Never splits a character.
export function foldLine(line) {
  if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; limit = 74; } // the leading space takes one byte
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.map((l, i) => (i ? ` ${l}` : l)).join('\r\n');
}

const day = (iso) => iso.replace(/-/g, '');
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // 20261030T094501Z

export function buildIcs(events, { now = new Date(), name = 'Apex', truncated = false } = {}) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apex//Calendar export//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(name)}`];
  const dtstamp = stamp(now);
  for (const e of events) {
    L.push('BEGIN:VEVENT', `UID:${e.uid}@apex`, `DTSTAMP:${dtstamp}`, `DTSTART;VALUE=DATE:${day(e.date)}`, `DTEND;VALUE=DATE:${day(addDays(e.date, 1))}`,
      `SUMMARY:${escapeText(e.title)}`);
    if (e.description) L.push(`DESCRIPTION:${escapeText(e.description)}`);
    L.push('TRANSP:TRANSPARENT');
    if (e.alarm) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(e.title)}`, 'TRIGGER;RELATED=START:PT9H', 'END:VALARM');
    L.push('END:VEVENT');
  }
  if (truncated) L.push('COMMENT:Apex wrote the first 1000 events only.');
  L.push('END:VCALENDAR');
  return `${L.map(foldLine).join('\r\n')}\r\n`;
}
