// Your own categories (Phase 8b). A category is only a label plus starting answers (how value changes, income,
// who owns it) and the extra details to ask for. The real behaviour of every investment lives on the investment
// itself, so changing a category never rewrites anything you already recorded.
// The screens are in js/ui/category-views.js; this file holds the rules and is tested in Node.
import { InputError } from './inputs.js';
import { BUILT_IN_TEMPLATES } from './templates.js';
import { INCOME_CHOICES, VALUE_CHOICES } from './wizard.js';

export const CATEGORY_ICONS = ['land', 'house', 'building', 'car', 'users', 'handshake', 'landmark', 'coins', 'sprout', 'wrench', 'gem', 'bitcoin', 'chart', 'frame', 'piggy', 'tag'];
export const OWNERSHIP_CHOICES = [['sole', 'Just me', 'You are the only owner.'], ['shared', 'Shared with other people', 'Apex asks who is in it and how much each person put in.']];
export const FIELD_TYPES = [['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['url', 'Link']];
export const MAX_FIELDS = 15;
export { INCOME_CHOICES, VALUE_CHOICES };

const lower = (s) => String(s || '').trim().toLowerCase();
const labelOf = (choices, v) => (choices.find(([k]) => k === v) || [])[1] || v;

// "Plot size" -> plotSize. Always a valid field key, unique among `used`.
export function keyFromLabel(label, used = new Set()) {
  const words = String(label || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  let key = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
  if (!/^[a-z]/.test(key)) key = `field${key ? key[0].toUpperCase() + key.slice(1) : ''}`;
  key = key.slice(0, 30);
  let out = key, n = 2;
  while (used.has(out)) out = `${key.slice(0, 27)}${n++}`;
  return out;
}

// "plotSize" -> "Plot size": a readable name for a saved value whose field was removed from its category.
export const humanizeKey = (key) => {
  const s = String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
};

export const blankCategory = () => ({ name: '', icon: 'tag', valueChange: 'manualOnly', income: 'irregular', ownership: 'sole', fields: [] });

// Starting from a built-in (or one of your own): same answers and details, but the name is left for you to choose.
export function categoryDraft(template = null, { keepName = false } = {}) {
  if (!template) return blankCategory();
  const b = template.defaultBehaviors || {};
  return {
    name: keepName ? template.name : '', icon: CATEGORY_ICONS.includes(template.icon) ? template.icon : 'tag',
    valueChange: b.valueChange || 'manualOnly', income: b.income || 'none', ownership: b.ownership || 'sole',
    fields: (template.customFieldDefs || []).map((d) => ({ key: d.key, label: d.label, type: d.type || 'text' })),
  };
}

// Names that would be confusing next to yours: every built-in and every other custom category.
export const takenNames = (customs, exceptId = null) => new Set([...BUILT_IN_TEMPLATES.map((t) => lower(t.name)), ...customs.filter((c) => c.id !== exceptId).map((c) => lower(c.name))]);

// [{ field, message }] in the order they should be shown. Empty = fine. Rows with no label at all are ignored, not errors.
export function categoryErrors(draft, { taken = new Set() } = {}) {
  const errors = [], name = String(draft.name || '').trim();
  if (!name) errors.push({ field: 'name', message: 'Give the category a name.' });
  else if (name.length > 60) errors.push({ field: 'name', message: 'Keep the name under 60 letters.' });
  else if (taken.has(lower(name))) errors.push({ field: 'name', message: 'You already have a category with that name. Pick a different one.' });
  if (!CATEGORY_ICONS.includes(draft.icon)) errors.push({ field: 'icon', message: 'Choose an icon.' });
  if (!VALUE_CHOICES.some(([k]) => k === draft.valueChange)) errors.push({ field: 'valueChange', message: 'Choose how its value changes.' });
  if (!INCOME_CHOICES.some(([k]) => k === draft.income)) errors.push({ field: 'income', message: 'Choose what income it pays.' });
  if (!OWNERSHIP_CHOICES.some(([k]) => k === draft.ownership)) errors.push({ field: 'ownership', message: 'Choose who owns it.' });
  const rows = (draft.fields || []).filter((f) => String(f.label || '').trim());
  if (rows.length > MAX_FIELDS) errors.push({ field: 'fields', message: `A category can ask for up to ${MAX_FIELDS} details.` });
  const seen = new Set();
  rows.forEach((f, i) => {
    const label = String(f.label).trim();
    if (label.length > 60) errors.push({ field: 'fields', message: `Detail ${i + 1} is too long. Keep it under 60 letters.` });
    if (!FIELD_TYPES.some(([k]) => k === (f.type || 'text'))) errors.push({ field: 'fields', message: `Choose a type for "${label}".` });
    if (seen.has(lower(label))) errors.push({ field: 'fields', message: `"${label}" is listed twice.` });
    seen.add(lower(label));
  });
  return errors;
}

// The record to save. Details you already had keep their key (so values already saved on investments stay attached
// even if you rename the label); new details get a key made from the label.
export function buildCategory(draft, { taken = new Set() } = {}) {
  const errors = categoryErrors(draft, { taken });
  if (errors.length) throw new InputError(errors[0].message);
  const rows = draft.fields.filter((f) => String(f.label || '').trim());
  const used = new Set(rows.map((f) => f.key).filter(Boolean));
  const defs = rows.map((f) => { const key = f.key || keyFromLabel(f.label, used); used.add(key); return { key, label: String(f.label).trim(), type: f.type || 'text' }; });
  return { name: String(draft.name).trim(), icon: draft.icon, defaultBehaviors: { valueChange: draft.valueChange, income: draft.income, ownership: draft.ownership, term: null }, customFieldDefs: defs };
}

export const describeCategory = (t) => {
  const b = t.defaultBehaviors || {};
  return [labelOf(VALUE_CHOICES, b.valueChange), labelOf(INCOME_CHOICES, b.income), labelOf(OWNERSHIP_CHOICES, b.ownership)].join('. ');
};

// How many investments use a category. Deleted investments are counted separately: they do not block deleting
// the category (the category can be restored from Recently deleted if one of them is brought back).
export async function categoryUsage(store, categoryId) {
  const invs = (await store.list('investment', { includeDeleted: true })).filter((i) => i.categoryId === categoryId);
  const live = invs.filter((i) => !i.deletedAt);
  return { active: live.filter((i) => i.status !== 'closed').length, closed: live.filter((i) => i.status === 'closed').length, live: live.length, deleted: invs.length - live.length };
}

export async function removeCategory(store, category) {
  const use = await categoryUsage(store, category.id);
  if (use.live > 0) throw new InputError(`${use.live === 1 ? '1 investment uses' : `${use.live} investments use`} this category, so it cannot be deleted. Delete ${use.live === 1 ? 'it' : 'them'} first, or keep the category.`);
  return store.remove(category.id);
}

export async function saveCategory(store, draft, { id = null } = {}) {
  const customs = await store.list('categoryTemplate');
  const data = buildCategory(draft, { taken: takenNames(customs, id) });
  return id ? store.update(id, data) : store.create('categoryTemplate', data);
}
