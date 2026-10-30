// Settings restructure: the list, the section routes, the quick picker, the danger zone and the file registration.
import { readFile } from 'node:fs/promises';
import { LOCK_CHOICES, SETTINGS_SECTIONS, THEME_WORDS, lockWord } from '../js/ui/settings-views.js';
import { backToOrigin, getOrigin, noteRoute, tabForShared } from '../js/ui/nav.js';
import { fill } from '../js/ui/dom.js';

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
  for (const r of ['#/categories', '#/export', '#/deleted']) ok(sv.includes(`'${r}'`), `no row for ${r}`);
  for (const r of ['#/reminders', '#/projections']) ok(!sv.includes(`'${r}'`), `${r} moved to the Outlook tab`);
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

test('back links: Help goes back to Settings when you came from Settings, otherwise Home', () => {
  noteRoute(['home']);
  ok(backToOrigin().href === '#/' && backToOrigin().text === 'Home' && tabForShared() === 'home');
  noteRoute(['settings', 'appearance']);
  ok(getOrigin() === 'settings' && backToOrigin().href === '#/settings' && tabForShared() === 'settings');
  noteRoute(['help', 'start']);
  ok(getOrigin() === 'settings', 'Help itself must not change where you came from');
  noteRoute(['investments', 'abc']);
  ok(getOrigin() === 'investments' && backToOrigin().href === '#/');
  noteRoute(['deleted']);
  ok(getOrigin() === 'settings', 'pages that live in Settings always count as Settings');
  noteRoute(['reminders']);
  ok(getOrigin() === 'outlook' && backToOrigin().href === '#/outlook' && tabForShared() === 'outlook', 'Reminders and Outlook count as Outlook');
});
test('every page that lives in Settings links back to Settings (and Reminders back to Outlook)', async () => {
  const [mg, rp, cat, hp] = await Promise.all(['js/ui/manage-views.js', 'js/ui/report-views.js', 'js/ui/category-views.js', 'js/ui/help.js'].map(read));
  ok(/backLink\('#\/outlook', 'Outlook'\), h\('div', \{ class: 'page-actions' \}, h\('h1', \{ class: 'page-title' \}, 'Reminders'\)/.test(mg), 'Reminders needs its back link to Outlook');
  ok(/backLink\('#\/settings', 'Settings'\), h\('h1', \{ class: 'page-title' \}, 'Recently deleted'\)/.test(mg), 'Recently deleted needs its back link');
  ok(rp.includes("backLink('#/settings', 'Settings'), h('h1', { class: 'page-title' }, 'Export and print')") && cat.includes("backLink('#/settings', 'Settings'), h('h1', { class: 'page-title' }, 'My categories')"));
    ok(hp.includes('backToOrigin()') && !hp.includes("backLink('Home', '#/')"), 'Help follows where you came from');
});
test('fill() never prints the word "false": a missing section is simply absent', () => {
  const el = { replaceChildren(...k) { this.k = k; } };
  fill(el, 'a', false, null, undefined, ['b', false], 'c');
  ok(JSON.stringify(el.k) === JSON.stringify(['a', 'b', 'c']), JSON.stringify(el.k));
});
test('no page replaces its contents with a bare replaceChildren (that is how "false" got printed)', async () => {
  for (const f of ['workspace', 'manage-views', 'report-views', 'document-views', 'category-views', 'sync-ui', 'wizard']) {
    ok(!/[A-Za-z_]\w*\.replaceChildren\(/.test((await read(`js/ui/${f}.js`)).replace(/^\s*\/\/.*$/gm, '')), `${f}.js still calls replaceChildren directly`);
  }
});
test('spacing tokens: every --space-N used by any stylesheet exists (a missing one silently removes the gap)', async () => {
  const names = ['base', 'categories', 'components', 'documents', 'forms', 'help', 'home', 'manage', 'motion', 'outlook', 'picker', 'pin', 'reports', 'settings', 'sync', 'workspace'];
  const tokens = await read('css/tokens.css');
  const have = new Set([...tokens.matchAll(/(--space-\d+)\s*:/g)].map((m) => m[1]));
  for (const n of names) for (const m of (await read(`css/${n}.css`)).matchAll(/var\((--space-\d+)/g)) ok(have.has(m[1]), `${n}.css uses ${m[1]}, which is not defined`);
});
test('wide fields cannot push a page sideways: scenario cards, export rows and the page itself are guarded', async () => {
  const rep = await read('css/reports.css'), ws = await read('css/workspace.css');
  ok(rep.includes('grid-template-columns: minmax(0, 1fr)') && rep.includes('.export-row .row-main { flex: 1 1 14rem; }'));
  ok(/\.ws-main, \.ws-outlet, \.flow[^{]*\{ min-width: 0; \}/.test(ws));
});

export async function runSettingsTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) {
    try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); }
  }
  log(`\n${passed} passed, ${failed} failed (settings).`);
  return { passed, failed };
}
