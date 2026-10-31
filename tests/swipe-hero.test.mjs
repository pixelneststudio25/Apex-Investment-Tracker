// Phase 13 tests (batch 3): swipe actions and the shared-element glide. The gestures need a touch screen, so the rules
// that decide what happens are pure functions tested here, and the wiring is checked on the source.
import { readFile } from 'node:fs/promises';
import { AXIS_LOCK_PX, CLICK_GUARD_PX, FLING_PX_PER_MS, swipeAxis, swipeOffset, swipeSettle } from '../js/ui/swipe.js';
import { shouldGlide } from '../js/ui/hero.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('axis: a small movement decides nothing, a sideways one is a swipe, an up-down one is a scroll, a diagonal leans to scrolling', () => {
  eq(swipeAxis(3, 2), null); eq(swipeAxis(AXIS_LOCK_PX - 1, 0), null, 'just under the line'); eq(swipeAxis(-12, 2), 'x'); eq(swipeAxis(2, 30), 'y'); eq(swipeAxis(-30, 28), 'y', 'a near-diagonal is not taken from the scroll'); eq(swipeAxis(-30, 20), 'x'); eq(swipeAxis(0, -9), 'y');
});
test('offset: the row follows the finger inside its range and gives a little beyond, never far', () => {
  eq(swipeOffset(0, -50, 168), -50); eq(swipeOffset(0, -168, 168), -168); eq(swipeOffset(-168, 40, 168), -128, 'dragging an open row back');
  ok(swipeOffset(0, 80, 168) > 0 && swipeOffset(0, 80, 168) <= 14, 'pulling right of closed gives a small bounce'); eq(swipeOffset(0, 5000, 168), 14);
  ok(swipeOffset(0, -400, 168) < -168 && swipeOffset(0, -400, 168) >= -190, 'pulling past open gives a little give'); eq(swipeOffset(0, -5000, 168), -190);
});
test('settle: a flick decides first, otherwise halfway does, and a flick the other way beats a deep drag', () => {
  const w = 168;
  eq(swipeSettle({ offset: -20, width: w, velocity: -FLING_PX_PER_MS }), 'open', 'a quick flick left opens even a short drag');
  eq(swipeSettle({ offset: -150, width: w, velocity: FLING_PX_PER_MS }), 'closed', 'a quick flick right closes even a deep drag');
  eq(swipeSettle({ offset: -84, width: w, velocity: 0 }), 'open', 'exactly halfway opens'); eq(swipeSettle({ offset: -83, width: w, velocity: 0 }), 'closed'); eq(swipeSettle({ offset: 0, width: w, velocity: -0.1 }), 'closed', 'a slow drift does nothing');
  ok(CLICK_GUARD_PX > 0 && CLICK_GUARD_PX < AXIS_LOCK_PX, 'a drag is recognised as a drag before it can count as a tap');
});
test('glide: only when the browser can, Reduce Motion is off, the old tile is on screen and the new page has one', () => {
  const base = { supported: true, reduced: false, fromTile: {}, toTile: {}, onScreen: true };
  eq(shouldGlide(base), true);
  for (const [k, v] of [['supported', false], ['reduced', true], ['fromTile', null], ['toTile', null], ['onScreen', false]]) eq(shouldGlide({ ...base, [k]: v }), false, k);
});
test('swipe is wired into the Investments list for open investments only, with real actions and a keyboard route', async () => {
  const ws = await read('js/ui/workspace.js'), sw = await read('js/ui/swipe.js');
  ok(ws.includes("it.error || m.basis === 'realized' ? h('li', {}, link) : swipeRow(inv, link)"), 'closed and broken investments are plain rows');
  ok(ws.includes('`#/investments/${inv.id}/entry`') && ws.includes('`#/investments/${inv.id}/valuation`') && ws.includes("'Add entry'") && ws.includes("'Update value'"), 'the two actions go to the existing forms');
  ok(ws.includes('Swipe a row left for quick actions.'), 'a hint for touch screens');
  for (const k of ["'ArrowLeft'", "'ArrowRight'", "'Escape'"]) ok(sw.includes(k), `${k} handled`);
  ok(sw.includes("e.pointerType === 'mouse'"), 'a mouse never drags a row'); ok(sw.includes("tabindex', open ? '0' : '-1'") && sw.includes("'aria-hidden', String(!open)") && sw.includes("'aria-expanded'"), 'closed actions are hidden from keyboards and screen readers');
  ok(sw.includes("haptic('toggle')"), 'a tap of feedback when it opens, behind the setting'); ok(sw.includes('closeOthers(api)') && sw.includes("addEventListener('hashchange'"), 'one open at a time; leaving the page closes it');
});
test('the glide is wired both ways and every card, row and header names its tile and title', async () => {
  const ws = await read('js/ui/workspace.js');
  eq((ws.match(/'data-inv': inv\.id/g) || []).length, 3, 'Home card, list row, page header'); eq((ws.match(/'data-hero': 'tile'/g) || []).length, 3); eq((ws.match(/'data-hero': 'name'/g) || []).length, 3);
  ok(ws.includes('hasHero(view, target)') && ws.includes('hasHero(view, shownDetail)'), 'forward to the page and back again'); ok(ws.includes('keepScroll ? null :'), 'a refresh in place never glides');
  ok(ws.includes('await heroSwap({ outlet, view, id: glideId, swap })') && ws.includes('if (!glided) { swap();'), 'when it cannot glide, the page changes exactly as before');
  const hero = await read('js/ui/hero.js'); ok(/finally \{[^}]*viewTransitionName = ''/.test(hero), 'the names are always removed afterwards');
});
test('house rules: nothing moves under Reduce Motion, colours are tokens, no innerHTML, no network, files cached, and the glide has its own style', async () => {
  const [sw, hero, css, motion, sh] = await Promise.all(['js/ui/swipe.js', 'js/ui/hero.js', 'css/workspace.css', 'css/motion.css', 'sw.js'].map(read));
  for (const [n, src] of [['swipe.js', sw], ['hero.js', hero]]) { ok(!/innerHTML|fetch\(|localStorage/.test(src), `${n}: clean`); ok(!/#[0-9a-fA-F]{3,8}\b|rgb\(/.test(src), `${n}: no fixed colours`); }
  const block = css.slice(css.indexOf('Swipe actions on investment list rows')); ok(block.length > 200 && !/#[0-9a-fA-F]{3,8}\b|rgb\(/.test(block), 'swipe styles use tokens only');
  ok(/prefers-reduced-motion: reduce\) \{ \.swipe-front \{ transition: none; \}/.test(block), 'the slide is removed with Reduce Motion'); ok(block.includes('touch-action: pan-y'), 'vertical scrolling stays native');
  ok(motion.includes('html[data-vt="hero"]::view-transition-group(inv-tile)'), 'glide styles'); ok(hero.includes('prefersReducedMotion()'), 'and it checks Reduce Motion itself');
  for (const f of ['/js/ui/swipe.js', '/js/ui/hero.js']) ok(sh.includes(`'${f}'`), `${f} cached offline`); ok(Number(sh.match(/apex-shell-(\d+)/)[1]) >= 12);
});

export async function runSwipeHeroTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) { try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); } }
  log(`\n${passed} passed, ${failed} failed (swipe actions and glide).`);
  return { passed, failed };
}
