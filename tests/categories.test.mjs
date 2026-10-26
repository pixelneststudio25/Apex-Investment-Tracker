// Phase 8b tests: your own categories. A category is only a label with starting answers and extra details, so the
// rules to protect are: names stay unambiguous, saved values keep their key through renames, a category that
// investments use cannot be deleted, and everything round-trips through the wizard's template lookup.
import { generateDek } from '../js/core/crypto.js';
import { createMemoryBackend } from '../js/core/db.js';
import { createStore } from '../js/core/store.js';
import { findTemplate } from '../js/models/templates.js';
import { applyTemplate, buildPlan, newDraft, savePlan } from '../js/models/wizard.js';
import { InputError } from '../js/models/inputs.js';
import { deletedItems } from '../js/models/manage.js';
import { MAX_FIELDS, blankCategory, buildCategory, categoryDraft, categoryErrors, categoryUsage, describeCategory, humanizeKey, keyFromLabel, removeCategory, saveCategory, takenNames } from '../js/models/categories.js';

const TODAY = '2026-04-15', USER = 'u1';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
const rejects = async (p, test) => { try { await p; } catch (e) { ok(test(e), `unexpected error: ${e.code || ''} ${e.message}`); return e; } throw new Error('expected an error'); };

let n = 0;
async function fresh() {
  const dek = await generateDek();
  return createStore({ backend: createMemoryBackend(), getDek: () => dek, userId: USER, uuid: () => `c-${++n}` });
}
const draftOf = (over = {}) => ({ ...blankCategory(), name: 'Shop rent', ...over });
// An investment in a custom category, made the same way the wizard makes it.
async function invest(store, cat, name = 'My shop') {
  const d = applyTemplate(newDraft(TODAY), cat, TODAY);
  Object.assign(d, { name, openedOn: '2025-01-01', capital: { amount: '1,000,000', date: '', note: '' } });
  const { investmentId } = await savePlan(store, buildPlan(d, cat, { today: TODAY }));
  return investmentId;
}

test('keys: made from the label, valid, and unique even for similar labels', () => {
  eq([keyFromLabel('Plot size'), keyFromLabel('C of O number'), keyFromLabel('12 acres'), keyFromLabel('  '), keyFromLabel('Ünïcode name')], ['plotSize', 'cOfONumber', 'field12Acres', 'field', 'unicodeName']);
  const used = new Set(['plotSize']);
  eq([keyFromLabel('Plot size', used), keyFromLabel('Plot  Size!', new Set(['plotSize', 'plotSize2']))], ['plotSize2', 'plotSize3']);
  ok(/^[a-z][A-Za-z0-9_]{0,39}$/.test(keyFromLabel('x'.repeat(80))), 'long labels still give a valid key');
  eq([humanizeKey('plotSize'), humanizeKey('registrationNumber'), humanizeKey('')], ['Plot size', 'Registration number', '']);
});
test('validation: a name is needed and cannot repeat a built-in or one of your own, whatever the capitals', async () => {
  const store = await fresh(), cat = await saveCategory(store, draftOf());
  const taken = takenNames(await store.list('categoryTemplate'));
  const msg = (d, t = taken) => categoryErrors(d, { taken: t }).filter((e) => e.field === 'name').map((e) => e.message);
  ok(msg(draftOf({ name: '  ' }))[0].includes('name'), 'empty');
  ok(/already have/.test(msg(draftOf({ name: 'LAND' }))[0]), 'a built-in name');
  ok(/already have/.test(msg(draftOf({ name: 'shop RENT' }))[0]), 'one of your own');
  eq(msg(draftOf({ name: 'shop RENT' }), takenNames(await store.list('categoryTemplate'), cat.id)), [], 'editing a category may keep its own name');
  ok(msg(draftOf({ name: 'x'.repeat(61) }))[0].includes('60'), 'too long');
  eq(categoryErrors(draftOf({ name: 'Fresh name' }), { taken }), [], 'a good draft has no errors');
});
test('validation: choices must be real, details need unique labels, blank rows are ignored, and there is a limit', () => {
  const field = (e) => e.map((x) => x.field);
  eq(field(categoryErrors(draftOf({ valueChange: 'wishful', income: 'lots', ownership: 'group', icon: 'sparkle' }))), ['icon', 'valueChange', 'income', 'ownership']);
  const dup = categoryErrors(draftOf({ fields: [{ label: 'Plot size', type: 'text' }, { label: ' plot SIZE ', type: 'number' }] }));
  ok(dup.length === 1 && /twice/.test(dup[0].message), 'the same label twice');
  eq(categoryErrors(draftOf({ fields: [{ label: '', type: 'text' }, { label: '   ', type: 'date' }] })), [], 'blank rows are not errors');
  ok(categoryErrors(draftOf({ fields: [{ label: 'A', type: 'colour' }] })).length === 1, 'an unknown type');
  const many = Array.from({ length: MAX_FIELDS + 1 }, (_, i) => ({ label: `Detail ${i}`, type: 'text' }));
  ok(categoryErrors(draftOf({ fields: many })).some((e) => /up to 15/.test(e.message)), 'too many details');
});
test('save: a custom category is found by the wizard lookup and carries its answers and details', async () => {
  const store = await fresh();
  const rec = await saveCategory(store, draftOf({ icon: 'house', valueChange: 'none', income: 'schedule', ownership: 'shared', fields: [{ label: 'Shop number', type: 'text' }, { label: 'Opened on', type: 'date' }, { label: '', type: 'text' }] }));
  const customs = await store.list('categoryTemplate'), t = findTemplate(rec.id, customs);
  eq([t.name, t.icon], ['Shop rent', 'house']);
  eq(t.defaultBehaviors, { valueChange: 'none', income: 'schedule', ownership: 'shared', term: null });
  eq(t.customFieldDefs, [{ key: 'shopNumber', label: 'Shop number', type: 'text' }, { key: 'openedOn', label: 'Opened on', type: 'date' }]);
  eq(describeCategory(t), 'Stays at what I paid. Regular payments. Shared with other people');
  const plain = await saveCategory(store, draftOf({ name: 'Plain', valueChange: 'none', income: 'none', ownership: 'sole' }));
  const inv = await invest(store, findTemplate(plain.id, await store.list('categoryTemplate'))), saved = await store.get(inv);
  eq([saved.categoryId, saved.behaviors.valueChange, saved.behaviors.income, saved.behaviors.ownership], [plain.id, 'none', 'none', 'sole']);
});
test('start from: copies a built-in or your own category, keeps detail keys, and leaves the name blank to choose', () => {
  const land = findTemplate('land'), d = categoryDraft(land);
  eq([d.name, d.icon, d.valueChange], ['', 'land', 'appreciation']);
  eq(d.fields, (land.customFieldDefs || []).map((f) => ({ key: f.key, label: f.label, type: f.type || 'text' })));
  const kept = categoryDraft({ ...land, name: 'Mine' }, { keepName: true });
  eq(kept.name, 'Mine');
  eq(categoryDraft(null), blankCategory());
  const built = buildCategory({ ...d, name: 'My land' }, { taken: takenNames([]) });
  eq(built.customFieldDefs.map((f) => f.key), (land.customFieldDefs || []).map((f) => f.key), 'details copied from a built-in keep their keys');
});
test('edit: renaming a detail keeps its key (so saved values stay attached); removing one keeps the saved value; new ones get new keys', async () => {
  const store = await fresh();
  const rec = await saveCategory(store, draftOf({ fields: [{ label: 'Shop number', type: 'text' }, { label: 'Landlord', type: 'text' }] }));
  const cat = findTemplate(rec.id, await store.list('categoryTemplate'));
  const invId = await invest(store, { ...cat, id: rec.id });
  await store.update(invId, { customFields: { shopNumber: 'B12', landlord: 'Mrs Bello' } });
  const d = categoryDraft(cat, { keepName: true });
  d.fields[0].label = 'Unit number';                       // rename
  d.fields.splice(1, 1);                                   // remove Landlord
  d.fields.push({ key: null, label: 'Lease ends', type: 'date' });
  const after = await saveCategory(store, d, { id: rec.id });
  eq(after.customFieldDefs, [{ key: 'shopNumber', label: 'Unit number', type: 'text' }, { key: 'leaseEnds', label: 'Lease ends', type: 'date' }]);
  eq((await store.get(invId)).customFields, { shopNumber: 'B12', landlord: 'Mrs Bello' }, 'nothing recorded on the investment changed');
  eq((await store.get(invId)).behaviors.valueChange, 'manualOnly', 'the investment keeps its own settings');
});
test('edit: changing the starting answers never rewrites an investment already added', async () => {
  const store = await fresh(), rec = await saveCategory(store, draftOf({ valueChange: 'appreciation', income: 'none' }));
  const invId = await invest(store, findTemplate(rec.id, await store.list('categoryTemplate')));
  const d = categoryDraft(rec, { keepName: true }); d.valueChange = 'depreciation'; d.income = 'schedule';
  await saveCategory(store, d, { id: rec.id });
  const inv = await store.get(invId);
  eq([inv.behaviors.valueChange, inv.behaviors.income], ['appreciation', 'none']);
});
test('delete: blocked while an investment uses it (active or closed), allowed when unused, undone from Recently deleted', async () => {
  const store = await fresh(), used = await saveCategory(store, draftOf()), spare = await saveCategory(store, draftOf({ name: 'Spare' }));
  const invId = await invest(store, findTemplate(used.id, await store.list('categoryTemplate')));
  eq(await categoryUsage(store, used.id), { active: 1, closed: 0, live: 1, deleted: 0 });
  const e = await rejects(removeCategory(store, used), (x) => x instanceof InputError && /1 investment uses this category/.test(x.message));
  ok(/Delete that|Delete it first|Delete it/.test(e.message));
  await store.update(invId, { status: 'closed', closedOn: '2026-01-01' });
  await rejects(removeCategory(store, used), (x) => x instanceof InputError, 'a closed investment still blocks');
  eq((await store.list('categoryTemplate')).length, 2, 'nothing was deleted');
  await removeCategory(store, spare);
  eq((await store.list('categoryTemplate')).map((c) => c.name), ['Shop rent']);
  const trash = (await deletedItems(store)).filter((x) => x.type === 'categoryTemplate');
  eq(trash.map((x) => x.record.name), ['Spare'], 'listed in Recently deleted');
  await store.restore(spare.id);
  eq((await store.list('categoryTemplate')).length, 2, 'restored');
});
test('delete: a deleted investment does not block it, and is counted so the screen can warn', async () => {
  const store = await fresh(), cat = await saveCategory(store, draftOf());
  const invId = await invest(store, findTemplate(cat.id, await store.list('categoryTemplate')));
  await store.remove(invId);
  eq(await categoryUsage(store, cat.id), { active: 0, closed: 0, live: 0, deleted: 1 });
  await removeCategory(store, cat);
  eq((await store.list('categoryTemplate')).length, 0);
});

export async function runCategoryTests() {
  let passed = 0, failed = 0;
  for (const t of tests) {
    try { await t.fn(); passed++; console.log(`PASS  ${t.name}`); }
    catch (e) { failed++; console.log(`FAIL  ${t.name}\n      ${e.message}`); }
  }
  console.log(`\n${passed} passed, ${failed} failed (categories).`);
  return { passed, failed };
}
