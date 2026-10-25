// The signed-in workspace: navigation, dashboard, investments, investment detail and settings.
// Read-only for investments in this release (adding and editing come next). Everything is calculated by the
// engine through js/models/portfolio.js; this file only arranges and words it.
import { h } from './dom.js';
import { animateNumber, applyTheme, currentTheme, enter, prefersReducedMotion, setBusy, toggleTheme, withBusy } from './motion.js';
import { slideThumb, stepSlider } from './formkit.js';
import { confirmDialog } from './dialog.js';
import { icon } from './icons.js';
import { donut, lineChart, segmentClass } from './charts.js';
import { amtText, fmtDate, fmtMonthYear, greeting, isHidden, money, pct, setHidden, todayISO, tone } from './fmt.js';
import { addMonths } from '../engine/index.js';
import { createPortfolio } from '../models/portfolio.js';
import { BUILT_IN_TEMPLATES, findTemplate } from '../models/templates.js';
import { seedSamplePortfolio } from '../models/sample.js';
import { StoreError } from '../core/store.js';
import { wizardView } from './wizard.js';
import { recordFormView } from './forms.js';
import { isPaletteOpen, openPalette } from './palette.js';
import { helpLink, helpView } from './help.js';
import { downloadText, statusChip, syncPanel } from './sync-ui.js';
import { manageView } from './manage-views.js';
import { reportView } from './report-views.js';
import { dueUnrecorded } from '../models/manage.js';
import { HELP_ROUTE, helpSearchItems } from '../models/help-content.js';

const KIND = { capital_in: ['Money put in', -1], cost: ['Cost', -1], income: ['Income received', 1], payout: ['Payout received', 1], proceeds: ['Sale proceeds', 1], repayment: ['Loan repayment', 1] };
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
let heroPlayed = false; // the dashboard figure counts up once per visit, not on every page change
const amt = (kobo, opts) => h('span', { class: 'amt' }, amtText(kobo, opts)); // blurs when amounts are hidden
const pill = (net, roi, small) => {
  const t = tone(net);
  // Nothing gained or lost yet (a brand-new investment): one calm phrase instead of "₦0.00 0.00%".
  if (t === 'flat') return h('span', { class: `pill flat${small ? ' pill--small' : ''}` }, 'No change yet');
  return h('span', { class: `pill ${t}${small ? ' pill--small' : ''}` }, t === 'gain' && icon('arrowUp'), t === 'loss' && icon('arrowDown'), amt(net, { sign: true }), roi != null && ` ${pct(roi, { sign: true })}`);
};
const pillPct = (net, roi) => { const t = tone(net); return h('span', { class: `pill pill--small ${t}` }, t === 'gain' && icon('arrowUp'), t === 'loss' && icon('arrowDown'), pct(roi, { sign: true })); };
const stat = (label, value, cls = '') => h('div', {}, h('dt', {}, label), h('dd', { class: `money ${cls}` }, value));
const signed = (kobo) => h('span', { class: `money ${tone(kobo)}` }, amt(kobo, { sign: true }));
const sectionHead = (title, right) => h('div', { class: 'section-head' }, h('h2', {}, title), right);
const emptyBlock = ({ iconName, title, text, actions, hero = false, help = null }) => h('div', { class: hero ? 'empty panel empty--hero' : 'empty' },
  h('span', { class: 'empty-art' }, icon(iconName, { size: 30 })), h('h2', {}, title), h('p', {}, text), actions && h('div', { class: 'row' }, actions),
  help && helpLink(help.topic, help.text));
const tintOf = (id) => { let n = 0; for (const ch of String(id)) n = (n * 31 + ch.charCodeAt(0)) >>> 0; return `tint-${(n % 6) + 1}`; };
const miniEmpty = (iconName, text) => h('div', { class: 'mini-empty' }, icon(iconName, { size: 20 }), text);
const rise = (el, i) => { if (el && !prefersReducedMotion()) { el.classList.add('rise'); el.style.setProperty('--i', String(i)); } return el; };
const initials = (s) => (String(s || '').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'A');
const lockup = () => h('span', { class: 'lockup' }, h('img', { class: 'lockup-mark', src: '/img/apex-mark.svg', alt: '', width: 32, height: 32 }), h('span', { class: 'wordmark', role: 'img', 'aria-label': 'Apex' }));

// Large amount with a quiet currency sign and quiet decimals. paint(text) re-draws it; works with the count-up.
function heroAmount() {
  const cur = h('span', { class: 'cur' }), whole = h('span', { class: 'whole' }), dec = h('span', { class: 'dec' });
  const el = h('span', { class: 'hero-num amt' }, cur, whole, dec);
  const paint = (text) => {
    const m = /^(\D*?)(\d[\d,]*)(\.\d+)?(.*)$/.exec(String(text));
    if (!m) { cur.textContent = ''; whole.textContent = text; dec.textContent = ''; return; }
    const suffix = m[4] || '';
    cur.textContent = m[1].trim() ? m[1] : '';
    whole.textContent = suffix ? m[2] + (m[3] || '') + suffix : m[2];
    dec.textContent = suffix ? '' : (m[3] || '');
  };
  return { el, paint };
}

// Keeps a sliding marker under the active item of a group (tab bar, side nav, detail tabs). Positions go through CSS variables.
function indicator(group, selector, { vertical = false, center = 0 } = {}) {
  const place = () => {
    const on = group.querySelector(selector);
    if (!on || !group.isConnected || !on.offsetWidth) return;
    if (vertical) { group.style.setProperty('--ind-y', `${on.offsetTop}px`); group.style.setProperty('--ind-h', `${on.offsetHeight}px`); }
    else { const w = center || on.offsetWidth; group.style.setProperty('--ind-x', `${on.offsetLeft + (on.offsetWidth - w) / 2}px`); group.style.setProperty('--ind-w', `${w}px`); }
    group.style.setProperty('--ind-o', '1');
  };
  try { new MutationObserver(place).observe(group, { subtree: true, attributes: true, attributeFilter: ['aria-current', 'aria-selected'] }); } catch { /* old browser */ }
  try { new ResizeObserver(place).observe(group); } catch { /* old browser */ }
  requestAnimationFrame(place);
  return place;
}

// Loading shapes that match each page, so the layout does not jump when real content arrives.
function skeletonFor(page) {
  const line = (c = '') => h('div', { class: `skeleton skeleton-line ${c}`.trim() });
  const rows = (n) => h('div', { class: 'panel' }, Array.from({ length: n }, () => h('div', { class: 'sk-row' },
    h('div', { class: 'skeleton skeleton-tile' }), h('div', { class: 'sk-lines' }, line('w60'), line('w35')), line('w20'))));
  if (page === 'settings') return h('div', { class: 'flow', 'aria-hidden': 'true' }, line('w30 h-title'), h('div', { class: 'panel' }, line('w40'), line('w80'), line('w65')), h('div', { class: 'panel' }, line('w50'), line('w70')));
  if (page === 'investments') return h('div', { class: 'flow', 'aria-hidden': 'true' }, line('w40 h-title'), h('div', { class: 'skeleton skeleton-search' }), rows(5));
  return h('div', { class: 'flow', 'aria-hidden': 'true' }, line('w45 h-title'),
    h('div', { class: 'dash' },
      h('div', { class: 'dash-main' }, h('div', { class: 'panel' }, line('w30'), h('div', { class: 'skeleton skeleton-hero' }), h('div', { class: 'sk-stats' }, line(), line(), line(), line())), h('div', { class: 'skeleton skeleton-block' })),
      h('div', { class: 'dash-side' }, h('div', { class: 'skeleton skeleton-block' }), h('div', { class: 'skeleton skeleton-block short' }))));
}

export function mountWorkspace({ data, email, actions }) {
  const root = h('div', { class: 'ws' });
  const outlet = h('div', { class: 'ws-outlet' });
  const avatar = h('span', { class: 'avatar', 'aria-hidden': 'true' }), userName = h('p', { class: 'side-user-name' }), userSub = h('p', { class: 'side-user-sub' });
  const hideBtn = h('button', { class: 'icon-btn', type: 'button' });
  let settings = null, token = 0, hashHandler = null, ctxCache = null;

  // ---------- chrome ----------
  const NAV = [['home', '#/', 'Home', 'home'], ['investments', '#/investments', 'Investments', 'list'], ['settings', '#/settings', 'Settings', 'sliders']];
  const tabLinks = NAV.map(([key, href, label, ic]) => h('a', { class: 'tab', href, 'data-key': key }, icon(ic, { size: 22 }), label));
  const sideLinks = NAV.map(([key, href, label, ic]) => h('a', { href, 'data-key': key }, icon(ic), label));
  const sideNav = h('nav', { class: 'side-nav', 'aria-label': 'Main' }, sideLinks);
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Main' }, tabLinks);
  const moonIco = icon('moon'), sunIco = icon('sun');
  moonIco.classList.add('theme-ico', 'theme-ico--moon'); sunIco.classList.add('theme-ico', 'theme-ico--sun');
  const themeBtn = h('button', { class: 'icon-btn theme-toggle', type: 'button', 'aria-label': 'Switch between light and dark', title: 'Switch theme' }, moonIco, sunIco);
  async function flipTheme(origin) {
    await toggleTheme(origin);
    try { if (ctxCache) settings = await ctxCache.pf.updateSettings({ theme: currentTheme() }); } catch (e) { console.error(e); }
  }
  themeBtn.addEventListener('click', () => flipTheme(themeBtn));
  // Search and commands (Ctrl+K). A button on phones and tablets, a wide search box in the desktop sidebar.
  const isMac = /mac|iphone|ipad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');
  const shortcut = isMac ? '⌘K' : 'Ctrl K';
  const searchBtn = h('button', { class: 'icon-btn palette-btn', type: 'button', 'aria-label': 'Search and commands', title: `Search and commands (${shortcut})`, onclick: () => showPalette() }, icon('search'));
  const sideSearch = h('button', { class: 'side-search', type: 'button', 'aria-label': `Search and commands, shortcut ${shortcut}`, onclick: () => showPalette() },
    icon('search', { size: 18 }), h('span', { class: 'side-search-text' }, 'Search'), h('kbd', { 'aria-hidden': 'true' }, shortcut));
  const lockBtn = (cls) => h('button', { class: cls, type: 'button', 'aria-label': 'Lock Apex now', title: 'Lock now', onclick: actions.onLock }, icon('lock'));
  const topbar = h('header', { class: 'topbar' }, lockup(),
    h('div', { class: 'topbar-actions' },
      actions.sync ? statusChip(actions.sync) : h('span', { class: 'chip-status', title: 'Your records are stored encrypted on this device.' }, 'Saved on this device'),
      searchBtn, hideBtn, themeBtn, lockBtn('icon-btn')));
  root.append(
    h('aside', { class: 'ws-side' }, lockup(), h('div', { class: 'side-top' }, sideSearch, sideNav),
      h('div', { class: 'side-user' }, avatar, h('div', { class: 'side-user-text' }, userName, userSub), lockBtn('icon-btn'))),
    h('main', { class: 'ws-main' }, topbar, outlet),
    tabbar);
  indicator(sideNav, '[aria-current="page"]', { vertical: true });
  indicator(tabbar, '[aria-current="page"]', { center: 28 });

  function paintChrome(page) {
    for (const a of [...tabLinks, ...sideLinks]) { if (a.dataset.key === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
    const who = settings?.displayName || String(email || '').split('@')[0] || 'You';
    avatar.textContent = initials(who); userName.textContent = who; userSub.textContent = settings?.portfolioName || 'Encrypted on this device';
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
  // Plays the blur / focus animation on amounts for a moment after the hide setting changes.
  function flashAmounts() { const r = document.documentElement; r.classList.add('amt-anim'); setTimeout(() => r.classList.remove('amt-anim'), 700); }
  function toast(text, action) {
    root.querySelectorAll('.toast').forEach((x) => x.remove());
    const timer = h('span', { class: 'toast-timer', 'aria-hidden': 'true' });
    const t = h('div', { class: 'toast', role: 'status' }, icon(/^could not/i.test(text) ? 'alert' : 'checkCircle', { size: 18 }), h('span', { class: 'toast-text' }, text),
      action && h('button', { class: 'link-btn toast-btn', type: 'button', onclick: () => { t.remove(); action.run(); } }, action.label), timer);
    const ms = action ? 9000 : 3800;
    t.style.setProperty('--ttl', `${ms}ms`);
    const close = () => { if (!t.isConnected) return; t.classList.add('out'); setTimeout(() => t.remove(), prefersReducedMotion() ? 0 : 200); };
    root.append(t);
    if (prefersReducedMotion()) setTimeout(close, ms); else timer.addEventListener('animationend', close, { once: true });
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

  async function addSample(ctx, button, { stay = false } = {}) {
    setBusy(button, true);
    try {
      const ids = await seedSamplePortfolio(ctx.store);
      await ctx.store.meta.set('sampleIds', ids);
      toast('Sample portfolio added. Remove it any time in Settings.');
      if (stay) { render(); return; }
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
    if (!(await confirmDialog({ title: `Delete \"${inv.name}\"?`, body: 'It and everything recorded under it will be hidden. You can undo right after.', confirmLabel: 'Delete', cancelLabel: 'Keep it', danger: true }))) return;
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
    hero: true, iconName: 'landmark', title: 'Nothing on record yet',
    text: where === 'home' ? 'Your investments will appear here, with what they are worth and what they have earned. Add your first one, or try the sample portfolio to see how Apex works.' : 'Add your first investment, or try the sample portfolio to see how Apex works.',
    actions: [addLink(), sampleButton(ctx)], help: { topic: 'start', text: 'New to Apex? Read the 5-minute guide' } });

  // ---------- Home: quick actions and the investment cards ----------
  const activeOf = (items) => items.filter((it) => !it.error && it.metrics.basis !== 'realized');
  function quickActions(ctx, items) {
    const live = activeOf(items);
    const pick = (kind, placeholder) => () => {
      if (live.length === 1) { go(`#/investments/${live[0].investment.id}/${kind}`); return; }
      openPalette({ placeholder, isAlive: () => root.isConnected, load: async () => live.map(({ investment: inv }) => { const c = ctx.cat(inv.categoryId); return { group: 'Choose an investment', label: inv.name, sub: c.name, icon: c.icon, run: () => go(`#/investments/${inv.id}/${kind}`) }; }) });
    };
    const qa = (ic, text, props) => h(props.href ? 'a' : 'button', { class: 'qa', ...(props.href ? {} : { type: 'button' }), ...props }, h('span', { class: 'qa-ico' }, icon(ic, { size: 22 })), h('span', { class: 'qa-label' }, text));
    return h('div', { class: 'qa-row', role: 'group', 'aria-label': 'Quick actions' },
      qa('plus', 'Add', { href: '#/new', 'aria-label': 'Add an investment' }),
      live.length > 0 && qa('coins', 'Entry', { onclick: pick('entry', 'Add an entry to which investment?'), 'aria-label': 'Add a ledger entry' }),
      live.length > 0 && qa('chart', 'Value', { onclick: pick('valuation', 'Add a valuation to which investment?'), 'aria-label': 'Add a valuation' }),
      qa('search', 'Search', { onclick: () => showPalette(), 'aria-label': 'Search and commands' }));
  }
  function investmentStrip(ctx, items) {
    const rank = (it) => [it.metrics.basis === 'realized' ? 1 : 0, -Number(it.metrics.currentValueKobo)];
    const shown = items.filter((it) => !it.error).sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1]; }).slice(0, 8);
    if (!shown.length) return null;
    return h('section', { 'aria-label': 'Your investments' }, sectionHead('Your investments', h('a', { class: 'see-all', href: '#/investments' }, 'See all')),
      h('ul', { class: 'cards' }, shown.map(({ investment: inv, metrics: m }) => { const c = ctx.cat(inv.categoryId);
        return h('li', {}, h('a', { class: 'inv-card', href: `#/investments/${inv.id}` },
          h('span', { class: `tile ${tintOf(inv.categoryId)}` }, icon(c.icon)),
          h('span', { class: 'inv-card-name' }, inv.name), h('span', { class: 'inv-card-sub' }, m.basis === 'realized' ? `${c.name}, closed` : c.name),
          h('span', { class: 'inv-card-val money' }, amt(m.currentValueKobo)), pillPct(m.netGainKobo, m.roi)));
      })));
  }

  // ---------- setup checklist (Home) ----------
  // Every tick comes from what is actually on this device, never from a click, so it cannot say "done" falsely.
  // The sample portfolio does not count: it is made up. "Hide" is remembered on this device.
  async function setupCard(ctx, items) {
    if (await ctx.store.meta.get('setupDismissed')) return null;
    const sample = new Set(((await ctx.store.meta.get('sampleIds')) || {}).investments || []);
    const mine = items.map((it) => it.investment).filter((i) => !sample.has(i.id)), ids = new Set(mine.map((i) => i.id));
    const [vals, entries, scheds, pin, keyOk] = await Promise.all([ctx.store.list('valuation'), ctx.store.list('entry'), ctx.store.list('schedule'),
      actions.hasPin ? actions.hasPin().catch(() => false) : false, ctx.store.meta.get('keyChecked')]);
    const first = mine[0];
    const link = (path, label) => first && h('a', { class: 'btn btn--secondary btn--small', href: `#/investments/${first.id}/${path}` }, label);
    const steps = [
      { title: 'Add your first investment', text: 'Land, rent, a treasury bill, a car, a partnership and more.', done: mine.length > 0, act: h('a', { class: 'btn btn--secondary btn--small', href: '#/new' }, 'Add one') },
      { title: 'Record what it is worth today', text: 'A valuation you enter beats any assumption, so Apex shows a real figure.', done: vals.some((v) => ids.has(v.investmentId)), act: link('valuation', 'Add valuation') },
      { title: 'Log income or a cost', text: 'Rent received, a service charge, a legal fee. It all feeds your returns.', done: entries.some((e) => ids.has(e.investmentId) && ['income', 'payout', 'cost'].includes(e.kind)) || scheds.some((x) => ids.has(x.investmentId)), act: link('entry', 'Add entry') },
      { title: 'Set a PIN for quick unlocking', text: 'Four digits to unlock Apex on this device instead of your password.', done: !!pin, act: h('button', { class: 'btn btn--secondary btn--small', type: 'button', onclick: actions.onSetPin }, 'Set PIN') },
      { title: 'Check your recovery key', text: 'Confirms the key you saved really opens your data. It changes nothing.', done: !!keyOk, act: h('button', { class: 'btn btn--secondary btn--small', type: 'button', onclick: actions.onCheckKey }, 'Check key') },
    ];
    const done = steps.filter((x) => x.done).length, all = done === steps.length;
    const bar = h('div', { class: 'setup-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(steps.length), 'aria-valuenow': String(done), 'aria-label': 'Setup progress' }, h('i', {}));
    bar.style.setProperty('--p', String(done / steps.length));
    const hide = h('button', { class: 'link-btn', type: 'button', onclick: async () => { await ctx.store.meta.set('setupDismissed', true); render(); } }, all ? 'Done' : 'Hide');
    const list = h('ul', { class: 'setup-steps' }, steps.map((x) => h('li', { class: `setup-step${x.done ? ' is-done' : ''}` },
      h('span', { class: 'setup-check', 'aria-hidden': 'true' }, x.done && icon('check', { size: 16 })),
      h('div', { class: 'setup-text' }, h('p', { class: 'setup-title' }, x.title, x.done && h('span', { class: 'sr-only' }, ' (done)')), !x.done && h('p', { class: 'sub' }, x.text)),
      !x.done && x.act)));
    const more = h('div', { class: 'setup-more', id: 'setup-more', hidden: true }, bar, list, h('div', { class: 'setup-foot' }, helpLink('start', 'Read the 5-minute guide'), hide));
    const ring = h('span', { class: 'setup-ring', 'aria-hidden': 'true' }, h('span', {}, `${done}/${steps.length}`));
    ring.style.setProperty('--p', String(done / steps.length));
    const toggle = h('button', { class: 'setup-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'setup-more',
      onclick: () => { const open = more.hidden; more.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); } },
      ring, h('span', { class: 'setup-toggle-text' }, h('strong', {}, all ? 'You are all set' : 'Getting started'), h('span', { class: 'sub' }, all ? 'Everything on the list is done.' : `Next: ${steps.find((x) => !x.done).title}`)), icon('chevronRight', { size: 18 }));
    return h('section', { class: 'panel setup', 'aria-label': 'Getting started' }, toggle, more);
  }

  // ---------- Home ----------
  async function homeView(ctx) {
    const asOf = todayISO();
    const items = await ctx.pf.overview(asOf);
    const firstName = (settings.displayName || '').trim().split(/\s+/)[0];
    const heading = h('div', { class: 'home-head' }, h('div', {}, h('p', { class: 'home-greet' }, greeting()), h('h1', { class: 'page-title' }, firstName || 'Welcome')),
      settings.portfolioName && h('span', { class: 'chip chip--plain' }, settings.portfolioName));
    const setup = await setupCard(ctx, items);
    if (!items.length) return h('div', { class: 'flow' }, heading, firstRun(ctx, 'home'), rise(setup, 1));
    const [sum, tl, up, rec, sample] = await Promise.all([ctx.pf.summary(asOf, items), ctx.pf.timeline(asOf), ctx.pf.upcoming(asOf), ctx.pf.recent(6), sampleLive(ctx.store)]);

    const notes = [];
    if (sample) notes.push(h('p', { class: 'note-box' }, 'You are looking at the sample portfolio. Nothing here is real. Remove it in Settings when you are ready to start your own.'));
    if (sum.errors.length) notes.push(h('p', { class: 'alert alert--warn' }, `${plural(sum.errors.length, 'investment', 'investments')} could not be calculated and ${sum.errors.length === 1 ? 'is' : 'are'} left out of these totals. Open ${sum.errors.length === 1 ? 'it' : 'each one'} under Investments to see why.`));
    if (ctx.store.problems().length) notes.push(h('p', { class: 'alert alert--warn' }, `${plural(ctx.store.problems().length, 'record', 'records')} could not be read on this device and ${ctx.store.problems().length === 1 ? 'is' : 'are'} being skipped.`));

    // growth chart: lives inside the statement card, under the big number
    const growth = (() => {
      if (tl.length < 2) {
        return h('p', { class: 'sub growth-note growth-note--plain' }, 'Your growth chart appears after your first month-end.');
      }
      const range = h('div', { class: 'seg seg--slide', role: 'group', 'aria-label': 'Chart range' });
      const readout = h('p', { class: 'readout', 'aria-live': 'off' });
      const box = h('div', { class: 'chart-box' });
      const ranges = [['1M', 1], ['6M', 6], ['1Y', 12], ['All', null]];
      const draw = (months) => {
        ranges.forEach(([, m], i) => range.children[i].setAttribute('aria-pressed', String(m === months)));
        const from = months ? addMonths(asOf, -months) : '0000-00-00';
        const pts = tl.filter((p) => p.date >= from).map((p) => ({ date: p.date, a: p.valueKobo, b: p.putInKobo }));
        if (pts.length < 2) { readout.replaceChildren(); box.replaceChildren(h('p', { class: 'sub chart-empty' }, 'Not enough history in this range yet. Try a longer one.')); return; }
        const say = (p) => h('span', {}, fmtDate(p.date), ': worth ', h('strong', {}, amt(p.a)), ', money put in ', h('strong', {}, amt(p.b)));
        const last = pts[pts.length - 1];
        readout.replaceChildren(say(last));
        box.replaceChildren(lineChart({ points: pts, description: `Line chart of what your investments were worth over time, from ${fmtDate(pts[0].date)} to ${fmtDate(last.date)}. Latest: worth ${money(last.a)}, money put in ${money(last.b)}.`,
          onHover: (p) => readout.replaceChildren(say(p || last)) }));
      };
      ranges.forEach(([label, m]) => range.append(h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => draw(m) }, label)));
      slideThumb(range);
      draw(null);
      return h('div', { class: 'growth' }, h('div', { class: 'growth-head' }, readout, range), box,
        h('p', { class: 'legend-inline' }, h('span', {}, 'Worth, including investments sold'), h('span', { class: 'dashed' }, 'Money put in')));
    })();

    // the statement: the memorable part of the dashboard
    let full = false;
    const hero = heroAmount();
    const heroBtn = h('button', { class: 'hero-btn money', type: 'button', 'aria-label': 'Value of what you hold today. Press to switch between short and full amount.' }, hero.el);
    heroBtn.addEventListener('click', () => { full = !full; hero.paint(amtText(sum.valueKobo, { compact: !full })); });
    if (!heroPlayed && !isHidden()) {
      animateNumber({ set textContent(t) { hero.paint(t); } }, sum.valueKobo, { duration: 900, format: (n) => amtText(Math.round(n)) });
    } else hero.paint(amtText(sum.valueKobo));
    heroPlayed = true;
    const statement = h('section', { class: 'panel statement', 'aria-label': 'Portfolio statement' },
      h('p', { class: 'statement-label' }, `Total value today · ${plural(sum.count.active, 'investment', 'investments')}`), heroBtn,
      h('p', { class: 'sub statement-sub' }, pill(sum.netGainKobo, sum.roi), ' overall, counting income and anything already sold'),
      quickActions(ctx, items),
      growth,
      h('dl', { class: 'statement-line' },
        stat('Money put in', amt(sum.investedKobo + sum.costsKobo)), stat('Income received', amt(sum.incomeKobo)),
        stat('Sold or repaid', amt(sum.proceedsKobo + sum.repaidKobo)), stat('Net gain', amt(sum.netGainKobo, { sign: true }), tone(sum.netGainKobo))));

    // allocation by category
    const byCat = new Map();
    for (const it of items) if (!it.error && it.metrics.valueKobo > 0) { const c = ctx.cat(it.investment.categoryId); byCat.set(c.name, (byCat.get(c.name) || 0) + it.metrics.valueKobo); }
    const segs = [...byCat].map(([label, valueKobo]) => ({ label, valueKobo })).sort((a, b) => b.valueKobo - a.valueKobo);
    let allocPanel = null;
    if (segs.length) {
      const total = segs.reduce((t, s) => t + s.valueKobo, 0);
      const dn = donut({ segments: segs, centre: amtText(total), formatValue: (k) => amtText(k), description: `Donut chart of current value by category: ${segs.map((s) => `${s.label} ${pct(s.valueKobo / total, { dp: 0 })}`).join(', ')}.` });
      const legend = h('ul', { class: 'rows' }, segs.map((s, i) => {
        const li = h('li', {}, h('div', { class: 'row-line', tabindex: '0' }, h('span', { class: `swatch ${segmentClass(i)}` }),
          h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, s.label)),
          h('div', { class: 'row-end' }, h('span', { class: 'money' }, amt(s.valueKobo)), h('span', { class: 'row-sub' }, pct(s.valueKobo / total, { dp: 1 })))));
        const line = li.firstChild;
        for (const [ev, v] of [['mouseenter', i], ['focus', i], ['mouseleave', null], ['blur', null]]) line.addEventListener(ev, () => dn.highlight(v));
        return li;
      }));
      allocPanel = h('section', { class: 'panel' }, sectionHead('Where it is held'), h('div', { class: 'alloc' }, dn, legend));
    }

    // coming up
    const comingPanel = h('section', { class: 'panel' }, sectionHead('Coming up', h('a', { class: 'link-btn', href: '#/reminders' }, 'Reminders')),
      up.length ? h('ul', { class: 'rows' }, up.slice(0, 6).map((u) => h('li', {}, h('a', { class: 'row-line', href: `#/investments/${u.investmentId}` },
        h('span', { class: `date-col${u.overdue ? ' overdue' : ''}` }, fmtDate(u.date)),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, u.title), u.investmentName && h('div', { class: 'row-sub' }, u.investmentName)),
        u.amountKobo != null && h('div', { class: 'row-end' }, signed(u.kind === 'cost' ? -u.amountKobo : u.amountKobo), h('span', { class: 'row-sub' }, 'expected'))))))
        : miniEmpty('calendar', 'Nothing expected in the next 45 days. Rent, costs and reminders you set up will show here.'));

    // recent activity
    const recentPanel = h('section', { class: 'panel' }, sectionHead('Recent activity'),
      rec.length ? h('ul', { class: 'rows' }, rec.map((e) => h('li', {}, h('a', { class: 'row-line', href: `#/investments/${e.investmentId}` },
        h('span', { class: 'date-col' }, fmtDate(e.date)),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, KIND[e.kind][0]), h('div', { class: 'row-sub' }, e.investmentName)),
        h('div', { class: 'row-end' }, signed(KIND[e.kind][1] * e.amountKobo)))))) : miniEmpty('list', 'No activity yet. Entries you add show up here.'));

    const out = h('div', { class: 'flow', 'data-noenter': '1' }, heading, ...notes, rise(setup, 0),
      h('div', { class: 'dash' },
        h('div', { class: 'dash-main' }, rise(statement, 0), rise(investmentStrip(ctx, items), 1)),
        h('div', { class: 'dash-side' }, rise(allocPanel, 1), rise(comingPanel, 2)),
        h('div', { class: 'dash-wide' }, rise(recentPanel, 3))));
    return out;
  }

  // ---------- Investments list ----------
  async function listView(ctx) {
    const asOf = todayISO();
    const items = await ctx.pf.overview(asOf);
    const head = h('div', { class: 'page-actions' }, h('h1', { class: 'page-title' }, 'Investments'), addLink());
    if (!items.length) return h('div', { class: 'flow' }, h('h1', { class: 'page-title' }, 'Investments'), firstRun(ctx, 'list')); // same first-run card as Home, with its own buttons
    let filter = 'all', query = '', first = true;
    const listBox = h('div', {});
    const seg = h('div', { class: 'seg seg--slide', role: 'group', 'aria-label': 'Filter' });
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search by name or category', 'aria-label': 'Search investments' });
    const clear = () => { filter = 'all'; query = ''; search.value = ''; draw(); };
    const noMatch = () => {
      const q = query.trim();
      const text = q ? `No investments match “${q}”.` : filter === 'closed' ? 'None of your investments are closed yet.' : 'No active investments right now.';
      return h('div', { class: 'mini-empty mini-empty--action' }, icon('search', { size: 20 }), h('span', {}, text), h('button', { class: 'link-btn', type: 'button', onclick: clear }, 'Show everything'));
    };
    const draw = () => {
      const q = query.trim().toLowerCase();
      const shown = items.filter((it) => {
        const closed = !it.error && it.metrics.basis === 'realized';
        if (filter === 'active' && closed) return false; if (filter === 'closed' && !closed) return false;
        return !q || `${it.investment.name} ${ctx.cat(it.investment.categoryId).name}`.toLowerCase().includes(q);
      });
      const isClosed = (it) => !it.error && it.metrics.basis === 'realized';
      const worth = (it) => (it.error ? -1 : Number(it.metrics.currentValueKobo));
      shown.sort((x, y) => (isClosed(x) - isClosed(y)) || (worth(y) - worth(x))); // open ones first, biggest first
      const ul = shown.length ? h('ul', { class: 'rows' }, shown.map((it, n) => {
        const inv = it.investment, c = ctx.cat(inv.categoryId), m = it.metrics;
        const li = h('li', {}, h('a', { class: 'row-line', href: `#/investments/${inv.id}` },
          h('span', { class: `tile ${tintOf(inv.categoryId)}` }, icon(c.icon)), // a photo can replace the icon here later
          h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, inv.name, m?.basis === 'realized' && h('span', { class: 'chip' }, 'Closed')),
            h('div', { class: 'row-sub' }, m?.basis === 'realized' ? `${c.name}, closed ${fmtDate(inv.closedOn || m.asOf)}` : `${c.name}, since ${fmtMonthYear(inv.openedOn)}`)),
          it.error ? h('div', { class: 'row-end' }, h('span', { class: 'row-sub overdue' }, 'Cannot be calculated'))
            : h('div', { class: 'row-end' }, h('span', { class: 'money' }, amt(m.currentValueKobo)), pillPct(m.netGainKobo, m.roi))));
        if (first) rise(li, Math.min(n, 8) * 0.6);
        return li;
      })) : noMatch();
      listBox.replaceChildren(ul);
      first = false;
      [...seg.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === filter)));
    };
    [['all', 'All'], ['active', 'Active'], ['closed', 'Closed']].forEach(([f, l]) => seg.append(h('button', { type: 'button', 'data-f': f, 'aria-pressed': 'false', onclick: () => { filter = f; draw(); } }, l)));
    slideThumb(seg);
    search.addEventListener('input', () => { query = search.value; draw(); });
    draw();
    const addCard = items.length <= 3 ? h('a', { class: 'add-card', href: '#/new' }, h('span', { class: 'add-card-plus' }, icon('plus')),
      h('span', {}, h('strong', {}, 'Add another investment'), h('span', { class: 'sub' }, 'Land, rent, treasury bills, a car, a partnership and more.'))) : null;
    return h('div', { class: 'flow' }, head, h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search'), search), seg), h('div', { class: 'panel panel--flush' }, listBox), addCard);
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
    const hero = heroAmount();
    hero.paint(amtText(m.currentValueKobo));
    const heroValue = h('button', { class: 'hero-btn money', type: 'button', 'aria-label': `${closed ? 'Sold for' : 'Worth'}. Press to switch between short and full amount.` }, hero.el);
    heroValue.addEventListener('click', () => { full = !full; hero.paint(amtText(m.currentValueKobo, { compact: !full })); });

    const ann = m.annualized;
    const annText = ann.rate == null ? 'Not available yet' : `${pct(ann.rate)} a year`;
    const head = h('section', { class: 'panel statement' },
      h('div', { class: 'detail-head' }, h('span', { class: 'tile tile--large' }, icon(c.icon, { size: 28 })), // photo slot: an image can replace the icon later
        h('div', {}, h('h1', { class: 'page-title' }, inv.name), h('p', { class: 'sub' }, `${c.name}, ${closed ? 'closed' : 'active'} since ${fmtMonthYear(inv.openedOn)}`))),
      h('p', { class: 'statement-label' }, closed ? 'Sold for' : 'Worth today'), heroValue,
      h('p', { class: 'sub' }, basisText),
      h('p', { class: 'sub statement-sub' }, pill(m.netGainKobo, m.roi), ' in total, counting income and costs'),
      h('dl', { class: 'statement-line' }, stat('Invested', amt(m.investedKobo)), stat('Costs', amt(m.costsKobo)), stat('Income received', amt(m.incomeKobo)), stat('Held for', plural(m.daysHeld, 'day', 'days'))));

    const returns = h('dl', { class: 'defs' },
      h('dt', {}, 'Return on investment'), h('dd', { class: 'money' }, pct(m.roi)),
      h('dt', {}, 'Annualized return'), h('dd', { class: 'money' }, annText, ann.method && h('span', { class: 'sub' }, ` (${ann.method === 'cagr' ? 'CAGR' : 'XIRR'})`), ann.shortHold && ann.rate != null && h('div', { class: 'sub' }, 'Held for under a year, so treat this as a rough guide.')),
      m.yield.rate != null && m.yield.trailing12mNetIncomeKobo !== 0 && [h('dt', {}, 'Income yield, last 12 months'), h('dd', { class: 'money' }, pct(m.yield.rate))]);

    const working = h('details', { class: 'working' }, h('summary', {}, 'How this is calculated'), h('ul', {},
      h('li', {}, `Days are actual calendar days, counted from the first money put in to ${closed ? 'the closing date' : 'today'}. Years are days divided by 365.`),
      h('li', {}, m.valueSource === 'valuation' ? 'Worth is your latest valuation, used exactly as entered.' : m.valueSource === 'assumed' ? 'Worth is the money put in, grown or reduced by the rates under Details, over the actual days.' : closed ? 'Worth is the sale proceeds you recorded.' : 'Worth is what you paid, because no valuation or rate is set.'),
      h('li', {}, `Net gain = ${money(m.totalValueKobo, { compact: false })} (worth, sale proceeds and loan repayments) + ${money(m.incomeKobo, { compact: false })} (income) − ${money(m.investedKobo, { compact: false })} (invested) − ${money(m.costsKobo, { compact: false })} (costs) = ${money(m.netGainKobo, { compact: false })}.`),
      h('li', {}, `Return on investment = net gain ÷ (invested + costs) = ${pct(m.roi)}.`),
      ann.method === 'cagr' && h('li', {}, 'Annualized return (CAGR) is the yearly rate that turns the money invested into the final value over the days held.'),
      ann.method === 'xirr' && h('li', {}, 'Annualized return (XIRR) is the yearly rate at which every dated payment in and out balances to zero.')),
      h('p', { class: 'working-more' }, helpLink('numbers', 'Reading your numbers, with a worked example')));

    const due = b.schedules.filter((x) => x.status === 'active' && !closed).reduce((n, x) => n + dueUnrecorded(x, b.entries, asOf).length, 0);
    const reminders = b.reminders.filter((r) => !r.done).sort((x, y) => (x.dueDate < y.dueDate ? -1 : 1));
    // tabs
    const panels = {};
    panels.overview = () => h('div', { class: 'flow' }, due > 0 && h('a', { class: 'note-box note-box--link', href: `#/investments/${inv.id}/schedule` }, `${plural(due, 'regular payment is', 'regular payments are')} due and not in your ledger yet. Record ${due === 1 ? 'it' : 'them'}.`), returns,
      b.valuations.length > 0 && h('section', {}, sectionHead('Valuations'), h('ul', { class: 'rows' }, [...b.valuations].reverse().map((v) => h('li', {}, h('a', { class: 'row-line', href: `#/investments/${inv.id}/valuation/${v.id}` },
        h('span', { class: 'date-col' }, fmtDate(v.date)), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, `By ${SOURCE[v.source]}`), v.note && h('div', { class: 'row-sub' }, v.note)),
        h('div', { class: 'row-end' }, h('span', { class: 'money' }, amt(v.valueKobo)))))))),
      (b.schedules.length > 0 || (!closed && inv.behaviors.income !== 'none')) && h('section', {}, sectionHead('Regular payments', h('a', { class: 'link-btn', href: `#/investments/${inv.id}/schedule${b.schedules.length ? '' : '/new'}` }, b.schedules.length ? 'Manage' : 'Add one')), b.schedules.length > 0 && h('ul', { class: 'rows' }, b.schedules.map((s) => h('li', {}, h('a', { class: 'row-line', href: `#/investments/${inv.id}/schedule/${s.id}` }, h('div', { class: 'row-main' }, scheduleSentence(s))))))),
      h('section', {}, sectionHead('Reminders', h('a', { class: 'link-btn', href: `#/reminders/new/${inv.id}` }, 'Add')), reminders.length ? h('ul', { class: 'rows' }, reminders.map((r) => h('li', {}, h('a', { class: 'row-line', href: `#/reminders/${r.id}` }, h('span', { class: `date-col${r.dueDate < asOf ? ' overdue' : ''}` }, fmtDate(r.dueDate)), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, r.text)))))) : h('p', { class: 'sub' }, 'No reminders for this investment.')),
      working);
    panels.ledger = () => h('div', { class: 'flow' }, b.entries.length ? h('ul', { class: 'rows' }, [...b.entries].reverse().map((e) => h('li', {}, h('a', { class: 'row-line', href: `#/investments/${inv.id}/entry/${e.id}` },
      h('span', { class: 'date-col' }, fmtDate(e.date)), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, KIND[e.kind][0]), e.note && h('div', { class: 'row-sub' }, e.note)),
      h('div', { class: 'row-end' }, signed(KIND[e.kind][1] * e.amountKobo)))))) : emptyBlock({ iconName: 'list', title: 'Nothing in the ledger yet', text: closed ? 'This investment is closed, so there is nothing to add. Reopen it if you need to record more.' : 'Every payment into or out of this investment is listed here, newest first. Add the first one to get started.',
        actions: !closed && h('a', { class: 'btn', href: `#/investments/${inv.id}/entry` }, icon('plus'), 'Add entry'), help: { topic: 'income-costs', text: 'How entries work' } }),
      b.entries.length > 0 && h('p', { class: 'sub' }, `${plural(b.entries.length, 'entry', 'entries')}. Money leaving you shows as minus and money reaching you as plus. Open an entry to edit or delete it.`));
    panels.people = () => {
      const name = (pid) => (pid === 'me' ? 'You' : b.partners.find((p) => p.id === pid)?.name || 'Partner');
      const mine = partners.partners.find((p) => p.partnerId === 'me');
      return h('div', { class: 'flow' }, h('div', { class: 'row' }, h('a', { class: 'btn btn--secondary btn--small', href: `#/investments/${inv.id}/shares` }, 'Change who shares it')), h('div', { class: 'scroll-x' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['Who', 'Put in', 'Share', 'Worth', 'Income', 'Net gain'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, partners.partners.map((p) => h('tr', {}, h('td', {}, name(p.partnerId)), h('td', {}, amt(p.contributionKobo)), h('td', {}, pct(p.ownershipBp / 10000, { dp: 0 })),
          h('td', {}, amt(p.valueShareKobo)), h('td', {}, amt(p.incomeShareKobo)), h('td', { class: tone(p.netGainKobo) }, amt(p.netGainKobo, { sign: true }))))))),
      mine && h('p', { class: 'sub' }, `Your own position, after what you put in: ${money(mine.netPositionKobo, { compact: false, sign: true })}.`));
    };
    panels.details = () => {
      const defs = c.customFieldDefs || [], rows = [
        ['Category', c.name], ['Status', closed ? 'Closed' : 'Active'], ['Opened', fmtDate(inv.openedOn)], inv.closedOn && ['Closed', fmtDate(inv.closedOn)],
        inv.behaviors.term && ['Matures', fmtDate(inv.behaviors.term.maturityDate)], ['Value', VALUE_CHANGE[inv.behaviors.valueChange]],
        ...inv.rates.map((rt, i) => [i === 0 ? 'Rates' : '', rateSentence(inv, rt)]),
        ...Object.entries(inv.customFields).map(([k, v]) => [defs.find((d) => d.key === k)?.label || k, v == null ? '' : String(v)]),
      ].filter(Boolean);
      return h('div', { class: 'flow' }, h('div', { class: 'row' }, h('a', { class: 'btn btn--secondary btn--small', href: `#/investments/${inv.id}/edit` }, 'Edit details'), h('a', { class: 'btn btn--secondary btn--small', href: `#/investments/${inv.id}/history` }, 'Change history')), h('dl', { class: 'defs' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
        inv.notes && h('section', {}, sectionHead('Notes'), h('p', { class: 'prose' }, inv.notes)),
        h('section', {}, sectionHead('Delete'), h('p', { class: 'sub' }, 'Deleting hides this investment and everything recorded under it. You can undo it straight afterwards.'),
          h('div', { class: 'row row--actions' }, h('button', { class: 'btn btn--secondary btn--danger', type: 'button', onclick: () => deleteInvestment(ctx, inv) }, 'Delete this investment'))));
    };
    const tabsList = [['overview', 'Overview'], ['ledger', 'Ledger'], partners && ['people', 'People'], ['details', 'Details']].filter(Boolean);
    const body = h('div', { role: 'tabpanel' });
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    const pick = (key) => { const panel = panels[key](); panel.classList.add('fade-in'); body.replaceChildren(panel); [...tabs.children].forEach((t) => t.setAttribute('aria-selected', String(t.dataset.k === key))); };
    tabsList.forEach(([k, l]) => tabs.append(h('button', { type: 'button', role: 'tab', 'data-k': k, 'aria-selected': 'false', onclick: () => pick(k) }, l)));
    pick('overview');
    indicator(tabs, '[aria-selected="true"]');
    const actionsRow = h('div', { class: 'row row--actions' }, closed
      ? h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => reopen(ctx, inv.id) }, 'Reopen this investment')
      : [h('a', { class: 'btn', href: `#/investments/${inv.id}/entry` }, icon('plus'), 'Add entry'), h('a', { class: 'btn btn--secondary', href: `#/investments/${inv.id}/valuation` }, 'Add valuation'), h('a', { class: 'btn btn--secondary', href: `#/investments/${inv.id}/close` }, 'Close'), h('a', { class: 'btn btn--secondary', href: `#/investments/${inv.id}/edit` }, 'Edit'), h('a', { class: 'btn btn--secondary', href: `#/projections/${inv.id}` }, 'Look ahead')]);
    return h('div', { class: 'flow' }, h('a', { class: 'back', href: '#/investments' }, icon('chevronLeft', { size: 18 }), 'Investments'), head, actionsRow, tabs, body);
  }

  // ---------- Settings ----------
  async function settingsView(ctx) {
    const sample = await sampleLive(ctx.store);
    const who = settings.displayName || String(email || '').split('@')[0] || 'You';
    const name = h('input', { class: 'input', id: 'displayName', value: settings.displayName, maxlength: 80, autocomplete: 'name', placeholder: 'How should Apex greet you?' });
    const pname = h('input', { class: 'input', id: 'portfolioName', value: settings.portfolioName, maxlength: 80, placeholder: 'For example, My assets' });
    const saved = h('p', { class: 'hint', role: 'status' });
    const profile = h('form', { class: 'stack', novalidate: true },
      h('div', { class: 'field' }, h('label', { for: 'displayName' }, 'Your name'), name),
      h('div', { class: 'field' }, h('label', { for: 'portfolioName' }, 'Portfolio name'), pname, h('p', { class: 'hint' }, 'Shown on your dashboard.')),
      h('button', { class: 'btn', type: 'submit', hidden: true }, 'Save changes'), saved);
    const saveBtn = profile.querySelector('button[type=submit]');
    let base = { n: settings.displayName || '', p: settings.portfolioName || '' };
    const sync = () => { saveBtn.hidden = name.value === base.n && pname.value === base.p; if (!saveBtn.hidden) saved.textContent = ''; };
    name.addEventListener('input', sync); pname.addEventListener('input', sync);
    profile.addEventListener('submit', async (e) => {
      e.preventDefault();
      await withBusy(profile.querySelector('button[type=submit]'), async () => {
        settings = await ctx.pf.updateSettings({ displayName: name.value, portfolioName: pname.value });
        paintChrome('settings');
        base = { n: settings.displayName || '', p: settings.portfolioName || '' };
        saveBtn.hidden = true; saved.textContent = 'Saved.';
      });
    });

    // theme: three preview cards. The switch reveals outward from the card you pressed.
    const themeOpts = h('div', { class: 'theme-opts', role: 'group', 'aria-label': 'Theme' },
      [['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => {
        const b = h('button', { type: 'button', class: 'theme-opt', 'aria-pressed': String(v === settings.theme) },
          h('span', { class: `theme-prev theme-prev--${v}`, 'aria-hidden': 'true' }, h('i', {}), h('i', {}), h('i', {})), h('span', {}, l));
        b.addEventListener('click', async () => {
          [...themeOpts.children].forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          await applyTheme(v, b);
          settings = await ctx.pf.updateSettings({ theme: v });
        });
        return b;
      }));
    // text size: a four-stop slider with a preview that resizes as you drag. The size is saved when you let go.
    const SIZES = [[90, 'Smaller'], [100, 'Standard'], [115, 'Larger'], [130, 'Largest']];
    const prevName = h('span', { class: 'size-preview-name' }), prevPct = h('span', {});
    const prev = h('div', { class: 'size-preview', 'aria-hidden': 'true' },
      h('p', { class: 'size-preview-top' }, prevName, prevPct),
      h('p', { class: 'size-preview-amount money' }, '₦18,500,000', h('span', { class: 'dec' }, '.00')),
      h('p', { class: 'size-preview-text' }, 'Your rent for this year has been received.'));
    const paintPreview = ([v, name]) => { prev.style.setProperty('--pv', String(v / 100)); prevName.textContent = name; prevPct.textContent = `${v}%`; };
    const slider = stepSlider({ label: 'Text size', stops: SIZES, value: settings.textScale || 100, hint: 'Drag to preview. The size applies everywhere when you let go.',
      onPreview: paintPreview,
      onChange: async ([v]) => { try { settings = await ctx.pf.updateSettings({ textScale: v }); applyAppearance(); } catch (e) { toast('Could not save the text size.'); console.error(e); } } });
    paintPreview(slider.current());
    const scale = h('div', { class: 'size-control' }, slider.el, prev);
    const hide = h('input', { type: 'checkbox', id: 'hide' }); hide.checked = !!settings.hideAmounts;
    hide.addEventListener('change', async () => { settings = await ctx.pf.updateSettings({ hideAmounts: hide.checked }); applyAppearance(); flashAmounts(); paintChrome('settings'); });
    const sampleBtn = sample ? h('button', { class: 'btn btn--secondary', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => removeSample(ctx)) }, 'Remove the sample portfolio') : sampleButton(ctx);

    return h('div', { class: 'settings flow' }, h('h1', { class: 'page-title' }, 'Settings'),
      h('div', { class: 'settings-grid' },
        h('div', { class: 'settings-col' },
          h('section', { class: 'panel' }, h('div', { class: 'profile-head' }, h('span', { class: 'avatar avatar--lg', 'aria-hidden': 'true' }, initials(who)), h('div', {}, h('h2', {}, 'Profile'), h('p', { class: 'sub' }, email))), profile),
          h('section', { class: 'panel stack' }, h('h2', {}, 'Appearance'), themeOpts, scale,
            h('label', { class: 'check check--switch', for: 'hide' }, hide, h('span', {}, 'Hide amounts on screen (percentages stay visible). You can also use the eye at the top.'))),
          h('section', { class: 'panel stack' }, h('h2', {}, 'Sample portfolio'), h('p', { class: 'sub' }, sample ? 'The sample portfolio is on this device. It is made up and can be removed without touching your own records.' : 'Adds a made-up portfolio (land, a rental flat, a car, a treasury bill and a partnership) so you can explore Apex before adding real records.'), sampleBtn)),
        h('div', { class: 'settings-col' },
          h('section', { class: 'panel stack' }, h('h2', {}, 'Your records'), h('p', { class: 'sub' }, 'Reminders you have set, and anything you deleted that can still be brought back.'),
            h('div', { class: 'row' }, h('a', { class: 'btn btn--secondary', href: '#/reminders' }, 'Reminders'), h('a', { class: 'btn btn--secondary', href: '#/deleted' }, 'Recently deleted'))),
          h('section', { class: 'panel stack' }, h('h2', {}, 'Look ahead, export and print'), h('p', { class: 'sub' }, 'Try a what-if rate on an investment, download your records for a spreadsheet, or print a clean statement.'),
            h('div', { class: 'row' }, h('a', { class: 'btn btn--secondary', href: '#/projections' }, 'Projections'), h('a', { class: 'btn btn--secondary', href: '#/export' }, 'Export and print'))),
          h('section', { class: 'panel stack' }, h('h2', {}, 'Help'), h('p', { class: 'sub' }, 'Short guides in plain words, a glossary, and answers to what people ask most.'),
            h('div', { class: 'row' }, h('a', { class: 'btn', href: HELP_ROUTE.home }, icon('book'), 'How to use Apex'), h('a', { class: 'btn btn--secondary', href: HELP_ROUTE.faq }, 'Common questions'))),
          actions.sync && syncPanel({ sync: actions.sync, toast, actions }),
          h('section', { class: 'panel stack' }, h('h2', {}, 'Security'), h('p', { class: 'sub' }, `Signed in as ${email}. Records are encrypted on this device and locked after 2 minutes of inactivity.`),
            h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: actions.onLock }, 'Lock now'), h('button', { class: 'btn btn--secondary', type: 'button', onclick: actions.onSetPin }, 'Set or change PIN')),
            h('div', { class: 'row' }, h('button', { class: 'btn btn--secondary', type: 'button', onclick: actions.onCheckKey }, 'Check my recovery key'))),
          h('section', { class: 'panel stack' }, h('h2', {}, 'Account'), h('p', { class: 'sub' }, 'Signing out keeps your encrypted records on this device, so Apex opens quickly next time. You will still need your password or recovery key to open them. Before signing out, Apex backs up any changes it can.'),
            h('div', { class: 'row' }, h('button', { class: 'btn btn--secondary', type: 'button', onclick: actions.onSignOut }, 'Sign out'))),
          h('section', { class: 'panel panel--danger stack' }, h('h2', {}, 'Danger zone'), h('p', { class: 'sub' }, 'Replaces your current recovery key with a new one. Save the new key somewhere safe straight away.'),
            h('div', { class: 'row' }, h('button', { class: 'btn btn--danger', type: 'button', onclick: actions.onRotateKey }, 'Create a new recovery key')),
            h('p', { class: 'sub' }, 'Deletes the copy of your records stored in this browser and signs you out, for example on a shared computer. Apex first checks that everything is backed up online; signing in again brings it all back.'),
            h('div', { class: 'row' }, h('button', { class: 'btn btn--danger', type: 'button', onclick: actions.onWipe }, 'Remove my data from this device'))))));
  }

  // ---------- Help ----------
  async function helpScreen(ctx, parts) {
    const [invs, ids] = await Promise.all([ctx.pf.investments(), ctx.store.meta.get('sampleIds')]);
    const mine = new Set((ids && ids.investments) || []);
    return helpView({
      parts, shortcut,
      investments: invs.map((i) => ({ id: i.id, name: i.name, status: i.status, sample: mine.has(i.id) })),
      sample: { live: !!ids, ids: ids || { investments: [] } },
      addSample: (button) => addSample(ctx, button, { stay: true }),
      openSearch: () => showPalette(),
    });
  }

  // ---------- search and commands (Ctrl+K) ----------
  async function toggleHide() {
    try { const ctx = await load(); settings = await ctx.pf.updateSettings({ hideAmounts: !settings.hideAmounts }); applyAppearance(); flashAmounts(); if (location.hash.startsWith('#/new')) paintChrome('investments'); else render(); } catch (e) { console.error(e); }
  }
  async function showAmounts() { if (settings?.hideAmounts) await toggleHide(); }
  async function paletteItems() {
    const ctx = ctxCache || await load();
    const [invs, dismissed] = await Promise.all([ctx.pf.investments(), ctx.store.meta.get('setupDismissed')]);
    const dark = currentTheme() === 'dark', hidden = !!settings?.hideAmounts;
    const cmd = (group, label, ic, run, keywords = '', sub = '') => ({ group, label, icon: ic, run, keywords, sub });
    const list = [
      cmd('Actions', 'Add an investment', 'plus', () => go('#/new'), 'new create buy record'),
      cmd('Actions', hidden ? 'Show amounts' : 'Hide amounts', hidden ? 'eye' : 'eyeOff', toggleHide, 'privacy blur money balance'),
      cmd('Actions', dark ? 'Switch to the light theme' : 'Switch to the dark theme', dark ? 'sun' : 'moon', () => flipTheme(themeBtn), 'appearance mode night day'),
      cmd('Actions', 'Lock Apex now', 'lock', actions.onLock, 'secure'),
      cmd('Actions', 'Set or change PIN', 'key', actions.onSetPin, 'passcode unlock'),
      cmd('Actions', 'Check my recovery key', 'shield', actions.onCheckKey, 'backup'),
      actions.sync && cmd('Actions', 'Back up now', 'check', () => actions.sync.run().then((s) => toast(s.state === 'synced' && !s.pending ? 'Backed up.' : 'Could not finish backing up. See Settings.')), 'sync save cloud online'),
      actions.exportBackup && cmd('Actions', 'Download a backup file', 'download', async () => { try { const f = await actions.exportBackup(); downloadText(f.filename, f.text); toast('Backup file saved.'); } catch { toast('Could not create the backup file.'); } }, 'export save copy'),
      dismissed && cmd('Actions', 'Show the setup checklist', 'checkCircle', async () => { await ctx.store.meta.set('setupDismissed', null); if (location.hash === '#/' || location.hash === '') render(); else go('#/'); }, 'getting started onboarding'),
      cmd('Go to', 'Home', 'home', () => go('#/'), 'dashboard overview'),
      cmd('Go to', 'Investments', 'list', () => go('#/investments'), 'list all'),
      cmd('Go to', 'Projections', 'chart', () => go('#/projections'), 'look ahead what if future forecast scenario'),
      cmd('Go to', 'Export and print', 'download', () => go('#/export'), 'csv spreadsheet excel download save'),
      cmd('Go to', 'Printable statement', 'doc', () => go('#/statement'), 'print pdf report statement'),
      cmd('Go to', 'Reminders', 'calendar', () => go('#/reminders'), 'dates due remind tax lease'),
      cmd('Go to', 'Recently deleted', 'undo', () => go('#/deleted'), 'restore trash bin removed'),
      cmd('Go to', 'Settings', 'sliders', () => go('#/settings'), 'profile appearance security text size'),
      cmd('Go to', 'How to use Apex', 'book', () => go(HELP_ROUTE.home), 'help guide tutorial learn start glossary questions faq'),
    ].filter(Boolean);
    for (const it of helpSearchItems()) list.push({ group: it.group, label: it.label, sub: it.sub, icon: it.icon, keywords: it.keywords, searchOnly: true, run: () => go(it.hash) });
    const closedOf = (i) => i.status === 'closed';
    for (const inv of [...invs].sort((a, b) => (closedOf(a) - closedOf(b)) || a.name.localeCompare(b.name))) {
      const c = ctx.cat(inv.categoryId);
      list.push({ group: 'Investments', label: inv.name, sub: `${c.name}${closedOf(inv) ? ', closed' : ''}`, icon: c.icon, keywords: c.name, run: () => go(`#/investments/${inv.id}`) });
    }
    return list;
  }
  function showPalette() {
    if (root.classList.contains('is-focus')) return; // in the middle of a form: do not jump away from it
    if (!isPaletteOpen() && document.documentElement.classList.contains('dialog-open')) return;
    openPalette({ load: paletteItems, isAlive: () => root.isConnected });
  }
  const keyHandler = (e) => {
    if (!root.isConnected) { document.removeEventListener('keydown', keyHandler); return; }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'k') { e.preventDefault(); showPalette(); }
  };
  document.addEventListener('keydown', keyHandler);

  // ---------- routing ----------
  async function render() {
    const mine = ++token;
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const page = parts[0] || 'home';
    const key = page === 'investments' || page === 'new' || page === 'projections' ? 'investments' : page === 'settings' || page === 'help' || page === 'deleted' || page === 'export' || page === 'statement' ? 'settings' : 'home';
    paintChrome(key);
    // Adding or editing a record is a focused task: on phones the tab bar steps aside so the form has the screen.
    root.classList.toggle('is-focus', page === 'new' || (page === 'investments' && parts.length >= 3) || (page === 'reminders' && parts.length >= 2));
    outlet.setAttribute('aria-busy', 'true');
    // The skeleton only appears if loading takes a moment, so quick pages do not flash.
    const wait = setTimeout(() => { if (mine === token) outlet.replaceChildren(skeletonFor(key)); }, 140);
    try {
      const ctx = await load();
      ctxCache = ctx;
      let view;
      if (page === 'new') view = await newView(ctx);
      else if ((page === 'investments' && parts[1] && ['edit', 'schedule', 'history', 'shares'].includes(parts[2])) || page === 'reminders' || page === 'deleted') view = await manageView({ ctx, toast, go, actions }, parts);
      else if (page === 'projections' || page === 'export' || page === 'statement') view = await reportView({ ctx, toast, go, showAmounts }, parts);
      else if (page === 'investments' && parts[1] && parts[2]) view = await recordFormView({ ctx, invId: parts[1], kind: parts[2], recordId: parts[3], today: todayISO(), toast, go });
      else if (page === 'investments' && parts[1]) view = await detailView(ctx, parts[1]);
      else if (page === 'investments') view = await listView(ctx);
      else if (page === 'settings') view = await settingsView(ctx);
      else if (page === 'help') view = await helpScreen(ctx, parts);
      else view = await homeView(ctx);
      if (mine !== token) return;
      paintChrome(key);
      outlet.replaceChildren(view);
      if (!view.dataset?.noenter) enter(view);
      window.scrollTo(0, 0);
    } catch (e) {
      if (mine !== token || (e instanceof StoreError && e.code === 'LOCKED')) return;
      outlet.replaceChildren(h('p', { class: 'alert alert--error', role: 'alert' }, e instanceof StoreError || e.code === 'INVALID' ? e.message : 'Something went wrong while reading your records. Reload the page and try again.'));
      console.error(e);
    } finally {
      clearTimeout(wait);
      if (mine === token) outlet.removeAttribute('aria-busy');
    }
  }
  hideBtn.addEventListener('click', toggleHide);
  hashHandler = () => { if (!root.isConnected) { window.removeEventListener('hashchange', hashHandler); return; } render(); };
  window.addEventListener('hashchange', hashHandler);
  if (!location.hash.startsWith('#/')) history.replaceState(null, '', '#/');
  render();
  return root;
}
