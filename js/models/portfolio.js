// Joins stored records to the calculation engine. The screens (Phase 4) ask this module for ready-made
// numbers; the engine stays pure and knows nothing about storage.
//
// Deleting an investment hides it AND everything that belongs to it, without touching the child records
// (no cascade writes). Restoring the investment brings everything back exactly as it was.
import { investmentMetrics, partnerShares } from '../engine/index.js';
import { StoreError } from '../core/store.js';

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1);

export function createPortfolio(store) {
  const children = async (type, investmentId) => (await store.list(type)).filter((r) => r.investmentId === investmentId);

  async function investments({ status } = {}) {
    const all = await store.list('investment');
    return status ? all.filter((i) => i.status === status) : all;
  }

  // Everything that belongs to one live investment, or null if it is missing or deleted.
  async function bundle(investmentId) {
    const investment = await store.get(investmentId);
    if (!investment || investment.type !== 'investment') return null;
    const [entries, valuations, schedules, ownership, documents, reminders, partners] = await Promise.all([
      children('entry', investmentId), children('valuation', investmentId), children('schedule', investmentId),
      children('ownership', investmentId), children('document', investmentId), children('reminder', investmentId),
      store.list('partner'),
    ]);
    return { investment, entries: entries.sort(byDate), valuations: valuations.sort(byDate), schedules, ownership, documents, reminders, partners };
  }

  async function metrics(investmentId, asOf, { rateTypes = null } = {}) {
    const b = await bundle(investmentId);
    if (!b) throw new StoreError('NOT_FOUND', 'Investment not found.');
    const m = investmentMetrics({ investment: b.investment, entries: b.entries, valuations: b.valuations, asOf, rateTypes });
    const shared = b.investment.behaviors.ownership === 'shared' && b.ownership.length > 0;
    const partners = shared ? partnerShares({ ownership: b.ownership, entries: b.entries, totalValueKobo: m.totalValueKobo, netGainKobo: m.netGainKobo, asOf }) : null;
    return { bundle: b, metrics: m, partners };
  }

  // Portfolio totals across live investments. One investment that cannot be calculated (for example two
  // overlapping rates) is left out of the totals and listed in `errors`; it never blocks the dashboard.
  async function summary(asOf) {
    const total = { investedKobo: 0, costsKobo: 0, incomeKobo: 0, proceedsKobo: 0, valueKobo: 0, totalValueKobo: 0, netGainKobo: 0 };
    const count = { active: 0, closed: 0 }, errors = [];
    for (const inv of await investments()) {
      try {
        const { metrics: m } = await metrics(inv.id, asOf);
        for (const k of Object.keys(total)) total[k] += m[k];
        count[m.basis === 'realized' ? 'closed' : 'active']++;
      } catch (e) { errors.push({ investmentId: inv.id, code: e.code || 'ERROR', message: e.message }); }
    }
    for (const v of Object.values(total)) if (!Number.isSafeInteger(v)) throw new StoreError('OVERFLOW', 'Portfolio total is too large to calculate.');
    const basis = total.investedKobo + total.costsKobo;
    return { asOf, ...total, roi: basis === 0 ? null : total.netGainKobo / basis, count, errors };
  }

  // The settings record is a singleton. If two devices both created one before syncing, the newest wins.
  async function settings() {
    const all = (await store.list('settings')).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1));
    return all[0] || store.create('settings', {});
  }
  async function updateSettings(change) { const s = await settings(); return store.update(s.id, change); }

  return { investments, bundle, metrics, summary, settings, updateSettings };
}
