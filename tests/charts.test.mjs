// Phase 12-ii tests: the Outlook charts. The drawing needs a screen, so the rules that decide what is drawn are pure
// functions tested here; the house rules (no inline colours, no innerHTML, tokens only) are checked on the source.
import { readFile } from 'node:fs/promises';
import { describeBand, describeCashFlow, describeStack, nearestIndex, stackLayers } from '../js/ui/charts.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
const money = (k) => `₦${(k / 100).toLocaleString('en-US')}`;

// Three months of an imaginary portfolio of seven investments, worth 700, 600 ... 100 (in naira) and growing a little.
const parts = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ investment: { id: `i${n}`, name: `Inv ${n}` }, endKobo: (8 - n) * 10000 }));
const months = [0, 1, 2].map((m) => ({ month: m, date: `2026-0${m + 4}-15`, byInvestment: Object.fromEntries(parts.map((p) => [p.investment.id, p.endKobo + m * 100])) }));

test('nearestIndex: the scrub position snaps to the closest month and never leaves the chart', () => {
  const g = { count: 61, left: 8, width: 624 };
  eq(nearestIndex(8, g), 0); eq(nearestIndex(632, g), 60); eq(nearestIndex(320, g), 30);
  eq(nearestIndex(-500, g), 0, 'left of the chart'); eq(nearestIndex(9999, g), 60, 'right of the chart');
  eq(nearestIndex(100, { count: 1, left: 0, width: 10 }), 0, 'one point');
});
test('stackLayers: biggest at the bottom, the smallest are added together as "Everything else", and the layers add up to the total every month', () => {
  const layers = stackLayers(months, parts);
  eq(layers.length, 6, 'five named layers and one for the rest'); eq(layers[0].label, 'Inv 1'); eq(layers[4].label, 'Inv 5');
  eq(layers[5].label, 'Everything else'); eq(layers[5].count, 2, 'two investments folded together');
  months.forEach((m, i) => eq(layers.reduce((t, l) => t + l.values[i], 0), Object.values(m.byInvestment).reduce((t, x) => t + x, 0), `month ${i} adds up`));
  eq(layers[5].values[0], 20000 + 10000, 'Inv 6 plus Inv 7 today');
});
test('stackLayers: six or fewer investments are all named, ties are ordered by name, and an empty list gives no layers', () => {
  const six = stackLayers(months, parts.slice(0, 6)); eq(six.length, 6); ok(six.every((l) => l.id !== 'other'));
  const tied = stackLayers(months, [{ investment: { id: 'b', name: 'Bravo' }, endKobo: 5 }, { investment: { id: 'a', name: 'Alpha' }, endKobo: 5 }].map((p) => ({ ...p })), 5);
  eq(tied.map((l) => l.label), ['Alpha', 'Bravo']); eq(stackLayers([], []), []);
});
test('descriptions: both charts say what they show, where it ends, that it is a projection, and honour real terms', () => {
  const bands = [{ lowKobo: 100, baseKobo: 100, highKobo: 100 }, ...Array.from({ length: 60 }, () => ({ lowKobo: 150000, baseKobo: 200000, highKobo: 260000 }))];
  const b = describeBand(bands, money, { real: true });
  ok(b.includes('5 years') && b.includes('₦2,000') && b.includes('cautious case of ₦1,500') && b.includes('optimistic case of ₦2,600') && b.includes('today\'s money') && b.includes('not a fact'), b);
  ok(!describeBand(bands, money).includes('today\'s money'), 'real terms is only mentioned when on');
  const layers = stackLayers(months, parts), s = describeStack(layers, months, money);
  ok(s.includes('Inv 1') && s.includes('not a fact') && s.includes('2 months') === false, s);
  const hidden = describeBand(bands, () => '₦ ••••••'); ok(!/\d{3}/.test(hidden.replace(/\d+ years?/, '')), 'a hidden-amounts formatter leaves no figures in the description');
});
test('the charts follow the house rules: no innerHTML, no inline style attribute, no fixed colours, and the colours are chart tokens', async () => {
  const js = await read('js/ui/charts.js'), css = await read('css/workspace.css');
  ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(js), 'no innerHTML');
  const outlook = js.slice(js.indexOf('Outlook charts (Phase 12-ii)'));
  ok(!/style\s*:|setAttribute\(\s*['"]style/.test(outlook), 'no inline styles in the new charts'); ok(!/#[0-9a-fA-F]{3,8}\b|rgb\(/.test(outlook), 'no fixed colours in the new charts');
  const block = css.slice(css.indexOf('Outlook charts (band and stacked areas)'));
  ok(block.length > 100 && !/#[0-9a-fA-F]{3,8}\b|rgb\(/.test(block), 'the new chart styles use tokens only');
  for (let i = 1; i <= 6; i++) ok(block.includes(`.layer-${i} { fill: var(--chart-${i}); }`), `layer-${i} uses chart-${i}`);
  ok(!/animation/.test(block), 'the new charts do not animate, so Reduce Motion needs no special case');
});
test('the charts can be scrubbed without a mouse: arrow keys, Home, End, and a slider role with a value text', async () => {
  const js = await read('js/ui/charts.js');
  for (const k of ['ArrowRight', 'ArrowLeft', 'Home', 'End', 'PageUp', 'Escape']) ok(js.includes(`'${k}'`), `${k} handled`);
  ok(js.includes("role: 'slider'") && js.includes('aria-valuetext') && js.includes('tabindex: 0'), 'slider semantics');
});

test('cash flow bars: the description gives the totals and says it is a projection; bars use tokens', async () => {
  const w = [{ from: '2026-05-01', to: '2026-05-31', incomeKobo: 1000000, costsKobo: 250000 }, { from: '2026-06-01', to: '2026-06-30', incomeKobo: 1000000, costsKobo: 0 }];
  const t = describeCashFlow(w, money); ok(t.includes('2 months') && t.includes('₦20,000 comes in') && t.includes('₦2,500 goes out') && t.includes('not a fact'), t);
  const css = await read('css/workspace.css'); ok(css.includes('.chart .bar-in { fill: var(--accent); }') && css.includes('.chart .bar-out { fill: var(--chart-5); }'));
});
test('the scrub helper can skip the dot and place its own index, so bars and lines share one scrubber', async () => {
  const js = await read('js/ui/charts.js'); ok(js.includes('dot: withDot = true') && js.includes('pick = null') && js.includes('Math.floor((px - L) / slot)'));
});

export async function runChartTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) { try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); } }
  log(`\n${passed} passed, ${failed} failed (outlook charts).`);
  return { passed, failed };
}
