// Screens for single records: add or edit a ledger entry, add or edit a valuation, close an investment.
// What counts as valid lives in js/models/records.js; this file draws the form and saves the result.
import { h } from './dom.js';
import { setBusy } from './motion.js';
import { icon } from './icons.js';
import { fmtDate } from './fmt.js';
import { choiceList, dateInput, field, moneyField, selectInput, textArea } from './formkit.js';
import { InputError, koboToInput } from '../models/inputs.js';
import { ENTRY_CHOICES, buildClose, buildEntry, buildValuation } from '../models/records.js';
import { SOURCE_CHOICES } from '../models/wizard.js';
import { entryDocuments } from './document-views.js';

export async function recordFormView({ ctx, invId, kind, recordId, today, toast, go }) {
  const { store } = ctx;
  const back = `#/investments/${invId}`;
  const backLink = h('a', { class: 'back', href: back }, icon('chevronLeft', { size: 18 }), 'Back to the investment');
  const inv = await store.get(invId);
  const missing = (what) => h('div', { class: 'flow' }, backLink, h('p', { class: 'alert alert--error', role: 'alert' }, `${what} could not be found. It may have been removed.`));
  if (!inv || inv.type !== 'investment') return missing('This investment');

  let rec = null;
  if (recordId) {
    rec = await store.get(recordId);
    if (!rec || rec.type !== kind || rec.investmentId !== invId) return missing('This record');
  }
  const editing = !!rec, closed = inv.status === 'closed';
  const error = h('p', { class: 'alert alert--error', role: 'alert', hidden: true });
  const showError = (msg) => { error.textContent = msg; error.hidden = !msg; if (msg) error.scrollIntoView({ block: 'nearest' }); };
  let busy = false;
  const submit = (label, work) => h('button', { class: 'btn', type: 'submit' }, label);
  const wire = (form, work, doneText) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true; showError('');
    const btn = form.querySelector('button[type=submit]'); setBusy(btn, true);
    try { await work(); toast(doneText); go(back); }
    catch (err) {
      busy = false; setBusy(btn, false);
      if (err instanceof InputError || err.code === 'INVALID' || err.code === 'LOCKED') showError(err.message);
      else { showError('Could not save. Nothing was changed. Please try again.'); console.error(err); }
    }
  });
  const removeWithUndo = (id, what) => h('button', { class: 'btn btn--secondary btn--danger', type: 'button', onclick: async () => {
    try {
      await store.remove(id);
      toast(`${what} deleted.`, { label: 'Undo', run: async () => { await store.restore(id); window.dispatchEvent(new HashChangeEvent('hashchange')); } });
      go(back);
    } catch (err) { showError('Could not delete. Nothing was changed.'); console.error(err); }
  } }, `Delete this ${what.toLowerCase()}`);
  const head = (title, sub) => h('div', {}, h('h1', { class: 'page-title' }, title), h('p', { class: 'sub' }, sub || inv.name));
  const actions = (primary, extra) => h('div', { class: 'row sticky-actions' }, submit(primary), h('a', { class: 'btn btn--secondary', href: back }, 'Cancel'), extra);

  // ---------- ledger entry ----------
  if (kind === 'entry') {
    const form = { kind: rec?.kind || (inv.behaviors.income !== 'none' ? 'income' : 'cost'), date: rec?.date || today, amount: rec ? koboToInput(rec.amountKobo) : '', note: rec?.note || '' };
    const amount = moneyField('Amount', { value: form.amount, onInput: (v) => { form.amount = v; } });
    const f = h('form', { class: 'stack', novalidate: true },
      h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'What happened?'),
        choiceList({ name: 'entryKind', label: 'What happened', value: form.kind, options: ENTRY_CHOICES, onChange: (v) => { form.kind = v; } })),
      field('Date', dateInput({ value: form.date, onInput: (v) => { form.date = v; } })).el, amount.el,
      field('Note', textArea({ value: form.note, onInput: (v) => { form.note = v; }, maxlength: 1000, rows: 2 }), { optional: true }).el,
      closed && h('p', { class: 'note-box' }, 'This investment is closed. Entries dated after the closing date are not counted in its figures.'),
      error, actions(editing ? 'Save changes' : 'Add to ledger'));
    wire(f, async () => {
      const data = buildEntry(form, invId);
      if (editing) { const { investmentId, ...change } = data; await store.update(recordId, change); } else await store.create('entry', data);
    }, editing ? 'Entry updated.' : 'Entry added.');
    return h('div', { class: 'flow form-page' }, backLink, head(editing ? 'Edit entry' : 'Add an entry'), f, editing && entryDocuments(inv, rec, (await store.list('document')).filter((d) => d.investmentId === invId), { closed }), editing && removeWithUndo(recordId, 'Entry'), editing && h('p', { class: 'sub' }, h('a', { href: `#/investments/${invId}/history/${recordId}` }, 'See the change history of this entry')));
  }

  // ---------- valuation ----------
  if (kind === 'valuation') {
    const form = { date: rec?.date || today, amount: rec ? koboToInput(rec.valueKobo) : '', source: rec?.source || 'own_estimate', note: rec?.note || '' };
    const f = h('form', { class: 'stack', novalidate: true },
      h('p', { class: 'sub' }, 'A valuation is what it is worth on a given day. The latest one replaces any growth rate.'),
      moneyField('Worth on that day', { value: form.amount, allowZero: true, onInput: (v) => { form.amount = v; } }).el,
      field('Valuation date', dateInput({ value: form.date, onInput: (v) => { form.date = v; } })).el,
      field('Where does the figure come from?', selectInput({ value: form.source, options: SOURCE_CHOICES, onChange: (v) => { form.source = v; } })).el,
      field('Note', textArea({ value: form.note, onInput: (v) => { form.note = v; }, maxlength: 1000, rows: 2 }), { optional: true }).el,
      error, actions(editing ? 'Save changes' : 'Save valuation'));
    wire(f, async () => {
      const data = buildValuation(form, invId);
      if (editing) { const { investmentId, ...change } = data; await store.update(recordId, change); } else await store.create('valuation', data);
    }, editing ? 'Valuation updated.' : 'Valuation added.');
    return h('div', { class: 'flow form-page' }, backLink, head(editing ? 'Edit valuation' : 'Add a valuation'), f, editing && removeWithUndo(recordId, 'Valuation'), editing && h('p', { class: 'sub' }, h('a', { href: `#/investments/${invId}/history/${recordId}` }, 'See the change history of this valuation')));
  }

  // ---------- close ----------
  if (kind === 'close') {
    if (closed) return h('div', { class: 'flow form-page' }, backLink, head('Already closed', inv.name), h('p', { class: 'note-box' }, `This investment was closed on ${fmtDate(inv.closedOn)}.`));
    const form = { date: today, amount: '', note: '' };
    const f = h('form', { class: 'stack', novalidate: true },
      h('p', { class: 'sub' }, 'Closing means you no longer hold it: it was sold, matured or written off. Apex then shows what you actually received and stops growing the value. You can reopen it later.'),
      field('Closing date', dateInput({ value: form.date, onInput: (v) => { form.date = v; } })).el,
      moneyField('Money you received', { value: form.amount, allowZero: true, optional: true, hint: 'The sale price or maturity payment. Leave empty if nothing came back.', onInput: (v) => { form.amount = v; } }).el,
      field('Note', textArea({ value: form.note, onInput: (v) => { form.note = v; }, maxlength: 1000, rows: 2 }), { optional: true }).el,
      error, actions('Close this investment'));
    wire(f, async () => {
      const c = buildClose(form, inv);
      await store.update(invId, c.change);
      if (c.proceeds) await store.create('entry', c.proceeds);
    }, 'Investment closed.');
    return h('div', { class: 'flow form-page' }, backLink, head('Close this investment'), f);
  }
  return missing('This page');
}
