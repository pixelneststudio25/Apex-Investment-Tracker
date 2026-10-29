// The Apex dropdown: its placement and type-ahead rules are pure and tested here; every choose-one field must use it
// (no raw <select> may come back), and the date fields must wear the same shell. The on-screen behaviour is covered
// by the manual checks in docs/phase11-notes.md.
import { readFile } from 'node:fs/promises';
import { nextMatch, placePopover } from '../js/ui/picker.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('placePopover: opens under the field when there is room', () => {
  const p = placePopover({ rect: { top: 100, bottom: 150, left: 40, width: 300 }, viewW: 1000, viewH: 800, height: 300 });
  ok(!p.openUp && p.top === 156 && p.left === 40 && p.width === 300, JSON.stringify(p));
});
test('placePopover: flips above near the bottom of the screen, and stays inside the window', () => {
  const p = placePopover({ rect: { top: 700, bottom: 750, left: 900, width: 300 }, viewW: 1000, viewH: 800, height: 300 });
  ok(p.openUp && p.top >= 12 && p.left + p.width <= 1000 - 12, JSON.stringify(p));
});
test('placePopover: never narrower than 220px and never taller than the room', () => {
  const p = placePopover({ rect: { top: 10, bottom: 60, left: 20, width: 100 }, viewW: 600, viewH: 300, height: 900 });
  ok(p.width === 220 && p.maxHeight <= 300, JSON.stringify(p));
});
test('nextMatch: typing jumps to the next option that starts with the letters, wrapping round', () => {
  const labels = ['Every month', 'Every 3 months', 'Every year', 'Every so many days'];
  eq(nextMatch(labels, 'every y', 1), 2);
  eq(nextMatch(labels, 'e', 3), 0, 'wraps');
  eq(nextMatch(labels, 'z', 0), -1);
  eq(nextMatch(labels, '', 0), -1);
});
test('every choose-one field uses the Apex dropdown: no raw <select> is created anywhere', async () => {
  for (const f of ['js/ui/formkit.js', 'js/ui/wizard.js', 'js/ui/manage-views.js', 'js/ui/forms.js', 'js/ui/category-views.js', 'js/ui/document-views.js', 'js/ui/report-views.js', 'js/ui/workspace.js']) {
    ok(!/h\(\s*['"]select['"]/.test(await read(f)), `${f} still creates a native select`);
  }
  const kit = await read('js/ui/formkit.js');
  ok(kit.includes("pickOption(") && kit.includes('input--pick'), 'selectInput must open the Apex sheet');
});
test('the dropdown and date fields are styled, loaded by the page, and kept offline', async () => {
  const css = await read('css/picker.css');
  ok(css.includes('.input--pick') && css.includes('.pick-opt') && css.includes('input.input[type="date"]'));
  ok((await read('index.html')).includes('/css/picker.css'), 'index.html must load css/picker.css');
  const sw = await read('sw.js');
  ok(sw.includes("'/css/picker.css'") && sw.includes("'/js/ui/picker.js'"), 'sw.js SHELL must list both new files');
});
test('the picker uses no innerHTML and no style attributes (the security policy forbids both)', async () => {
  const js = (await read('js/ui/picker.js')).replace(/^\s*\/\/.*$/gm, '');
  ok(!/innerHTML|setAttribute\(\s*['"]style/.test(js));
});

export async function runPickerTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) {
    try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); }
  }
  log(`\n${passed} passed, ${failed} failed (dropdowns).`);
  return { passed, failed };
}
