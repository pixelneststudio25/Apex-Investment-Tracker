// Phase 12-iii tests: the Outlook tab, its routes and redirects, and the house rules for the new screen.
// The screen itself needs a browser; these check the wiring on the source and the pure navigation rules.
import { readFile } from 'node:fs/promises';
import { SETTINGS_SECTIONS } from '../js/ui/settings-views.js';
import { STATIC_ROUTES } from '../js/models/help-content.js';
import { backToOrigin, getOrigin, noteRoute, tabForShared } from '../js/ui/nav.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'failed'); };
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('the bottom bar has four tabs in order: Home, Investments, Outlook, Settings', async () => {
  const ws = await read('js/ui/workspace.js');
  const nav = ws.match(/const NAV = \[(.*)\];/)[1];
  const keys = [...nav.matchAll(/\['(\w+)', '#\//g)].map((m) => m[1]);
  ok(JSON.stringify(keys) === JSON.stringify(['home', 'investments', 'outlook', 'settings']), keys.join(','));
  ok(nav.includes("['outlook', '#/outlook', 'Outlook', 'trend']"));
});
test('Outlook, Reminders and the old projection links highlight the right tab, and every old link still lands somewhere sensible', async () => {
  const ws = await read('js/ui/workspace.js');
  ok(ws.includes("page === 'outlook' || page === 'reminders' ? 'outlook'"), 'Outlook and Reminders light the Outlook tab');
  ok(ws.includes("if (parts[0] === 'projections')"), 'old projection links are redirected');
  ok(ws.includes("`#/outlook/${parts[1]}`") && ws.includes("'#/outlook'") && ws.includes("parts[1] !== 'all'"), '#/projections/<id> goes to that investment; #/projections and #/projections/all go to Outlook');
  ok(ws.includes("history.replaceState(null, '', to)"), 'the address bar is corrected, so Back does not bounce');
  ok(ws.includes("page === 'outlook') view = await outlookView("), 'the route renders the Outlook screen');
  ok(!/href: '#\/projections|go\('#\/projections|`#\/projections/.test(ws), 'nothing in the app still links to the old routes');
});
test('every in-app link to the old Projections pages is gone, and Help points at Outlook', async () => {
  for (const f of ['workspace', 'settings-views', 'manage-views', 'report-views', 'help', 'palette', 'outlook-views']) ok(!/#\/projections/.test((await read(`js/ui/${f}.js`)).replace(/^\s*\/\/.*$/gm, '')), `${f}.js still links to #/projections`);
  ok(STATIC_ROUTES.includes('#/outlook') && !STATIC_ROUTES.includes('#/projections'));
  const search = (await read('js/ui/workspace.js'));
  ok(/cmd\('Go to', 'Outlook', 'trend'/.test(search) && !/'Whole portfolio projection'/.test(search), 'search finds Outlook');
});
test('Reminders and Projections left Settings; Outlook pages count as Outlook for back links and Help', () => {
  ok(!('reminders' in SETTINGS_SECTIONS) && !('projections' in SETTINGS_SECTIONS));
  noteRoute(['outlook']); ok(getOrigin() === 'outlook' && backToOrigin().href === '#/outlook' && backToOrigin().text === 'Outlook' && tabForShared() === 'outlook');
  noteRoute(['help', 'start']); ok(getOrigin() === 'outlook', 'Help does not change where you came from');
  noteRoute(['reminders', 'new']); ok(getOrigin() === 'outlook');
  noteRoute(['settings']); ok(getOrigin() === 'settings' && backToOrigin().href === '#/settings');
  noteRoute(['home']); ok(getOrigin() === 'home' && backToOrigin().href === '#/');
});
test('the new files are cached for offline use and the stylesheet is linked', async () => {
  const sw = await read('sw.js'), html = await read('index.html');
  for (const f of ['/js/ui/outlook-views.js', '/js/ui/sheet.js', '/js/models/outlook.js', '/css/outlook.css']) ok(sw.includes(`'${f}'`), `${f} missing from the offline list`);
  ok(html.includes('href="/css/outlook.css"'));
  ok(Number(sw.match(/apex-shell-(\d+)/)[1]) >= 8, 'the cache version was bumped');
});
test('Outlook follows the house rules: no innerHTML, no inline styles or colours, tokens only, every figure marked as a projection', async () => {
  const [v, sh, css] = await Promise.all(['js/ui/outlook-views.js', 'js/ui/sheet.js', 'css/outlook.css'].map(read));
  for (const [n, src] of [['outlook-views.js', v], ['sheet.js', sh]]) {
    ok(!/innerHTML|outerHTML|insertAdjacentHTML|replaceChildren\(/.test(src.replace(/^\s*\/\/.*$/gm, '')), `${n}: no innerHTML or bare replaceChildren`);
    ok(!/style\s*:|setAttribute\(\s*['"]style|\.style\./.test(src), `${n}: no inline styles`); ok(!/#[0-9a-fA-F]{3,8}\b|rgb\(/.test(src), `${n}: no fixed colours`);
    ok(!/localStorage|sessionStorage|fetch\(/.test(src), `${n}: nothing is saved or sent`);
  }
  ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css), 'outlook.css: colours only through tokens'); ok(!/animation|transition/.test(css), 'outlook.css does not move');
  ok(v.includes("'Projection'") && v.includes('not facts'), 'the screen says it is a projection');
});
test('the screen has every section the plan lists, in order', async () => {
  const v = await read('js/ui/outlook-views.js');
  const at = (t) => v.indexOf(t);
  const order = ["'Headline'", "'Where it could go'", "'Assumptions'", "'Scenarios'", 'comingUp(ctx', "'Cash flow'", "'Maturities'", "'Goals'"].map(at);
  ok(order.every((i) => i > 0) && order.every((x, i) => !i || x > order[i - 1]), `sections out of order: ${order}`);
  for (const t of ['YEAR_CHOICES', "'Custom'", "'Real terms", "My share", 'Cautious', 'Optimistic', "'Reset'", 'Target worth']) ok(v.includes(t), `missing ${t}`);
  ok(!/Show projection/.test(v), 'no Show projection button: figures update live');
});
test('typed numbers are checked with sentences, never a crash: years, inflation, points and rates', async () => {
  const v = await read('js/ui/outlook-views.js');
  ok(v.includes('parseYears(v)') && v.includes('parseInflation(v)') && v.includes('parseNudge(v)') && v.includes('buildScenario('), 'every typed field goes through its parser');
  ok(v.includes('Type a yearly rate, or use the saved rate.'));
});
test('the cash flow and goals use the engine, not their own sums', async () => {
  const v = await read('js/ui/outlook-views.js');
  for (const f of ['cashFlowByMonth(', 'maturities(', 'reachMonth(', 'incomeInYear(', 'projectBand(', 'projectOutlook(']) ok(v.includes(f), `${f} not used`);
});

test('saving: the screen loads what was saved once per unlock, saves quietly after a change (not on first paint), and offers named scenarios', async () => {
  const v = await read('js/ui/outlook-views.js'), ws = await read('js/ui/workspace.js');
  ok(v.includes('S.owner !== ctx.store') && v.includes('loadPlans(ctx.store)') && v.includes('choicesFromPlan(working'), 'loads the saved choices when the store changes');
  ok(v.includes('refresh(false)'), 'the first paint does not write anything'); ok(v.includes('setTimeout(() => { saveWorking(ctx.store, S, years())') && v.includes('.catch(() => {})'), 'saves after a short pause and can never break the screen');
  for (const t of ["'Saved scenarios'", "'Save these choices'", "'Load'", "'Delete'", "'Undo'", "'Reset everything'", 'MAX_NAMED']) ok(v.includes(t), `missing ${t}`);
  ok(ws.includes('rerender: () => render({ keepScroll: true })'), 'loading a scenario redraws in place without jumping to the top');
});

export async function runOutlookUiTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) { try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); } }
  log(`\n${passed} passed, ${failed} failed (outlook screen and routes).`);
  return { passed, failed };
}
