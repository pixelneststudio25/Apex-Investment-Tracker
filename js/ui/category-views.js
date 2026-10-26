// Screens for your own categories: the list, and one form to add or change one. The rules live in
// js/models/categories.js (tested). No inline styles, no innerHTML.
import { h } from './dom.js';
import { icon } from './icons.js';
import { withBusy } from './motion.js';
import { choiceList, field, selectInput, showErrors, textInput } from './formkit.js';
import { InputError } from '../models/inputs.js';
import { BUILT_IN_TEMPLATES, findTemplate } from '../models/templates.js';
import { CATEGORY_ICONS, FIELD_TYPES, INCOME_CHOICES, MAX_FIELDS, OWNERSHIP_CHOICES, VALUE_CHOICES, categoryDraft, categoryErrors, categoryUsage, describeCategory, removeCategory, saveCategory, takenNames } from '../models/categories.js';

const ICON_NAMES = { land: 'Land', house: 'House', building: 'Building', car: 'Vehicle', users: 'People', handshake: 'Business', landmark: 'Bank', coins: 'Coins', sprout: 'Farm', wrench: 'Equipment', gem: 'Valuables', bitcoin: 'Crypto', chart: 'Chart', frame: 'Art', piggy: 'Savings', tag: 'Other' };
const backLink = (href, text) => h('a', { class: 'back', href }, icon('chevronLeft', { size: 18 }), text);
const usageText = (u) => (u.live === 0 ? 'Not used yet' : `Used by ${u.live === 1 ? '1 investment' : `${u.live} investments`}`);

export async function categoryView(env, parts) {
  const [, a, b, c] = parts;
  if (!a) return listScreen(env);
  if (a === 'new') return formScreen(env, { startFrom: b && b !== 'blank' ? b : null, afterWizard: c === 'wizard' });
  return formScreen(env, { id: a });
}

async function listScreen({ ctx }) {
  const customs = await ctx.store.list('categoryTemplate');
  const usage = await Promise.all(customs.map((c) => categoryUsage(ctx.store, c.id)));
  return h('div', { class: 'flow' }, backLink('#/settings', 'Settings'), h('h1', { class: 'page-title' }, 'My categories'),
    h('p', { class: 'sub' }, 'A category sets the starting answers when you add an investment, and the extra details to ask for. Apex already has the usual ones. Add your own for anything that does not fit.'),
    customs.length
      ? h('ul', { class: 'rows' }, customs.map((t, i) => h('li', {}, h('a', { class: 'row-line', href: `#/categories/${t.id}` },
        h('span', { class: 'tile', 'aria-hidden': 'true' }, icon(t.icon)),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, t.name), h('div', { class: 'row-sub' }, describeCategory(t)), h('div', { class: 'row-sub' }, usageText(usage[i]))),
        icon('chevronRight', { size: 18 })))))
      : h('div', { class: 'mini-empty' }, icon('tag', { size: 20 }), h('span', {}, 'You have not added a category yet.')),
    h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/categories/new' }, icon('plus'), 'Add a category')));
}

async function formScreen({ ctx, toast, go }, { id = null, startFrom = null, afterWizard = false }) {
  const { store } = ctx, customs = await store.list('categoryTemplate');
  const rec = id ? customs.find((c) => c.id === id) : null;
  if (id && !rec) return h('div', { class: 'flow' }, backLink('#/categories', 'My categories'), h('p', { class: 'alert alert--error', role: 'alert' }, 'This category could not be found. It may have been deleted. You can bring it back from Recently deleted.'));
  const draft = rec ? categoryDraft(rec, { keepName: true }) : categoryDraft(startFrom ? findTemplate(startFrom, customs) : null);
  const usage = rec ? await categoryUsage(store, rec.id) : null;
  const back = afterWizard ? '#/new' : '#/categories';
  const reg = {}, F = (key, label, control, opts) => { const f = field(label, control, opts); reg[key] = f; return f.el; };
  const noop = { setError() {} };
  Object.assign(reg, { icon: noop, valueChange: noop, income: noop, ownership: noop });

  const startOptions = [['blank', 'Start from scratch'], ...BUILT_IN_TEMPLATES.map((t) => [t.id, t.name]), ...customs.map((t) => [t.id, `${t.name} (mine)`])];
  const startField = !rec && field('Start from', selectInput({ value: startFrom || 'blank', options: startOptions, onChange: (v) => go(`#/categories/new/${v}${afterWizard ? '/wizard' : ''}`) }), { optional: true, hint: 'Copies the answers and details of an existing category. Choosing again replaces what is below.' });

  const picks = CATEGORY_ICONS.map((n) => {
    const b = h('button', { class: 'icon-pick', type: 'button', 'aria-pressed': String(n === draft.icon), 'aria-label': ICON_NAMES[n] || n, title: ICON_NAMES[n] || n }, icon(n, { size: 22 }));
    b.addEventListener('click', () => { draft.icon = n; picks.forEach((x, i) => x.setAttribute('aria-pressed', String(CATEGORY_ICONS[i] === n))); });
    return b;
  });

  const list = h('div', { class: 'cat-fields' });
  const addDetail = h('button', { class: 'btn btn--secondary btn--small', type: 'button' }, icon('plus'), 'Add a detail');
  function drawFields(focusLast = false) {
    list.replaceChildren(...draft.fields.map((f, i) => {
      const label = textInput({ value: f.label, onInput: (v) => { f.label = v; }, maxlength: 60, placeholder: 'For example: Plot size' })(`cat-f${i}`);
      label.setAttribute('aria-label', `Detail ${i + 1} name`);
      const type = selectInput({ value: f.type || 'text', options: FIELD_TYPES, onChange: (v) => { f.type = v; } })(`cat-t${i}`);
      type.setAttribute('aria-label', `Detail ${i + 1} type`);
      const remove = h('button', { class: 'cat-remove', type: 'button', 'aria-label': `Remove detail ${i + 1}` }, icon('x', { size: 18 }));
      remove.addEventListener('click', () => { draft.fields.splice(i, 1); drawFields(); });
      return h('div', { class: 'cat-field' }, label, type, remove);
    }));
    addDetail.disabled = draft.fields.length >= MAX_FIELDS;
    if (focusLast) list.querySelector('.cat-field:last-child input')?.focus();
  }
  addDetail.addEventListener('click', () => { draft.fields.push({ key: null, label: '', type: 'text' }); drawFields(true); });
  drawFields();

  const detailsField = field('Details to ask for', () => h('div', { class: 'stack' }, list, h('div', { class: 'row' }, addDetail)), { optional: true, hint: `Extra questions for each investment in this category, such as plot size or registration number. Up to ${MAX_FIELDS}.` });
  reg.fields = detailsField;

  const err = h('p', { class: 'alert alert--error', role: 'alert', hidden: true });
  const save = h('button', { class: 'btn', type: 'submit' }, rec ? 'Save changes' : 'Save category');
  const form = h('form', { class: 'stack', novalidate: true },
    startField && startField.el,
    F('name', 'Name', textInput({ value: draft.name, onInput: (v) => { draft.name = v; }, maxlength: 60, placeholder: 'For example: Shop rent' }), { hint: 'Something you will recognise in the list of categories.' }),
    h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'Icon'), h('div', { class: 'icon-picks', role: 'group', 'aria-label': 'Icon' }, picks)),
    h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'How does its value change?'), choiceList({ name: 'valueChange', label: 'How its value changes', value: draft.valueChange, options: VALUE_CHOICES, onChange: (v) => { draft.valueChange = v; } })),
    h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'What income does it pay?'), choiceList({ name: 'income', label: 'Income it pays', value: draft.income, options: INCOME_CHOICES, onChange: (v) => { draft.income = v; } })),
    h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'Who usually owns it?'), choiceList({ name: 'ownership', label: 'Who owns it', value: draft.ownership, options: OWNERSHIP_CHOICES, onChange: (v) => { draft.ownership = v; } })),
    detailsField.el,
    rec && usage.live > 0 && h('p', { class: 'note-box' }, 'The three answers above are starting points for investments you add from now on. Investments you already added keep their own settings. Renaming a detail changes its label everywhere. Removing one stops asking for it on new investments, but a value already saved stays saved and still shows.'),
    err, h('div', { class: 'doc-actions' }, save, h('a', { class: 'btn btn--secondary', href: back }, 'Cancel')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.hidden = true;
    const errors = categoryErrors(draft, { taken: takenNames(customs, id) });
    const first = showErrors(reg, errors);
    if (errors.length) { first?.el?.scrollIntoView?.({ block: 'center' }); return; }
    await withBusy(save, async () => {
      try { await saveCategory(store, draft, { id }); toast(rec ? 'Saved.' : 'Category saved.'); go(afterWizard ? '#/new' : '#/categories'); }
      catch (x) { err.textContent = x instanceof InputError ? x.message : 'Something went wrong. Nothing was changed. Please try again.'; err.hidden = false; if (!(x instanceof InputError)) console.error(x); }
    });
  });

  let del = null;
  if (rec) {
    const dErr = h('p', { class: 'alert alert--error', role: 'alert', hidden: true });
    del = h('section', {}, h('div', { class: 'section-head' }, h('h2', {}, 'Delete')),
      usage.live > 0
        ? h('p', { class: 'note-box' }, `${usageText(usage)}${usage.closed ? `, including ${usage.closed} closed` : ''}, so this category cannot be deleted. Delete ${usage.live === 1 ? 'that investment' : 'those investments'} first, or keep the category.`)
        : h('div', { class: 'stack' },
          h('p', { class: 'sub' }, `Nothing uses this category. Deleting hides it. You can undo straight afterwards, or bring it back from Recently deleted.${usage.deleted ? ` ${usage.deleted === 1 ? 'A deleted investment uses' : `${usage.deleted} deleted investments use`} it: if you restore ${usage.deleted === 1 ? 'it' : 'one'}, restore this category first.` : ''}`),
          dErr,
          h('div', { class: 'row row--actions' }, h('button', { class: 'btn btn--secondary btn--danger', type: 'button', onclick: (e) => withBusy(e.currentTarget, async () => {
            try { await removeCategory(store, rec); toast('Category deleted.', { label: 'Undo', run: async () => { await store.restore(rec.id); window.dispatchEvent(new HashChangeEvent('hashchange')); } }); go('#/categories'); }
            catch (x) { dErr.textContent = x instanceof InputError ? x.message : 'Something went wrong. Nothing was changed.'; dErr.hidden = false; }
          }) }, 'Delete this category'))));
  }
  return h('div', { class: 'flow' }, backLink(back, afterWizard ? 'New investment' : 'My categories'), h('h1', { class: 'page-title' }, rec ? rec.name : 'Add a category'), form, del);
}
