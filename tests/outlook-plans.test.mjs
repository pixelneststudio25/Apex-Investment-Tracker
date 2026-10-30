// Phase 12-iv tests: saved Outlook choices. Only choices are stored, always encrypted, never a result.
import { readFile } from 'node:fs/promises';
import { generateDek } from '../js/core/crypto.js';
import { createMemoryBackend } from '../js/core/db.js';
import { createStore } from '../js/core/store.js';
import { validate, ModelError, TYPES } from '../js/models/schemas.js';
import { InputError } from '../js/models/inputs.js';
import { buildScenario, blankScenario } from '../js/models/projections.js';
import { MAX_NAMED, choicesFromPlan, defaultChoices, describePlan, loadPlans, planFields, removeNamed, saveNamed, saveWorking } from '../js/models/outlook-plans.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
const rejects = async (fn, re, kind = InputError) => { try { await fn(); } catch (e) { if (e instanceof kind) { if (re) ok(re.test(e.message), `message "${e.message}"`); return; } throw e; } throw new Error('expected a refusal'); };

let n = 0;
async function fresh() {
  const dek = await generateDek(), backend = createMemoryBackend();
  return { backend, store: createStore({ backend, getDek: () => dek, userId: 'u1', uuid: () => `p-${++n}` }) };
}
const edited = (percent, extra = {}) => buildScenario({ ...blankScenario('Edited'), percent, ...extra });
const choices = (over = {}) => ({ ...defaultChoices(), ...over });

test('the record type exists and its rules refuse anything odd, with a sentence', () => {
  ok(TYPES.includes('outlookPlan'));
  const good = validate('outlookPlan', { kind: 'working' });
  eq([good.years, good.preset, good.share, good.real, good.overrides], [5, 'base', 'full', false, []], 'defaults');
  for (const [bad, re] of [[{ kind: 'other' }, /one of/], [{ kind: 'named' }, /needs a name/], [{ kind: 'working', years: 0 }, /between 1 and 50/], [{ kind: 'working', years: 2.5 }, /whole number/],
    [{ kind: 'working', share: 'half' }, /one of/], [{ kind: 'working', result: 5 }, /./], [{ kind: 'working', overrides: [{ investmentId: 'a', percent: '1', direction: 'sideways', method: 'simple' }] }, /one of/],
    [{ kind: 'working', overrides: Array.from({ length: 101 }, () => ({ investmentId: 'a', percent: '1', direction: 'grows', method: 'simple' })) }, /at most 100/]]) {
    try { validate('outlookPlan', bad); throw new Error(`accepted ${JSON.stringify(bad).slice(0, 60)}`); } catch (e) { if (!(e instanceof ModelError)) throw e; ok(re.test(e.message), e.message); }
  }
});
test('the working record is created once, updated in place, and a save with nothing changed writes nothing', async () => {
  const { store } = await fresh(), c = choices({ overrides: { inv1: edited('20') }, real: true, inflationText: '6', goalText: '50,000,000' });
  const a = await saveWorking(store, c, 5); ok(a.version === 1);
  const none = await saveWorking(store, c, 5); eq([none.id, none.version], [a.id, 1], 'unchanged means no new version');
  eq((await store.history(a.id)).length, 1, 'and nothing added to the history');
  const b = await saveWorking(store, { ...c, inflationText: '7' }, 5); eq([b.id, b.version], [a.id, 2], 'same record, next version');
  eq((await store.list('outlookPlan')).length, 1, 'still one working record');
  const { working, named } = await loadPlans(store); eq([working.inflationText, working.real, named.length], ['7', true, 0]);
});
test('choices survive a round trip: saved, loaded and saved again gives the same record, including a custom horizon', async () => {
  const c = choices({ years: 7, custom: true, customText: '7', preset: '', nudgeText: '2.5', nudgeDir: 'up', share: 'mine', overrides: { a: edited('12.5', { method: 'compound12' }), b: edited('15', { direction: 'loses' }) } });
  const f1 = planFields(c, 7), back = choicesFromPlan({ ...f1 }, new Set(['a', 'b']));
  eq([back.years, back.custom, back.customText, back.preset, back.nudgeText, back.nudgeDir, back.share], [7, true, '7', '', '2.5', 'up', 'mine']);
  eq(planFields(back, 7), f1, 'a second save is identical'); eq(back.overrides.a.rate, 0.125); eq(back.overrides.b.direction, 'loses');
  eq(choicesFromPlan(planFields(choices({ years: 10 }), 10), new Set()).custom, false, '10 years is a normal choice, not custom');
});
test('rates for investments that are gone, or that no longer make sense, are dropped quietly on load', async () => {
  const f = planFields(choices({ overrides: { gone: edited('9'), here: edited('11') } }), 5);
  const back = choicesFromPlan(f, new Set(['here'])); eq(Object.keys(back.overrides), ['here']);
  const broken = { ...f, overrides: [{ investmentId: 'here', percent: 'abc', direction: 'grows', method: 'simple' }, { investmentId: 'here', percent: '', direction: 'grows', method: 'simple' }] };
  eq(Object.keys(choicesFromPlan(broken, new Set(['here'])).overrides), [], 'unreadable and blank rates are skipped, nothing throws');
});
test('named scenarios: save, list in order, refuse a blank, a duplicate (any capital letters) or a sixth, and delete one', async () => {
  const { store } = await fresh(), c = choices({ nudgeText: '3', nudgeDir: 'down', preset: 'cautious' });
  await rejects(() => saveNamed(store, '   ', c, 5), /Give the scenario a name/); await rejects(() => saveNamed(store, 'x'.repeat(61), c, 5), /60 characters/);
  const first = await saveNamed(store, '  Bank rates fall ', c, 5); eq(first.name, 'Bank rates fall', 'the name is trimmed');
  await rejects(() => saveNamed(store, 'bank RATES fall', c, 5), /already have a scenario called/);
  for (let i = 2; i <= MAX_NAMED; i++) await saveNamed(store, `Scenario ${i}`, c, 5);
  await rejects(() => saveNamed(store, 'One too many', c, 5), /up to 5 scenarios/);
  eq((await loadPlans(store)).named.map((p) => p.name), ['Bank rates fall', 'Scenario 2', 'Scenario 3', 'Scenario 4', 'Scenario 5'], 'oldest first');
  await removeNamed(store, first.id); eq((await loadPlans(store)).named.length, 4); await saveNamed(store, 'One more', c, 5);
  eq((await loadPlans(store)).named.length, 5, 'a deleted one frees a place');
  await rejects(() => removeNamed(store, 'nope'), /could not be found/);
});
test('the working record and the named ones never mix: saving the working record does not touch a saved scenario, and the working one cannot be deleted as a scenario', async () => {
  const { store } = await fresh(); const named = await saveNamed(store, 'Keep me', choices({ years: 10 }), 10);
  await saveWorking(store, choices({ years: 3 }), 3);
  const { working, named: list } = await loadPlans(store); eq([working.years, list.length, list[0].years, list[0].version], [3, 1, 10, 1]);
  await rejects(() => removeNamed(store, working.id), /could not be found/); eq(named.kind, 'named');
});
test('two devices that both made a working record do not break anything: the oldest is used', async () => {
  const { store } = await fresh(); await store.create('outlookPlan', planFields(choices({ years: 1 }), 1)); await store.create('outlookPlan', planFields(choices({ years: 3 }), 3));
  eq((await loadPlans(store)).working.years, 1); await saveWorking(store, choices({ years: 10 }), 10);
  eq((await loadPlans(store)).working.years, 10); eq((await store.list('outlookPlan')).filter((p) => p.years === 3).length, 1, 'the other is left alone');
});
test('words for a saved scenario contain only the choices, no money', () => {
  eq(describePlan(planFields(choices({ nudgeText: '3', nudgeDir: 'down', real: true, inflationText: '6', share: 'mine', overrides: { a: edited('9') } }), 10)), "10 years, 1 edited rate, 3 points lower, today's money at 6%, my share");
  eq(describePlan(planFields(choices(), 1)), '1 year'); eq(describePlan(planFields(choices({ nudgeText: '1', nudgeDir: 'up' }), 5)), '5 years, 1 point higher');
  ok(!/₦|\d{4,}/.test(describePlan(planFields(choices({ goalText: '50,000,000' }), 5))), 'the target is never in the words');
});
test('everything is encrypted at rest and the server needs no change: the type lives inside the ciphertext', async () => {
  const { store, backend } = await fresh(); await saveNamed(store, 'Secret scenario name', choices({ goalText: '123456789', inflationText: '6.25' }), 5);
  const raw = JSON.stringify(await backend.getAll('records'));
  for (const t of ['Secret scenario name', 'outlookPlan', '123456789', '6.25', 'named']) ok(!raw.includes(t), `"${t}" is readable in storage`);
  const sql = await readFile(new URL('./supabase/schema.sql', import.meta.url), 'utf8');
  ok(!/outlook|record_type|\btype\b\s+(text|varchar)/i.test(sql), 'the records table has no type column, so no SQL change is needed');
});

export async function runOutlookPlanTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) { try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); } }
  log(`\n${passed} passed, ${failed} failed (saved outlook choices).`);
  return { passed, failed };
}
