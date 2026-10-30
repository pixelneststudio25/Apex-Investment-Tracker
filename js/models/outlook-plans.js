// Saved Outlook settings (Phase 12-iv). Two kinds of record, both type "outlookPlan", both encrypted like everything else:
//  - working: one record that remembers what you last chose on the Outlook tab (edited rates, years, scenario, inflation,
//    share, target). It is saved quietly as you go and loaded when you come back, on any device.
//  - named: up to MAX_NAMED scenarios you saved on purpose, which you can load, replace or delete.
// Only the choices are stored, never a result, so every figure is worked out fresh and stays a projection.
import { InputError } from './inputs.js';
import { buildScenario } from './projections.js';

export const MAX_NAMED = 5;
export const YEAR_CHOICES = [1, 3, 5, 10];
export const PRESET_NUDGE = { cautious: ['3', 'down'], base: ['', 'down'], optimistic: ['3', 'up'] };

// The starting choices on the Outlook tab.
export const defaultChoices = () => ({ years: 5, custom: false, customText: '', preset: 'base', nudgeText: '', nudgeDir: 'down', share: 'full', real: false, inflationText: '', goalText: '', overrides: {} });

// Screen choices -> the fields of a record. `years` is the horizon in effect (a whole number).
export function planFields(choices, years, { kind = 'working', name = '' } = {}) {
  return {
    kind, name, years, preset: choices.preset || '', nudgeText: choices.nudgeText.trim(), nudgeDir: choices.nudgeDir, share: choices.share,
    real: !!choices.real, inflationText: choices.inflationText.trim(), goalText: choices.goalText.trim(),
    overrides: Object.entries(choices.overrides).map(([investmentId, sc]) => ({ investmentId, percent: sc.percentText, direction: sc.direction, method: sc.method })),
  };
}

// A record -> screen choices. Rates for investments that no longer exist, or that no longer parse, are dropped quietly.
export function choicesFromPlan(plan, validIds) {
  const overrides = {};
  for (const o of plan.overrides || []) {
    if (!validIds.has(o.investmentId)) continue;
    try { const sc = buildScenario({ label: 'Edited', percent: o.percent, direction: o.direction, method: o.method }); if (sc) overrides[o.investmentId] = sc; } catch { /* skip a rate that no longer parses */ }
  }
  const custom = !YEAR_CHOICES.includes(plan.years);
  return { ...defaultChoices(), years: plan.years, custom, customText: custom ? String(plan.years) : '', preset: plan.preset, nudgeText: plan.nudgeText, nudgeDir: plan.nudgeDir,
    share: plan.share, real: plan.real, inflationText: plan.inflationText, goalText: plan.goalText, overrides };
}

// Plain words for a saved scenario's row. No money figures: only the choices.
export function describePlan(plan) {
  const bits = [`${plan.years} ${plan.years === 1 ? 'year' : 'years'}`];
  if (plan.overrides.length) bits.push(`${plan.overrides.length} edited ${plan.overrides.length === 1 ? 'rate' : 'rates'}`);
  if (plan.nudgeText) bits.push(`${plan.nudgeText} ${plan.nudgeText === '1' ? 'point' : 'points'} ${plan.nudgeDir === 'down' ? 'lower' : 'higher'}`);
  if (plan.real && plan.inflationText) bits.push(`today's money at ${plan.inflationText}%`);
  if (plan.share === 'mine') bits.push('my share');
  return bits.join(', ');
}

const byAge = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1);

export async function loadPlans(store) {
  const all = (await store.list('outlookPlan')).sort(byAge);
  return { working: all.find((p) => p.kind === 'working') || null, named: all.filter((p) => p.kind === 'named') };
}

// Saves what is on screen as the working record. Nothing is written when nothing changed.
export async function saveWorking(store, choices, years) {
  const { working } = await loadPlans(store), fields = planFields(choices, years);
  if (working) return store.update(working.id, fields);
  return store.create('outlookPlan', fields);
}

export async function saveNamed(store, rawName, choices, years) {
  const name = String(rawName ?? '').trim();
  if (!name) throw new InputError('Give the scenario a name.');
  if (name.length > 60) throw new InputError('Keep the name to 60 characters or fewer.');
  const { named } = await loadPlans(store);
  if (named.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new InputError(`You already have a scenario called "${name}". Choose another name, or delete that one first.`);
  if (named.length >= MAX_NAMED) throw new InputError(`You can keep up to ${MAX_NAMED} scenarios. Delete one to save another.`);
  return store.create('outlookPlan', planFields(choices, years, { kind: 'named', name }));
}

export async function removeNamed(store, id) {
  const rec = await store.get(id);
  if (!rec || rec.type !== 'outlookPlan' || rec.kind !== 'named') throw new InputError('That scenario could not be found.');
  return store.remove(id);
}
