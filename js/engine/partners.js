// Shared investments (General System Plan 8.4). Ownership rows: { partnerId ('me' or a partner id),
// contributionKobo, percentage (basis points, 10000 = 100%), effectiveFrom, effectiveTo }.
// A partner's contribution is the amount on their row in effect on the as-of date.
import { compareDates } from './dates.js';
import { EngineError } from './errors.js';
import { allocate } from './money.js';

export function ownershipOn(ownership, date) {
  const rows = ownership.filter((o) => (!o.effectiveFrom || compareDates(o.effectiveFrom, date) <= 0) && (!o.effectiveTo || compareDates(date, o.effectiveTo) < 0));
  const total = rows.reduce((s, o) => s + o.percentage, 0);
  if (rows.length === 0 || total !== 10000) throw new EngineError('OWNERSHIP_TOTAL', `Ownership on ${date} adds up to ${total / 100}%, not 100%`);
  return rows;
}

const add = (map, key, n) => map.set(key, (map.get(key) || 0) + n);

export function partnerShares({ ownership, entries = [], totalValueKobo, netGainKobo, asOf }) {
  const now = ownershipOn(ownership, asOf);
  const incomeBy = new Map(), costBy = new Map();
  for (const e of entries.filter((x) => compareDates(x.date, asOf) <= 0)) {
    const target = e.kind === 'income' || e.kind === 'payout' ? incomeBy : e.kind === 'cost' ? costBy : null;
    if (!target) continue;
    const rows = ownershipOn(ownership, e.date);
    allocate(e.amountKobo, rows.map((o) => o.percentage)).forEach((amt, i) => add(target, rows[i].partnerId, amt));
  }
  const bps = now.map((o) => o.percentage);
  const valueParts = allocate(totalValueKobo, bps), gainParts = allocate(netGainKobo, bps);
  const contributed = now.reduce((s, o) => s + o.contributionKobo, 0);
  const partners = now.map((o, i) => {
    const incomeShareKobo = incomeBy.get(o.partnerId) || 0, costShareKobo = costBy.get(o.partnerId) || 0;
    return {
      partnerId: o.partnerId, ownershipBp: o.percentage, contributionKobo: o.contributionKobo,
      contributionShare: contributed ? o.contributionKobo / contributed : null,
      valueShareKobo: valueParts[i], incomeShareKobo, costShareKobo, netGainKobo: gainParts[i],
      // what this partner gets (value + income) minus what they put in (contribution + their share of costs)
      netPositionKobo: valueParts[i] + incomeShareKobo - costShareKobo - o.contributionKobo,
    };
  });
  return { partners, contributedKobo: contributed };
}
