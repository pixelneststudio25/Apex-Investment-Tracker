// Help section tests: every link points somewhere real, every term and question exists, nothing is orphaned, and every
// number or example the Help states is checked against the real calculation engine (so the Help cannot quietly go wrong).
import { generateDek } from '../js/core/crypto.js';
import { createMemoryBackend } from '../js/core/db.js';
import { createStore } from '../js/core/store.js';
import { cagr, valueKobo, xirr } from '../js/engine/index.js';
import { ENTRY_CHOICES } from '../js/models/records.js';
import { seedSamplePortfolio } from '../js/models/sample.js';
import {
  EXAMPLE, FAQ, GLOSSARY, HELP_HOME, HELP_ROUTE, LEDGER_KINDS, RECORD_KINDS, SAMPLE_INVESTMENTS, STATIC_ROUTES, TOPICS, TRY_ACTIONS,
  checkHelpContent, faqById, helpSearchItems, resolveTry, sampleHref, termById, topicById,
} from '../js/models/help-content.js';
import { rank } from '../js/ui/palette.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };

// Source files can be read only in Node (the browser runner skips those checks).
const inNode = typeof process !== 'undefined' && !!process.versions?.node;
async function source(rel) {
  if (!inNode) return null;
  const fs = await import('node:fs/promises');
  return fs.readFile(new URL(rel, import.meta.url), 'utf8');
}

// ---------- the content itself ----------
test('help content: no broken links, terms, questions or empty fields', () => {
  const problems = checkHelpContent();
  ok(problems.length === 0, problems.join('; '));
  ok(topicById(HELP_HOME.startId), 'Start here topic exists');
});
test('help content: every glossary term and every question is used by at least one topic (nothing orphaned)', () => {
  for (const g of GLOSSARY) ok(TOPICS.some((t) => (t.glossary || []).includes(g.id)), `glossary term "${g.id}" is not linked from any topic`);
  for (const f of FAQ) ok(TOPICS.some((t) => (t.faq || []).includes(f.id)), `question "${f.id}" is not linked from any topic`);
});
test('help content: plain words only (no contractions, no em dashes, no HTML)', () => {
  const strings = [];
  const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(TOPICS); walk(GLOSSARY); walk(FAQ); walk(HELP_HOME);
  for (const s of strings) {
    ok(!/\w'\w/.test(s), `straight-apostrophe contraction in: ${s.slice(0, 60)}`);
    ok(!/[\u2014\u2013]/.test(s), `dash in: ${s.slice(0, 60)}`);
    ok(!/[<>]/.test(s), `angle bracket in: ${s.slice(0, 60)}`);
  }
});

// ---------- "Try it now" and routes ----------
test('try it: every button points at a real route, record form or action', async () => {
  for (const t of TOPICS) {
    const ty = t.tryIt;
    if (ty.route) ok(STATIC_ROUTES.includes(ty.route), `${t.id}: ${ty.route}`);
    if (ty.record) ok(RECORD_KINDS.includes(ty.record), `${t.id}: ${ty.record}`);
    if (ty.action) ok(TRY_ACTIONS.includes(ty.action), `${t.id}: ${ty.action}`);
  }
  const ws = await source('../js/ui/workspace.js'), forms = await source('../js/ui/forms.js');
  if (!ws) return;
  for (const page of ['new', 'investments', 'settings', 'help']) ok(ws.includes(`page === '${page}'`), `workspace.js does not route "${page}"`);
  for (const kind of RECORD_KINDS) ok(forms.includes(`kind === '${kind}'`), `forms.js has no "${kind}" form`);
  const sv = await source('../js/ui/settings-views.js');
  ok(sv && sv.includes('stepSlider'), 'Settings uses the text-size slider');
});
test('try it: picks a real active investment, skips closed ones for forms, and falls back to "add one first"', () => {
  const invs = [{ id: 'S1', name: 'Sample flat', status: 'active', sample: true }, { id: 'C1', name: 'Old bill', status: 'closed', sample: false }, { id: 'R1', name: 'My plot', status: 'active', sample: false }];
  eq(resolveTry({ label: 'x', record: 'entry' }, invs).href, '#/investments/R1/entry');
  eq(resolveTry({ label: 'x', record: 'close' }, [invs[1]]).href, '#/new', 'only a closed investment: nothing to close');
  eq(resolveTry({ label: 'x', record: 'valuation' }, [invs[0], invs[1]]).href, '#/investments/S1/valuation');
  ok(/sample portfolio/.test(resolveTry({ label: 'x', record: 'valuation' }, [invs[0]]).note), 'says when it is the sample');
  eq(resolveTry({ label: 'x', detail: true }, [invs[1]]).href, '#/investments/C1', 'reading numbers works on a closed one too');
  eq(resolveTry({ label: 'x', detail: true, fallbackLabel: 'Add first' }, []).label, 'Add first');
  eq(resolveTry({ label: 'x', route: '#/new' }, []).href, '#/new');
  eq(resolveTry({ label: 'x', action: 'palette' }, []).kind, 'action');
  for (const t of TOPICS) ok(resolveTry(t.tryIt, []).href || resolveTry(t.tryIt, []).kind === 'action', `${t.id} resolves with no investments`);
});

// ---------- sample portfolio tie-in ----------
test('sample links: the order of the sample portfolio matches what Help points at', async () => {
  const state = { dek: await generateDek() };
  let n = 0;
  const store = createStore({ backend: createMemoryBackend(), getDek: () => state.dek, userId: 'u1', uuid: () => `h-${++n}` });
  const ids = await seedSamplePortfolio(store);
  for (const [key, { index, name }] of Object.entries(SAMPLE_INVESTMENTS)) {
    const rec = await store.get(ids.investments[index]);
    eq(rec.name, name, `sample "${key}"`);
    eq(sampleHref(key, ids), `#/investments/${ids.investments[index]}`);
  }
  eq(sampleHref('nope', ids), null); eq(sampleHref('land', null), null);
});

// ---------- every number the Help states ----------
test('worked example: net gain, return and annualized return agree with the engine and with hand arithmetic', () => {
  const { m, text } = EXAMPLE;
  eq(m.netGainKobo, 1250000000 + 120000000 - 1000000000 - 50000000, 'net gain by hand');
  eq(text.net, '₦3,200,000.00'); eq(text.basis, '₦10,500,000.00'); eq(text.roi, '30.48%'); eq(text.days, '730');
  ok(Math.abs(m.roi - 3200000 / 10500000) < 1e-12, 'ROI by hand');
  // independent check of the annualized rate: all dated flows discounted at that rate must balance to (almost) zero
  const flows = [[0, -1000000000], [12, -50000000], [365, 120000000], [730, 1250000000]];
  const npv = flows.reduce((s, [d, a]) => s + a * Math.pow(1 + m.annualized.rate, -d / 365), 0);
  ok(Math.abs(npv) < 100, `annualized rate does not balance the flows (npv ${npv} kobo)`);
  eq(m.annualized.method, 'xirr');
  ok(Math.abs(xirr(flows.map(([d, a]) => ({ date: d === 0 ? '2024-10-23' : d === 12 ? '2024-11-04' : d === 365 ? '2025-10-23' : '2026-10-23', amountKobo: a }))) - m.annualized.rate) < 1e-9, 'XIRR matches the engine');
});
test('glossary and steps: the small examples are true', () => {
  eq(cagr(1000000000, 1440000000, 730), 0.2, 'CAGR example: 10m to 14.4m in 2 years is 20%');
  const from = '2025-01-01', to = '2028-01-01'; // 1,095 days (the leap day, 29 Feb 2028, falls after this range)
  const rate = (method) => [{ type: 'assumed', rate: 0.1, rateUnit: 'year', method, compoundsPerYear: 1, effectiveFrom: from }];
  eq(valueKobo(100000000, from, to, rate('simple')), 130000000, 'simple: ₦1,000,000 at 10% over 1,095 days');
  eq(valueKobo(100000000, from, to, rate('compound')), 133100000, 'compound: ₦1,000,000 at 10% over 1,095 days');
  ok(/1,095 days\) at 10% a year, ₦1,000,000 becomes ₦1,300,000 simple or ₦1,331,000 compounded/.test(termById('simple-compound').meaning));
  ok(/1,095 days\) at 10% a year, ₦1,000,000 becomes ₦1,300,000 simple or ₦1,331,000 compounded/.test(topicById('valuations-rates').steps.map((s) => s.text).join(' ')));
  eq(valueKobo(100000000, '2025-01-01', '2028-01-01', rate('simple')) , 130000000);
});
test('mock-ups: shared-investment shares add up exactly, and the ledger words match the app', () => {
  const people = topicById('shared').mock;
  eq(people.rows.reduce((s, r) => s + r.bp, 0), 10000, 'shares total 100%');
  eq(people.rows.reduce((s, r) => s + Math.round((people.worth * r.bp) / 10000), 0), people.worth, 'worth shares add up to the kobo');
  eq(Object.keys(LEDGER_KINDS).sort(), ENTRY_CHOICES.map(([k]) => k).sort(), 'ledger kinds match the entry kinds');
  for (const r of topicById('income-costs').mock.rows) ok(LEDGER_KINDS[r.kind], `ledger mock kind ${r.kind}`);
});

// ---------- search ----------
test('search: every Help entry opens a real page, and stays out of the list shown before typing', () => {
  const items = helpSearchItems();
  eq(items.length, TOPICS.length + GLOSSARY.length + FAQ.length, 'one entry per topic, term and question');
  for (const it of items) {
    ok(it.label && it.hash.startsWith('#/help') && it.searchOnly === true, `bad entry ${it.label}`);
    ok((it.keywords || '').length < 160, `keywords too long for ${it.label}`);
    const [, a, b] = it.hash.replace('#/', '#').split('/');
    if (!a || a === 'help') continue;
    if (a === 'glossary') ok(!b || termById(b), `missing term ${b}`); else if (a === 'faq') ok(!b || faqById(b), `missing question ${b}`); else ok(topicById(a), `missing topic ${a}`);
  }
  const all = [{ group: 'Actions', label: 'Lock Apex now', run() {} }, { group: 'Investments', label: 'Plot', run() {} }, ...items.map((i) => ({ ...i, run() {} }))];
  ok(rank(all, '').every((i) => !i.searchOnly), 'idle list has no Help entries');
  ok(rank(all, 'xirr').some((i) => i.label === 'XIRR'), 'typing finds the glossary term');
  ok(rank(all, 'ajo').some((i) => /thrift/i.test(i.label)), 'typing finds a term by its other name');
  ok(rank(all, 'lost key').some((i) => /recovery key/i.test(i.label)), 'typing finds a question by its everyday words');
  eq(HELP_ROUTE.term('roi'), '#/help/glossary/roi');
});

export async function runHelpTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) { try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); } }
  log(`\n${passed} passed, ${failed} failed (help).`);
  return { passed, failed };
}
