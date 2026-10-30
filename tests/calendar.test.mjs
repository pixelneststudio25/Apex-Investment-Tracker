// Phase 13 tests (batch 2): the calendar file. Expected text is written out by hand, never produced by the code under test.
import { readFile } from 'node:fs/promises';
import { generateDek } from '../js/core/crypto.js';
import { createMemoryBackend } from '../js/core/db.js';
import { createStore } from '../js/core/store.js';
import { createPortfolio } from '../js/models/portfolio.js';
import { SAMPLE_AS_OF, seedSamplePortfolio } from '../js/models/sample.js';
import { buildIcs, calendarName, collectCalendarEvents, escapeText, foldLine } from '../js/models/calendar.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
const bytes = (s) => new TextEncoder().encode(s).length;
const unfold = (ics) => ics.replace(/\r\n[ \t]/g, '').split('\r\n');
const NOW = new Date('2026-10-30T09:45:01.123Z');

let n = 0;
async function fresh() {
  const dek = await generateDek(), store = createStore({ backend: createMemoryBackend(), getDek: () => dek, userId: 'u', uuid: () => `c-${++n}` });
  return { store, pf: createPortfolio(store) };
}
const inv = (store, name = 'Flat', extra = {}) => store.create('investment', { name, categoryId: 'real-estate', openedOn: '2025-01-01', behaviors: { valueChange: 'none', income: 'schedule', ownership: 'sole', term: null }, rates: [], ...extra });
const collect = (ctx, o = {}) => collectCalendarEvents({ pf: ctx.pf, store: ctx.store, asOf: SAMPLE_AS_OF, months: 12, ...o });

test('escaping: backslash, semicolon, comma and line breaks cannot break out of a line', () => {
  eq(escapeText('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne'); eq(escapeText('x\r\ny\rz'), 'x\\ny\\nz'); eq(escapeText(null), '');
  const ics = buildIcs([{ uid: 'u1', date: '2026-11-01', title: 'Pay\r\nEND:VEVENT\r\nBEGIN:VEVENT', description: 'a;b', kind: 'reminder', alarm: true }], { now: NOW });
  eq(ics.split('\r\n').filter((l) => l === 'END:VEVENT').length, 1, 'a title cannot add a second event'); ok(ics.includes('SUMMARY:Pay\\nEND:VEVENT\\nBEGIN:VEVENT'));
});
test('folding: no line is longer than 75 bytes, a character is never split, and unfolding gives the original back', () => {
  const long = `SUMMARY:${'₦ naira and café, '.repeat(20)}end`, folded = foldLine(long);
  const lines = folded.split('\r\n'); ok(lines.length > 1); ok(lines.every((l) => bytes(l) <= 75), 'every line fits'); ok(lines.slice(1).every((l) => l.startsWith(' ')), 'continuations start with a space');
  eq(unfold(`${folded}\r\n`)[0], long, 'round trip'); ok(!folded.includes('\uFFFD'), 'no broken characters'); eq(foldLine('SHORT'), 'SHORT');
  const exact = 'X'.repeat(75); eq(foldLine(exact), exact, '75 bytes exactly is not folded'); eq(foldLine('X'.repeat(76)).split('\r\n').length, 2);
});
test('the file: CRLF everywhere, one calendar, all-day events that end the next day (across a month, a year and a leap day), free time, a 9 am alert only on reminders', () => {
  const ev = (uid, date, kind) => ({ uid, date, title: `T ${uid}`, description: '', kind, alarm: kind === 'reminder' });
  const ics = buildIcs([ev('a', '2026-11-30', 'reminder'), ev('b', '2026-12-31', 'income'), ev('c', '2028-02-28', 'cost'), ev('d', '2028-02-29', 'cost')], { now: NOW, name: 'Apex' });
  ok(ics.endsWith('END:VCALENDAR\r\n') && !/[^\r]\n/.test(ics), 'CRLF only'); const L = ics.split('\r\n');
  eq(L.slice(0, 6), ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apex//Calendar export//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Apex']);
  eq([L.filter((l) => l === 'BEGIN:VEVENT').length, L.filter((l) => l === 'END:VEVENT').length, L.filter((l) => l === 'BEGIN:VALARM').length], [4, 4, 1], 'one alert, for the reminder');
  eq(L.filter((l) => l.startsWith('DTSTART')), ['DTSTART;VALUE=DATE:20261130', 'DTSTART;VALUE=DATE:20261231', 'DTSTART;VALUE=DATE:20280228', 'DTSTART;VALUE=DATE:20280229']);
  eq(L.filter((l) => l.startsWith('DTEND')), ['DTEND;VALUE=DATE:20261201', 'DTEND;VALUE=DATE:20270101', 'DTEND;VALUE=DATE:20280229', 'DTEND;VALUE=DATE:20280301']);
  ok(L.every((l) => !l.startsWith('DTSTAMP') || l === 'DTSTAMP:20261030T094501Z'), 'stamped in UTC without fractions'); eq(L.filter((l) => l === 'TRANSP:TRANSPARENT').length, 4);
  ok(L.includes('TRIGGER;RELATED=START:PT9H')); ok(L.includes('UID:a@apex'));
  const empty = buildIcs([], { now: NOW }); ok(empty.endsWith('END:VCALENDAR\r\n') && !empty.includes('VEVENT'), 'an empty calendar is still a valid file');
});
test('reminders: one-off, repeating (written out date by date), done, deleted investment, overdue', async () => {
  const c = await fresh(), a = await inv(c.store, 'Flat'), gone = await inv(c.store, 'Gone');
  await c.store.create('reminder', { investmentId: null, dueDate: '2026-11-05', text: 'Renew insurance', recurrence: 'none', done: false });
  await c.store.create('reminder', { investmentId: a.id, dueDate: '2026-11-15', text: 'Service charge', recurrence: 'quarterly', done: false });
  await c.store.create('reminder', { investmentId: a.id, dueDate: '2026-11-20', text: 'Finished one', recurrence: 'none', done: true });
  await c.store.create('reminder', { investmentId: gone.id, dueDate: '2026-11-21', text: 'Of a deleted investment', recurrence: 'none', done: false });
  await c.store.create('reminder', { investmentId: null, dueDate: '2026-10-01', text: 'Late one', recurrence: 'none', done: false });
  await c.store.create('reminder', { investmentId: null, dueDate: '2026-09-01', text: 'Missed monthly', recurrence: 'monthly', done: false });
  await c.store.remove(gone.id);
  const { events } = await collect(c, { asOf: '2026-10-23' }), by = (t) => events.filter((e) => e.title.includes(t));
  eq(by('Renew').map((e) => e.date), ['2026-11-05']); eq(by('Service').map((e) => e.date), ['2026-11-15', '2027-02-15', '2027-05-15', '2027-08-15'], 'every 3 months inside 12 months');
  eq(by('Finished').length + by('deleted investment').length, 0, 'done and orphaned ones are left out');
  eq([by('Late')[0].date, by('Late')[0].title], ['2026-10-23', 'Overdue: Late one'], 'an overdue one-off lands on today');
  eq(by('Missed monthly').map((e) => e.date).slice(0, 2), ['2026-11-01', '2026-12-01'], 'a missed repeat is not shown again; the next one is'); ok(by('Missed monthly').every((e) => !e.title.startsWith('Overdue')));
  ok(events.every((e) => e.kind !== 'reminder' || e.alarm)); eq(new Set(events.map((e) => e.uid)).size, events.length, 'every id is different');
});
test('payments: plain by default (no amount, no investment name), full detail only when asked, recorded ones and closed investments left out', async () => {
  const c = await fresh(); await seedSamplePortfolio(c.store);
  const plain = await collect(c), full = await collect(c, { details: true }), pay = (r) => r.events.filter((e) => e.kind !== 'reminder');
  ok(pay(plain).length > 0 && pay(plain).length === pay(full).length, 'the same dates either way');
  const names = (await c.pf.investments()).map((i) => i.name);
  for (const e of pay(plain)) { ok(!/₦|\d{3}/.test(e.title + e.description), `amount leaked: ${e.title}`); ok(!names.some((nm) => (e.title + e.description).includes(nm)), `name leaked: ${e.title}`); ok(/Payment expected|Cost expected/.test(e.title)); }
  ok(pay(full).every((e) => /₦/.test(e.title)) && pay(full).some((e) => names.some((nm) => e.title.includes(nm))), 'details on: amounts and names');
  const first = (await c.pf.upcoming(SAMPLE_AS_OF, { days: 365 })).find((u) => u.kind === 'income' && u.scheduleId);
  await c.store.create('entry', { investmentId: first.investmentId, kind: 'income', date: first.date, amountKobo: first.amountKobo, note: '', linkedScheduleId: first.scheduleId });
  const after = await collect(c, { details: true }); ok(!after.events.some((e) => e.uid === `${first.scheduleId}-${first.date}-income`), 'a payment you recorded is no longer expected');
});
test('importing again updates, not duplicates: the ids are steady between two exports, and the range is respected', async () => {
  const c = await fresh(); await seedSamplePortfolio(c.store);
  const a = await collect(c), b = await collect(c); eq(a.events.map((e) => e.uid), b.events.map((e) => e.uid), 'steady ids'); ok(a.events.length > 3);
  const three = await collect(c, { months: 3 }); ok(three.events.length < a.events.length && three.events.every((e) => e.date <= '2027-01-23'), '3 months is shorter than 12');
  eq(a.events.map((e) => e.date), [...a.events.map((e) => e.date)].sort(), 'in date order'); ok(a.events.every((e) => e.date >= SAMPLE_AS_OF && e.date <= '2027-10-23'));
  ok(calendarName('2026-10-30') === 'apex-calendar-2026-10-30.ics');
});
test('a whole sample portfolio produces a file a calendar app can read: every event complete, every line short enough', async () => {
  const c = await fresh(); await seedSamplePortfolio(c.store);
  const { events, truncated } = await collect(c, { details: true }), ics = buildIcs(events, { now: NOW, truncated }), L = unfold(ics);
  eq(truncated, false); eq(L.filter((l) => l === 'BEGIN:VEVENT').length, events.length); ok(ics.split('\r\n').every((l) => bytes(l) <= 75));
  const blocks = ics.split('BEGIN:VEVENT').slice(1); ok(blocks.every((b) => /UID:/.test(b) && /DTSTAMP:/.test(b) && /DTSTART;VALUE=DATE:\d{8}\r/.test(b) && /DTEND;VALUE=DATE:\d{8}\r/.test(b) && /SUMMARY:/.test(b) && /END:VEVENT/.test(b)));
  ok(events.some((e) => /Service charge invoice due/.test(e.title)), 'the sample reminder is in');
});
test('a flood of reminders is cut at 1000 and the file says so', async () => {
  const c = await fresh(); for (let i = 0; i < 1003; i++) await c.store.create('reminder', { investmentId: null, dueDate: '2026-11-05', text: `R${i}`, recurrence: 'none', done: false });
  const { events, truncated } = await collect(c); eq([events.length, truncated], [1000, true]); ok(buildIcs(events, { now: NOW, truncated }).includes('COMMENT:Apex wrote the first 1000 events only.'));
});
test('the Export page offers it safely: off by default, honest about cloud calendars, made on the device, cached offline', async () => {
  const rv = await read('js/ui/report-views.js'), cal = await read('js/models/calendar.js'), sw = await read('sw.js');
  ok(rv.includes('calendarPanel(ctx, sample)') && /checked: false, asSwitch: true/.test(rv) && rv.includes('Calendar apps often sync to a cloud service') && rv.includes("'text/calendar;charset=utf-8'"));
  ok(!/fetch\(|XMLHttpRequest|localStorage|innerHTML/.test(cal), 'nothing is sent or stored'); ok(sw.includes("'/js/models/calendar.js'"));
  ok((await read('js/ui/outlook-views.js')).includes('Put these in my calendar'), 'Outlook points to it');
});

export async function runCalendarTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) { try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); } }
  log(`\n${passed} passed, ${failed} failed (calendar export).`);
  return { passed, failed };
}
