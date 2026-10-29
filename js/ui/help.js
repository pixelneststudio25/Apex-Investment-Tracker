// The Help section: a home page, one short page per topic, a glossary and a list of questions.
// All the words live in js/models/help-content.js. This file only arranges them, using the app's own classes,
// so Help always looks like the rest of Apex (serif titles, soft cards, the green accent, both themes).
// No innerHTML and no inline styles (the site's security policy forbids both).
//
//   helpView({ parts, investments, sample, shortcut, addSample, openSearch }) -> element
//   parts: the route after "#/", for example ['help'], ['help', 'numbers'], ['help', 'glossary', 'roi']
import { h } from './dom.js';
import { backToOrigin } from './nav.js';
import { icon } from './icons.js';
import { fmtDate } from './fmt.js';
import { prefersReducedMotion } from './motion.js';
import { formatNaira, formatPercent } from '../engine/index.js';
import { BUILT_IN_TEMPLATES } from '../models/templates.js';
import {
  EXAMPLE, FAQ, GLOSSARY, HELP_HOME, HELP_ROUTE, LEDGER_KINDS, TOPICS,
  faqById, resolveTry, sampleHref, termById, topicById,
} from '../models/help-content.js';

const toneOf = (n) => (n > 0 ? 'gain' : n < 0 ? 'loss' : 'flat');
const byTerm = (a, b) => a.term.localeCompare(b.term);

// ---------- small pieces ----------
const backLink = (text, href) => h('a', { class: 'back', href }, icon('chevronLeft', { size: 18 }), text);
const sectionHead = (title, right) => h('div', { class: 'section-head' }, h('h2', {}, title), right);
const chipLink = (text, href) => h('a', { class: 'help-chip', href }, text);
const missing = (title, text) => h('div', { class: 'flow help' }, backLink('Help', HELP_ROUTE.home),
  h('div', { class: 'empty' }, h('span', { class: 'empty-art' }, icon('search', { size: 30 })), h('h2', {}, title), h('p', {}, text),
    h('div', { class: 'row' }, h('a', { class: 'btn', href: HELP_ROUTE.home }, 'Back to Help'))));

// Scrolls a linked entry into view once the page is on screen (instantly when the person prefers less motion).
function reveal(el) {
  if (!el) return;
  setTimeout(() => { try { el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }); } catch { /* old browser */ } }, 80);
}

// ---------- mock-ups ----------
// Small pictures built from the app's real classes, so they match the design in both themes. They are decoration
// for the steps beside them (which carry the same facts in words), so they are hidden from screen readers and inert.
function mockFrame(body, caption) {
  return h('figure', { class: 'help-mock' },
    h('div', { class: 'help-mock-body', 'aria-hidden': 'true', inert: true }, body),
    h('figcaption', {}, caption || 'An example, not your own records.'));
}

const MOCKS = {
  checklist(spec, topic) {
    const steps = topic.steps, done = spec.done || 0;
    const bar = h('div', { class: 'setup-bar' }, h('i', {}));
    bar.style.setProperty('--p', String(done / steps.length));
    return h('div', { class: 'panel help-panel-mock' }, bar,
      h('ul', { class: 'setup-steps' }, steps.map((s, i) => h('li', { class: `setup-step${i < done ? ' is-done' : ''}` },
        h('span', { class: 'setup-check' }, i < done && icon('check', { size: 16 })),
        h('div', { class: 'setup-text' }, h('p', { class: 'setup-title' }, s.title))))));
  },

  categories(spec) {
    const picks = spec.ids.map((id) => BUILT_IN_TEMPLATES.find((t) => t.id === id)).filter(Boolean);
    return h('div', { class: 'cat-grid help-cats' }, picks.map((t) => h('div', { class: 'cat', 'aria-pressed': String(t.id === spec.selected) },
      h('span', { class: 'tile' }, icon(t.icon)), h('span', { class: 'cat-name' }, t.name))));
  },

  statement() {
    const { m, text: x } = EXAMPLE;
    const whole = x.worth.replace(/^₦/, '').replace(/\.\d+$/, ''), dec = x.worth.match(/\.\d+$/)?.[0] || '';
    const gainTone = toneOf(m.netGainKobo);
    return h('div', { class: 'panel statement help-statement' },
      h('p', { class: 'statement-label' }, 'Worth today'),
      h('p', { class: 'help-hero money' }, h('span', { class: 'cur' }, '₦'), h('span', {}, whole), h('span', { class: 'dec' }, dec)),
      h('p', { class: 'sub' }, `Valuation by your own estimate on ${fmtDate(EXAMPLE.valuations[0].date)}.`),
      h('p', { class: 'sub statement-sub' },
        h('span', { class: `pill ${gainTone}` }, icon('arrowUp'), `${formatNaira(m.netGainKobo, { sign: true })} ${formatPercent(m.roi, { sign: true })}`), ' in total, counting income and costs'),
      h('dl', { class: 'statement-line' },
        h('div', {}, h('dt', {}, 'Invested'), h('dd', { class: 'money' }, x.invested)),
        h('div', {}, h('dt', {}, 'Costs'), h('dd', { class: 'money' }, x.costs)),
        h('div', {}, h('dt', {}, 'Income received'), h('dd', { class: 'money' }, x.income)),
        h('div', {}, h('dt', {}, 'Held for'), h('dd', { class: 'money' }, `${x.days} days`))),
      h('dl', { class: 'defs' },
        h('dt', {}, 'Return on investment'), h('dd', { class: 'money' }, x.roi),
        h('dt', {}, 'Annualized return'), h('dd', { class: 'money' }, `${x.annualized} a year`, h('span', { class: 'sub' }, ` (${m.annualized.method === 'cagr' ? 'CAGR' : 'XIRR'})`))));
  },

  ledger(spec) {
    return h('ul', { class: 'rows' }, spec.rows.map((r) => {
      const [label, sign] = LEDGER_KINDS[r.kind], signed = sign * r.amount;
      return h('li', {}, h('div', { class: 'row-line' },
        h('span', { class: 'date-col' }, fmtDate(r.date)),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, label), r.note && h('div', { class: 'row-sub' }, r.note)),
        h('div', { class: 'row-end' }, h('span', { class: `money ${toneOf(signed)}` }, formatNaira(signed, { sign: true })))));
    }));
  },

  worth(spec) {
    return h('ol', { class: 'rows help-worth' }, spec.rows.map((r) => h('li', {}, h('div', { class: 'row-line' },
      h('span', { class: `tile tint-${r.n}` }, String(r.n)),
      h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, r.title), h('div', { class: 'row-sub' }, r.text)),
      h('span', { class: 'chip help-badge' }, r.badge)))));
  },

  people(spec) {
    return h('div', { class: 'scroll-x' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['Who', 'Put in', 'Share', 'Worth'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, spec.rows.map((r) => h('tr', {}, h('td', {}, r.who), h('td', {}, formatNaira(r.put)),
        h('td', {}, `${r.bp / 100}%`), h('td', {}, formatNaira(Math.round((spec.worth * r.bp) / 10000))))))));
  },

  toast(spec) {
    return h('div', { class: 'toast help-toast' }, icon('checkCircle', { size: 18 }), h('span', { class: 'toast-text' }, spec.text),
      h('span', { class: 'link-btn toast-btn' }, spec.action));
  },

  iconRows(spec) {
    return h('ul', { class: 'rows' }, spec.rows.map((r) => h('li', {}, h('div', { class: 'row-line' },
      h('span', { class: 'tile' }, icon(r.icon)),
      h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, r.title), h('div', { class: 'row-sub' }, r.text))))));
  },

  palette(spec) {
    return h('div', { class: 'palette help-palette' },
      h('div', { class: 'palette-search' }, icon('search'), h('span', { class: 'help-fake-input' }, spec.query)),
      h('ul', { class: 'palette-list' }, spec.results.map((r, i) => h('li', { class: 'palette-item', 'aria-selected': String(i === 0) },
        h('span', { class: 'palette-ico' }, icon(r.icon, { size: 18 })),
        h('span', { class: 'palette-text' }, h('span', { class: 'palette-label' }, r.label), r.sub && h('span', { class: 'palette-sub' }, r.sub)),
        h('span', { class: 'palette-go' }, icon('arrowRight', { size: 16 }))))));
  },
};
const drawMock = (topic) => (topic.mock && MOCKS[topic.mock.type] ? mockFrame(MOCKS[topic.mock.type](topic.mock, topic)) : null);

// ---------- sample portfolio tie-in ----------
function sampleBlock({ text, key, sample, addSample }) {
  const href = key ? sampleHref(key, sample.ids) : null;
  const action = sample.live
    ? (href ? h('a', { class: 'btn btn--secondary btn--small', href }, 'Open it in the sample portfolio') : h('a', { class: 'btn btn--secondary btn--small', href: '#/' }, 'Go to the sample portfolio'))
    : h('button', { class: 'btn btn--secondary btn--small', type: 'button', onclick: (e) => addSample(e.currentTarget) }, 'Add the sample portfolio');
  return h('section', { class: 'help-sample', 'aria-label': 'Try it in the sample portfolio' },
    h('span', { class: 'tile tint-3' }, icon('sprout')),
    h('div', { class: 'help-sample-text' }, h('p', { class: 'help-sample-title' }, 'See it in the sample portfolio'), h('p', { class: 'sub' }, text),
      !sample.live && h('p', { class: 'sub' }, 'It is made up, and you can remove it any time in Settings.')),
    action);
}

// ---------- Help home ----------
function homeView(o) {
  const start = topicById(HELP_HOME.startId);
  const search = h('button', { class: 'help-search', type: 'button', onclick: o.openSearch, 'aria-label': `Search the Help. Shortcut ${o.shortcut}` },
    icon('search', { size: 18 }), h('span', { class: 'help-search-text' }, 'Search the Help'), h('kbd', { 'aria-hidden': 'true' }, o.shortcut));
  const startCard = h('section', { class: 'panel help-start', 'aria-label': 'Start here' },
    h('div', { class: 'help-start-head' }, h('span', { class: 'tile tile--large tint-1' }, icon(start.icon, { size: 28 })),
      h('div', {}, h('p', { class: 'help-eyebrow' }, 'Start here'), h('h2', {}, start.title), h('p', { class: 'sub' }, start.summary))),
    h('ol', { class: 'help-mini' }, start.steps.map((s) => h('li', {}, s.title))),
    h('a', { class: 'btn', href: HELP_ROUTE.topic(start.id) }, 'Begin the guide', icon('arrowRight')));
  const topics = TOPICS.filter((t) => t.id !== start.id);
  const grid = h('ul', { class: 'help-grid' }, topics.map((t) => h('li', {}, h('a', { class: 'help-card', href: HELP_ROUTE.topic(t.id) },
    h('span', { class: `tile tint-${t.tint}` }, icon(t.icon)),
    h('span', { class: 'help-card-text' }, h('span', { class: 'help-card-title' }, t.title), h('span', { class: 'help-card-sub' }, t.summary)),
    icon('chevronRight', { size: 18 })))));
  const more = h('ul', { class: 'help-grid help-grid--two' },
    h('li', {}, h('a', { class: 'help-card', href: HELP_ROUTE.glossary }, h('span', { class: 'tile tint-4' }, icon('book')),
      h('span', { class: 'help-card-text' }, h('span', { class: 'help-card-title' }, 'Glossary'), h('span', { class: 'help-card-sub' }, `${GLOSSARY.length} terms in plain words, from ROI to XIRR.`)), icon('chevronRight', { size: 18 }))),
    h('li', {}, h('a', { class: 'help-card', href: HELP_ROUTE.faq }, h('span', { class: 'tile tint-5' }, icon('help')),
      h('span', { class: 'help-card-text' }, h('span', { class: 'help-card-title' }, 'Common questions'), h('span', { class: 'help-card-sub' }, `${FAQ.length} real questions, answered straight.`)), icon('chevronRight', { size: 18 }))));
  return h('div', { class: 'flow help' },
    backLink(backToOrigin().text, backToOrigin().href),
    h('header', { class: 'help-head' }, h('h1', { class: 'page-title' }, HELP_HOME.title), h('p', { class: 'lead' }, HELP_HOME.lead), search),
    startCard,
    h('section', {}, sectionHead('Topics'), grid),
    h('section', {}, sectionHead('Words and answers'), more),
    sampleBlock({ text: 'Not ready to enter real records? Explore a made-up portfolio first: a plot, a rented flat, a car, a treasury bill and a partnership.', key: null, sample: o.sample, addSample: o.addSample }));
}

// ---------- one topic ----------
function topicView(topic, o) {
  const tr = resolveTry(topic.tryIt, o.investments);
  const tryBtn = tr.kind === 'action'
    ? h('button', { class: 'btn', type: 'button', onclick: o.openSearch }, icon('search'), tr.label)
    : h('a', { class: 'btn', href: tr.href }, tr.label, icon('arrowRight'));
  const steps = h('ol', { class: 'help-steps' }, topic.steps.map((s) => h('li', {},
    h('div', { class: 'help-step-body' }, h('h3', {}, s.title), h('p', {}, s.text),
      s.more && topicById(s.more) && h('a', { class: 'help-more', href: HELP_ROUTE.topic(s.more) }, `Read more: ${topicById(s.more).title}`, icon('chevronRight', { size: 16 }))))));
  const words = (topic.glossary || []).map(termById).filter(Boolean);
  const qs = (topic.faq || []).map(faqById).filter(Boolean);
  const i = TOPICS.indexOf(topic), prev = TOPICS[i - 1], next = TOPICS[i + 1];
  const pager = h('nav', { class: 'help-pager', 'aria-label': 'More topics' },
    prev ? h('a', { class: 'help-pager-link', href: HELP_ROUTE.topic(prev.id) }, icon('chevronLeft', { size: 18 }), h('span', {}, h('span', { class: 'sub' }, 'Previous'), h('span', { class: 'help-pager-title' }, prev.title))) : h('span', {}),
    next ? h('a', { class: 'help-pager-link help-pager-link--next', href: HELP_ROUTE.topic(next.id) }, h('span', {}, h('span', { class: 'sub' }, 'Next'), h('span', { class: 'help-pager-title' }, next.title)), icon('chevronRight', { size: 18 })) : h('span', {}));
  return h('div', { class: 'flow help help-topic' },
    backLink('Help', HELP_ROUTE.home),
    h('header', { class: 'help-head' }, h('span', { class: `tile tile--large tint-${topic.tint}` }, icon(topic.icon, { size: 28 })),
      h('h1', { class: 'page-title' }, topic.title), h('p', { class: 'lead' }, topic.lead)),
    drawMock(topic),
    h('section', { 'aria-label': 'Steps' }, sectionHead('Step by step'), steps),
    h('section', { class: 'panel help-try' }, h('div', {}, h('h2', {}, 'Try it now'), tr.note && h('p', { class: 'sub' }, tr.note)), tryBtn),
    h('aside', { class: 'note-box help-note' }, icon('bulb', { size: 18 }), h('div', {}, h('p', { class: 'help-note-title' }, 'Good to know'), h('p', {}, topic.goodToKnow))),
    topic.sample && sampleBlock({ text: topic.sample.text, key: topic.sample.key, sample: o.sample, addSample: o.addSample }),
    words.length > 0 && h('section', {}, sectionHead('Words used here'), h('div', { class: 'help-chips' }, words.map((g) => chipLink(g.term, HELP_ROUTE.term(g.id))))),
    qs.length > 0 && h('section', {}, sectionHead('Questions people ask'), h('ul', { class: 'rows help-qs' }, qs.map((f) => h('li', {}, h('a', { class: 'row-line', href: HELP_ROUTE.question(f.id) },
      h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, f.q)), icon('chevronRight', { size: 18 })))))),
    pager);
}

// ---------- glossary ----------
function glossaryView(targetId) {
  const terms = [...GLOSSARY].sort(byTerm);
  const status = h('p', { class: 'sr-only', role: 'status' });
  const filter = h('input', { class: 'input', id: 'help-filter', type: 'search', placeholder: 'Filter the terms', autocomplete: 'off', 'aria-label': 'Filter the glossary' });
  const rows = terms.map((g) => {
    const topics = TOPICS.filter((t) => (t.glossary || []).includes(g.id));
    return h('article', { class: `help-term${g.id === targetId ? ' is-target' : ''}`, id: `term-${g.id}`, 'data-find': `${g.term} ${g.aka || ''} ${g.meaning}`.toLowerCase() },
      h('h2', {}, g.term, g.aka && h('span', { class: 'help-aka' }, ` (${g.aka})`)),
      h('p', {}, g.meaning),
      topics.length > 0 && h('p', { class: 'help-see sub' }, 'See also: ', topics.map((t, i) => [i > 0 && ', ', h('a', { href: HELP_ROUTE.topic(t.id) }, t.title)])));
  });
  const none = h('p', { class: 'help-none sub', hidden: true }, 'No term matches that. Try a shorter word.');
  const list = h('div', { class: 'help-terms' }, rows);
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    let shown = 0;
    for (const r of rows) { const on = !q || r.dataset.find.includes(q); r.hidden = !on; if (on) shown++; }
    none.hidden = shown > 0;
    status.textContent = shown === 1 ? '1 term' : `${shown} terms`;
  });
  const view = h('div', { class: 'flow help' }, backLink('Help', HELP_ROUTE.home),
    h('header', { class: 'help-head' }, h('h1', { class: 'page-title' }, 'Glossary'), h('p', { class: 'lead' }, 'The words Apex uses, in plain language.'), filter),
    status, list, none);
  if (targetId) reveal(rows.find((r) => r.id === `term-${targetId}`));
  return view;
}

// ---------- questions ----------
function faqView(targetId) {
  const items = FAQ.map((f) => {
    const d = h('details', { class: 'help-q', id: `faq-${f.id}`, open: f.id === targetId || undefined },
      h('summary', {}, f.q),
      h('div', { class: 'help-q-body' }, h('p', {}, f.a), h('a', { class: 'help-more', href: HELP_ROUTE.topic(f.topic) }, `Read the guide: ${topicById(f.topic).title}`, icon('chevronRight', { size: 16 }))));
    return d;
  });
  const view = h('div', { class: 'flow help' }, backLink('Help', HELP_ROUTE.home),
    h('header', { class: 'help-head' }, h('h1', { class: 'page-title' }, 'Common questions'), h('p', { class: 'lead' }, 'Straight answers to what people ask most.')),
    h('div', { class: 'panel help-qs-panel' }, items));
  if (targetId) reveal(items.find((d) => d.id === `faq-${targetId}`));
  return view;
}

// ---------- entry point ----------
// o: { parts, investments: [{ id, name, status, sample }], sample: { live, ids }, shortcut, addSample(button), openSearch() }
export function helpView(o) {
  const [, a, b] = o.parts;
  if (!a) return homeView(o);
  if (a === 'glossary') { if (b && !termById(b)) return missing('That term is not in the glossary', 'It may have been renamed. Browse the full glossary instead.'); return glossaryView(b); }
  if (a === 'faq') { if (b && !faqById(b)) return missing('That question is not here', 'It may have been reworded. Browse the full list instead.'); return faqView(b); }
  const topic = topicById(a);
  return topic ? topicView(topic, o) : missing('That Help page does not exist', 'Pick a topic from the Help home instead.');
}

// A small "?" link for other screens (empty states, the checklist). Goes to a Help topic.
export function helpLink(topicId, text = 'How this works') {
  return h('a', { class: 'help-link', href: HELP_ROUTE.topic(topicId) }, icon('help', { size: 16 }), text);
}
