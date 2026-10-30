// Joins stored records to the calculation engine. The screens ask this module for ready-made numbers;
// the engine stays pure and knows nothing about storage.
//
// Deleting an investment hides it AND everything that belongs to it, without touching the child records
// (no cascade writes). Restoring the investment brings everything back exactly as it was.
import { addDays, investmentMetrics, partnerShares, scheduleEntries } from '../engine/index.js';
import { StoreError } from '../core/store.js';

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1);
// 'me' first, then by start date: screens and tests never depend on storage order.
const byOwner = (a, b) => (a.partnerId === 'me' ? -1 : b.partnerId === 'me' ? 1 : (a.effectiveFrom || '') < (b.effectiveFrom || '') ? -1 : (a.effectiveFrom || '') > (b.effectiveFrom || '') ? 1 : a.createdAt < b.createdAt ? -1 : 1);

const pad = (n) => String(n).padStart(2, '0');
// Month-end dates from the month of `from` up to `to` (the last point is `to` itself).
export function monthEnds(from, to) {
  const [fy, fm] = from.split('-').map(Number), [ty, tm] = to.split('-').map(Number);
  const out = [];
  let y = fy, m = fm - 1;
  while (y < ty || (y === ty && m < tm - 1)) {
    out.push(`${y}-${pad(m + 1)}-${pad(new Date(Date.UTC(y, m + 1, 0)).getUTCDate())}`);
    if (++m > 11) { m = 0; y++; }
  }
  out.push(to);
  return out;
}
const thin = (arr, max) => {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max), out = arr.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
};

export function createPortfolio(store) {
  // One calculated snapshot per generation of the store (Phase 13). While nothing has been written, locked or synced,
  // every screen gets the same answers without reading and calculating everything again. The moment the store changes,
  // the snapshot is thrown away. Callers always get their own copy, so changing a result can never change the snapshot.
  // A store without a generation counter (a test double) simply bypasses it.
  const snap = { gen: null, hit: new Map() };
  const fresh = () => { const g = store.generation?.(); if (g === undefined) return false; if (snap.gen !== g) { snap.gen = g; snap.hit.clear(); } return true; };
  const keep = (key, compute) => {
    if (!fresh()) return compute();
    let p = snap.hit.get(key);
    if (!p) { p = compute(); snap.hit.set(key, p); p.catch(() => { if (snap.hit.get(key) === p) snap.hit.delete(key); }); }
    return p;
  };
  const memo = (key, compute) => keep(key, compute).then((v) => structuredClone(v));
  // Every record of one type, read once per generation. For use inside this module only: callers never see these objects.
  const listOf = (type) => keep(`list:${type}`, () => store.list(type));

  const children = async (type, investmentId) => (await listOf(type)).filter((r) => r.investmentId === investmentId);

  async function investmentsRaw({ status } = {}) {
    const all = await listOf('investment');
    return status ? all.filter((i) => i.status === status) : all;
  }
  const investments = async (opts) => structuredClone(await investmentsRaw(opts));

  // Everything that belongs to one live investment, or null if it is missing or deleted.
  async function bundleRaw(investmentId) {
    const investment = await store.get(investmentId);
    if (!investment || investment.type !== 'investment') return null;
    const [entries, valuations, schedules, ownership, documents, reminders, partners] = await Promise.all([
      children('entry', investmentId), children('valuation', investmentId), children('schedule', investmentId),
      children('ownership', investmentId), children('document', investmentId), children('reminder', investmentId),
      listOf('partner'),
    ]);
    return { investment, entries: entries.sort(byDate), valuations: valuations.sort(byDate), schedules, ownership: ownership.sort(byOwner), documents, reminders, partners };
  }

  const calc = (b, asOf, rateTypes = null) => investmentMetrics({ investment: b.investment, entries: b.entries, valuations: b.valuations, asOf, rateTypes });

  async function metricsRaw(investmentId, asOf, { rateTypes = null } = {}) {
    const b = await bundleRaw(investmentId);
    if (!b) throw new StoreError('NOT_FOUND', 'Investment not found.');
    const m = calc(b, asOf, rateTypes);
    const shared = b.investment.behaviors.ownership === 'shared' && b.ownership.length > 0;
    const partners = shared ? partnerShares({ ownership: b.ownership, entries: b.entries, totalValueKobo: m.totalValueKobo, netGainKobo: m.netGainKobo, asOf }) : null;
    return { bundle: b, metrics: m, partners };
  }

  // One row per live investment with its figures. An investment that cannot be calculated (for example two
  // overlapping rates in old data) has `error` instead of `metrics`; it never blocks the others.
  async function overviewRaw(asOf) {
    const items = [];
    for (const investment of await investmentsRaw()) {
      try { items.push({ investment, metrics: (await metricsRaw(investment.id, asOf)).metrics }); }
      catch (e) { items.push({ investment, error: { code: e.code || 'ERROR', message: e.message } }); }
    }
    return items;
  }

  // Portfolio totals across live investments; broken ones are left out of the totals and listed in `errors`.
  async function summaryRaw(asOf, items) {
    items ||= await overviewRaw(asOf);
    const total = { investedKobo: 0, costsKobo: 0, incomeKobo: 0, proceedsKobo: 0, repaidKobo: 0, valueKobo: 0, totalValueKobo: 0, netGainKobo: 0 };
    const count = { active: 0, closed: 0 }, errors = [];
    for (const it of items) {
      if (it.error) { errors.push({ investmentId: it.investment.id, ...it.error }); continue; }
      for (const k of Object.keys(total)) total[k] += it.metrics[k];
      count[it.metrics.basis === 'realized' ? 'closed' : 'active']++;
    }
    for (const v of Object.values(total)) if (!Number.isSafeInteger(v)) throw new StoreError('OVERFLOW', 'Portfolio total is too large to calculate.');
    const basis = total.investedKobo + total.costsKobo;
    return { asOf, ...total, roi: basis === 0 ? null : total.netGainKobo / basis, count, errors };
  }

  // Month-end history of the whole portfolio for the dashboard chart: value including investments already
  // sold (so a maturity never looks like a drop), against money put in (invested plus costs).
  async function timelineRaw(asOf, { maxPoints = 72 } = {}) {
    const bundles = [];
    for (const inv of await investmentsRaw()) { const b = await bundleRaw(inv.id); if (b) bundles.push(b); }
    if (!bundles.length) return [];
    const start = bundles.map((b) => b.investment.openedOn).sort()[0];
    if (start > asOf) return [];
    return thin(monthEnds(start, asOf), maxPoints).map((date) => {
      let valueKobo = 0, putInKobo = 0;
      for (const b of bundles) {
        if (b.investment.openedOn > date) continue;
        try { const m = calc(b, date); valueKobo += m.totalValueKobo; putInKobo += m.investedKobo + m.costsKobo; } catch { /* left out, like in the summary */ }
      }
      return { date, valueKobo, putInKobo };
    });
  }

  // What is coming up: expected scheduled income and costs that have not been recorded yet, plus reminders.
  async function upcomingRaw(asOf, { days = 45 } = {}) {
    const end = addDays(asOf, days), items = [];
    const live = new Map((await investmentsRaw()).map((i) => [i.id, i]));
    const entries = await listOf('entry');
    for (const s of await listOf('schedule')) {
      const inv = live.get(s.investmentId);
      if (!inv || inv.status === 'closed' || s.status !== 'active') continue;
      for (const e of scheduleEntries(s, end)) {
        if (e.date <= asOf || entries.some((x) => x.linkedScheduleId === s.id && x.date === e.date)) continue;
        items.push({ date: e.date, kind: s.kind, scheduleId: s.id, title: s.label || (s.kind === 'income' ? 'Income expected' : 'Cost expected'), investmentId: inv.id, investmentName: inv.name, amountKobo: e.amountKobo });
      }
    }
    for (const r of await listOf('reminder')) {
      const inv = r.investmentId ? live.get(r.investmentId) : null;
      if (r.done || (r.investmentId && !inv) || r.dueDate > end) continue;
      items.push({ date: r.dueDate, kind: 'reminder', title: r.text, investmentId: inv?.id || null, investmentName: inv?.name || null, overdue: r.dueDate < asOf });
    }
    // Same day: money first, then reminders.
    return items.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.kind === 'reminder') !== (b.kind === 'reminder') ? (a.kind === 'reminder' ? 1 : -1) : a.title < b.title ? -1 : 1));
  }

  // The latest entries across live investments, newest first.
  async function recentRaw(limit = 8) {
    const live = new Map((await investmentsRaw()).map((i) => [i.id, i]));
    return (await listOf('entry')).filter((e) => live.has(e.investmentId))
      .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit).map((e) => ({ ...e, investmentName: live.get(e.investmentId).name }));
  }

  // The settings record is a singleton. If two devices both created one before syncing, the newest wins.
  async function settings() {
    const all = [...(await listOf('settings'))].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1));
    return all[0] || store.create('settings', {});
  }
  async function updateSettings(change) { const s = await settings(); return store.update(s.id, change); }

  // What the screens call. Same answers as before, kept for as long as the store does not change.
  const bundle = (id) => memo(`b:${id}`, () => bundleRaw(id));
  const metrics = (id, asOf, opts = {}) => memo(`m:${id}:${asOf}:${JSON.stringify(opts.rateTypes ?? null)}`, () => metricsRaw(id, asOf, opts));
  const overview = (asOf) => memo(`ov:${asOf}`, () => overviewRaw(asOf));
  const summary = (asOf, items) => (items ? summaryRaw(asOf, items) : memo(`sum:${asOf}`, () => summaryRaw(asOf)));
  const timeline = (asOf, opts = {}) => memo(`tl:${asOf}:${opts.maxPoints ?? 72}`, () => timelineRaw(asOf, opts));
  const upcoming = (asOf, opts = {}) => memo(`up:${asOf}:${opts.days ?? 45}`, () => upcomingRaw(asOf, opts));
  const recent = (limit = 8) => memo(`rc:${limit}`, () => recentRaw(limit));

  return { investments, bundle, metrics, overview, summary, timeline, upcoming, recent, settings, updateSettings };
}
