// PIN screen helpers: initials for the avatar and reading attempts-left from the auth message. The DOM behaviour
// (keys, dots, pips, success moment) is checked in a real browser, see docs/phase9-pin-notes.md.
import { attemptsFromMessage, initialsFromEmail } from '../js/ui/pin-views.js';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };

test('initials: two parts give two letters, digits and symbols are ignored', () => {
  eq(initialsFromEmail('dan.okafor92@mail.com'), 'DO');
  eq(initialsFromEmail('ada_obi@mail.com'), 'AO');
  eq(initialsFromEmail('ngozi-eze+apex@mail.com'), 'NE');
});
test('initials: a single name gives one letter; unusable input falls back to A', () => {
  eq(initialsFromEmail('daniel@mail.com'), 'D');
  eq(initialsFromEmail('1234@mail.com'), 'A');
  eq(initialsFromEmail(''), 'A');
  eq(initialsFromEmail(undefined), 'A');
});
test('initials: accented and non-Latin letters are kept', () => {
  eq(initialsFromEmail('émile.zola@mail.com'), 'ÉZ');
});
test('attempts: reads the number from the auth message, singular and plural', () => {
  eq(attemptsFromMessage('Incorrect PIN. 3 attempts left.', 4), 3);
  eq(attemptsFromMessage('Incorrect PIN. 1 attempt left.', 2), 1);
});
test('attempts: with no number in the message it counts down, never below zero', () => {
  eq(attemptsFromMessage('Incorrect PIN.', 4), 3);
  eq(attemptsFromMessage('Something else', 0), 0);
});

export async function runPinTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) { try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); } }
  log(`\n${passed} passed, ${failed} failed (PIN screens).`);
  return { passed, failed };
}
