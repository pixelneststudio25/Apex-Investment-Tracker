// Settings restructure: the list, the section routes, the quick picker, the danger zone and the file registration.
import { readFile } from 'node:fs/promises';
import { LOCK_CHOICES, SETTINGS_SECTIONS, THEME_WORDS, lockWord } from '../js/ui/settings-views.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'failed'); };
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('lock words: minutes read plainly and zero means never', () => {
  ok(lockWord(2) === '2 min' && lockWord('15') === '15 min' && lockWord(0) === 'Never');
  ok(LOCK_CHOICES.map((c) => c[0]).join() === '1,2,5,15,0', 'the choices are the ones the schema allows');
});
test('theme words cover every mode the theme code can return', () => {
  ok(Object.keys(THEME_WORDS).sort().join() === 'dark,light,system');
});
test('every section has a title, an icon that exists, and search words', async () => {
  const icons = await read('js/ui/icons.js');
  for (const [slug, [title, ic, words]] of Object.entries(SETTINGS_SECTIONS)) {
    ok(title && words, `${slug} needs a title and search words`);
    ok(new RegExp(`\\b${ic}:`).test(icons), `${slug} uses the icon "${ic}", which does not exist`);
  }
});
test('the list has every group, opens sections by route, and keeps every old destination reachable', async () => {
  const sv = await read('js/ui/settings-views.js');
  for (const g of ['Preferences', 'Your data', 'Backup', 'Security', 'Help', 'Account']) ok(sv.includes(`group('${g}'`), `missing group ${g}`);
  for (const r of ['#/categories', '#/export', '#/deleted', '#/reminders', '#/projections']) ok(sv.includes(`'${r}'`), `no row for ${r}`);
  ok(sv.includes('`#/settings/${key}`'), 'section rows must use #/settings/<section>');
  for (const a of ['onSetPin', 'onCheckKey', 'onLock', 'onSignOut', 'onWipe', 'onRotateKey']) ok(sv.includes(`actions.${a}`), `no row for ${a}`);
});
test('auto-lock is a quick pick in the Apex sheet and applies at once', async () => {
  const sv = await read('js/ui/settings-views.js');
  ok(sv.includes('pickOption(') && sv.includes('actions.onLockTimeout'));
});
test('the danger zone asks before creating a new recovery key, and the wipe keeps its own backup check', async () => {
  const sv = await read('js/ui/settings-views.js'), app = await read('js/app.js');
  ok(/confirmDialog\(\{ title: 'Create a new recovery key\?'/.test(sv));
  ok(app.includes("title: 'Remove my data from this device?'") && app.includes('sync.verify()'));
});
test('workspace routes sections, opens them from search, and no longer holds the old settings page', async () => {
  const ws = await read('js/ui/workspace.js');
  ok(ws.includes('settingsView(settingsEnv(ctx), parts)') && ws.includes('SETTINGS_SECTIONS'));
  ok(!ws.includes("h('h2', {}, 'Danger zone')"), 'the old panels must be gone from workspace.js');
});
test('settings.css and settings-views.js are loaded by the page and cached offline, and the CSP rules hold', async () => {
  ok((await read('index.html')).includes('/css/settings.css'));
  const sw = await read('sw.js');
  ok(sw.includes("'/css/settings.css'") && sw.includes("'/js/ui/settings-views.js'"));
  const js = (await read('js/ui/settings-views.js')).replace(/^\s*\/\/.*$/gm, '');
  ok(!/innerHTML|setAttribute\(\s*['"]style/.test(js));
});

export async function runSettingsTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) {
    try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); }
  }
  log(`\n${passed} passed, ${failed} failed (settings).`);
  return { passed, failed };
}
