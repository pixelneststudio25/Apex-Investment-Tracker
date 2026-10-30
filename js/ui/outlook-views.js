// The Outlook tab (Phase 12-iii): where everything could be later. One screen for the whole portfolio, or for one
// investment at #/outlook/<id>. Every figure comes from js/models/outlook.js (tested); this file arranges and words it.
// Nothing here is saved yet, and every figure is labelled as a projection. No inline styles, no innerHTML.
import { fill, h } from './dom.js';
import { icon } from './icons.js';
import { animateNumber, prefersReducedMotion } from './motion.js';
import { amtText, fmtDate, fmtMonthYear, isHidden, money, pct, todayISO, tone } from './fmt.js';
import { bandChart, barChart, describeBand, describeCashFlow, describeStack, segmentClass, stackLayers, stackedChart } from './charts.js';
import { checkbox, field, moneyField, percentField, segmented, selectInput, textInput } from './formkit.js';
import { openSheet } from './sheet.js';
import { helpLink } from './help.js';
import { InputError, parseNaira } from '../models/inputs.js';
import { DIRECTIONS, METHODS, blankScenario, buildScenario, parseYears, scenarioFromRate } from '../models/projections.js';
import { cashFlowByMonth, incomeInYear, maturities, parseInflation, parseNudge, projectBand, projectOutlook, rateSentence, ratesFor, reachMonth } from '../models/outlook.js';
import { loadReport } from '../models/export.js';
import { MAX_NAMED, PRESET_NUDGE, YEAR_CHOICES, choicesFromPlan, defaultChoices, describePlan, loadPlans, removeNamed, saveNamed, saveWorking } from '../models/outlook-plans.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const amt = (kobo, opts = {}) => h('span', { class: 'amt' }, amtText(kobo, { compact: false, ...opts }));
const amtC = (kobo, opts = {}) => amt(kobo, { compact: true, ...opts }); // short form for tight rows and live readouts
const sectionHead = (title, right) => h('div', { class: 'section-head' }, h('h2', {}, title), right);
const miniEmpty = (ic, text) => h('div', { class: 'mini-empty' }, icon(ic, { size: 20 }), text);
const tag = h.bind(null, 'span', { class: 'chip' }, 'Projection');
const PRESETS = [['cautious', 'Cautious'], ['base', 'Base'], ['optimistic', 'Optimistic']];
const METHOD_WORD = { simple: 'simple', compound1: 'compounded once a year', compound12: 'compounded monthly' };

// What the person has chosen on this screen. It is kept in memory while the app is open and saved (encrypted) as the
// person goes, so it is there again after a reload and on other devices. Only the choices are saved, never a result.
const S = { ...defaultChoices(), chart: 'band', owner: null };

const rangeWord = (years) => (years === 1 ? 'In 1 year' : `In ${years} years`);
const monthsToWords = (m) => { const y = Math.floor(m / 12), r = m % 12; return [y && plural(y, 'year', 'years'), r && plural(r, 'month', 'months')].filter(Boolean).join(' and ') || 'today'; };

export async function outlookView(env, parts = []) {
  const { ctx, toast } = env, asOf = todayISO(), onlyId = parts[1] || null;
  const items = await loadReport(ctx.pf, asOf);
  const scoped = onlyId ? items.filter((it) => it.investment.id === onlyId) : items;
  const back = onlyId && scoped.length ? h('a', { class: 'back', href: `#/investments/${onlyId}` }, icon('chevronLeft', { size: 18 }), scoped[0].investment.name) : null;
  const title = h('div', { class: 'page-actions' }, h('h1', { class: 'page-title' }, 'Outlook'));
  if (onlyId && !scoped.length) return h('div', { class: 'flow' }, h('a', { class: 'back', href: '#/outlook' }, icon('chevronLeft', { size: 18 }), 'Outlook'), title, h('p', { class: 'alert alert--error', role: 'alert' }, 'This investment could not be found. It may have been removed.'));
  const open = scoped.filter((it) => it.metrics && it.metrics.basis !== 'realized');
  if (!open.length) {
    const why = onlyId ? 'This investment is closed, so there is nothing left to project. Reopen it first if that was a mistake.' : 'There is nothing to look ahead at yet. Add an investment and its outlook will appear here.';
    return h('div', { class: 'flow' }, back, title, h('p', { class: 'note-box' }, why), !onlyId && h('a', { class: 'btn', href: '#/new' }, icon('plus'), 'Add investment'));
  }
  if (S.owner !== ctx.store) { // first visit since the app was opened or unlocked: bring back what was saved
    Object.assign(S, defaultChoices(), { chart: 'band', owner: ctx.store });
    try { const { working } = await loadPlans(ctx.store); if (working) Object.assign(S, choicesFromPlan(working, new Set(items.map((it) => it.investment.id)))); } catch { /* start fresh */ }
  }
  const anyShared = open.some((it) => it.investment.behaviors?.ownership === 'shared');
  if (!anyShared) S.share = 'full';

  // ---------- the pieces that change when a choice changes ----------
  const headLabel = h('p', { class: 'ol-label' }), headAmount = h('p', { class: 'ol-amount money' }), headGain = h('p', { class: 'ol-gain' });
  const headNote = h('p', { class: 'sub ol-note' });
  const chartBox = h('div', { class: 'chart-box' }), readout = h('p', { class: 'readout', 'aria-live': 'off' }), legend = h('ul', { class: 'ol-legend' });
  const assumeList = h('ul', { class: 'rows ol-assume' }), notes = h('div', { class: 'flow' });
  const cashBox = h('div', { class: 'chart-box' }), cashRead = h('p', { class: 'readout', 'aria-live': 'off' });
  const matBox = h('div', {}), goalBox = h('div', { class: 'stack' }), tableBox = h('div', { class: 'scroll-x' });
  const nudgeNote = h('p', { class: 'hint' }), inflationErr = h('p', { class: 'field-error', role: 'alert' });
  let shown = null, anim = null, cashWindows = [];

  const inflation = () => { if (!S.real) return null; try { return parseInflation(S.inflationText); } catch { return null; } };
  const nudge = () => { try { return parseNudge(S.nudgeText, S.nudgeDir); } catch { return 0; } };
  const years = () => (S.custom ? (() => { try { return parseYears(S.customText) || S.years; } catch { return S.years; } })() : S.years);
  const args = () => ({ items: scoped, asOf, years: years(), overrides: S.overrides, nudge: nudge(), share: S.share, inflation: inflation() });

  function paintHead(out) {
    const last = out.months[out.months.length - 1], gain = last.gainKobo;
    fill(headLabel, `${rangeWord(out.years)}${out.real ? ', in today\'s money' : ''}`, ' ', tag());
    const text = (k) => amtText(k); // short (₦172.6M) so it never wraps; the exact figure is in the tooltip and the table
    headAmount.title = isHidden() ? '' : money(last.valueKobo, { compact: false });
    if (anim) anim.cancel();
    const from = shown ?? last.valueKobo;
    if (isHidden() || prefersReducedMotion() || from === last.valueKobo) headAmount.textContent = text(last.valueKobo);
    else anim = animateNumber(headAmount, last.valueKobo, { from, duration: 500, format: (n) => text(Math.round(n)) });
    headAmount.classList.toggle('amt', true);
    shown = last.valueKobo;
    fill(headGain, h('span', { class: `pill pill--small ${tone(gain)}` }, gain > 0 && icon('arrowUp'), gain < 0 && icon('arrowDown'), amt(gain, { sign: true })), h('span', {}, ` gain from today${out.startKobo ? `, ${pct(gain / out.startKobo, { sign: true })}` : ''}, counting regular payments`));
    fill(headNote, out.share === 'mine' ? 'Showing only your own share of shared investments.' : anyShared ? 'Shared investments count at their full value, the same as on Home.' : '');
  }

  function paintChart(out) {
    const say = (m) => h('span', {}, fmtMonthYear(m.date), ': ');
    const end = out.months[out.months.length - 1], fm = (k) => money(k, { compact: false });
    if (S.chart === 'band') {
      const b = projectBand(args(), 0.03, out), last = b.bands[b.bands.length - 1];
      const rd = (p) => { const v = p || last; fill(readout, say(v), 'cautious ', h('strong', {}, amtC(v.lowKobo)), ', base ', h('strong', {}, amtC(v.baseKobo)), ', optimistic ', h('strong', {}, amtC(v.highKobo))); };
      rd(null);
      fill(chartBox, bandChart({ bands: b.bands, description: describeBand(b.bands, fm, { real: out.real }), onHover: (p) => rd(p), valueText: (p) => `${fmtMonthYear(p.date)}: base ${fm(p.baseKobo)}, from ${fm(p.lowKobo)} to ${fm(p.highKobo)}` }));
      fill(legend, h('li', {}, h('span', { class: 'key key--line' }), 'Base'), h('li', {}, h('span', { class: 'key key--band' }), 'Three points lower to three points higher'));
    } else {
      const layers = stackLayers(out.months, out.parts);
      const rd = (p) => { const m = p ? p.month : end; const total = p ? p.totalKobo : layers.reduce((t, l) => t + l.values[l.values.length - 1], 0); fill(readout, fmtMonthYear(m.date), ': total ', h('strong', {}, amtC(total))); };
      rd(null);
      fill(chartBox, stackedChart({ months: out.months, layers, description: describeStack(layers, out.months, fm, { real: out.real }), onHover: (p) => rd(p), valueText: (i, t) => `${fmtMonthYear(out.months[i].date)}: total ${fm(t)}` }));
      fill(legend, ...layers.map((l, i) => h('li', {}, h('span', { class: `swatch ${segmentClass(i)}` }), l.count ? `${l.label} (${l.count})` : l.label)));
    }
  }

  function paintTable(out) {
    const rows = out.rows;
    fill(tableBox, h('table', { class: 'table proj-table' }, h('caption', { class: 'sr-only' }, 'Projected worth by year'),
      h('thead', {}, h('tr', {}, ['Looking ahead', 'Date', 'Worth then', 'Gain from today'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('th', { scope: 'row' }, plural(r.years, 'year', 'years')), h('td', {}, fmtDate(r.date)), h('td', {}, amt(r.valueKobo)), h('td', { class: tone(r.gainKobo) }, amt(r.gainKobo, { sign: true })))))));
  }

  function paintAssumptions(out) {
    const byId = new Map(out.parts.map((p) => [p.investment.id, p]));
    fill(assumeList, ...open.filter((it) => byId.has(it.investment.id)).map((it) => {
      const p = byId.get(it.investment.id), edited = p.source === 'edited', sc = S.overrides[it.investment.id];
      const words = edited ? `${sc.direction === 'loses' ? 'Loses' : 'Grows'} ${sc.percentText}% a year, ${METHOD_WORD[sc.method]}` : rateSentence(ratesFor({ investment: it.investment, asOf }).rates);
      const c = ctx.cat(it.investment.categoryId);
      const main = h('button', { class: 'row-line ol-pick', type: 'button', 'aria-label': `${it.investment.name}: ${words}. Change the rate used for this projection.`, onclick: () => editRate(it, p) },
        h('span', { class: 'tile tint-1' }, icon(c.icon)),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, it.investment.name, edited && h('span', { class: 'dot', title: 'Edited', 'aria-hidden': 'true' })), h('div', { class: 'row-sub' }, words)),
        h('div', { class: 'row-end' }, h('span', { class: `chip chip--${p.source}` }, { saved: 'Saved', edited: 'Edited', none: 'None' }[p.source]), h('span', { class: 'row-sub' }, 'then ', amtC(p.endKobo))));
      return h('li', { class: 'ol-assume-row' }, main, edited && h('button', { class: 'link-btn ol-reset', type: 'button', onclick: () => { delete S.overrides[it.investment.id]; refresh(); } }, 'Reset'));
    }));
    fill(notes, out.held.length > 0 && h('p', { class: 'note-box' }, `${plural(out.held.length, 'investment has', 'investments have')} no rate set, so ${out.held.length === 1 ? 'it is' : 'they are'} held flat at the worth today: ${out.held.join(', ')}. Tap one above to try a rate.`),
      out.broken.length > 0 && h('p', { class: 'note-box' }, `Left out because it cannot be calculated yet: ${out.broken.join(', ')}.`),
      out.closedCount > 0 && !onlyId && h('p', { class: 'sub' }, `${plural(out.closedCount, 'closed investment is', 'closed investments are')} not included.`));
  }

  function paintMaturities() {
    const list = maturities({ items: scoped, asOf, overrides: S.overrides, nudge: nudge(), share: S.share, inflation: inflation() });
    fill(matBox, list.length ? h('ul', { class: 'rows ol-timeline' }, list.map((m) => h('li', {}, h('a', { class: 'row-line', href: `#/investments/${m.investment.id}` },
      h('span', { class: 'date-col' }, fmtDate(m.date)), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, m.investment.name), h('div', { class: 'row-sub' }, m.days === 1 ? 'tomorrow' : `in ${plural(m.days, 'day', 'days')}`)),
      h('div', { class: 'row-end' }, amtC(m.valueKobo), h('span', { class: 'row-sub' }, 'projected')))))) : miniEmpty('calendar', 'Nothing is due to mature. Term investments with a maturity date show here.'));
  }

  function paintCash() {
    cashWindows = cashFlowByMonth({ items: scoped, asOf, share: S.share, inflation: inflation() });
    const any = cashWindows.some((w) => w.incomeKobo || w.costsKobo), fm = (k) => money(k, { compact: false });
    if (!any) { fill(cashBox, miniEmpty('list', 'No regular payments are set up. Rent and costs you add to an investment show here.')); fill(cashRead); return; }
    const total = (k) => cashWindows.reduce((t, w) => t + w[k], 0);
    const rd = (w) => fill(cashRead, w ? h('span', {}, fmtMonthYear(w.to), ': in ', h('strong', {}, amtC(w.incomeKobo)), ', costs ', h('strong', {}, amtC(w.costsKobo))) : h('span', {}, 'Next 12 months: in ', h('strong', {}, amtC(total('incomeKobo'))), ', costs ', h('strong', {}, amtC(total('costsKobo')))));
    rd(null);
    fill(cashBox, barChart({ windows: cashWindows, description: describeCashFlow(cashWindows, fm), onHover: (w) => rd(w), valueText: (w) => `${fmtMonthYear(w.to)}: in ${fm(w.incomeKobo)}, costs ${fm(w.costsKobo)}` }),
      h('ul', { class: 'ol-legend' }, h('li', {}, h('span', { class: 'key key--in' }), 'Income expected'), h('li', {}, h('span', { class: 'key key--out' }), 'Costs expected')));
  }

  function paintGoal(out) {
    const kids = [];
    const yi = incomeInYear(out.months, out.years);
    if (yi) kids.push(h('p', { class: 'ol-goal' }, `Regular payments in year ${out.years}: `, h('strong', {}, amt(yi.incomeKobo)), ' in', yi.costsKobo ? [', ', h('strong', {}, amt(yi.costsKobo)), ' costs'] : '', '. They follow your saved payment plans.'));
    let target = null;
    if (S.goalText.trim()) { try { target = parseNaira(S.goalText); } catch { target = null; } }
    if (target) {
      let hit = reachMonth(out.months, target), long = false;
      if (!hit && out.years < 50) { try { hit = reachMonth(projectOutlook({ ...args(), years: 50 }).months, target); long = true; } catch { hit = null; } }
      kids.push(hit ? h('p', { class: 'ol-goal' }, hit.month === 0 ? 'You are already there: ' : 'At these assumptions you reach ', h('strong', {}, amt(target)), hit.month === 0 ? ' today.' : [' in ', h('strong', {}, fmtMonthYear(hit.date)), `, about ${monthsToWords(hit.month)} from now.`])
        : h('p', { class: 'ol-goal' }, 'At these assumptions you do not reach ', h('strong', {}, amt(target)), ' within 50 years. Try a higher rate on the investments above.'));
    }
    fill(goalBox, ...kids);
  }

  function refresh(save = true) {
    let out;
    try { out = projectOutlook(args()); } catch (e) { if (!(e instanceof InputError)) throw e; fill(headNote, e.message); return; }
    paintHead(out); paintChart(out); paintTable(out); paintAssumptions(out); paintMaturities(); paintCash(); paintGoal(out);
    if (save) queueSave();
    nudgeNote.textContent = S.nudgeText.trim() ? `Every growth rate moves ${S.nudgeDir === 'down' ? 'down' : 'up'} by ${S.nudgeText.trim()} points. Investments with no rate stay flat.` : 'Base: every investment uses its own rate.';
  }
  let saveTimer = 0;
  const queueSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveWorking(ctx.store, S, years()).catch(() => {}); }, 700); };
  let timer = 0;
  const later = () => { clearTimeout(timer); timer = setTimeout(() => { if (headLabel.isConnected) refresh(); }, 140); };

  // ---------- the rate sheet ----------
  async function editRate(it, part) {
    const cur = S.overrides[it.investment.id], saved = ratesFor({ investment: it.investment, asOf }).rates[0];
    const sf = saved ? scenarioFromRate(saved) : null; // null when the saved rate compounds in a way these boxes cannot show
    const start = cur ? { percent: cur.percentText, direction: cur.direction, method: cur.method } : sf ? { percent: sf.percent, direction: sf.direction, method: sf.method } : { ...blankScenario(''), percent: '' };
    const f = { ...start };
    const rate = percentField('Yearly rate (%)', { value: f.percent, onInput: (v) => { f.percent = v; }, hint: !cur && saved && !sf ? 'The saved rate compounds in a way this box cannot show, so it starts blank. Nothing is lost: it is still saved on the investment.' : 'For example 12 for twelve percent a year. Used from today on, in place of the saved rates.' });
    const dir = segmented({ label: 'Grows or loses value', options: DIRECTIONS, value: f.direction, onChange: (v) => { f.direction = v; } });
    const method = field('How the rate is applied', selectInput({ value: f.method, options: METHODS, onChange: (v) => { f.method = v; } }));
    const err = h('p', { class: 'field-error', role: 'alert' });
    const result = await openSheet({ title: it.investment.name, build: (close) => [h('p', { class: 'sub' }, 'Try a different rate for this investment. Nothing real changes: this only changes the projection.'), rate.el,
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Grows or loses value'), dir), method.el, err,
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => close(null) }, 'Cancel'),
        cur && h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => close('reset') }, 'Use the saved rate'),
        h('button', { class: 'btn', type: 'button', onclick: () => { try { const sc = buildScenario({ label: 'Edited', ...f }); if (!sc) throw new InputError('Type a yearly rate, or use the saved rate.'); close(sc); } catch (e) { if (e instanceof InputError) { err.textContent = e.message; } else throw e; } } }, 'Use this rate'))] });
    if (result === 'reset') delete S.overrides[it.investment.id]; else if (result) S.overrides[it.investment.id] = result; else return;
    refresh();
  }

  // ---------- the controls (built once, so typing never loses focus) ----------
  const yearsSeg = h('div', { class: 'seg seg--slide', role: 'group', 'aria-label': 'How far ahead' });
  const customField = field('Years', textInput({ inputmode: 'numeric', value: S.customText, placeholder: 'for example 7', onInput: (v) => { S.customText = v; try { parseYears(v); customField.setError(null); } catch (e) { customField.setError(e.message); } later(); } }), { className: 'ol-custom' });
  const paintYears = () => { [...yearsSeg.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === (S.custom ? 'c' : String(S.years))))); customField.el.hidden = !S.custom; };
  for (const y of YEAR_CHOICES) yearsSeg.append(h('button', { type: 'button', 'data-v': String(y), 'aria-pressed': 'false', onclick: () => { S.custom = false; S.years = y; paintYears(); refresh(); } }, `${y}Y`));
  yearsSeg.append(h('button', { type: 'button', 'data-v': 'c', 'aria-pressed': 'false', onclick: () => { S.custom = true; paintYears(); refresh(); customField.control.focus(); } }, 'Custom'));
  paintYears();

  const infl = percentField('Yearly inflation (%)', { value: S.inflationText, hint: 'You choose this figure. Apex does not guess one. Every future amount is then shown in today\'s money.', onInput: (v) => { S.inflationText = v; try { parseInflation(v); inflationErr.textContent = ''; } catch (e) { inflationErr.textContent = e.message; } later(); } });
  infl.el.hidden = !S.real;
  const realSwitch = checkbox({ label: 'Real terms (today\'s money)', checked: S.real, asSwitch: true, onChange: (v) => { S.real = v; infl.el.hidden = !v; refresh(); } });
  const shareSeg = anyShared && segmented({ label: 'Shared investments', options: [['full', 'Full value'], ['mine', 'My share']], value: S.share, onChange: (v) => { S.share = v; refresh(); } });

  const presetSeg = segmented({ label: 'Scenario', options: PRESETS, value: S.preset, onChange: (v) => { S.preset = v; [S.nudgeText, S.nudgeDir] = PRESET_NUDGE[v]; nudgeField.control.value = S.nudgeText; refreshDir(); refresh(); } });
  const nudgeField = percentField('Move every growth rate by (points)', { value: S.nudgeText, onInput: (v) => { S.nudgeText = v; S.preset = ''; [...presetSeg.children].forEach((b) => b.setAttribute('aria-pressed', 'false')); try { parseNudge(v); nudgeField.setError(null); } catch (e) { nudgeField.setError(e.message); } later(); } });
  const dirSeg = segmented({ label: 'Lower or higher', options: [['down', 'Lower'], ['up', 'Higher']], value: S.nudgeDir, onChange: (v) => { S.nudgeDir = v; S.preset = ''; [...presetSeg.children].forEach((b) => b.setAttribute('aria-pressed', 'false')); refresh(); } });
  const refreshDir = () => [...dirSeg.children].forEach((b, i) => b.setAttribute('aria-pressed', String(['down', 'up'][i] === S.nudgeDir)));
  const chartSeg = segmented({ label: 'Chart', options: [['band', 'Range'], ['stack', 'Where from']], value: S.chart, onChange: (v) => { S.chart = v; refresh(); } });
  const goal = moneyField('Target worth', { value: S.goalText, optional: true, hint: 'Type an amount to see when you could reach it.', onInput: (v) => { S.goalText = v; later(); } });

  // ---------- saved scenarios ----------
  const validIds = new Set(items.map((it) => it.investment.id));
  const redraw = async () => { if (env.rerender) await env.rerender(); };
  const plansBox = h('div', { class: 'stack' }), planErr = h('p', { class: 'field-error', role: 'alert' });
  const planName = field('Name', textInput({ placeholder: 'for example Bank rates fall', maxlength: 60, onInput: () => { planErr.textContent = ''; } }));
  const planPaint = async () => {
    let named = [];
    try { named = (await loadPlans(ctx.store)).named; } catch { /* show none */ }
    fill(plansBox, named.length ? h('ul', { class: 'rows' }, named.map((p) => h('li', { class: 'ol-assume-row' },
      h('div', { class: 'row-line ol-pick-static' }, h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, p.name), h('div', { class: 'row-sub' }, describePlan(p)))),
      h('button', { class: 'link-btn ol-reset', type: 'button', onclick: async () => { Object.assign(S, defaultChoices(), choicesFromPlan(p, validIds)); try { await saveWorking(ctx.store, S, p.years); } catch { /* the screen still shows it */ } toast(`Loaded ${p.name}`); await redraw(); } }, 'Load'),
      h('button', { class: 'link-btn ol-reset', type: 'button', onclick: async () => { try { await removeNamed(ctx.store, p.id); toast(`Deleted ${p.name}`, { label: 'Undo', run: async () => { await ctx.store.restore(p.id); planPaint(); } }); } catch (e) { toast('Could not delete that scenario'); } planPaint(); } }, 'Delete'))))
      : h('p', { class: 'sub' }, 'None yet. Set up rates and a scenario above, then save them here to come back to.'),
      h('p', { class: 'hint' }, `${named.length} of ${MAX_NAMED} saved. Only your choices are kept, never a result, so every figure is worked out fresh.`));
  };
  const saveBtn = h('button', { class: 'btn btn--secondary', type: 'button', onclick: async () => {
    planErr.textContent = '';
    try { await saveNamed(ctx.store, planName.control.value, S, years()); planName.control.value = ''; toast('Scenario saved'); await planPaint(); }
    catch (e) { if (e instanceof InputError) planErr.textContent = e.message; else { console.error(e); planErr.textContent = 'Could not save that scenario. Try again.'; } } } }, 'Save these choices');
  const resetAll = h('button', { class: 'link-btn', type: 'button', onclick: async () => { Object.assign(S, defaultChoices()); try { await saveWorking(ctx.store, S, 5); } catch { /* ignore */ } toast('Back to your saved rates'); await redraw(); } }, 'Reset everything');
  planPaint();

  refresh(false);
  return h('div', { class: 'flow ol' }, back,
    h('div', {}, h('h1', { class: 'page-title' }, 'Outlook'), onlyId ? h('p', { class: 'sub' }, scoped[0].investment.name) : h('p', { class: 'sub' }, 'Where everything could be later. A what-if, never a fact.')),
    h('section', { class: 'panel stack ol-top', 'aria-label': 'Headline' }, yearsSeg, customField.el, headLabel, headAmount, headGain, headNote, h('div', { class: 'ol-switches' }, realSwitch, shareSeg), infl.el, inflationErr),
    h('section', { class: 'panel stack' }, sectionHead('Where it could go', tag()), chartSeg, readout, chartBox, legend, tableBox),
    h('section', { class: 'panel stack' }, sectionHead('Assumptions', h('span', { class: 'sub' }, 'Tap one to try a rate')), assumeList, notes),
    h('section', { class: 'panel stack' }, sectionHead('Scenarios'), presetSeg, nudgeField.el, h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Lower or higher'), dirSeg), nudgeNote),
    h('section', { class: 'panel stack' }, sectionHead('Saved scenarios', resetAll), plansBox, planName.el, planErr, saveBtn),
    await comingUp(ctx, asOf, onlyId),
    h('section', { class: 'panel stack' }, sectionHead('Cash flow', tag()), cashRead, cashBox),
    h('section', { class: 'panel stack' }, sectionHead('Maturities'), matBox),
    h('section', { class: 'panel stack' }, sectionHead('Goals'), goal.el, goalBox),
    h('p', { class: 'note-box' }, 'These are projections, not facts. Each investment starts from what it is worth today. Apex saves only the choices you make here, encrypted like the rest, and these figures never appear in your real totals.'),
    h('p', { class: 'sub' }, helpLink('projections-export', 'How looking ahead works')));
}

// The next 45 days, with reminders inside it.
async function comingUp(ctx, asOf, onlyId) {
  const all = await ctx.pf.upcoming(asOf, { days: 45 }), list = (onlyId ? all.filter((u) => u.investmentId === onlyId) : all).slice(0, 8);
  const rows = list.length ? h('ul', { class: 'rows' }, list.map((u) => h('li', {}, h('a', { class: 'row-line', href: u.investmentId ? `#/investments/${u.investmentId}` : '#/reminders' },
    h('span', { class: `date-col${u.overdue ? ' overdue' : ''}` }, fmtDate(u.date)),
    h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, u.title), u.investmentName && h('div', { class: 'row-sub' }, u.investmentName)),
    u.amountKobo != null && h('div', { class: 'row-end' }, h('span', { class: `money ${u.kind === 'cost' ? 'loss' : 'gain'}` }, amtC(u.kind === 'cost' ? -u.amountKobo : u.amountKobo, { sign: true })), h('span', { class: 'row-sub' }, 'expected'))))))
    : miniEmpty('calendar', 'Nothing expected in the next 45 days. Rent, costs and reminders you set up will show here.');
  return h('section', { class: 'panel stack' }, sectionHead('Coming up', h('a', { class: 'link-btn', href: '#/reminders' }, 'Reminders')), rows,
    h('div', { class: 'row' }, h('a', { class: 'btn btn--secondary btn--small', href: '#/reminders/new' }, icon('plus'), 'Add a reminder'), h('a', { class: 'btn btn--secondary btn--small', href: '#/export' }, icon('calendar'), 'Put these in my calendar')));
}
