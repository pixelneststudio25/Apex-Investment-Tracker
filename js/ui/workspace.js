// The signed-in workspace: navigation, dashboard, investments, investment detail and settings.
// Read-only for investments in this release (adding and editing come next). Everything is calculated by the
// engine through js/models/portfolio.js; this file only arranges and words it.
import { h } from './dom.js';
import { setBusy, withBusy } from './motion.js';
import { icon } from './icons.js';
import { donut, lineChart, segmentClass } from './charts.js';
import { fmtDate, fmtMonthYear, greeting, money, pct, setHidden, todayISO, tone } from './fmt.js';
import { addMonths } from '../engine/index.js';
import { createPortfolio } from '../models/portfolio.js';
import { BUILT_IN_TEMPLATES, findTemplate } from '../models/templates.js';
import { seedSamplePortfolio } from '../models/sample.js';
import { StoreError } from '../core/store.js';
import { wizardView } from './wizard.js';
import { recordFormView } from './forms.js';

const KIND = { capital_in: ['Money put in', -1], cost: ['Cost', -1], income: ['Income received', 1], payout: ['Payout received', 1], proceeds: ['Sale proceeds', 1] };
const SOURCE = { own_estimate: 'your own estimate', agent: 'an agent', comparable_sale: 'a comparable sale', bank: 'a bank', other: 'another source' };
const VALUE_CHANGE = { none: 'No change in value', appreciation: 'Grows in value', depreciation: 'Loses value', interest: 'Earns interest', manualOnly: 'Valued by hand' };
const pctShort = (f) => pct(f).replace(/\.?0+%$/, '%');
const every = (n) => ({ 1: 'yearly', 2: 'half-yearly', 4: 'quarterly', 12: 'monthly', 365: 'daily' }[n] || (n ? `${n} times a year` : 'yearly'));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const addLink = () => h('a', { class: 'btn btn--small', href: '#/new' }, icon('plus'), 'Add investment');
const go = (hash) => { location.hash = hash; };

function rateSentence(inv, r) {
  const what = r.rate < 0 || inv.behaviors.valueChange === 'depreciation' ? 'depreciation' : inv.behaviors.valueChange === 'interest' ? 'interest' : 'growth';
  const how = r.method === 'compound' ? `compounded ${every(r.compoundsPerYear)}` : 'simple, not compounded';
  return `${r.type === 'agreed' ? 'Agreed' : 'Assumed'} ${what} of ${pctShort(Math.abs(r.rate))} ${r.rateUnit === 'month' ? 'a month' : 'a year'}, ${how}${r.effectiveFrom ? `, from ${fmtDate(r.effectiveFrom)}` : ''}${r.effectiveTo ? ` to ${fmtDate(r.effectiveTo)}` : ''}.`;
}
const scheduleSentence = (s) => `${s.label || (s.kind === 'income' ? 'Income' : 'Cost')}: ${money(s.amountKobo, { compact: false })} ${s.frequency === 'custom' ? `every ${s.everyDays} days` : s.frequency}, from ${fmtDate(s.startDate)}${s.endDate ? ` to ${fmtDate(s.endDate)}` : ''}${s.adjustments.length ? `, changing ${plural(s.adjustments.length, 'time', 'times')}` : ''}${s.skippedDates.length ? `, ${plural(s.skippedDates.length, 'month', 'months')} skipped` : ''}.`;

// ---------- small pieces ----------
const pill = (net, roi, small) => {
  const t = tone(net);
  return h('span', { class: `pill ${t}${small ? ' pill--small' : ''}` }, t === 'gain' && icon('arrowUp'), t === 'loss' && icon('arrowDown'), money(net, { sign: true }), roi != null && ` ${pct(roi, { sign: true })}`);
};
const pillPct = (net, roi) => { const t = tone(net); return h('span', { class: `pill pill--small ${t}` }, t === 'gain' && icon('arrowUp'), t === 'loss' && icon('arrowDown'), pct(roi, { sign: true })); };
const stat = (label, value, cls = '') => h('div', {}, h('dt', {}, label), h('dd', { class: `money ${cls}` }, value));
const signed = (kobo) => h('span', { class: `money ${tone(kobo)}` }, money(kobo, { sign: true }));
const sectionHead = (title, right) => h('div', { class: 'section-head' }, h('h2', {}, title), right);
const emptyBlock = ({ iconName, title, text, actions }) => h('div', { class: 'empty' },
  h('span', { class: 'tile tile--large' }, icon(iconName, { size: 28 })), h('h2', {}, title), h('p', {}, text), actions && h('div', { class: 'row' }, actions));
const skeleton = () => h('div', { 'aria-hidden': 'true' }, h('div', { class: 'skel', style: undefined, 'data-h': '1' }), h('div', { class: 'skel' }), h('div', { class: 'skel' }));

export function mountWorkspace({ data, email, actions }) {
  const root = h('div', { class: 'ws' });
  const outlet = h('div', { class: 'ws-outlet' });
  const sideName = h('p', { class: 'side-name' });
  const hideBtn = h('button', { class: 'icon-btn', type: 'button' });
  let settings = null, token = 0, hashHandler = null;

  // ---------- chrome ----------
  const NAV = [['home', '#/', 'Home', 'home'], ['investments', '#/investments', 'Investments', 'list'], ['settings', '#/settings', 'Settings', 'sliders']];
  const tabLinks = NAV.map(([key, href, label, ic]) => h('a', { class: 'tab', href, 'data-key': key }, icon(ic, { size: 22 }), label));
  const sideLinks = NAV.map(([key, href, label, ic]) => h('a', { href, 'data-key': key }, icon(ic), label));
  const topbar = h('header', { class: 'topbar' },
    h('span', { class: 'brand' }, 'Apex'),
    h('div', { class: 'topbar-actions' },
      h('span', { class: 'chip-status', title: 'Your records are stored encrypted on this device. Syncing arrives in a later update.' }, 'Saved on this device'),
      hideBtn,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Lock Apex now', title: 'Lock now', onclick: actions.onLock }, icon('lock'))));
  root.append(
    h('aside', { class: 'ws-side' }, h('div', {}, h('span', { class: 'brand' }, 'Apex'), sideName), h('nav', { class: 'side-nav', 'aria-label': 'Main' }, sideLinks)),
    h('main', { class: 'ws-main' }, topbar, outlet),
    h('nav', { class: 'tabbar', 'aria-label': 'Main' }, tabLinks));

  function paintChrome(page) {
    for (const a of [...tabLinks, ...sideLinks]) { if (a.dataset.key === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
    sideName.textContent = settings?.portfolioName || '';
    const hidden = !!settings?.hideAmounts;
    hideBtn.replaceChildren(icon(hidden ? 'eyeOff' : 'eye'));
    hideBtn.setAttribute('aria-label', hidden ? 'Show amounts' : 'Hide amounts');
    hideBtn.setAttribute('aria-pressed', String(hidden));
    hideBtn.title = hidden ? 'Show amounts' : 'Hide amounts';
  }
  function applyAppearance() {
    document.documentElement.style.setProperty('--text-scale', String((settings.textScale || 100) / 100));
    setHidden(settings.hideAmounts);
  }
  function toast(text, action) {
    const t = h('div', { class: 'toast', role: 'status' }, text,
      action && h('button', { class: 'link-btn toast-btn', type: 'button', onclick: () => { t.remove(); action.run(); } }, action.label));
    root.append(t); setTimeout(() => t.remove(), action ? 9000 : 3800);
  }

  // ---------- data ----------
  async function load() {
    const store = await data.store();
    const pf = createPortfolio(store);
    settings = await pf.settings();
    applyAppearance();
    const custom = await store.list('categoryTemplate');
    const cat = (id) => findTemplate(id, custom) || { id, name: 'Other', icon: 'tag', customFieldDefs: [] };
    return { store, pf, cat };
  }
  const sampleLive = async (store) => !!(await store.meta.get('sampleIds'));

  async function addSample(ctx, button) {
    setBusy(button, true);
    try {
      const ids = await seedSamplePortfolio(ctx.store);
      await ctx.store.meta.set('sampleIds', ids);
      toast('Sample portfolio added. Remove it any time in Settings.');
      location.hash = '#/';
      if (location.hash === '#/') render();
    } catch (e) { setBusy(button, false); toast('Could not add the sample portfolio.'); throw e; }
  }
  async function removeSample(ctx) {
    const ids = await ctx.store.meta.get('sampleIds');
    for (const id of [...(ids?.investments || []), ...(ids?.partners || [])]) { try { await ctx.store.remove(id); } catch (e) { if (!(e instanceof StoreError)) throw e; } }
    await ctx.store.meta.set('sampleIds', null);
    toast('Sample portfolio removed.');
    render();
  }
  async function reopen(ctx, id) {
    await ctx.store.update(id, { status: 'active', closedOn: null });
    toast('Reopened. Any sale proceeds you recorded are still in the ledger. Delete them there if they no longer apply.');
    render();
  }
  async function deleteInvestment(ctx, inv) {
    if (!window.confirm(`Delete "${inv.name}"? It and everything recorded under it will be hidden. You can undo right after.`)) return;
    await ctx.store.remove(inv.id);
    toast(`"${inv.name}" deleted.`, { label: 'Undo', run: async () => { await ctx.store.restore(inv.id); render(); } });
    go('#/investments');
  }
  async function newView(ctx) {
    const [custom, partners] = await Promise.all([ctx.store.list('categoryTemplate'), ctx.store.list('partner')]);
    return wizardView({ store: ctx.store, templates: [...BUILT_IN_TEMPLATES, ...custom], partners, today: todayISO(), toast, go });
  }
  const sampleButton = (ctx) => { const b = h('button', { class: 'btn btn--secondary', type: 'button' }, 'Try the sample portfolio'); b.addEventListener('click', () => addSample(ctx, b)); return b; };
  const firstRun = (ctx, where) => emptyBlock({
    iconName: 'landmark', title: 'Nothing on record yet',
    text: where === 'home' ? 'Your investments will appear here, with what they are worth and what they have earned. Add your first one, or try the sample portfolio to see how Apex works.' : 'Add your first investment, or try the sample portfolio to see how Apex works.',
    actions: [addLink(), sampleButton(ctx)] });

  // ---------- Home ----------
  async function homeView(ctx) {
    const asOf = todayISO();
    const items = await ctx.pf.overview(asOf);
    if (!items.length) return h('div', {}, h('h1', { class: 'page-title' }, `${greeting()}${settings.displayName ? ', ' + settings.displayName : ''}.`), firstRun(ctx, 'home'));
    const [sum, tl, up, rec, sample] = await Promise.all([ctx.pf.summary(asOf, items), ctx.pf.timeline(asOf), ctx.pf.upcoming(asOf), ctx.pf.recent(6), sampleLive(ctx.store)]);
    const out = h('div', {});

    out.append(h('div', {}, h('h1', { class: 'page-title' }, `${greeting()}${settings.displayName ? ', ' + settings.displayName : ''}.`),
      settings.portfolioName && h('p', { class: 'sub' }, settings.portfolioName), h('div', { class: 'row row--actions' }, addLink())));
    if (sample) out.append(h('p', { class: 'note-box' }, 'You are looking at the sample portfolio. Nothing here is real. Remove it in Settings when you are ready to start your own.'));
    if (sum.errors.length) out.append(h('p', { class: 'alert alert--warn' }, `${plural(sum.errors.length, 'investment', 'investments')} could not be calculated and ${sum.errors.length === 1 ? 'is' : 'are'} left out of these totals. Open ${sum.errors.length === 1 ? 'it' : 'each one'} under Investments to see why.`));
    if (ctx.store.problems().length) out.append(h('p', { class: 'alert alert--warn' }, `${plural(ctx.store.problems().length, 'record', 'records')} could not be read on this device and ${ctx.store.problems().length === 1 ? 'is' : 'are'} being skipped.`));

    // the statement
    let full = false;
    const heroValue = h('button', { class: 'hero-btn money', type: 'button', 'aria-label': 'Value of what you hold today. Press to switch between short and full amount.' }, money(sum.valueKobo));
    heroValue.addEventListener('click', () => { full = !full; heroValue.textContent = money(sum.valueKobo, { compact: !full }); });
    out.append(h('section', { class: 'statement', 'aria-label': 'Portfolio statement' },
      h('p', { class: 'statement-label' }, `What you hold today, ${plural(sum.count.active, 'investment', 'investments')}`), heroValue, h('hr', { class: 'gold-rule' }),
      h('p', { class: 'sub' }, pill(sum.netGainKobo, sum.roi), ' overall, counting income and anything already sold'),
      h('dl', { class: 'statement-line' },
        stat('Money put in', money(sum.investedKobo + sum.costsKobo)), stat('Income received', money(sum.incomeKobo)),
        stat('Sold for', money(sum.proceedsKobo)), stat('Net gain', money(sum.netGainKobo, { sign: true }), tone(sum.netGainKobo)))));

    // growth chart
    if (tl.length > 1) {
      const range = h('div', { class: 'seg', role: 'group', 'aria-label': 'Chart range' });
      const readout = h('p', { class: 'readout', 'aria-live': 'off' });
      const box = h('div', { class: 'chart-box' });
      const ranges = [['All', null], ['1 year', 12], ['6 months', 6]];
      const draw = (months) => {
        const from = months ? addMonths(asOf, -months) : '0000-00-00';
        const pts = tl.filter((p) => p.date >= from).map((p) => ({ date: p.date, a: p.valueKobo, b: p.putInKobo }));
        const say = (p) => h('span', {}, fmtDate(p.date), ': worth ', h('strong', {}, money(p.a)), ', money put in ', h('strong', {}, money(p.b)));
        const last = pts[pts.length - 1] || tl[tl.length - 1];
        readout.replaceChildren(say(last));
        box.replaceChildren(lineChart({ points: pts, description: `Line chart of what your investments were worth over time, from ${fmtDate(pts[0].date)} to ${fmtDate(last.date)}. Latest: worth ${money(last.a)}, money put in ${money(last.b)}.`,
          onHover: (p) => readout.replaceChildren(say(p || last)) }));
        ranges.forEach(([, m], i) => range.children[i].setAttribute('aria-pressed', String(m === months)));
      };
      ranges.forEach(([label, m]) => range.append(h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => draw(m) }, label)));
      draw(null);
      out.append(h('section', {}, sectionHead('How it has grown', range), readout, box,
        h('p', { class: 'legend-inline' }, h('span', {}, 'Worth, including investments sold'), h('span', { class: 'dashed' }, 'Money put in'))));
    }

    // allocation by category
    const byCat = new Map();
    for (const it of items) if (!it.error && it.metrics.valueKobo > 0) { const c = ctx.cat(it.investment.categoryId); byCat.set(c.name, (byCat.get(c.name) || 0) + it.metrics.valueKobo); }
    const segs = [...byCat].map(([label, valueKobo]) => ({ label, valueKobo })).sort((a, b) => b.valueKobo - a.valueKobo);
    if (segs.length) {
      const total = segs.reduce((t, s) => t + s.valueKobo, 0);
      out.append(h('section', {}, sectionHead('Where it is held'),
        h('div', { class: 'alloc' },
          donut({ segments: segs, centre: money(total), description: `Donut chart of current value by category: ${segs.map((s) => `${s.label} ${pct(s.valueKobo / total, { dp: 0 })}`).join(', ')}.` }),
          h('ul', { class: 'rows' }, segs.map((s, i) => h('li', {}, h('div', { class: 'row-line' }, h('span', { class: `swatch ${segmentClass(i)}` }),
            h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, s.label)),
            h('div', { class: 'row-end' }, h('span', { class: 'money' }, money(s.valueKobo)), h('span', { class: 'row-sub' }, pct(s.valueKobo / total, { dp: 1 }))))))))));
    }

    // coming up
    out.append(h('section', {}, sectionHead('Coming up'),
      up.length ? h('ul', { class: 'rows' }, up.slice(0, 6).map((u) => h('li', {}, h('a', { class: 'row-line', href: `#/investments/${u.investmentId}` },
        h('span', { class: `date-col${u.overdue ? ' overdue' : ''}` }, fmtDate(u.date)),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, u.title), u.investmentName && h('div', { class: 'row-sub' }, u.investmentName)),
        u.amountKobo != null && h('div', { class: 'row-end' }, signed(u.kind === 'cost' ? -u.amountKobo : u.amountKobo), h('span', { class: 'row-sub' }, 'expected'))))))
        : h('p', { class: 'sub' }, 'Nothing expected in the next 45 days.')));

    // recent activity
    out.append(h('section', {}, sectionHead('Recent activity'),
      h('ul', { class: 'rows' }, rec.map((e) => h('li', {}, h('a', { class: 'row-line', href: `#/investments/${e.investmentId}` },
        h('span', { class: 'date-col' }, fmtDate(e.date)),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, KIND[e.kind][0]), h('div', { class: 'row-sub' }, e.investmentName)),
        h('div', { class: 'row-end' }, signed(KIND[e.kind][1] * e.amountKobo))))))));
    return stackChildren(out);
  }
  // Spacing between the blocks of a view is handled by `.ws-outlet > * + *`; views are flat wrappers.
  function stackChildren(node) { node.className = 'flow'; return node; }

  // ---------- Investments list ----------
  async function listView(ctx) {
    const asOf = todayISO();
    const items = await ctx.pf.overview(asOf);
    const head = h('div', { class: 'page-actions' }, h('h1', { class: 'page-title' }, 'Investments'), addLink());
    if (!items.length) return h('div', {}, head, firstRun(ctx, 'list'));
    let filter = 'all', query = '';
    const listBox = h('div', {});
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Filter' });
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search by name or category', 'aria-label': 'Search investments' });
    const draw = () => {
      const q = query.trim().toLowerCase();
      const shown = items.filter((it) => {
        const closed = !it.error && it.metrics.basis === 'realized';
        if (filter === 'active' && closed) return false; if (filter === 'closed' && !closed) return false;
        return !q || `${it.investment.name} ${ctx.cat(it.investment.categoryId).name}`.toLowerCase().includes(q);
      });
      listBox.replaceChildren(shown.length ? h('ul', { class: 'rows' }, shown.map((it) => {
        const inv = it.investment, c = ctx.cat(inv.categoryId), m = it.metrics;
        return h('li', {}, h('a', { class: 'row-line', href: `#/investments/${inv.id}` },
          h('span', { class: 'tile' }, icon(c.icon)),
          h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, inv.name),
            h('div', { class: 'row-sub' }, m?.basis === 'realized' ? `${c.name}, closed ${fmtDate(inv.closedOn || m.asOf)}` : `${c.name}, since ${fmtMonthYear(inv.openedOn)}`)),
          it.error ? h('div', { class: 'row-end' }, h('span', { class: 'row-sub overdue' }, 'Cannot be calculated'))
            : h('div', { class: 'row-end' }, h('span', { class: 'money' }, money(m.currentValueKobo)), pillPct(m.netGainKobo, m.roi))));
      })) : h('p', { class: 'sub' }, 'No investments match.'));
      [...seg.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === filter)));
    };
    [['all', 'All'], ['active', 'Active'], ['closed', 'Closed']].forEach(([f, l]) => seg.append(h('button', { type: 'button', 'data-f': f, 'aria-pressed': 'false', onclick: () => { filter = f; draw(); } }, l)));
    search.addEventListener('input', () => { query = search.value; draw(); });
    draw();
    return h('div', { class: 'flow' }, head, h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search'), search), seg), listBox);
  }

  // ---------- Investment detail ----------
  async function detailView(ctx, id) {
    const asOf = todayISO();
    let r;
    try { r = await ctx.pf.metrics(id, asOf); }
    catch (e) {
      if (e.code === 'NOT_FOUND') return h('div', { class: 'flow' }, h('a', { class: 'back', href: '#/investments' }, icon('chevronLeft', { size: 18 }), 'Investments'), emptyBlock({ iconName: 'search', title: 'Investment not found', text: 'It may have been removed. Go back to your list to find it.' }));
      if (e.code) return h('div', { class: 'flow' }, h('a', { class: 'back', href: '#/investments' }, icon('chevronLeft', { size: 18 }), 'Investments'), h('p', { class: 'alert alert--error', role: 'alert' }, `This investment cannot be calculated: ${e.message}`));
      throw e;
    }
    const { bundle: b, metrics: m, partners } = r, inv = b.investment, c = ctx.cat(inv.categoryId), closed = m.basis === 'realized';

    const basisText = closed ? `Closed on ${fmtDate(inv.closedOn || m.asOf)}.`
      : m.valueSource === 'valuation' ? `Valuation by ${SOURCE[b.valuations[b.valuations.length - 1].source]} on ${fmtDate(m.valuationDate)}.`
      : m.valueSource === 'assumed' ? 'Estimated from the rate you set.' : 'Shown at cost: no valuation or rate set yet.';
    let full = false;
    const heroValue = h('button', { class: 'hero-btn money', type: 'button', 'aria-label': `${closed ? 'Sold for' : 'Worth'}. Press to switch between short and full amount.` }, money(m.currentValueKobo));
    heroValue.addEventListener('click', () => { full = !full; heroValue.textContent = money(m.currentValueKobo, { compact: !full }); });

    const ann = m.annualized;
    const annText = ann.rate == null ? 'Not available yet' : `${pct(ann.rate)} a year`;
    const head = h('section', { class: 'statement' },
      h('div', { class: 'detail-head' }, h('span', { class: 'tile tile--large' }, icon(c.icon, { size: 28 })),
        h('div', {}, h('h1', { class: 'page-title' }, inv.name), h('p', { class: 'sub' }, `${c.name}, ${closed ? 'closed' : 'active'} since ${fmtMonthYear(inv.openedOn)}`))),
      h('p', { class: 'statement-label', style: undefined }, closed ? 'Sold for' : 'Worth today'), heroValue,
      h('p', { class: 'sub' }, basisText), h('hr', { class: 'gold-rule' }),
      h('p', { class: 'sub' }, pill(m.netGainKobo, m.roi), ' net gain, counting income and costs'),
      h('dl', { class: 'statement-line' }, stat('Invested', money(m.investedKobo)), stat('Costs', money(m.costsKobo)), stat('Income received', money(m.incomeKobo)), stat('Held for', plural(m.daysHeld, 'day', 'days'))));

    const returns = h('dl', { class: 'defs' },
      h('dt', {}, 'Return on investment'), h('dd', { class: 'money' }, pct(m.roi)),
      h('dt', {}, 'Annualized return'), h('dd', { class: 'money' }, annText, ann.method && h('span', { class: 'sub' }, ` (${ann.method === 'cagr' ? 'CAGR' : 'XIRR'})`), ann.shortHold && ann.rate != null && h('div', { class: 'sub' }, 'Held for under a year, so treat this as a rough guide.')),
      m.yield.rate != null && m.yield.trailing12mNetIncomeKobo !== 0 && [h('dt', {}, 'Income yield, last 12 months'), h('dd', { class: 'money' }, pct(m.yield.rate))]);

    const working = h('details', { class: 'working' }, h('summary', {}, 'How this is calculated'), h('ul', {},
      h('li', {}, `Days are actual calendar days, counted from the first money put in to ${closed ? 'the closing date' : 'today'}. Years are days divided by 365.`),
      h('li', {}, m.valueSource === 'valuation' ? 'Worth is your latest valuation, used exactly as entered.' : m.valueSource === 'assumed' ? 'Worth is the money put in, grown or reduced by the rates under Details, over the actual days.' : closed ? 'Worth is the sale proceeds you recorded.' : 'Worth is what you paid, because no valuation or rate is set.'),
      h('li', {}, `Net gain = ${money(m.totalValueKobo, { compact: false })} (worth or proceeds) + ${money(m.incomeKobo, { compact: false })} (income) − ${money(m.investedKobo, { compact: false })} (invested) − ${money(m.costsKobo, { compact: false })} (costs) = ${money(m.netGainKobo, { compact: false })}.`),
      h('li', {}, `Return on investment = net gain ÷ (invested + costs) = ${pct(m.roi)}.`),
      ann.method === 'cagr' && h('li', {}, 'Annualized return (CAGR) is the yearly rate that turns the money invested into the final value over the days held.'),
      ann.method === 'xirr' && h('li', {}, 'Annualized return (XIRR) is the yearly rate at which every dated payment in and out balances to zero.')));

    // tabs
    const panels = {};
    panels.overview = () => h('div', { class: 'flow' }, returns,
      b.valuations.length > 0 && h('section', {}, sectionHead('Valuations'), h('ul', { class: 'rows' }, [...b.valuations].reverse().map((v) => h('li', {}, h('a', { class: 'row-line', href: `#/investments/${inv.id}/valuation/${v.id}` },
        h('span', { class: 'date-col' }, fmtDate(v.date)), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, `By ${SOURCE[v.source]}`), v.note && h('div', { class: 'row-sub' }, v.note)),
        h('div', { class: 'row-end' }, h('span', { class: 'money' }, money(v.valueKobo)))))))),
      b.schedules.length > 0 && h('section', {}, sectionHead('Regular payments'), h('ul', { class: 'rows' }, b.schedules.map((s) => h('li', {}, h('div', { class: 'row-line' }, h('div', { class: 'row-main' }, scheduleSentence(s))))))),
      working);
    panels.ledger = () => h('div', { class: 'flow' }, b.entries.length ? h('ul', { class: 'rows' }, [...b.entries].reverse().map((e) => h('li', {}, h('a', { class: 'row-line', href: `#/investments/${inv.id}/entry/${e.id}` },
      h('span', { class: 'date-col' }, fmtDate(e.date)), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, KIND[e.kind][0]), e.note && h('div', { class: 'row-sub' }, e.note)),
      h('div', { class: 'row-end' }, signed(KIND[e.kind][1] * e.amountKobo)))))) : h('p', { class: 'sub' }, 'No entries yet.'),
      h('p', { class: 'sub' }, `${plural(b.entries.length, 'entry', 'entries')}. Amounts show money leaving you as minus and money reaching you as plus. Tap an entry to edit or delete it.`));
    panels.people = () => {
      const name = (pid) => (pid === 'me' ? 'You' : b.partners.find((p) => p.id === pid)?.name || 'Partner');
      const mine = partners.partners.find((p) => p.partnerId === 'me');
      return h('div', { class: 'flow' }, h('div', { class: 'scroll-x' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['Who', 'Put in', 'Share', 'Worth', 'Income', 'Net gain'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, partners.partners.map((p) => h('tr', {}, h('td', {}, name(p.partnerId)), h('td', {}, money(p.contributionKobo)), h('td', {}, pct(p.ownershipBp / 10000, { dp: 0 })),
          h('td', {}, money(p.valueShareKobo)), h('td', {}, money(p.incomeShareKobo)), h('td', { class: tone(p.netGainKobo) }, money(p.netGainKobo, { sign: true }))))))),
      mine && h('p', { class: 'sub' }, `Your own position, after what you put in: ${money(mine.netPositionKobo, { compact: false, sign: true })}.`));
    };
    panels.details = () => {
      const defs = c.customFieldDefs || [], rows = [
        ['Category', c.name], ['Status', closed ? 'Closed' : 'Active'], ['Opened', fmtDate(inv.openedOn)], inv.closedOn && ['Closed', fmtDate(inv.closedOn)],
        inv.behaviors.term && ['Matures', fmtDate(inv.behaviors.term.maturityDate)], ['Value', VALUE_CHANGE[inv.behaviors.valueChange]],
        ...inv.rates.map((rt, i) => [i === 0 ? 'Rates' : '', rateSentence(inv, rt)]),
        ...Object.entries(inv.customFields).map(([k, v]) => [defs.find((d) => d.key === k)?.label || k, v == null ? '' : String(v)]),
      ].filter(Boolean);
      return h('div', { class: 'flow' }, h('dl', { class: 'defs' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
        inv.notes && h('section', {}, sectionHead('Notes'), h('p', { class: 'prose' }, inv.notes)),
        h('section', {}, sectionHead('Delete'), h('p', { class: 'sub' }, 'Deleting hides this investment and everything recorded under it. You can undo it straight afterwards.'),
          h('div', { class: 'row row--actions' }, h('button', { class: 'btn btn--secondary btn--danger', type: 'button', onclick: () => deleteInvestment(ctx, inv) }, 'Delete this investment'))));
    };
    const tabsList = [['overview', 'Overview'], ['ledger', 'Ledger'], partners && ['people', 'People'], ['details', 'Details']].filter(Boolean);
    const body = h('div', { role: 'tabpanel' });
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    const pick = (key) => { body.replaceChildren(panels[key]()); [...tabs.children].forEach((t) => t.setAttribute('aria-selected', String(t.dataset.k === key))); };
    tabsList.forEach(([k, l]) => tabs.append(h('button', { type: 'button', role: 'tab', 'data-k': k, 'aria-selected': 'false', onclick: () => pick(k) }, l)));
    pick('overview');
    const actionsRow = h('div', { class: 'row row--actions' }, closed
      ? h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => reopen(ctx, inv.id) }, 'Reopen this investment')
      : [h('a', { class: 'btn', href: `#/investments/${inv.id}/entry` }, icon('plus'), 'Add entry'), h('a', { class: 'btn btn--secondary', href: `#/investments/${inv.id}/valuation` }, 'Add valuation'), h('a', { class: 'btn btn--secondary', href: `#/investments/${inv.id}/close` }, 'Close')]);
    return h('div', { class: 'flow' }, h('a', { class: 'back', href: '#/investments' }, icon('chevronLeft', { size: 18 }), 'Investments'), head, actionsRow, tabs, body);
  }

  // ---------- Settings ----------
  async function settingsView(ctx) {
    const sample = await sampleLive(ctx.store);
    const name = h('input', { class: 'input', id: 'displayName', value: settings.displayName, maxlength: 80, autocomplete: 'name' });
    const pname = h('input', { class: 'input', id: 'portfolioName', value: settings.portfolioName, maxlength: 80 });
    const saved = h('p', { class: 'hint', role: 'status' });
    const profile = h('form', { class: 'stack', novalidate: true },
      h('div', { class: 'field' }, h('label', { for: 'displayName' }, 'Your name'), name),
      h('div', { class: 'field' }, h('label', { for: 'portfolioName' }, 'Portfolio name'), pname, h('p', { class: 'hint' }, 'Shown on your dashboard.')),
      h('button', { class: 'btn', type: 'submit' }, 'Save'), saved);
    profile.addEventListener('submit', async (e) => {
      e.preventDefault();
      await withBusy(profile.querySelector('button[type=submit]'), async () => {
        settings = await ctx.pf.updateSettings({ displayName: name.value, portfolioName: pname.value });
        paintChrome('settings'); saved.textContent = 'Saved.';
      });
    });
    const choice = (label, options, current, onPick) => {
      const g = h('div', { class: 'seg', role: 'group', 'aria-label': label });
      options.forEach(([v, l]) => g.append(h('button', { type: 'button', 'aria-pressed': String(v === current), onclick: async () => { await onPick(v); [...g.children].forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === v))); } }, l)));
      return g;
    };
    const root_ = document.documentElement;
    const theme = choice('Theme', [['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']], settings.theme, async (v) => {
      if (v === 'system') { root_.removeAttribute('data-theme'); try { localStorage.removeItem('apex.theme'); } catch { /* storage unavailable */ } }
      else { root_.setAttribute('data-theme', v); try { localStorage.setItem('apex.theme', v); } catch { /* storage unavailable */ } }
      settings = await ctx.pf.updateSettings({ theme: v });
    });
    const scale = choice('Text size', [[90, 'Smaller'], [100, 'Standard'], [115, 'Larger'], [130, 'Largest']], settings.textScale, async (v) => { settings = await ctx.pf.updateSettings({ textScale: v }); applyAppearance(); });
    const hide = h('input', { type: 'checkbox', id: 'hide' }); hide.checked = !!settings.hideAmounts;
    hide.addEventListener('change', async () => { settings = await ctx.pf.updateSettings({ hideAmounts: hide.checked }); applyAppearance(); paintChrome('settings'); });
    const sampleBtn = sample ? h('button', { class: 'btn btn--secondary', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => removeSample(ctx)) }, 'Remove the sample portfolio') : sampleButton(ctx);

    return h('div', { class: 'settings flow' }, h('h1', { class: 'page-title' }, 'Settings'),
      h('section', {}, sectionHead('Profile'), profile),
      h('section', { class: 'stack' }, sectionHead('Appearance'), theme, scale, h('label', { class: 'check', for: 'hide' }, hide, h('span', {}, 'Hide amounts on screen (percentages stay visible). You can also use the eye at the top.'))),
      h('section', { class: 'stack' }, sectionHead('Security'), h('p', { class: 'sub' }, `Signed in as ${email}. Records are encrypted on this device and locked after 2 minutes of inactivity.`),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: actions.onLock }, 'Lock now'), h('button', { class: 'btn btn--secondary', type: 'button', onclick: actions.onSetPin }, 'Set or change PIN')),
        h('div', { class: 'row' }, h('button', { class: 'btn btn--secondary', type: 'button', onclick: actions.onCheckKey }, 'Check my recovery key'), h('button', { class: 'btn btn--secondary', type: 'button', onclick: actions.onRotateKey }, 'Create a new recovery key'))),
      h('section', { class: 'stack' }, sectionHead('Sample portfolio'), h('p', { class: 'sub' }, sample ? 'The sample portfolio is on this device. It is made up and can be removed without touching your own records.' : 'Adds a made-up portfolio (land, a rental flat, a car, a treasury bill and a partnership) so you can explore Apex before adding real records.'), sampleBtn),
      h('section', { class: 'stack' }, sectionHead('Account'), h('button', { class: 'btn btn--secondary', type: 'button', onclick: actions.onSignOut }, 'Sign out'),
        h('p', { class: 'hint' }, 'Your records are saved on this device only for now. Syncing between devices arrives in a later update, so keep your recovery key safe.')));
  }

  // ---------- routing ----------
  async function render() {
    const mine = ++token;
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const page = parts[0] || 'home';
    paintChrome(page === 'investments' || page === 'new' ? 'investments' : page === 'settings' ? 'settings' : 'home');
    outlet.replaceChildren(skeleton());
    try {
      const ctx = await load();
      let view;
      if (page === 'new') view = await newView(ctx);
      else if (page === 'investments' && parts[1] && parts[2]) view = await recordFormView({ ctx, invId: parts[1], kind: parts[2], recordId: parts[3], today: todayISO(), toast, go });
      else if (page === 'investments' && parts[1]) view = await detailView(ctx, parts[1]);
      else if (page === 'investments') view = await listView(ctx);
      else if (page === 'settings') view = await settingsView(ctx);
      else view = await homeView(ctx);
      if (mine !== token) return;
      paintChrome(page === 'investments' || page === 'new' ? 'investments' : page === 'settings' ? 'settings' : 'home');
      outlet.replaceChildren(view);
      window.scrollTo(0, 0);
    } catch (e) {
      if (mine !== token || (e instanceof StoreError && e.code === 'LOCKED')) return;
      outlet.replaceChildren(h('p', { class: 'alert alert--error', role: 'alert' }, e instanceof StoreError || e.code === 'INVALID' ? e.message : 'Something went wrong while reading your records. Reload the page and try again.'));
      console.error(e);
    }
  }
  hideBtn.addEventListener('click', async () => {
    try { const ctx = await load(); settings = await ctx.pf.updateSettings({ hideAmounts: !settings.hideAmounts }); applyAppearance(); if (location.hash.startsWith('#/new')) paintChrome('investments'); else render(); } catch (e) { console.error(e); }
  });
  hashHandler = () => { if (!root.isConnected) { window.removeEventListener('hashchange', hashHandler); return; } render(); };
  window.addEventListener('hashchange', hashHandler);
  if (!location.hash.startsWith('#/')) history.replaceState(null, '', '#/');
  render();
  return root;
}
