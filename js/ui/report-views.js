// Phase 7 screens: Projections, Export, and the printable Statement. The rules live in js/models/projections.js and
// js/models/export.js (both tested); this file only draws forms and tables. No inline styles, no innerHTML.
import { h } from './dom.js';
import { icon } from './icons.js';
import { setBusy } from './motion.js';
import { lineChart } from './charts.js';
import { amtText, fmtDate, isHidden, money, pct, tone, todayISO } from './fmt.js';
import { checkbox, dateInput, field, percentField, segmented, selectInput, textInput } from './formkit.js';
import { helpLink } from './help.js';
import { formatNaira } from '../engine/index.js';
import { InputError, checkDate } from '../models/inputs.js';
import { dueUnrecorded } from '../models/manage.js';
import { DIRECTIONS, MAX_YEARS, METHODS, blankScenario, buildScenario, dueNotCounted, explain, horizonList, parseYears, runProjection, startingScenario } from '../models/projections.js';
import { runPortfolioProjection, splitItems } from '../models/portfolio-projection.js';
import { KIND_LABEL, SOURCE_LABEL, buildStatement, csvName, ledgerCsv, loadReport, summaryCsv, valuationsCsv } from '../models/export.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const backLink = (href, text) => h('a', { class: 'back', href }, icon('chevronLeft', { size: 18 }), text);
const amt = (kobo, opts = {}) => h('span', { class: 'amt' }, amtText(kobo, { compact: false, ...opts }));
const sectionHead = (title, right) => h('div', { class: 'section-head' }, h('h2', {}, title), right);
const yearsText = (n) => plural(n, 'year', 'years');
const errorBox = (text) => h('p', { class: 'alert alert--error', role: 'alert' }, text);

// A plain download of text as a file. Used for CSV; the backup file has its own helper in sync-ui.js.
export function downloadCsv(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function reportView(env, parts) {
  const page = parts[0];
  if (page === 'projections') return parts[1] === 'all' ? portfolioScreen(env) : parts[1] ? projectionScreen(env, parts[1]) : projectionChooser(env);
  if (page === 'export') return exportScreen(env);
  if (page === 'statement') return statementScreen(env, parts[1] || null);
  return null;
}

// ----- shared by the single-investment and whole-portfolio projection screens -----
function scenarioCard(title, initial, hint) {
  const state = { ...initial };
  const label = field('Name', textInput({ value: state.label, maxlength: 40, onInput: (v) => { state.label = v; } }));
  const rate = percentField('Yearly rate (%)', { value: state.percent, onInput: (v) => { state.percent = v; }, hint });
  const dir = segmented({ label: 'Grows or loses value', options: DIRECTIONS, value: state.direction, onChange: (v) => { state.direction = v; } });
  const method = field('How the rate is applied', selectInput({ value: state.method, options: METHODS, onChange: (v) => { state.method = v; } }));
  return { state, rate, el: h('fieldset', { class: 'scen' }, h('legend', {}, title), label.el, rate.el, h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Grows or loses value'), dir), method.el) };
}

function projTable(label, rows, showPay) {
  const heads = ['Looking ahead', 'Date', 'Worth then', ...(showPay ? ['Regular income', 'Regular costs'] : []), 'Gain from today', 'Yearly return'];
  return h('div', { class: 'scroll-x' }, h('table', { class: 'table proj-table' }, h('caption', { class: 'sr-only' }, `Projection for ${label}`),
    h('thead', {}, h('tr', {}, heads.map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, rows.map((row) => h('tr', {}, h('th', { scope: 'row' }, yearsText(row.years)), h('td', {}, fmtDate(row.endDate)), h('td', {}, amt(row.valueKobo)),
      showPay && h('td', {}, amt(row.incomeKobo)), showPay && h('td', {}, amt(row.costsKobo)),
      h('td', { class: tone(row.gainKobo) }, amt(row.gainKobo, { sign: true })), h('td', {}, row.annualRate == null ? 'n/a' : pct(row.annualRate)))))));
}

// ================= Projections: choose an investment =================
async function projectionChooser({ ctx }) {
  const today = todayISO();
  const live = (await ctx.pf.overview(today)).filter((it) => !it.error && it.metrics.basis !== 'realized');
  const head = h('div', { class: 'page-actions' }, h('h1', { class: 'page-title' }, 'Projections'));
  const intro = h('p', { class: 'sub' }, 'A projection shows what an investment could be worth later if a rate you choose holds. It is a what-if, not a fact, and nothing you try here is saved.');
  if (!live.length) return h('div', { class: 'flow' }, head, intro, h('div', { class: 'empty' }, h('span', { class: 'empty-art' }, icon('chart', { size: 30 })), h('h2', {}, 'Nothing to project yet'),
    h('p', {}, 'Add an investment that is still open, then come back here to look ahead.'), h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/new' }, icon('plus'), 'Add investment'))));
  const all = h('a', { class: 'panel row-line all-card', href: '#/projections/all' }, h('span', { class: 'tile tint-2' }, icon('chart')), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, 'Whole portfolio'), h('div', { class: 'row-sub' }, `${plural(live.length, 'open investment', 'open investments')} added up`)), h('div', { class: 'row-end' }, h('span', { class: 'money' }, amt(live.reduce((t, it) => t + it.metrics.valueKobo, 0))), h('span', { class: 'row-sub' }, 'worth today')));
  return h('div', { class: 'flow' }, head, intro, all, h('section', { 'aria-label': 'Choose an investment' }, sectionHead('Choose an investment'),
    h('div', { class: 'panel panel--flush' }, h('ul', { class: 'rows' }, live.map(({ investment: inv, metrics: m }) => {
      const c = ctx.cat(inv.categoryId);
      return h('li', {}, h('a', { class: 'row-line', href: `#/projections/${inv.id}` }, h('span', { class: 'tile tint-1' }, icon(c.icon)),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, inv.name), h('div', { class: 'row-sub' }, c.name)),
        h('div', { class: 'row-end' }, h('span', { class: 'money' }, amt(m.valueKobo)), h('span', { class: 'row-sub' }, 'worth today'))));
    })))),
    h('p', { class: 'sub' }, helpLink('projections-export', 'How projections work')));
}

// ================= Projections: one investment =================
async function projectionScreen({ ctx }, id) {
  const today = todayISO(), back = `#/investments/${id}`;
  let r;
  try { r = await ctx.pf.metrics(id, today); }
  catch (e) {
    if (e.code === 'NOT_FOUND') return h('div', { class: 'flow' }, backLink('#/projections', 'Projections'), errorBox('This investment could not be found. It may have been removed.'));
    if (e.code) return h('div', { class: 'flow' }, backLink(back, 'Investment'), errorBox(`This investment cannot be calculated yet, so it cannot be projected. ${e.message}`));
    throw e;
  }
  const { bundle: b, metrics: m } = r, inv = b.investment, c = ctx.cat(inv.categoryId);
  if (m.basis === 'realized') return h('div', { class: 'flow' }, backLink(back, inv.name), h('h1', { class: 'page-title' }, 'Projection'), h('p', { class: 'note-box' }, 'This investment is closed, so there is nothing left to project. Reopen it first if that was a mistake.'));
  const start = m.valueKobo;
  const startNote = m.valueSource === 'valuation' ? `your latest valuation, from ${fmtDate(m.valuationDate)}` : m.valueSource === 'assumed' ? 'an estimate from the rate saved on this investment' : 'the money put in, because there is no valuation or rate yet';
  const hasPlans = b.schedules.some((s) => s.status === 'active');
  const dueN = dueNotCounted(b, today, dueUnrecorded);

  // ----- the form -----
  const found = startingScenario(inv, today);
  const A = scenarioCard('Scenario A', found ? { ...found } : blankScenario('Scenario A'), found ? `Filled in from the rate saved on this investment. Change it freely: nothing is saved.` : 'For example 12 for twelve percent a year.');
  const B = scenarioCard('Scenario B (optional)', blankScenario('Scenario B'), 'Leave this empty to look at one scenario. Fill it in to compare the two side by side.');
  let yearsInput = '', include = true;
  const years = field('Another number of years', textInput({ inputmode: 'numeric', placeholder: 'for example 7', onInput: (v) => { yearsInput = v; } }), { optional: true, hint: `Apex always shows 1, 3, 5 and 10 years. Add one more, up to ${MAX_YEARS}.` });
  const submit = h('button', { class: 'btn', type: 'submit' }, icon('chart'), 'Show projection');
  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'scen-grid' }, A.el, B.el), years.el,
    hasPlans && checkbox({ label: 'Include the regular payments still expected (rent and costs you set up)', checked: true, onChange: (v) => { include = v; } }),
    h('div', { class: 'row' }, submit));
  const results = h('div', { class: 'flow', 'aria-live': 'polite' });
  const put = (...kids) => results.replaceChildren(...kids.flat().filter(Boolean)); // replaceChildren would print `false` for a skipped piece

  // ----- the answer -----
  function draw(out) {
    const showPay = [...out.a.rows, ...(out.b ? out.b.rows : [])].some((x) => x.incomeCount || x.costsCount);
    const scenarios = [out.a, ...(out.b ? [out.b] : [])];
    const pts = [{ date: out.asOf, a: out.startKobo, ...(out.b ? { b: out.startKobo } : {}) }, ...out.a.rows.map((row, i) => ({ date: row.endDate, a: row.valueKobo, ...(out.b ? { b: out.b.rows[i].valueKobo } : {}) }))];
    const last = out.a.rows[out.a.rows.length - 1];
    const readout = h('p', { class: 'readout' });
    const say = (p) => h('span', {}, `${fmtDate(p.date)}: `, h('strong', {}, `${out.a.scenario.label} `), amt(p.a, { compact: true }), out.b && [', ', h('strong', {}, `${out.b.scenario.label} `), amt(p.b, { compact: true })]);
    readout.replaceChildren(say(pts[pts.length - 1]));
    const chart = lineChart({ points: pts, onHover: (p) => readout.replaceChildren(say(p || pts[pts.length - 1])),
      description: `Line chart of projected worth from today to ${fmtDate(last.endDate)}. ${out.a.scenario.label} reaches ${money(last.valueKobo)}${out.b ? `, ${out.b.scenario.label} reaches ${money(out.b.rows[out.b.rows.length - 1].valueKobo)}` : ''}. This is a projection, not a fact.` });
    put(
      h('p', { class: 'note-box' }, 'These are projections, not facts. Each one assumes the rate you typed holds every year and that nothing else changes. Apex does not save them, and they never appear in your real figures.'),
      m.valueSource === 'cost' && h('p', { class: 'note-box' }, 'There is no valuation or rate on this investment yet, so the starting point is the money put in. Add a valuation to start from a truer figure.'),
      dueN > 0 && include && h('p', { class: 'note-box' }, `${plural(dueN, 'regular payment is', 'regular payments are')} already due and not in your ledger. ${dueN === 1 ? 'It is' : 'They are'} not counted here, because Apex never assumes money arrived.`),
      h('section', { class: 'panel stack' }, sectionHead('Projected worth', h('span', { class: 'chip' }, 'Projection')), readout, h('div', { class: 'chart-box' }, chart),
        h('p', { class: 'legend-inline' }, h('span', {}, out.a.scenario.label), out.b && h('span', { class: 'dashed' }, out.b.scenario.label))),
      ...scenarios.map((s, i) => h('section', { class: 'panel stack' }, sectionHead(s.scenario.label, h('span', { class: 'chip' }, 'Projection')),
        h('p', { class: 'sub' }, `${s.scenario.direction === 'loses' ? 'Loses' : 'Grows'} ${s.scenario.percentText}% a year, ${s.scenario.method === 'simple' ? 'simple, not compounded' : s.scenario.method === 'compound12' ? 'compounded monthly' : 'compounded once a year'}. Starting from ${money(out.startKobo, { compact: false })}, ${startNote}.`),
        projTable(s.scenario.label, s.rows, showPay),
        h('details', { class: 'working' }, h('summary', {}, 'How this is calculated'),
          h('ul', {}, explain({ row: s.rows[0], scenario: s.scenario, startKobo: out.startKobo, fmt: (k) => money(k, { compact: false }), startNote }).map((t) => h('li', {}, t))),
          h('p', { class: 'working-more' }, `This shows the first row, ${yearsText(s.rows[0].years)}. The other rows use the same steps with their own number of days.`)))),
      out.b && h('section', { class: 'panel stack' }, sectionHead(`${out.b.scenario.label} compared with ${out.a.scenario.label}`, h('span', { class: 'chip' }, 'Projection')),
        h('div', { class: 'scroll-x' }, h('table', { class: 'table proj-table' }, h('caption', { class: 'sr-only' }, 'Difference between the two scenarios'),
          h('thead', {}, h('tr', {}, ['Looking ahead', 'Worth then', 'Gain from today'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, out.diff.map((d) => h('tr', {}, h('th', { scope: 'row' }, yearsText(d.years)), h('td', { class: tone(d.valueKobo) }, amt(d.valueKobo, { sign: true })), h('td', { class: tone(d.gainKobo) }, amt(d.gainKobo, { sign: true }))))))),
        h('p', { class: 'sub' }, `A plus sign means ${out.b.scenario.label} ends higher than ${out.a.scenario.label}.`)),
      h('p', { class: 'sub' }, helpLink('projections-export', 'How projections work')));
  }
  function calc() {
    A.rate.setError(null); B.rate.setError(null); years.setError(null);
    let extra, a, bs;
    try { extra = parseYears(yearsInput); } catch (e) { if (!(e instanceof InputError)) throw e; years.setError(e.message); return; }
    try { a = buildScenario(A.state, 'Scenario A'); } catch (e) { if (!(e instanceof InputError)) throw e; A.rate.setError(e.message); return; }
    try { bs = buildScenario(B.state, 'Scenario B'); } catch (e) { if (!(e instanceof InputError)) throw e; B.rate.setError(e.message); return; }
    if (!a) {
      if (bs) { A.rate.setError('Scenario A needs a rate first. Fill it in, or clear Scenario B.'); return; }
      put(h('p', { class: 'note-box' }, 'Type a yearly rate in Scenario A, then choose Show projection.'));
      return;
    }
    if (bs && bs.label === a.label) bs = { ...bs, label: `${bs.label} (second)` };
    try { draw(runProjection({ bundle: b, startKobo: start, asOf: today, a, b: bs, years: horizonList(extra), includePayments: hasPlans && include })); }
    catch (e) { put(errorBox('Could not work this out. Please check the rates and try again.')); console.error(e); }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); setBusy(submit, true); try { calc(); } finally { setBusy(submit, false); } });
  if (found) calc(); else put(h('p', { class: 'note-box' }, 'Type a yearly rate in Scenario A, then choose Show projection.'));

  return h('div', { class: 'flow' }, backLink(back, inv.name),
    h('div', { class: 'detail-head' }, h('span', { class: 'tile tile--large' }, icon(c.icon, { size: 28 })), h('div', {}, h('h1', { class: 'page-title' }, 'Projection'), h('p', { class: 'sub' }, `${inv.name}, worth ${money(start, { compact: false })} today`))),
    h('p', { class: 'sub' }, 'Try a rate and see where it leads. This is a what-if: nothing you enter here is saved or counted in your real figures.'),
    h('section', { class: 'panel stack' }, form), results);
}


// ================= Projections: the whole portfolio =================
async function portfolioScreen({ ctx }) {
  const today = todayISO(), back = '#/projections';
  const items = await loadReport(ctx.pf, today), { open, broken, closedCount } = splitItems(items);
  if (!open.length) return h('div', { class: 'flow' }, backLink(back, 'Projections'), h('h1', { class: 'page-title' }, 'Whole portfolio'), h('p', { class: 'note-box' }, 'There is no open investment to project yet.'));
  const start = open.reduce((t, it) => t + it.metrics.valueKobo, 0), hasPlans = open.some((it) => it.bundle.schedules.some((x) => x.status === 'active'));
  const A = scenarioCard('Scenario A', { ...blankScenario('Scenario A'), label: 'Scenario A' }, 'Leave this empty to use each investment at its own saved rate. Type a rate to use one rate for all of them.');
  const B = scenarioCard('Scenario B (optional)', blankScenario('Scenario B'), 'Optional. One rate applied to every open investment, to compare with Scenario A.');
  let yearsInput = '', include = true;
  const years = field('Another number of years', textInput({ inputmode: 'numeric', placeholder: 'for example 7', onInput: (v) => { yearsInput = v; } }), { optional: true, hint: `Apex always shows 1, 3, 5 and 10 years. Add one more, up to ${MAX_YEARS}.` });
  const submit = h('button', { class: 'btn', type: 'submit' }, icon('chart'), 'Show projection');
  const form = h('form', { class: 'stack', novalidate: true }, h('div', { class: 'scen-grid' }, A.el, B.el), years.el,
    hasPlans && checkbox({ label: 'Include the regular payments still expected (rent and costs you set up)', checked: true, onChange: (v) => { include = v; } }), h('div', { class: 'row' }, submit));
  const results = h('div', { class: 'flow', 'aria-live': 'polite' });
  const put = (...kids) => results.replaceChildren(...kids.flat().filter(Boolean));
  const tag = h('span', { class: 'chip' }, 'Projection');
  const ownLabel = (p) => (p.flat ? 'No rate set, held flat' : `${p.scenario.direction === 'loses' ? 'Loses' : 'Grows'} ${p.scenario.percentText}% a year`);

  function draw(out) {
    const showPay = [...out.a.rows, ...(out.b ? out.b.rows : [])].some((x) => x.incomeCount || x.costsCount);
    const last = out.a.rows[out.a.rows.length - 1], aName = out.a.scenario.label, bName = out.b?.scenario.label;
    const pts = [{ date: today, a: out.startKobo, ...(out.b ? { b: out.startKobo } : {}) }, ...out.a.rows.map((r, i) => ({ date: r.endDate, a: r.valueKobo, ...(out.b ? { b: out.b.rows[i].valueKobo } : {}) }))];
    const readout = h('p', { class: 'readout' });
    const say = (p) => h('span', {}, `${fmtDate(p.date)}: `, h('strong', {}, `${aName} `), amt(p.a, { compact: true }), out.b && [', ', h('strong', {}, `${bName} `), amt(p.b, { compact: true })]);
    readout.replaceChildren(say(pts[pts.length - 1]));
    const chart = lineChart({ points: pts, onHover: (p) => readout.replaceChildren(say(p || pts[pts.length - 1])), description: `Line chart of the projected worth of your whole portfolio from today to ${fmtDate(last.endDate)}. ${aName} reaches ${money(last.valueKobo)}. This is a projection, not a fact.` });
    const far = out.a.rows[out.a.rows.length - 1];
    put(h('p', { class: 'note-box' }, 'These are projections, not facts. Each open investment starts from what it is worth today, and nothing else changes. Shared investments count at their full value, the same as on Home. Apex does not save these figures.'),
      out.flat.length > 0 && h('p', { class: 'note-box' }, `${plural(out.flat.length, 'investment has', 'investments have')} no rate set, so ${out.flat.length === 1 ? 'it is' : 'they are'} held flat at the worth today: ${out.flat.join(', ')}. Type a rate in Scenario A to use one rate for everything.`),
      (out.broken.length > 0 || out.closedCount > 0) && h('p', { class: 'sub' }, `${out.closedCount > 0 ? `${plural(out.closedCount, 'closed investment is', 'closed investments are')} not included. ` : ''}${out.broken.length > 0 ? `Left out because it could not be calculated: ${out.broken.join(', ')}.` : ''}`),
      h('section', { class: 'panel stack' }, sectionHead('Projected worth of everything', tag), readout, h('div', { class: 'chart-box' }, chart), h('p', { class: 'legend-inline' }, h('span', {}, aName), out.b && h('span', { class: 'dashed' }, bName))),
      ...[out.a, ...(out.b ? [out.b] : [])].map((s) => h('section', { class: 'panel stack' }, sectionHead(s.scenario.label, tag),
        h('p', { class: 'sub' }, `${plural(out.count, 'open investment', 'open investments')} added up, starting from ${money(out.startKobo, { compact: false })} today.`), projTable(s.scenario.label, s.rows, showPay))),
      out.b && h('section', { class: 'panel stack' }, sectionHead(`${bName} compared with ${aName}`, tag), h('div', { class: 'scroll-x' }, h('table', { class: 'table proj-table' }, h('caption', { class: 'sr-only' }, 'Difference between the two scenarios'),
        h('thead', {}, h('tr', {}, ['Looking ahead', 'Worth then', 'Gain from today'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, out.diff.map((d) => h('tr', {}, h('th', { scope: 'row' }, yearsText(d.years)), h('td', { class: tone(d.valueKobo) }, amt(d.valueKobo, { sign: true })), h('td', { class: tone(d.gainKobo) }, amt(d.gainKobo, { sign: true }))))))),
        h('p', { class: 'sub' }, `A plus sign means ${bName} ends higher than ${aName}.`)),
      h('section', { class: 'panel stack' }, sectionHead(`Where it comes from, after ${yearsText(far.years)}`, tag), h('div', { class: 'scroll-x' }, h('table', { class: 'table proj-table' }, h('caption', { class: 'sr-only' }, `Each investment in ${aName}`),
        h('thead', {}, h('tr', {}, ['Investment', 'Worth today', 'Rate used', 'Worth then'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, out.a.parts.map((p) => h('tr', {}, h('th', { scope: 'row' }, p.investment.name), h('td', {}, amt(p.startKobo)), h('td', {}, ownLabel(p)), h('td', {}, amt(p.rows[p.rows.length - 1].valueKobo))))),
        h('tfoot', {}, h('tr', {}, h('th', { scope: 'row' }, 'Total'), h('td', {}, amt(out.startKobo)), h('td', {}), h('td', {}, amt(far.valueKobo)))))),
        h('details', { class: 'working' }, h('summary', {}, 'How this is calculated'), h('ul', {},
          h('li', {}, 'Each open investment is projected on its own, in the same way as on its own Look ahead screen: its worth today, grown or reduced by its rate over the actual days, then divided into whole calendar years.'),
          h('li', {}, 'The portfolio figure is the sum of those results. The yearly return treats the total worth today, every expected payment and the total worth at the end as one set of dated payments.'),
          h('li', {}, 'Investments with no saved rate are held at their worth today, never guessed.')))),
      h('p', { class: 'sub' }, helpLink('projections-export', 'How projections work')));
  }
  function calc() {
    A.rate.setError(null); B.rate.setError(null); years.setError(null);
    let extra, a, bs;
    try { extra = parseYears(yearsInput); } catch (e) { if (!(e instanceof InputError)) throw e; years.setError(e.message); return; }
    try { a = buildScenario(A.state, 'Scenario A'); } catch (e) { if (!(e instanceof InputError)) throw e; A.rate.setError(e.message); return; }
    try { bs = buildScenario(B.state, 'Scenario B'); } catch (e) { if (!(e instanceof InputError)) throw e; B.rate.setError(e.message); return; }
    if (bs && a && bs.label === a.label) bs = { ...bs, label: `${bs.label} (second)` };
    if (a && !a.label) a = { ...a, label: 'Scenario A' };
    try { draw(runPortfolioProjection({ items, asOf: today, a, b: bs, years: horizonList(extra), includePayments: hasPlans && include })); }
    catch (e) { put(errorBox(e instanceof InputError ? e.message : 'Could not work this out. Please check the rates and try again.')); if (!(e instanceof InputError)) console.error(e); }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); setBusy(submit, true); try { calc(); } finally { setBusy(submit, false); } });
  calc();
  return h('div', { class: 'flow' }, backLink(back, 'Projections'),
    h('div', { class: 'detail-head' }, h('span', { class: 'tile tile--large tint-2' }, icon('chart', { size: 28 })), h('div', {}, h('h1', { class: 'page-title' }, 'Whole portfolio'), h('p', { class: 'sub' }, `${plural(open.length, 'open investment', 'open investments')}, worth ${money(start, { compact: false })} today`))),
    h('p', { class: 'sub' }, 'See where everything could be later. By default each investment uses its own saved rate. This is a what-if: nothing here is saved or counted in your real figures.'),
    h('section', { class: 'panel stack' }, form), results);
}

// ================= Export and print =================
async function exportScreen({ ctx }) {
  const sample = !!(await ctx.store.meta.get('sampleIds'));
  let asOf = todayISO();
  const catName = (id) => ctx.cat(id).name;
  const say = h('p', { class: 'sync-result', role: 'status', hidden: true });
  const dateField = field('Figures as at', dateInput({ value: asOf, onInput: (v) => { asOf = v; } }), { hint: 'Only the summary file uses this date. The ledger and valuation files always list everything.' });
  // [key, title, what it holds, how to make it]
  const kinds = [
    ['ledger', 'Ledger', 'Every entry on every investment: date, type, amount and note.', (items) => ledgerCsv(items, catName)],
    ['valuations', 'Valuations', 'Every valuation you recorded, with who gave it.', (items) => valuationsCsv(items, catName)],
    ['summary', 'Summary', 'One row per investment: money put in, income, worth, net gain and returns.', (items, date) => summaryCsv(items, catName, date)],
  ];
  const button = ([key, title, text, make]) => {
    const btn = h('button', { class: 'btn btn--secondary', type: 'button' }, icon('download'), `Download ${title.toLowerCase()} (CSV)`);
    btn.addEventListener('click', async () => {
      setBusy(btn, true); say.hidden = true;
      try {
        const date = key === 'summary' ? checkDate(asOf, 'The date') : todayISO();
        dateField.setError(null);
        const file = csvName(key, date);
        downloadCsv(file, make(await loadReport(ctx.pf, date), date));
        say.hidden = false; say.dataset.tone = 'ok'; say.textContent = `Saved ${file}. It is a plain file: anyone who gets it can read it.`;
      } catch (e) {
        if (e instanceof InputError) dateField.setError(e.message);
        else { say.hidden = false; say.dataset.tone = 'bad'; say.textContent = 'Could not create the file. Please try again.'; console.error(e); }
      } finally { setBusy(btn, false); }
    });
    return h('li', { class: 'export-row' }, h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, title), h('div', { class: 'row-sub' }, text)), btn);
  };
  return h('div', { class: 'flow' }, backLink('#/settings', 'Settings'), h('h1', { class: 'page-title' }, 'Export and print'),
    sample && h('p', { class: 'note-box' }, 'The made-up sample portfolio is on this device, so it is included in these files. Remove it in Settings first if you only want your own records.'),
    h('section', { class: 'panel stack' }, h('h2', {}, 'Files for a spreadsheet'),
      h('p', { class: 'sub' }, 'These open in Excel, Google Sheets and similar programs. Amounts are plain naira with two decimals, and money leaving you is minus. Deleted investments are left out.'),
      dateField.el, h('ul', { class: 'rows export-list' }, kinds.map(button)), say,
      h('p', { class: 'alert alert--warn' }, 'These files are not encrypted. Your records in Apex are, but a downloaded file is plain text. Keep it somewhere private and delete it when you no longer need it.')),
    h('section', { class: 'panel stack' }, h('h2', {}, 'Printable statement'),
      h('p', { class: 'sub' }, 'A clean page of your figures, as at a date you choose, ready to print or save as a PDF from the print window.'),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/statement' }, icon('doc'), 'Open the statement'))),
    h('p', { class: 'sub' }, helpLink('projections-export', 'How export and statements work')));
}

// ================= The printable statement =================
async function statementScreen({ ctx, showAmounts }, investmentId) {
  const prefs = await ctx.pf.settings(), name = prefs.displayName, portfolio = prefs.portfolioName;
  const head = (right) => h('div', { class: 'page-actions no-print' }, h('h1', { class: 'page-title' }, 'Statement'), right);
  if (isHidden()) {
    const btn = h('button', { class: 'btn', type: 'button', onclick: () => { setBusy(btn, true); showAmounts(); } }, icon('eye'), 'Show amounts');
    return h('div', { class: 'flow' }, backLink('#/export', 'Export and print'), head(null),
      h('p', { class: 'note-box' }, 'Amounts are hidden on screen, so a statement would have no figures. Show them to prepare the statement, then hide them again when you are done.'), h('div', { class: 'row' }, btn));
  }
  let asOf = todayISO(), includeLedger = false, only = investmentId, items = await loadReport(ctx.pf, asOf);
  if (only && !items.some((it) => it.investment.id === only)) only = null;
  const doc = h('article', { class: 'statement-doc', 'aria-label': 'Statement of investments' });
  const dateErr = h('p', { class: 'field-error', role: 'alert' });

  async function refresh() {
    try { checkDate(asOf, 'The date'); } catch (e) { dateErr.textContent = e.message; return; }
    dateErr.textContent = '';
    items = await loadReport(ctx.pf, asOf);
    if (only && !items.some((it) => it.investment.id === only)) only = null;
    doc.replaceChildren(...(await drawDoc()));
  }
  async function drawDoc() {
    const st = await buildStatement(ctx.pf, items, asOf, { investmentId: only, includeLedger });
    const s = st.summary, N = (k, o) => formatNaira(k, o);
    const right = (v, cls = '') => h('td', { class: `num ${cls}`.trim() }, v);
    const rows = st.sections.filter((x) => !x.error).map(({ investment: inv, metrics: m }) => h('tr', {}, h('th', { scope: 'row' }, inv.name, h('span', { class: 'doc-sub' }, ctx.cat(inv.categoryId).name)),
      h('td', {}, m.basis === 'realized' ? 'Closed' : 'Active'), right(N(m.investedKobo + m.costsKobo)), right(N(m.incomeKobo)), right(N(m.proceedsKobo + m.repaidKobo)), right(N(m.valueKobo)), right(N(m.netGainKobo, { sign: true }), tone(m.netGainKobo))));
    const failed = st.sections.filter((x) => x.error);
    const ledgers = st.includeLedger ? st.sections.filter((x) => !x.error).map(({ investment: inv, entries, valuations }) => h('section', { class: 'doc-section' }, h('h3', {}, inv.name),
      entries.length ? h('table', { class: 'doc-table' }, h('thead', {}, h('tr', {}, ['Date', 'Type', 'Amount', 'Note'].map((t, i) => h('th', { scope: 'col', class: i === 2 ? 'num' : '' }, t)))),
        h('tbody', {}, entries.map((e) => h('tr', {}, h('td', {}, fmtDate(e.date)), h('td', {}, KIND_LABEL[e.kind]), right(N((e.kind === 'capital_in' || e.kind === 'cost' ? -1 : 1) * e.amountKobo, { sign: true })), h('td', {}, e.note || ''))))) : h('p', { class: 'sub' }, 'No entries up to this date.'),
      valuations.length > 0 && h('table', { class: 'doc-table' }, h('thead', {}, h('tr', {}, ['Valuation date', 'Source', 'Worth'].map((t, i) => h('th', { scope: 'col', class: i === 2 ? 'num' : '' }, t)))),
        h('tbody', {}, valuations.map((v) => h('tr', {}, h('td', {}, fmtDate(v.date)), h('td', {}, SOURCE_LABEL[v.source] || v.source), right(N(v.valueKobo)))))))) : [];
    return [
      h('header', { class: 'doc-head' }, h('p', { class: 'doc-brand' }, 'Apex'), h('h2', { class: 'doc-title' }, only ? 'Statement of one investment' : 'Statement of investments'),
        portfolio && h('p', { class: 'doc-line' }, portfolio), name && h('p', { class: 'doc-line' }, `Prepared for ${name}`), h('p', { class: 'doc-line' }, `As at ${fmtDate(asOf)}. Amounts are in naira.`)),
      h('dl', { class: 'doc-summary' }, [['Worth today', N(s.valueKobo)], ['Money put in', N(s.investedKobo + s.costsKobo)], ['Income received', N(s.incomeKobo)], ['Sold or repaid', N(s.proceedsKobo + s.repaidKobo)], ['Net gain', N(s.netGainKobo, { sign: true })], ['Return on investment', pct(s.roi)]]
        .map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))),
      rows.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'doc-table doc-table--main' }, h('caption', { class: 'sr-only' }, 'Each investment and its figures'),
        h('thead', {}, h('tr', {}, ['Investment', 'Status', 'Money put in', 'Income', 'Sold or repaid', 'Worth today', 'Net gain'].map((t, i) => h('th', { scope: 'col', class: i > 1 ? 'num' : '' }, t)))),
        h('tbody', {}, rows),
        h('tfoot', {}, h('tr', {}, h('th', { scope: 'row' }, 'Total'), h('td', {}), right(N(s.investedKobo + s.costsKobo)), right(N(s.incomeKobo)), right(N(s.proceedsKobo + s.repaidKobo)), right(N(s.valueKobo)), right(N(s.netGainKobo, { sign: true }), tone(s.netGainKobo)))))) : h('p', { class: 'sub' }, 'There is nothing to show for this date.'),
      failed.length > 0 && h('p', { class: 'doc-note' }, `Left out because it could not be calculated: ${failed.map((x) => x.investment.name).join(', ')}.`),
      ...ledgers,
      h('footer', { class: 'doc-foot' }, h('p', {}, `Prepared by Apex on ${fmtDate(todayISO())} from records kept by the owner. Worth today is the latest valuation recorded for each open investment, or an estimate from the rate saved on it, or the money put in when there is neither. Closed investments show what was received. This is not an audited statement or a professional valuation.`)),
    ].filter(Boolean);
  }

  const dateIn = field('As at', dateInput({ value: asOf, onInput: (v) => { asOf = v; refresh(); } }));
  const which = field('Show', selectInput({ value: only || '', options: [['', 'All investments'], ...items.map((it) => [it.investment.id, it.investment.name])], onChange: (v) => { only = v || null; refresh(); } }));
  const ledgerBox = checkbox({ label: 'Include every entry and valuation', checked: false, onChange: (v) => { includeLedger = v; refresh(); } });
  const print = h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, icon('doc'), 'Print or save as PDF');
  doc.replaceChildren(...(await drawDoc()));
  return h('div', { class: 'flow statement-page' }, h('div', { class: 'no-print' }, backLink('#/export', 'Export and print')), head(print),
    h('section', { class: 'panel stack no-print' }, h('div', { class: 'stmt-controls' }, dateIn.el, which.el), dateErr, ledgerBox,
      h('p', { class: 'sub' }, 'Choose Print or save as PDF, then pick a printer or Save as PDF in the window that opens. The menus and buttons on this screen are left off the page.')),
    doc);
}
