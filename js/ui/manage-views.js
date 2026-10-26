// Screens for changing what is already saved: edit an investment, manage its regular payments, see and restore
// earlier versions, change who shares it, reminders, and recently deleted items. The rules live in
// js/models/manage.js; this file draws the forms and saves the result.
import { h } from './dom.js';
import { setBusy, withBusy } from './motion.js';
import { icon } from './icons.js';
import { confirmDialog } from './dialog.js';
import { fmtDate, money, todayISO } from './fmt.js';
import { checkbox, choiceList, dateInput, field, moneyField, percentField, segmented, selectInput, showErrors, textArea, textInput } from './formkit.js';
import { InputError, bpToInput } from '../models/inputs.js';
import { purgeDocument } from '../models/documents.js';
import { COMPOUND_CHOICES, FREQUENCY_CHOICES, INCOME_CHOICES, RATE_BASED, VALUE_CHOICES, hasTerm } from '../models/wizard.js';
import { RECURRENCE_CHOICES, applySharesPlan, blankRate, buildInvestmentChange, buildReminder, buildScheduleFields, buildSharesPlan, completeChange, deletedItems, diffVersions, dueUnrecorded, editDraft, editErrors, entryFromDue, resumeChange, scheduleDraft, scheduleErrors, sharesDraft, sharesErrors, skippableDates, stopChange, withIncrease, withSkipToggled, withoutIncrease } from '../models/manage.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const backLink = (href, text) => h('a', { class: 'back', href }, icon('chevronLeft', { size: 18 }), text);
const notFound = (href, text, what) => h('div', { class: 'flow' }, backLink(href, text), h('p', { class: 'alert alert--error', role: 'alert' }, `${what} could not be found. It may have been removed.`));
const KIND_NAMES = { capital_in: 'Money put in', cost: 'Cost', income: 'Income received', payout: 'Payout received', proceeds: 'Sale proceeds', repayment: 'Loan repayment' };
const SOURCE_NAMES = { own_estimate: 'your own estimate', agent: 'an agent', comparable_sale: 'a comparable sale', bank: 'a bank', other: 'another source' };
const saveFailed = (err) => (err instanceof InputError || err.code === 'INVALID' || err.code === 'LOCKED' || err.code === 'CORRUPT' ? err.message : 'Could not save. Nothing was changed. Please try again.');

// Runs `work` for a form's submit button with a busy state and one error line; on success shows `done` and goes `next`.
function wire(form, errorBox, { toast, go }, work, done, next) {
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true; errorBox.hidden = true;
    const btn = form.querySelector('button[type=submit]'); setBusy(btn, true);
    try { const target = await work(); toast(done); if (next || target) go(target || next); }
    catch (err) { busy = false; setBusy(btn, false); errorBox.textContent = saveFailed(err); errorBox.hidden = false; errorBox.scrollIntoView?.({ block: 'nearest' }); if (saveFailed(err).startsWith('Could not save')) console.error(err); }
  });
}
const errorLine = () => h('p', { class: 'alert alert--error', role: 'alert', hidden: true });

export async function manageView(env, parts) {
  const [page, a, b, c] = parts;
  if (page === 'investments' && b === 'edit') return editInvestment(env, a);
  if (page === 'investments' && b === 'schedule') return c === 'new' ? scheduleForm(env, a) : c ? scheduleManage(env, a, c) : scheduleList(env, a);
  if (page === 'investments' && b === 'history') return historyView(env, a, c);
  if (page === 'investments' && b === 'shares') return sharesView(env, a);
  if (page === 'reminders') return a === 'new' ? reminderForm(env, null, b) : a ? reminderForm(env, a) : remindersList(env);
  if (page === 'deleted') return deletedView(env);
  return null;
}

// ================= edit an investment =================
async function editInvestment({ ctx, toast, go }, invId) {
  const { store } = ctx, back = `#/investments/${invId}`;
  const rec = await store.get(invId);
  if (!rec || rec.type !== 'investment') return notFound('#/investments', 'Investments', 'This investment');
  const tpl = ctx.cat(rec.categoryId), draft = editDraft(rec), schedCount = (await store.list('schedule')).filter((s) => s.investmentId === invId).length;
  let reg = {};
  const F = (key, label, make, opts) => { const f = field(label, make, opts); reg[key] = f; return f.el; };
  const err = errorLine(), ratesBox = h('div', { class: 'stack' }), incomeNote = h('p', { class: 'note-box', hidden: true });

  function drawRates() {
    for (const k of Object.keys(reg)) if (k === 'rates' || k.startsWith('rates.')) delete reg[k];
    if (!RATE_BASED.includes(draft.valueChange)) {
      ratesBox.replaceChildren(draft.rates.length ? h('p', { class: 'note-box' }, `The ${plural(draft.rates.length, 'rate', 'rates')} set earlier will be removed when you save, because this way of valuing it does not use a rate.`) : '');
      return;
    }
    const verb = draft.valueChange === 'depreciation' ? 'How much it loses' : draft.valueChange === 'interest' ? 'Interest rate' : 'How much it grows';
    const general = h('p', { class: 'alert alert--error', role: 'alert', hidden: true });
    reg.rates = { setError: (m) => { general.textContent = m || ''; general.hidden = !m; }, control: general };
    ratesBox.replaceChildren(general,
      ...draft.rates.map((r, i) => h('section', { class: 'person' },
        h('div', { class: 'person-head' }, h('h2', {}, draft.rates.length > 1 ? `Rate ${i + 1}` : 'The rate'), (draft.rates.length > 1 || draft.valueChange !== 'interest') && h('button', { class: 'link-btn', type: 'button', onclick: () => { draft.rates.splice(i, 1); drawRates(); } }, 'Remove')),
        h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'Where does it come from?'), segmented({ label: 'Rate source', value: r.type, options: [['assumed', 'My own assumption'], ['agreed', 'Agreed with someone']], onChange: (v) => { r.type = v; } })),
        (() => { const f = percentField(verb, { value: r.percent, onInput: (v) => { r.percent = v; } }); reg[`rates.${i}.percent`] = f; return f.el; })(),
        h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'Per'), segmented({ label: 'Rate period', value: r.unit, options: [['year', 'a year'], ['month', 'a month']], onChange: (v) => { r.unit = v; if (r.method === 'compound') r.per = ''; drawRates(); } })),
        h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'How it adds up'), segmented({ label: 'Simple or compounding', value: r.method, options: [['simple', 'Simple'], ['compound', 'Compounding']], onChange: (v) => { r.method = v; drawRates(); } })),
        r.method === 'compound' && F(`rates.${i}.per`, 'Compounds', selectInput({ value: r.per || (r.unit === 'month' ? '12' : '1'), options: COMPOUND_CHOICES, onChange: (v) => { r.per = v; } })),
        h('div', { class: 'row row--fields' }, F(`rates.${i}.from`, 'Applies from', dateInput({ value: r.from, onInput: (v) => { r.from = v; } }), { optional: true, hint: 'Empty means from the start date.' }), F(`rates.${i}.to`, 'Applies until', dateInput({ value: r.to, onInput: (v) => { r.to = v; } }), { optional: true, hint: 'Empty means it carries on.' })))),
      h('div', { class: 'row' }, h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => { draft.rates.push(blankRate(draft)); drawRates(); } }, draft.rates.length ? 'Add a rate for another period' : 'Add a rate')));
  }
  const drawIncome = () => { const need = draft.income === 'schedule' && schedCount === 0; incomeNote.hidden = !need; incomeNote.textContent = need ? 'After you save, Apex will take you to set up the regular payment (amount, how often, first date).' : ''; };

  const basics = [
    F('name', 'Name', textInput({ value: draft.name, onInput: (v) => { draft.name = v; }, maxlength: 120 })),
    F('openedOn', 'Start date', dateInput({ value: draft.openedOn, onInput: (v) => { draft.openedOn = v; } })),
    (hasTerm(tpl) || rec.behaviors.term) && F('maturityDate', 'Maturity date', dateInput({ value: draft.maturityDate, onInput: (v) => { draft.maturityDate = v; } })),
    F('notes', 'Notes', textArea({ value: draft.notes, onInput: (v) => { draft.notes = v; }, maxlength: 5000 }), { optional: true }),
  ];
  const details = (tpl.customFieldDefs || []).map((d) => F(d.key, d.label, textInput({ value: draft.fields[d.key] ?? '', onInput: (v) => { draft.fields[d.key] = v; }, type: d.type === 'date' ? 'date' : 'text', inputmode: d.type === 'number' ? 'decimal' : undefined, maxlength: 500 }), { optional: true }));
  drawRates(); drawIncome();

  const form = h('form', { class: 'stack', novalidate: true },
    h('section', { class: 'stack' }, h('h2', {}, 'The basics'), ...basics),
    details.length > 0 && h('section', { class: 'stack subsection' }, h('h2', {}, 'Details'), ...details),
    h('section', { class: 'stack subsection' }, h('h2', {}, 'How its value changes'),
      choiceList({ name: 'value', label: 'How its value changes', value: draft.valueChange, options: VALUE_CHOICES, onChange: (v) => { draft.valueChange = v; if (v === 'interest' && !draft.rates.length) draft.rates.push(blankRate(draft)); drawRates(); } }), ratesBox),
    h('section', { class: 'stack subsection' }, h('h2', {}, 'Income it pays'),
      choiceList({ name: 'income', label: 'Income it pays', value: draft.income, options: INCOME_CHOICES, onChange: (v) => { draft.income = v; drawIncome(); } }), incomeNote,
      schedCount > 0 && h('p', { class: 'sub' }, h('a', { href: `#/investments/${invId}/schedule` }, 'Change the amounts, dates and skipped months of its regular payments'))),
    err,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Save changes'), h('a', { class: 'btn btn--secondary', href: back }, 'Cancel')));
  form.addEventListener('submit', (e) => {
    const errs = editErrors(draft, tpl);
    if (errs.length) { e.stopImmediatePropagation(); e.preventDefault(); const first = showErrors(reg, errs); (first || { control: err }).control.focus?.(); if (!first) { err.textContent = errs[0].message; err.hidden = false; } }
  }, true);
  wire(form, err, { toast, go }, async () => {
    await store.update(invId, buildInvestmentChange(draft, rec, tpl));
    return draft.income === 'schedule' && schedCount === 0 ? `#/investments/${invId}/schedule/new` : back;
  }, 'Changes saved.', back);
  return h('div', { class: 'flow' }, backLink(back, 'Back to the investment'), h('div', {}, h('h1', { class: 'page-title' }, 'Edit investment'), h('p', { class: 'sub' }, rec.name)), form,
    h('p', { class: 'sub' }, h('a', { href: `#/investments/${invId}/history` }, 'See the change history of this investment')));
}

// ================= regular payments =================
const sentence = (s) => `${money(s.amountKobo, { compact: false })} ${s.frequency === 'custom' ? `every ${s.everyDays} days` : { monthly: 'every month', quarterly: 'every 3 months', yearly: 'every year' }[s.frequency]}, from ${fmtDate(s.startDate)}${s.endDate ? ` to ${fmtDate(s.endDate)}` : ''}`;

async function scheduleList({ ctx }, invId) {
  const { store } = ctx, back = `#/investments/${invId}`, inv = await store.get(invId);
  if (!inv || inv.type !== 'investment') return notFound('#/investments', 'Investments', 'This investment');
  const [list, entries] = await Promise.all([store.list('schedule'), store.list('entry')]);
  const mine = list.filter((s) => s.investmentId === invId), today = todayISO();
  return h('div', { class: 'flow' }, backLink(back, 'Back to the investment'),
    h('div', { class: 'page-actions' }, h('h1', { class: 'page-title' }, 'Regular payments'), h('a', { class: 'btn btn--small', href: `${back}/schedule/new` }, icon('plus'), 'Add one')),
    mine.length ? h('ul', { class: 'rows' }, mine.map((s) => {
      const due = s.status === 'active' ? dueUnrecorded(s, entries.filter((e) => e.investmentId === invId), today).length : 0;
      return h('li', {}, h('a', { class: 'row-line', href: `${back}/schedule/${s.id}` },
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, s.label || (s.kind === 'income' ? 'Income' : 'Cost'), s.status === 'ended' && h('span', { class: 'chip' }, 'Stopped')), h('div', { class: 'row-sub' }, sentence(s))),
        due > 0 && h('div', { class: 'row-end' }, h('span', { class: 'row-sub overdue' }, `${plural(due, 'payment', 'payments')} to record`))));
    })) : h('div', { class: 'mini-empty' }, icon('calendar', { size: 20 }), h('span', {}, 'No regular payments yet. Add rent or a regular cost, and Apex will show it under Coming up.')));
}

async function scheduleForm({ ctx, toast, go }, invId) {
  const back = `#/investments/${invId}`, inv = await ctx.store.get(invId);
  if (!inv || inv.type !== 'investment') return notFound('#/investments', 'Investments', 'This investment');
  const d = scheduleDraft(null); d.start = todayISO();
  const err = errorLine(), reg = {};
  const F = (key, label, make, opts) => { const f = field(label, make, opts); reg[key] = f; return f.el; };
  const money_ = (key, label, o) => { const f = moneyField(label, o); reg[key] = f; return f.el; };
  const everyBox = h('div', {}), drawEvery = () => { everyBox.replaceChildren(d.frequency === 'custom' ? F('everyDays', 'Number of days between payments', textInput({ value: d.everyDays, inputmode: 'numeric', onInput: (v) => { d.everyDays = v; } })) : ''); };
  drawEvery();
  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'What kind of payment?'), segmented({ label: 'Income or cost', value: d.kind, options: [['income', 'Money coming to me (rent)'], ['cost', 'A regular cost']], onChange: (v) => { d.kind = v; } })),
    F('label', 'What is it called?', textInput({ value: d.label, onInput: (v) => { d.label = v; }, maxlength: 120, placeholder: 'For example: Yearly rent' }), { optional: true }),
    money_('amount', 'Amount each time', { value: d.amount, onInput: (v) => { d.amount = v; } }),
    F('frequency', 'How often?', selectInput({ value: d.frequency, options: FREQUENCY_CHOICES, onChange: (v) => { d.frequency = v; drawEvery(); } })), everyBox,
    F('start', 'First payment date', dateInput({ value: d.start, onInput: (v) => { d.start = v; } })),
    F('end', 'Last payment date', dateInput({ value: d.end, onInput: (v) => { d.end = v; } }), { optional: true, hint: 'Leave empty if it carries on.' }),
    h('p', { class: 'hint' }, 'Apex never assumes money arrived. Payments appear under Coming up, and you record each one as received when it comes.'),
    err, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Save regular payment'), h('a', { class: 'btn btn--secondary', href: `${back}/schedule` }, 'Cancel')));
  form.addEventListener('submit', (e) => { const errs = scheduleErrors(d); if (errs.length) { e.stopImmediatePropagation(); e.preventDefault(); showErrors(reg, errs)?.control.focus(); } }, true);
  wire(form, err, { toast, go }, async () => {
    await ctx.store.create('schedule', { investmentId: invId, ...buildScheduleFields(d), adjustments: [], skippedDates: [], status: 'active' });
    if (inv.behaviors.income !== 'schedule') await ctx.store.update(invId, { behaviors: { ...inv.behaviors, income: 'schedule' } });
  }, 'Regular payment saved.', `${back}/schedule`);
  return h('div', { class: 'flow' }, backLink(`${back}/schedule`, 'Regular payments'), h('div', {}, h('h1', { class: 'page-title' }, 'Add a regular payment'), h('p', { class: 'sub' }, inv.name)), form);
}

async function scheduleManage(env, invId, sid) {
  const { ctx, toast, go } = env, { store } = ctx, back = `#/investments/${invId}`;
  const root = h('div', { class: 'flow' });
  async function paint() {
    const [inv, s0] = await Promise.all([store.get(invId), store.get(sid)]);
    if (!inv || inv.type !== 'investment' || !s0 || s0.type !== 'schedule' || s0.investmentId !== invId) { root.replaceChildren(notFound(`${back}/schedule`, 'Regular payments', 'This regular payment')); return; }
    const s = s0, today = todayISO(), entries = (await store.list('entry')).filter((e) => e.investmentId === invId);
    const isIncome = s.kind === 'income', verb = isIncome ? 'received' : 'paid';
    const act = (btnText, fn, { cls = 'btn btn--secondary btn--small' } = {}) => h('button', { class: cls, type: 'button', onclick: (e) => withBusy(e.currentTarget, async () => { try { await fn(); await paint(); } catch (err) { toast(saveFailed(err)); } }) }, btnText);
    const change = (fields, text) => async () => { await store.update(sid, fields); if (text) toast(text); };

    // --- due now ---
    const due = s.status === 'active' ? dueUnrecorded(s, entries, today) : [];
    const dueSection = due.length ? h('section', { class: 'stack' }, h('div', { class: 'section-head' }, h('h2', {}, `To record (${due.length})`),
      due.length > 1 && act(`Record all ${due.length} as ${verb}`, async () => { for (const d of due) await store.create('entry', entryFromDue(s, d)); toast(`${plural(due.length, 'payment', 'payments')} recorded.`); })),
      h('p', { class: 'sub' }, `These have fallen due and are not in your ledger yet. Record each one as ${verb} when it really was, or skip a month that did not happen.`),
      h('ul', { class: 'rows' }, due.map((d) => h('li', {}, h('div', { class: 'row-line' }, h('span', { class: 'date-col overdue' }, fmtDate(d.date)), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, money(d.amountKobo, { compact: false }))),
        h('div', { class: 'row-end actions' }, act(`Record as ${verb}`, async () => { await store.create('entry', entryFromDue(s, d)); toast('Recorded.'); }), act('Skip', change({ skippedDates: withSkipToggled(s, d.date) }, 'Skipped.')))))))) : null;

    // --- the payment itself ---
    const d = scheduleDraft(s), reg = {}, err = errorLine();
    const F = (key, label, make, opts) => { const f = field(label, make, opts); reg[key] = f; return f.el; };
    const everyBox = h('div', {}), drawEvery = () => { everyBox.replaceChildren(d.frequency === 'custom' ? F('everyDays', 'Number of days between payments', textInput({ value: d.everyDays, inputmode: 'numeric', onInput: (v) => { d.everyDays = v; } })) : ''); };
    drawEvery();
    const amountF = moneyField('Amount each time', { value: d.amount, onInput: (v) => { d.amount = v; } }); reg.amount = amountF;
    const editForm = h('form', { class: 'stack', novalidate: true },
      F('label', 'What is it called?', textInput({ value: d.label, onInput: (v) => { d.label = v; }, maxlength: 120 }), { optional: true }), amountF.el,
      F('frequency', 'How often?', selectInput({ value: d.frequency, options: FREQUENCY_CHOICES, onChange: (v) => { d.frequency = v; drawEvery(); } })), everyBox,
      F('start', 'First payment date', dateInput({ value: d.start, onInput: (v) => { d.start = v; } })),
      F('end', 'Last payment date', dateInput({ value: d.end, onInput: (v) => { d.end = v; } }), { optional: true }),
      err, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Save changes')));
    editForm.addEventListener('submit', (e) => { const errs = scheduleErrors(d); if (errs.length) { e.stopImmediatePropagation(); e.preventDefault(); showErrors(reg, errs)?.control.focus(); } }, true);
    wire(editForm, err, { toast, go }, async () => { await store.update(sid, buildScheduleFields(d)); await paint(); return null; }, 'Changes saved.');

    // --- skipped months ---
    const skips = skippableDates(s, entries, today);
    const skipSection = h('section', { class: 'stack' }, h('h2', {}, 'Skip a payment'), h('p', { class: 'sub' }, 'A skipped payment is treated as not happening. It is left out of what is due and what is coming up.'),
      skips.length ? h('ul', { class: 'rows' }, skips.map((k) => h('li', {}, h('div', { class: 'row-line' }, h('span', { class: 'date-col' }, fmtDate(k.date)), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, money(k.amountKobo, { compact: false }), k.skipped && h('span', { class: 'chip' }, 'Skipped'))),
        h('div', { class: 'row-end' }, act(k.skipped ? 'Undo skip' : 'Skip', change({ skippedDates: withSkipToggled(s, k.date) }))))))) : h('p', { class: 'sub' }, 'No payments to skip right now.'));

    // --- changes in amount ---
    const incDate = { from: today, amount: '' }, incErr = errorLine();
    const incF = field('Starting on', dateInput({ value: incDate.from, onInput: (v) => { incDate.from = v; } })), incA = moneyField('New amount each time', { value: '', onInput: (v) => { incDate.amount = v; } });
    const incForm = h('form', { class: 'stack', novalidate: true }, h('div', { class: 'row row--fields' }, incF.el, incA.el), incErr, h('div', { class: 'row' }, h('button', { class: 'btn btn--secondary', type: 'submit' }, 'Add this change')));
    wire(incForm, incErr, { toast, go }, async () => { await store.update(sid, { adjustments: withIncrease(s, incDate) }); await paint(); return null; }, 'Change added.');
    const incSection = h('section', { class: 'stack' }, h('h2', {}, isIncome ? 'Rent changes' : 'Changes in amount'), h('p', { class: 'sub' }, 'For example a rent increase. From the date you give, every payment uses the new amount.'),
      s.adjustments.length > 0 && h('ul', { class: 'rows' }, s.adjustments.map((a) => h('li', {}, h('div', { class: 'row-line' }, h('span', { class: 'date-col' }, fmtDate(a.from)), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, `${money(a.amountKobo, { compact: false })} each time`)),
        h('div', { class: 'row-end' }, act('Remove', change({ adjustments: withoutIncrease(s, a.from) }))))))), incForm);

    // --- stop / resume / delete ---
    let stopOn = today; const stopErr = errorLine(), stopF = field('Last payment on', dateInput({ value: stopOn, onInput: (v) => { stopOn = v; } }));
    const stopSection = s.status === 'ended'
      ? h('section', { class: 'stack' }, h('h2', {}, 'Stopped'), h('p', { class: 'sub' }, `This regular payment stopped${s.endDate ? ` after ${fmtDate(s.endDate)}` : ''}. Payments already in your ledger are not affected.`), h('div', { class: 'row' }, act('Resume it', change(resumeChange(), 'Resumed.'), { cls: 'btn btn--secondary' })))
      : h('section', { class: 'stack' }, h('h2', {}, 'Stop it'), h('p', { class: 'sub' }, 'If the tenant left or the cost ended, give the date of the last payment. Nothing already recorded changes.'),
        (() => { const f = h('form', { class: 'stack', novalidate: true }, stopF.el, stopErr, h('div', { class: 'row' }, h('button', { class: 'btn btn--secondary', type: 'submit' }, 'Stop on this date')));
          wire(f, stopErr, { toast, go }, async () => { await store.update(sid, stopChange(s, stopOn, today)); await paint(); return null; }, 'Stopped.'); return f; })());
    const del = h('div', { class: 'row' }, h('button', { class: 'btn btn--secondary btn--danger', type: 'button', onclick: async () => {
      await store.remove(sid);
      toast('Regular payment deleted.', { label: 'Undo', run: async () => { await store.restore(sid); window.dispatchEvent(new HashChangeEvent('hashchange')); } });
      go(`${back}/schedule`);
    } }, 'Delete this regular payment'));

    root.replaceChildren(backLink(`${back}/schedule`, 'Regular payments'), h('div', {}, h('h1', { class: 'page-title' }, s.label || (isIncome ? 'Regular income' : 'Regular cost')), h('p', { class: 'sub' }, `${inv.name}. ${sentence(s)}.`)),
      dueSection, h('section', { class: 'stack' }, h('h2', {}, 'Change it'), editForm), skipSection, incSection, stopSection, h('section', { class: 'stack' }, h('h2', {}, 'Delete'), h('p', { class: 'sub' }, 'Removes the schedule only. Entries you already recorded stay in the ledger. You can undo straight afterwards.'), del));
  }
  await paint();
  return root;
}

// ================= change history =================
const LABELS = { name: 'Name', openedOn: 'Start date', closedOn: 'Closing date', status: 'Status', notes: 'Notes', behaviors: 'How it works', rates: 'Rates', customFields: 'Details', categoryId: 'Category', date: 'Date', kind: 'Kind', amountKobo: 'Amount', note: 'Note', valueKobo: 'Value', source: 'Source', label: 'Label', frequency: 'How often', startDate: 'First payment', endDate: 'Last payment', adjustments: 'Changes in amount', skippedDates: 'Skipped payments', everyDays: 'Days between', percentage: 'Share', contributionKobo: 'Put in', effectiveFrom: 'From', effectiveTo: 'Until', text: 'Reminder', dueDate: 'Due', recurrence: 'Repeats', done: 'Done', partnerId: 'Person', linkedScheduleId: 'Regular payment', investmentId: 'Investment', name_: 'Name' };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function showValue(key, v) {
  if (v == null || v === '') return 'empty';
  if (/Kobo$/.test(key) && typeof v === 'number') return money(v, { compact: false });
  if (key === 'percentage') return `${bpToInput(v)}%`;
  if (key === 'kind') return KIND_NAMES[v] || v;
  if (key === 'source') return SOURCE_NAMES[v] || v;
  if (key === 'done') return v ? 'done' : 'not done';
  if (Array.isArray(v)) return plural(v.length, 'item', 'items');
  if (typeof v === 'object') return 'changed';
  if (typeof v === 'string' && ISO_DATE.test(v)) return fmtDate(v);
  const t = String(v); return t.length > 70 ? `${t.slice(0, 67)}…` : t;
}
const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${fmtDate(todayISO(d))}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; };
export function summarise(prev, next) {
  if (!prev) return ['Created.'];
  const out = diffVersions(prev, next).map((d) => (d.key === '_deleted' ? 'Deleted.' : d.key === '_restored' ? 'Restored.' : `${LABELS[d.key] || d.key}: ${showValue(d.key, d.from)} → ${showValue(d.key, d.to)}`));
  return out.length ? out : ['Saved with no visible change.'];
}

async function historyView({ ctx, toast, go, actions }, invId, recordId) {
  const { store } = ctx, id = recordId || invId, back = `#/investments/${invId}`;
  const inv = await store.get(invId, { includeDeleted: true });
  if (!inv || inv.type !== 'investment') return notFound('#/investments', 'Investments', 'This investment');
  let note = '';
  try { if (actions?.sync) await actions.sync.pullHistory(id); } catch (e) { note = e.code === 'OFFLINE' ? 'You are offline, so this shows only the versions saved on this device.' : 'Older versions could not be fetched from the server just now, so this shows what is on this device.'; }
  const root = h('div', { class: 'flow' });
  async function paint() {
    let versions;
    try { versions = await store.history(id); } catch (e) { root.replaceChildren(notFound(back, 'Back to the investment', 'This record')); return; }
    const cur = versions[versions.length - 1], rec = cur.record, kindName = rec.type === 'investment' ? 'investment' : rec.type === 'entry' ? 'ledger entry' : rec.type;
    const restore = async (v) => {
      const yes = await confirmDialog({ title: `Restore version ${v.version}?`, body: `Version ${v.version} becomes the current one, saved as a new version. Nothing is lost: the version you have now stays in the history, so you can switch back.`, confirmLabel: 'Restore' });
      if (!yes) return;
      const before = cur.version;
      try {
        await store.revertTo(id, v.version);
        toast(`Restored version ${v.version}.`, { label: 'Undo', run: async () => { try { await store.revertTo(id, before); } catch (e) { toast('Could not undo.'); } await paint(); window.dispatchEvent(new HashChangeEvent('hashchange')); } });
        await paint();
      } catch (e) { toast(saveFailed(e)); }
    };
    const items = [...versions].reverse().map((v) => {
      const prev = versions.slice(0, versions.indexOf(v)).reverse().find((x) => x.record);
      return h('li', { class: 'version' }, h('div', { class: 'version-head' }, h('strong', {}, v.current ? `Version ${v.version} (now)` : `Version ${v.version}`), h('span', { class: 'row-sub' }, when(v.savedAt))),
        v.unreadable ? h('p', { class: 'sub' }, 'This version could not be read.') : h('ul', { class: 'diff' }, summarise(prev?.record, v.record).map((t) => h('li', {}, t))),
        !v.current && !v.unreadable && h('div', { class: 'row' }, h('button', { class: 'btn btn--secondary btn--small', type: 'button', onclick: () => restore(v) }, icon('undo', { size: 16 }), 'Restore this version')));
    });
    root.replaceChildren(backLink(back, 'Back to the investment'), h('div', {}, h('h1', { class: 'page-title' }, 'Change history'), h('p', { class: 'sub' }, `This ${kindName}${rec.name ? `: ${rec.name}` : ''}. Every save is kept, newest first.`)),
      note && h('p', { class: 'note-box' }, note), h('ol', { class: 'versions' }, items));
  }
  await paint();
  return root;
}

// ================= who shares it =================
async function sharesView({ ctx, toast, go }, invId) {
  const { store } = ctx, back = `#/investments/${invId}`, today = todayISO();
  const inv = await store.get(invId);
  if (!inv || inv.type !== 'investment') return notFound('#/investments', 'Investments', 'This investment');
  const [ownership, partners] = [(await store.list('ownership')).filter((o) => o.investmentId === invId), await store.list('partner')];
  const d = sharesDraft(ownership, partners, today), originalNames = new Map(d.rows.filter((r) => r.ref && r.ref !== 'me').map((r) => [r.ref, r.name]));
  const root = h('div', { class: 'flow' }), err = errorLine(), rowsBox = h('div', { class: 'stack' }), totals = h('p', { class: 'sub', 'aria-live': 'polite' });
  let reg = {};
  const F = (key, label, make, opts) => { const f = field(label, make, opts); reg[key] = f; return f.el; };
  const general = h('p', { class: 'alert alert--error', role: 'alert', hidden: true });
  const drawTotals = () => { let bp = 0; for (const r of d.rows) { const n = Number((r.share || '').replace(/[%\s]/g, '')); if (Number.isFinite(n)) bp += Math.round(n * 100); } totals.textContent = `Shares add up to ${bpToInput(bp) || '0'}% of 100%.`; };
  const drawRows = () => {
    for (const k of Object.keys(reg)) if (k.startsWith('rows')) delete reg[k];
    reg.rows = { setError: (m) => { general.textContent = m || ''; general.hidden = !m; }, control: general };
    rowsBox.replaceChildren(...d.rows.map((r, i) => {
      const used = new Set(d.rows.map((x, j) => (j === i ? null : x.ref))), pick = [['', 'Someone new'], ...partners.filter((p) => !used.has(p.id) || p.id === r.ref).map((p) => [p.id, p.name])];
      return h('section', { class: 'person' }, h('div', { class: 'person-head' }, h('h2', {}, r.ref === 'me' ? 'You' : r.name || `Person ${i + 1}`), r.ref !== 'me' && d.rows.length > 2 && h('button', { class: 'link-btn', type: 'button', onclick: () => { d.rows.splice(i, 1); drawRows(); drawTotals(); } }, 'Remove')),
        r.ref === '' && partners.length > 0 && F(`rows.${i}.ref`, 'Who is it?', selectInput({ value: r.ref, options: pick, onChange: (v) => { r.ref = v; const k = partners.find((p) => p.id === v); if (k) r.name = k.name; drawRows(); } })),
        r.ref !== 'me' && F(`rows.${i}.name`, r.ref ? 'Name' : 'Name of the new person', textInput({ value: r.name, maxlength: 80, onInput: (v) => { r.name = v; } })),
        h('div', { class: 'row row--fields' }, F(`rows.${i}.share`, 'Share (%)', textInput({ value: r.share, inputmode: 'decimal', onInput: (v) => { r.share = v; drawTotals(); } })), (() => { const f = moneyField('Put in', { value: r.putIn, allowZero: true, onInput: (v) => { r.putIn = v; } }); reg[`rows.${i}.putIn`] = f; return f.el; })()));
    }));
  };
  const dateBox = h('div', {}), drawDate = () => { dateBox.replaceChildren(d.mode === 'change' ? F('date', 'The shares changed on', dateInput({ value: d.date, onInput: (v) => { d.date = v; } }), { hint: 'The old shares apply up to this day, the new ones from it. Income received earlier keeps the old split.' }) : ''); };
  drawRows(); drawTotals(); drawDate();
  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'What are you doing?'), choiceList({ name: 'mode', label: 'Fix or change', value: d.mode, onChange: (v) => { d.mode = v; drawDate(); },
      options: [['correct', 'Fixing a mistake', 'The shares were entered wrongly. The fix applies from the very start.'], ['change', 'The shares really changed', 'Someone bought in or out. The new shares start on a date you choose.']] })), dateBox,
    general, rowsBox, totals,
    h('div', { class: 'row' }, h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => { d.rows.push({ ref: '', name: '', share: '', putIn: '0' }); drawRows(); } }, 'Add another person')),
    err, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Save shares'), h('a', { class: 'btn btn--secondary', href: back }, 'Cancel')));
  form.addEventListener('submit', (e) => { const errs = sharesErrors(d); if (errs.length) { e.stopImmediatePropagation(); e.preventDefault(); showErrors(reg, errs)?.control.focus?.(); } }, true);
  wire(form, err, { toast, go }, async () => {
    const plan = buildSharesPlan(d, { ownership, openedOn: inv.openedOn, today });
    await applySharesPlan(store, invId, plan);
    for (const r of d.rows) if (r.ref && r.ref !== 'me' && originalNames.has(r.ref) && originalNames.get(r.ref) !== r.name.trim() && r.name.trim()) await store.update(r.ref, { name: r.name.trim() });
  }, 'Shares saved.', back);
  root.append(backLink(back, 'Back to the investment'), h('div', {}, h('h1', { class: 'page-title' }, 'Who shares it'), h('p', { class: 'sub' }, inv.name)), form);
  return root;
}

// ================= reminders =================
async function remindersList({ ctx, toast, go }) {
  const { store } = ctx, today = todayISO();
  const root = h('div', { class: 'flow' });
  async function paint() {
    const [all, invs] = await Promise.all([store.list('reminder'), store.list('investment')]), name = new Map(invs.map((i) => [i.id, i.name]));
    const live = all.filter((r) => !r.investmentId || name.has(r.investmentId)), active = live.filter((r) => !r.done).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)), done = live.filter((r) => r.done).sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
    const row = (r) => h('li', {}, h('div', { class: 'row-line' }, h('span', { class: `date-col${!r.done && r.dueDate < today ? ' overdue' : ''}` }, fmtDate(r.dueDate)),
      h('a', { class: 'row-main row-link', href: `#/reminders/${r.id}` }, h('div', { class: 'row-title' }, r.text), h('div', { class: 'row-sub' }, [r.investmentId && name.get(r.investmentId), r.recurrence !== 'none' && RECURRENCE_CHOICES.find(([k]) => k === r.recurrence)[1].toLowerCase(), !r.done && r.dueDate < today && 'overdue'].filter(Boolean).join(', '))),
      !r.done && h('div', { class: 'row-end' }, h('button', { class: 'btn btn--secondary btn--small', type: 'button', onclick: (e) => withBusy(e.currentTarget, async () => { await store.update(r.id, completeChange(r, today)); toast(r.recurrence === 'none' ? 'Marked done.' : 'Done. Next one set.'); await paint(); }) }, 'Done'))));
    root.replaceChildren(h('div', { class: 'page-actions' }, h('h1', { class: 'page-title' }, 'Reminders'), h('a', { class: 'btn btn--small', href: '#/reminders/new' }, icon('plus'), 'Add a reminder')),
      active.length ? h('ul', { class: 'rows' }, active.map(row)) : h('div', { class: 'mini-empty' }, icon('calendar', { size: 20 }), h('span', {}, 'No reminders. Add one for a tax date, a lease renewal, a maturity or anything you might forget.')),
      done.length > 0 && h('details', { class: 'working' }, h('summary', {}, `Done (${done.length})`), h('ul', { class: 'rows' }, done.map(row))));
  }
  await paint();
  return root;
}

async function reminderForm({ ctx, toast, go }, reminderId, presetInvId) {
  const { store } = ctx, rec = reminderId ? await store.get(reminderId) : null;
  if (reminderId && (!rec || rec.type !== 'reminder')) return notFound('#/reminders', 'Reminders', 'This reminder');
  const invs = (await store.list('investment')).sort((a, b) => a.name.localeCompare(b.name));
  const f = { text: rec?.text || '', date: rec?.dueDate || todayISO(), recurrence: rec?.recurrence || 'none', inv: rec?.investmentId || (invs.some((i) => i.id === presetInvId) ? presetInvId : '') };
  const err = errorLine(), reg = {};
  const F = (key, label, make, opts) => { const x = field(label, make, opts); reg[key] = x; return x.el; };
  const form = h('form', { class: 'stack', novalidate: true },
    F('text', 'What do you want to be reminded of?', textInput({ value: f.text, onInput: (v) => { f.text = v; }, maxlength: 300, placeholder: 'For example: Renew the tenancy agreement' })),
    F('date', 'On', dateInput({ value: f.date, onInput: (v) => { f.date = v; } })),
    F('recurrence', 'Repeats', selectInput({ value: f.recurrence, options: RECURRENCE_CHOICES, onChange: (v) => { f.recurrence = v; } })),
    F('inv', 'About which investment?', selectInput({ value: f.inv, options: [['', 'Not about one investment'], ...invs.map((i) => [i.id, i.name])], onChange: (v) => { f.inv = v; } }), { optional: true }),
    err, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, rec ? 'Save changes' : 'Save reminder'), h('a', { class: 'btn btn--secondary', href: '#/reminders' }, 'Cancel')));
  wire(form, err, { toast, go }, async () => {
    const data = buildReminder(f, f.inv || null);
    if (rec) await store.update(reminderId, { ...data, done: rec.done }); else await store.create('reminder', data);
  }, rec ? 'Reminder updated.' : 'Reminder saved.', '#/reminders');
  const del = rec && h('div', { class: 'row' }, h('button', { class: 'btn btn--secondary btn--danger', type: 'button', onclick: async () => {
    await store.remove(reminderId);
    toast('Reminder deleted.', { label: 'Undo', run: async () => { await store.restore(reminderId); window.dispatchEvent(new HashChangeEvent('hashchange')); } }); go('#/reminders');
  } }, 'Delete this reminder'));
  return h('div', { class: 'flow' }, backLink('#/reminders', 'Reminders'), h('h1', { class: 'page-title' }, rec ? 'Edit reminder' : 'Add a reminder'), form, del);
}

// ================= recently deleted =================
async function deletedView({ ctx, toast }) {
  const { store } = ctx, root = h('div', { class: 'flow' });
  const nameOf = (it) => {
    const r = it.record, inv = it.investment?.name;
    if (it.type === 'investment') return [r.name, 'Investment and everything recorded under it'];
    if (it.type === 'entry') return [`${KIND_NAMES[r.kind]}: ${money(r.amountKobo, { compact: false })}`, `${fmtDate(r.date)}, in ${inv}`];
    if (it.type === 'valuation') return [`Valuation: ${money(r.valueKobo, { compact: false })}`, `${fmtDate(r.date)}, in ${inv}`];
    if (it.type === 'schedule') return [r.label || 'Regular payment', `in ${inv}`];
    if (it.type === 'document') return [r.label || r.filename, `Document, in ${inv}`];
    if (it.type === 'categoryTemplate') return [r.name, 'Category you made'];
    return [r.text, inv ? `Reminder, ${inv}` : 'Reminder'];
  };
  // Delete forever is offered for documents only: it removes the locked file from the server, on every device.
  const forever = (it) => it.type === 'document' && ctx.files && h('button', { class: 'btn btn--secondary btn--small btn--danger', type: 'button', onclick: async (e) => {
    const yes = await confirmDialog({ title: 'Delete this document forever?', body: 'The locked file is removed from the server and from every device. This cannot be undone, and the document cannot be restored afterwards.', confirmLabel: 'Delete forever', danger: true });
    if (!yes) return;
    await withBusy(e.currentTarget, async () => {
      try { await purgeDocument({ store, files: ctx.files.api, doc: it.record }); toast('Document deleted forever.'); await paint(); }
      catch (x) { toast(x instanceof InputError || ['OFFLINE', 'AUTH', 'SERVER'].includes(x?.code) ? x.message : 'Could not delete it. Nothing was changed.'); if (!(x instanceof InputError) && !x?.code) console.error(x); }
    });
  } }, 'Delete forever');
  async function paint() {
    const items = await deletedItems(store);
    root.replaceChildren(h('h1', { class: 'page-title' }, 'Recently deleted'), h('p', { class: 'sub' }, 'Anything you delete is kept, so you can bring it back. Restoring an investment brings back everything recorded under it.'),
      items.length ? h('ul', { class: 'rows' }, items.map((it) => { const [title, sub] = nameOf(it); return h('li', {}, h('div', { class: 'row-line' }, h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, title), h('div', { class: 'row-sub' }, `${sub}. Deleted ${when(it.record.deletedAt)}`)),
        h('div', { class: 'row-end' }, h('button', { class: 'btn btn--secondary btn--small', type: 'button', onclick: (e) => withBusy(e.currentTarget, async () => { await store.restore(it.record.id); toast('Restored.'); await paint(); }) }, 'Restore'), forever(it)))); }))
        : h('div', { class: 'mini-empty' }, icon('checkCircle', { size: 20 }), h('span', {}, 'Nothing has been deleted.')));
  }
  await paint();
  return root;
}
