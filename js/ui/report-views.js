// Phase 7 screens: Export and the printable Statement (the projection screens became the Outlook tab in Phase 12).
// The rules live in js/models/export.js (tested); this file only draws forms and tables. No inline styles, no innerHTML.
import { fill, h } from './dom.js';
import { icon } from './icons.js';
import { setBusy } from './motion.js';
import { amtText, fmtDate, isHidden, money, pct, tone, todayISO } from './fmt.js';
import { checkbox, dateInput, field, selectInput } from './formkit.js';
import { helpLink } from './help.js';
import { formatNaira } from '../engine/index.js';
import { InputError, checkDate } from '../models/inputs.js';
import { KIND_LABEL, SOURCE_LABEL, buildStatement, csvName, ledgerCsv, loadReport, summaryCsv, valuationsCsv } from '../models/export.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const backLink = (href, text) => h('a', { class: 'back', href }, icon('chevronLeft', { size: 18 }), text);
const amt = (kobo, opts = {}) => h('span', { class: 'amt' }, amtText(kobo, { compact: false, ...opts }));

// A plain download of text as a file. Used for CSV; the backup file has its own helper in sync-ui.js.
export function downloadCsv(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function reportView(env, parts) {
  const page = parts[0];
  if (page === 'export') return exportScreen(env);
  if (page === 'statement') return statementScreen(env, parts[1] || null);
  return null;
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
    fill(doc, ...(await drawDoc()));
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
  fill(doc, ...(await drawDoc()));
  return h('div', { class: 'flow statement-page' }, h('div', { class: 'no-print' }, backLink('#/export', 'Export and print')), head(print),
    h('section', { class: 'panel stack no-print' }, h('div', { class: 'stmt-controls' }, dateIn.el, which.el), dateErr, ledgerBox,
      h('p', { class: 'sub' }, 'Choose Print or save as PDF, then pick a printer or Save as PDF in the window that opens. The menus and buttons on this screen are left off the page.')),
    doc);
}
