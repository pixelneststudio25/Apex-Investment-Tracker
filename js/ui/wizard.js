// The add-investment wizard: one question group per screen, then a review where everything can be changed.
// All rules (what is valid, which steps apply, what gets saved) live in js/models/wizard.js; this file only
// draws the screens and passes what the person typed into the draft.
import { h } from './dom.js';
import { setBusy } from './motion.js';
import { icon } from './icons.js';
import { allocate, scheduleEntries } from '../engine/index.js';
import { fmtDate, money, pct } from './fmt.js';
import { checkbox, choiceList, dateInput, field, moneyField, percentField, segmented, selectInput, showErrors, textArea, textInput } from './formkit.js';
import { InputError, bpToInput, koboToInput, optionalDate, parseNaira, parseShareBp, wholeNumber, checkDate } from '../models/inputs.js';
import { COMPOUND_CHOICES, FREQUENCY_CHOICES, INCOME_CHOICES, RATE_BASED, SOURCE_CHOICES, STEP_TITLES, VALUE_CHOICES, applyTemplate, buildPlan, hasTerm, newDraft, savePlan, stepErrors, stepsFor } from '../models/wizard.js';

const pctShort = (f) => pct(f).replace(/\.?0+%$/, '%');
const label = (choices, v) => (choices.find((c) => c[0] === v) || [v, v])[1];

export function wizardView({ store, templates, partners, today, toast, go }) {
  const root = h('div', { class: 'flow wizard' });
  let draft = newDraft(today), step = 'category', reg = {}, saving = false;
  const tplOf = () => templates.find((t) => t.id === draft.templateId) || null;
  const stepList = () => stepsFor(draft, tplOf());
  const dirty = () => !!(draft.templateId && (draft.name.trim() || draft.capital.amount.trim()));

  // F registers a field under the key that stepErrors() reports, so errors land on the right input.
  const F = (key, text, make, opts) => { const f = field(text, make, opts); reg[key] = f; return f.el; };
  const M = (key, text, opts) => { const f = moneyField(text, opts); reg[key] = f; return f.el; };

  function draw() {
    reg = {};
    const steps = stepList(), idx = steps.indexOf(step);
    const title = h('h1', { class: 'page-title', tabindex: '-1' }, STEP_TITLES[step]);
    const body = ({ category, basics, details, money: moneyStep, value: valueStep, income: incomeStep, people: peopleStep, review })[step]();
    root.replaceChildren(
      h('div', { class: 'wizard-top' },
        h('button', { class: 'back back--btn', type: 'button', onclick: cancel }, icon('chevronLeft', { size: 18 }), 'Cancel'),
        h('p', { class: 'sub' }, `Step ${idx + 1} of ${steps.length}`)),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(steps.length), 'aria-valuenow': String(idx + 1), 'aria-label': 'Progress' },
        steps.map((s, i) => h('span', { class: i <= idx ? 'on' : '' }))),
      title, body, footer(steps, idx));
    title.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function cancel() {
    if (dirty() && !window.confirm('Discard this new investment? What you entered will be lost.')) return;
    go('#/investments');
  }
  function footer(steps, idx) {
    if (step === 'category') return h('div', {});
    const last = step === 'review';
    return h('div', { class: 'row wizard-foot' },
      h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => { step = steps[idx - 1]; draw(); } }, 'Back'),
      last ? h('button', { class: 'btn', type: 'button', id: 'save-btn', onclick: save }, 'Save investment') : h('button', { class: 'btn', type: 'button', onclick: next }, 'Continue'));
  }
  function next() {
    const steps = stepList(), errs = stepErrors(draft, step, tplOf(), { today });
    if (errs.length) {
      const first = showErrors(reg, errs);
      if (first) first.control.focus(); else toast(errs[0].message);
      return;
    }
    step = steps[steps.indexOf(step) + 1]; draw();
  }

  // ---------- 1. category ----------
  function category() {
    return h('div', { class: 'stack' },
      h('p', { class: 'sub' }, 'Pick the closest match. It only sets sensible starting answers, and you can change every one of them.'),
      h('div', { class: 'cat-grid' }, templates.map((t) => h('button', { class: 'cat', type: 'button', 'aria-pressed': String(t.id === draft.templateId),
        onclick: () => { if (t.id !== draft.templateId) draft = applyTemplate(draft, t, today); step = 'basics'; draw(); } },
      h('span', { class: 'tile' }, icon(t.icon)), h('span', { class: 'cat-name' }, t.name)))));
  }

  // ---------- 2. basics ----------
  function basics() {
    const tpl = tplOf();
    return h('div', { class: 'stack' },
      F('name', 'Name', textInput({ value: draft.name, onInput: (v) => { draft.name = v; }, maxlength: 120, placeholder: 'For example: Plot at Ibeju-Lekki', autocomplete: 'off' }), { hint: 'Something you will recognise at a glance.' }),
      F('openedOn', 'Start date', dateInput({ value: draft.openedOn, onInput: (v) => { draft.openedOn = v; } }), { hint: 'The day you bought it or first put money in.' }),
      hasTerm(tpl) && F('maturityDate', 'Maturity date', dateInput({ value: draft.maturityDate, onInput: (v) => { draft.maturityDate = v; } }), { hint: 'The day it is due to pay out.' }),
      h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'Who owns it?'),
        choiceList({ name: 'ownership', label: 'Who owns it', value: draft.ownership, onChange: (v) => { draft.ownership = v; draw(); },
          options: [['sole', 'Just me'], ['shared', 'Shared with other people', 'Apex will ask who is in it and how much each person put in.']] })),
      F('notes', 'Notes', textArea({ value: draft.notes, onInput: (v) => { draft.notes = v; }, maxlength: 5000 }), { optional: true }));
  }

  // ---------- 3. details ----------
  function details() {
    return h('div', { class: 'stack' }, h('p', { class: 'sub' }, `Everything here is optional. It helps you find the paperwork later.`),
      ...(tplOf().customFieldDefs || []).map((d) => F(d.key, d.label, textInput({ value: draft.fields[d.key] ?? '', onInput: (v) => { draft.fields[d.key] = v; },
        type: d.type === 'date' ? 'date' : 'text', inputmode: d.type === 'number' ? 'decimal' : undefined, maxlength: 500 }), { optional: true })));
  }

  // ---------- 4. money put in ----------
  function moneyStep() {
    return h('div', { class: 'stack' },
      M('capital.amount', 'Amount you put in', { value: draft.capital.amount, onInput: (v) => { draft.capital.amount = v; }, hint: 'The price you paid. Later costs, like legal fees, can be added in the ledger afterwards.' }),
      F('capital.date', 'Date paid', dateInput({ value: draft.capital.date, onInput: (v) => { draft.capital.date = v; } }), { optional: true, hint: 'Leave empty to use the start date.' }),
      F('capital.note', 'Note', textInput({ value: draft.capital.note, onInput: (v) => { draft.capital.note = v; }, maxlength: 1000, placeholder: 'For example: Purchase price' }), { optional: true }));
  }

  // ---------- 5. value ----------
  function valueStep() {
    const r = draft.rate, based = RATE_BASED.includes(draft.valueChange), out = h('div', { class: 'stack' });
    out.append(choiceList({ name: 'value', label: 'How its value changes', value: draft.valueChange, options: VALUE_CHOICES,
      onChange: (v) => { draft.valueChange = v; if (v === 'interest') r.type = 'agreed'; else if (r.type === 'agreed') r.type = 'assumed'; draw(); } }));
    if (based) {
      const verb = draft.valueChange === 'depreciation' ? 'How much it loses' : draft.valueChange === 'interest' ? 'Interest rate' : 'How much it grows';
      out.append(h('section', { class: 'stack subsection' }, h('h2', {}, 'The rate'),
        h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'Where does this rate come from?'),
          segmented({ label: 'Rate source', value: r.type, options: [['assumed', 'My own assumption'], ['agreed', 'Agreed with someone']], onChange: (v) => { r.type = v; } })),
        (() => { const f = percentField(verb, { value: r.percent, onInput: (v) => { r.percent = v; }, optional: draft.valueChange !== 'interest', hint: 'Type it as you say it: 12 or 12.5. Leave it empty if you would rather not assume anything.' }); reg['rate.percent'] = f; return f.el; })(),
        h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'Per'), segmented({ label: 'Rate period', value: r.unit, options: [['year', 'a year'], ['month', 'a month']], onChange: (v) => { r.unit = v; if (r.method === 'compound') r.per = ''; draw(); } })),
        h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'How it adds up'),
          segmented({ label: 'Simple or compounding', value: r.method, options: [['simple', 'Simple'], ['compound', 'Compounding']], onChange: (v) => { r.method = v; draw(); } }),
          h('p', { class: 'hint' }, r.method === 'simple' ? 'Simple: each period adds the same amount, based on what you first put in.' : 'Compounding: what it has already gained also earns, so growth speeds up.')),
        r.method === 'compound' && F('rate.per', 'Compounds', selectInput({ value: r.per || (r.unit === 'month' ? '12' : '1'), options: COMPOUND_CHOICES, onChange: (v) => { r.per = v; } })),
        F('rate.from', 'Rate starts on', dateInput({ value: r.from, onInput: (v) => { r.from = v; } }), { optional: true, hint: 'Leave empty to start from the start date.' })));
    }
    if (draft.valueChange !== 'none') {
      const c = draft.current;
      out.append(h('section', { class: 'stack subsection' }, h('h2', {}, 'Its value today'),
        h('p', { class: 'sub' }, draft.valueChange === 'manualOnly' ? 'Because you will update this by hand, enter what it is worth now if you know it. You can also do it later.' : 'Optional. A value you enter overrides the rate, because a real valuation beats an assumption.'),
        M('current.amount', 'Worth today', { value: c.amount, allowZero: true, onInput: (v) => { c.amount = v; }, optional: true }),
        F('current.date', 'Valuation date', dateInput({ value: c.date, onInput: (v) => { c.date = v; } })),
        F('current.source', 'Where does the figure come from?', selectInput({ value: c.source, options: SOURCE_CHOICES, onChange: (v) => { c.source = v; } }))));
    }
    return out;
  }

  // ---------- 6. income ----------
  function incomeStep() {
    const s = draft.schedule, out = h('div', { class: 'stack' });
    out.append(choiceList({ name: 'income', label: 'Income it pays', value: draft.income, options: INCOME_CHOICES, onChange: (v) => { draft.income = v; draw(); } }));
    if (draft.income === 'irregular') out.append(h('p', { class: 'note-box' }, 'You will add each payout or payment from the Ledger tab when it arrives.'));
    if (draft.income !== 'schedule') return out;
    const past = h('div', {});
    const drawPast = () => {
      let info = null;
      try {
        const due = scheduleEntries({ amountKobo: parseNaira(s.amount), frequency: s.frequency, everyDays: s.frequency === 'custom' ? wholeNumber(s.everyDays) : null, startDate: checkDate(s.start), endDate: optionalDate(s.end), adjustments: [], skippedDates: [] }, today);
        if (due.length) info = { count: due.length, total: due.reduce((a, e) => a + e.amountKobo, 0) };
      } catch (e) { if (!(e instanceof InputError)) throw e; }
      past.replaceChildren(info ? h('div', { class: 'stack' },
        checkbox({ label: `Record the ${info.count} ${info.count === 1 ? 'payment' : 'payments'} already due (${money(info.total, { compact: false })} in total) as received`, checked: s.recordPast, onChange: (v) => { s.recordPast = v; } }),
        h('p', { class: 'hint' }, 'Leave this off if you would rather add each payment yourself when you receive it. Apex never assumes money arrived.')) : '');
    };
    const on = (k) => (v) => { s[k] = v; drawPast(); };
    out.append(h('section', { class: 'stack subsection' }, h('h2', {}, 'The regular payment'),
      F('schedule.label', 'What is it called?', textInput({ value: s.label, onInput: (v) => { s.label = v; }, maxlength: 120, placeholder: 'For example: Yearly rent' }), { optional: true }),
      M('schedule.amount', 'Amount each time', { value: s.amount, onInput: on('amount') }),
      F('schedule.frequency', 'How often?', selectInput({ value: s.frequency, options: FREQUENCY_CHOICES, onChange: (v) => { s.frequency = v; draw(); } })),
      s.frequency === 'custom' && F('schedule.everyDays', 'Number of days between payments', textInput({ value: s.everyDays, inputmode: 'numeric', onInput: on('everyDays') })),
      F('schedule.start', 'First payment date', dateInput({ value: s.start, onInput: on('start') })),
      F('schedule.end', 'Last payment date', dateInput({ value: s.end, onInput: on('end') }), { optional: true, hint: 'Leave empty if it carries on.' }),
      past));
    drawPast();
    return out;
  }

  // ---------- 7. people ----------
  function peopleStep() {
    const rows = draft.people, rowsBox = h('div', { class: 'stack' });
    const general = h('p', { class: 'alert alert--error', role: 'alert', hidden: true });
    reg.people = { setError: (m) => { general.textContent = m || ''; general.hidden = !m; }, control: general };
    const totals = h('p', { class: 'sub', 'aria-live': 'polite' });
    const capital = () => { try { return parseNaira(draft.capital.amount); } catch { return null; } };
    const drawTotals = () => {
      let bp = 0, put = 0;
      for (const p of rows) { try { bp += parseShareBp(p.share); } catch { /* not typed yet */ } try { put += parseNaira(p.putIn || '0', { allowZero: true }); } catch { /* not typed yet */ } }
      const cap = capital();
      totals.textContent = `Shares add up to ${bpToInput(bp) || '0'}% of 100%. Put in so far: ${money(put, { compact: false })}${cap != null ? ` of ${money(cap, { compact: false })}` : ''}.`;
    };
    const drawRows = () => {
      for (const k of Object.keys(reg)) if (k.startsWith('people.')) delete reg[k];
      rowsBox.replaceChildren(...rows.map((p, i) => {
        const used = new Set(rows.map((x, j) => (j === i ? null : x.ref)));
        const choices = [['', 'Someone new'], ...partners.filter((x) => !used.has(x.id)).map((x) => [x.id, x.name])];
        return h('section', { class: 'person' },
          h('div', { class: 'person-head' }, h('h2', {}, p.ref === 'me' ? 'You' : `Person ${i}`),
            i >= 2 && h('button', { class: 'link-btn', type: 'button', onclick: () => { rows.splice(i, 1); drawRows(); drawTotals(); } }, 'Remove')),
          p.ref !== 'me' && partners.length > 0 && F(`people.${i}.ref`, 'Who is it?', selectInput({ value: p.ref, options: choices, onChange: (v) => { p.ref = v; const known = partners.find((x) => x.id === v); if (known) p.name = known.name; drawRows(); } })),
          p.ref !== 'me' && !p.ref && F(`people.${i}.name`, 'Name', textInput({ value: p.name, maxlength: 80, onInput: (v) => { p.name = v; } })),
          h('div', { class: 'row row--fields' },
            F(`people.${i}.share`, 'Share (%)', textInput({ value: p.share, inputmode: 'decimal', placeholder: 'for example 50', onInput: (v) => { p.share = v; drawTotals(); } })),
            M(`people.${i}.putIn`, 'Put in', { value: p.putIn, allowZero: true, onInput: (v) => { p.putIn = v; drawTotals(); } })));
      }));
    };
    drawRows(); drawTotals();
    const fill = () => {
      const cap = capital();
      try {
        if (cap == null) throw new InputError('Enter the money put in first (step 4).');
        const parts = allocate(cap, rows.map((p) => parseShareBp(p.share)));
        rows.forEach((p, i) => { p.putIn = koboToInput(parts[i]); });
        drawRows(); drawTotals();
      } catch (e) { if (e instanceof InputError) toast(e.message); else throw e; }
    };
    return h('div', { class: 'stack' },
      h('p', { class: 'sub' }, 'List everyone in it, you included. Each share is a percentage of the whole, and what each person put in must add up to the total you entered.'),
      general, rowsBox, totals,
      h('div', { class: 'row' },
        h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => { rows.push({ ref: '', name: '', share: '', putIn: '' }); drawRows(); } }, 'Add another person'),
        h('button', { class: 'btn btn--secondary', type: 'button', onclick: fill }, 'Fill amounts from shares')));
  }

  // ---------- 8. review ----------
  function review() {
    const tpl = tplOf(), errs = stepErrors(draft, 'review', tpl, { today });
    if (errs.length) {
      return h('div', { class: 'stack' }, h('p', { class: 'alert alert--warn' }, 'A few answers need another look before this can be saved.'),
        h('ul', { class: 'rows' }, errs.map((e) => h('li', {}, h('div', { class: 'row-line' }, h('div', { class: 'row-main' }, e.message),
          h('button', { class: 'link-btn', type: 'button', onclick: () => { step = e.step; draw(); } }, 'Fix'))))));
    }
    const plan = buildPlan(draft, tpl, { today }), inv = plan.investment, rate = inv.rates[0];
    const rows = (pairs) => h('dl', { class: 'defs' }, pairs.filter(Boolean).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    const section = (title, to, pairs) => h('section', {}, h('div', { class: 'section-head' }, h('h2', {}, title), h('button', { class: 'link-btn', type: 'button', onclick: () => { step = to; draw(); } }, 'Change')), rows(pairs));
    const valueText = !rate ? label(VALUE_CHOICES, inv.behaviors.valueChange)
      : `${rate.type === 'agreed' ? 'Agreed' : 'Assumed'} ${inv.behaviors.valueChange === 'depreciation' ? 'loss' : inv.behaviors.valueChange === 'interest' ? 'interest' : 'growth'} of ${pctShort(Math.abs(rate.rate))} ${rate.rateUnit === 'month' ? 'a month' : 'a year'}, ${rate.method === 'compound' ? `compounding ${label(COMPOUND_CHOICES, String(rate.compoundsPerYear)).toLowerCase()}` : 'simple'}`;
    const sched = plan.schedule;
    const out = h('div', { class: 'stack' }, h('p', { class: 'sub' }, 'Nothing is saved until you press Save. This is exactly what Apex will record.'),
      section('The investment', 'basics', [['Category', tpl.name], ['Name', inv.name], ['Started', fmtDate(inv.openedOn)], inv.behaviors.term && ['Matures', fmtDate(inv.behaviors.term.maturityDate)], ['Owned', inv.behaviors.ownership === 'shared' ? 'Shared' : 'Just you'], inv.notes && ['Notes', inv.notes]]),
      Object.keys(inv.customFields).length > 0 && section('Details', 'details', (tpl.customFieldDefs || []).filter((d) => inv.customFields[d.key] != null).map((d) => [d.label, String(inv.customFields[d.key])])),
      section('Money put in', 'money', [['Amount', money(plan.entries[0].amountKobo, { compact: false })], ['Date', fmtDate(plan.entries[0].date)], plan.entries[0].note && ['Note', plan.entries[0].note]]),
      section('Value', 'value', [['How it changes', valueText], plan.valuation && ['Worth today', `${money(plan.valuation.valueKobo, { compact: false })} on ${fmtDate(plan.valuation.date)} (${label(SOURCE_CHOICES, plan.valuation.source).toLowerCase()})`]]),
      section('Income', 'income', [['Income', sched ? `${sched.label}: ${money(sched.amountKobo, { compact: false })} ${sched.frequency === 'custom' ? `every ${sched.everyDays} days` : sched.frequency}, from ${fmtDate(sched.startDate)}${sched.endDate ? ` to ${fmtDate(sched.endDate)}` : ''}` : label(INCOME_CHOICES, inv.behaviors.income)],
        sched && plan.pastCount > 0 && ['Already due', plan.recordPast ? `${plan.pastCount} payments (${money(plan.pastTotalKobo, { compact: false })}) will be recorded as received` : `${plan.pastCount} payments, not recorded as received`]]));
    if (plan.ownership.length) {
      const name = (o) => (o.partnerRef.me ? 'You' : o.partnerRef.id ? partners.find((x) => x.id === o.partnerRef.id)?.name : plan.partners.find((x) => x.key === o.partnerRef.newKey)?.name);
      out.append(section('People', 'people', plan.ownership.map((o) => [name(o), `${bpToInput(o.percentage)}%, put in ${money(o.contributionKobo, { compact: false })}`])));
    }
    out.append(h('p', { class: 'alert alert--error', id: 'save-error', role: 'alert', hidden: true }));
    return out;
  }

  async function save() {
    if (saving) return;
    const btn = root.querySelector('#save-btn'), errBox = root.querySelector('#save-error');
    saving = true; setBusy(btn, true); errBox.hidden = true;
    try {
      const { investmentId } = await savePlan(store, buildPlan(draft, tplOf(), { today }));
      toast('Investment saved.');
      go(`#/investments/${investmentId}`);
    } catch (e) {
      saving = false; setBusy(btn, false);
      errBox.hidden = false; errBox.textContent = e.code === 'INVALID' || e.code === 'INPUT' || e.code === 'LOCKED' ? e.message : 'Could not save. Nothing was changed. Please try again.';
      if (!(e.code === 'INVALID' || e.code === 'INPUT' || e.code === 'LOCKED')) console.error(e);
    }
  }
  draw();
  return root;
}
