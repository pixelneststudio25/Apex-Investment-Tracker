// Readable export (Phase 7): CSV files for a spreadsheet and the data behind the printable statement.
//
// Rules this file keeps:
//  - Money in a file is plain naira with two decimals, built from whole kobo with integer arithmetic ("-1250000.50"),
//    never from floating-point division. Percentages are written through Decimal.
//  - Text cells that a spreadsheet could read as a formula (they start with = + - @ or a tab or return) get a leading
//    apostrophe, so a note typed as "=1+1" can never run as a formula when the file is opened.
//  - Files start with a byte-order mark and use CRLF, so Excel reads the naira sign and accents correctly.
//  - Only live records are exported: deleted investments and everything under them are left out.
import { D } from '../engine/index.js';

const SIGN = { capital_in: -1, cost: -1, income: 1, payout: 1, proceeds: 1, repayment: 1 };
export const KIND_LABEL = { capital_in: 'Money put in', cost: 'Cost', income: 'Income received', payout: 'Payout received', proceeds: 'Sale proceeds', repayment: 'Loan repayment' };
export const SOURCE_LABEL = { own_estimate: 'Your own estimate', agent: 'An agent', comparable_sale: 'A comparable sale', bank: 'A bank', other: 'Another source' };

// 125050 -> "1250.50"; -5 -> "-0.05". Whole kobo in, text out.
export function koboPlain(kobo) {
  if (!Number.isSafeInteger(kobo)) throw new Error('Amount must be whole kobo.');
  const abs = Math.abs(kobo);
  return `${kobo < 0 ? '-' : ''}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
export const pctPlain = (fraction) => (fraction == null || !Number.isFinite(fraction) ? null : new D(String(fraction)).times(100).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2));

// A cell that is a number, written as it is. Anything else is text and is escaped.
export const num = (text) => (text == null ? null : { num: String(text) });

export function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'object' && 'num' in v) return String(v.num);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
export function toCsv(headers, rows) {
  return `\ufeff${[headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
export const csvName = (kind, asOf) => `apex-${kind}-${asOf}.csv`;

// ---------- the data every export reads ----------
// One item per live investment: its records and its figures as at `asOf`. An investment that cannot be calculated
// has `error` and no `metrics`; it still appears in the ledger and valuation files.
export async function loadReport(pf, asOf) {
  const items = [];
  for (const investment of (await pf.investments()).sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))) {
    try { const r = await pf.metrics(investment.id, asOf); items.push({ investment, bundle: r.bundle, metrics: r.metrics, partners: r.partners, error: null }); }
    catch (e) {
      const bundle = await pf.bundle(investment.id);
      if (!bundle) continue;
      items.push({ investment, bundle, metrics: null, partners: null, error: { code: e.code || 'ERROR', message: e.message } });
    }
  }
  return items;
}

export function ledgerCsv(items, catName) {
  const rows = [];
  for (const { investment: inv, bundle } of items) {
    for (const e of bundle.entries) rows.push([inv.name, catName(inv.categoryId), e.date, KIND_LABEL[e.kind], num(koboPlain(SIGN[e.kind] * e.amountKobo)), e.note || '']);
  }
  return toCsv(['Investment', 'Category', 'Date', 'Type', 'Amount (naira, money leaving you is minus)', 'Note'], rows);
}
export function valuationsCsv(items, catName) {
  const rows = [];
  for (const { investment: inv, bundle } of items) for (const v of bundle.valuations) rows.push([inv.name, catName(inv.categoryId), v.date, num(koboPlain(v.valueKobo)), SOURCE_LABEL[v.source] || v.source, v.note || '']);
  return toCsv(['Investment', 'Category', 'Date', 'Worth (naira)', 'Source', 'Note'], rows);
}
export function summaryCsv(items, catName, asOf) {
  const rows = items.map(({ investment: inv, metrics: m, error }) => {
    const head = [inv.name, catName(inv.categoryId)];
    if (!m) return [...head, 'Cannot be calculated', inv.openedOn, inv.closedOn || '', null, null, null, null, null, null, null, null, null, null, error.message];
    return [...head, m.basis === 'realized' ? 'Closed' : 'Active', inv.openedOn, inv.closedOn || '',
      num(koboPlain(m.investedKobo)), num(koboPlain(m.costsKobo)), num(koboPlain(m.incomeKobo)), num(koboPlain(m.proceedsKobo + m.repaidKobo)),
      num(koboPlain(m.currentValueKobo)), num(koboPlain(m.netGainKobo)), num(pctPlain(m.roi)), num(pctPlain(m.annualized.rate)), m.annualized.method ? m.annualized.method.toUpperCase() : '', num(String(m.daysHeld)),
      m.basis === 'realized' ? 'Closed: money received' : { valuation: 'Valuation', assumed: 'Estimated from a rate', cost: 'Shown at cost' }[m.valueSource]];
  });
  return toCsv(['Investment', 'Category', `Status as at ${asOf}`, 'Opened', 'Closed', 'Money put in (naira)', 'Costs (naira)', 'Income received (naira)', 'Sold or repaid (naira)', 'Worth today or sold for (naira)', 'Net gain (naira)', 'Return on investment (%)', 'Annualized return (%)', 'Method', 'Days held', 'Where the worth comes from'], rows);
}

// ---------- the printable statement ----------
// Everything the page needs, so the screen only arranges it. `investmentId` limits it to one investment.
// Entries and valuations after the as-at date are left out, like every figure (the engine ignores them too).
export async function buildStatement(pf, items, asOf, { investmentId = null, includeLedger = false } = {}) {
  const chosen = investmentId ? items.filter((it) => it.investment.id === investmentId) : items;
  const summary = await pf.summary(asOf, chosen.map(({ investment, metrics, error }) => (error ? { investment, error } : { investment, metrics })));
  const sections = chosen.map((it) => ({
    investment: it.investment, metrics: it.metrics, error: it.error,
    entries: includeLedger ? it.bundle.entries.filter((e) => e.date <= asOf) : [],
    valuations: includeLedger ? it.bundle.valuations.filter((v) => v.date <= asOf) : [],
  }));
  return { asOf, summary, sections, includeLedger };
}
