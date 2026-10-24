// Calculation engine tests. Golden cases 1-6 come from General System Plan 8.6.
import {
  addMonths, allocate, compareScenarios, daysBetween, formatNaira, formatNairaCompact, formatPercent,
  horizonEnd, investmentMetrics, ownershipOn, partnerShares, project, scheduleEntries, toKobo, valueKobo, xirr, cagr,
} from '../js/engine/index.js';

const N = (naira) => Math.round(naira * 100); // naira -> kobo, for readable tests
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || 'not equal'}: got ${a}, expected ${b}`); };
const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m || 'not near'}: got ${a}, expected ${b} (tol ${tol})`); };
const throws = (fn, code) => { try { fn(); } catch (e) { if (e.code === code) return; throw new Error(`wrong error ${e.code || e.message}`); } throw new Error('expected an error'); };
const P10M = N(10000000);

// ---------- golden cases ----------
test('GOLDEN 1: land, simple 12% for 365 days = ₦11,200,000.00', () => {
  const v = valueKobo(P10M, '2026-01-01', '2027-01-01', [{ rate: 0.12, method: 'simple' }]);
  eq(formatNaira(v), '₦11,200,000.00');
});
test('GOLDEN 2: land, compound annual 12% for 5 years (1825 days) = ₦17,623,416.83', () => {
  eq(daysBetween('2026-01-01', '2030-12-31'), 1825);
  const v = valueKobo(P10M, '2026-01-01', '2030-12-31', [{ rate: 0.12, method: 'compound' }]);
  eq(formatNaira(v), '₦17,623,416.83');
});
test('GOLDEN 3: land, 12% simple, 2026-01-01 to 2026-07-01 (181 days) = ₦10,595,068.49', () => {
  eq(daysBetween('2026-01-01', '2026-07-01'), 181);
  eq(formatNaira(valueKobo(P10M, '2026-01-01', '2026-07-01', [{ rate: 0.12, method: 'simple' }])), '₦10,595,068.49');
});
test('GOLDEN 4: car with rent: value ₦3,400,000, income ₦1,200,000, net gain ₦600,000, ROI 15.00%', () => {
  const investment = { status: 'active', behaviors: { valueChange: 'depreciation' },
    rates: [{ type: 'assumed', rate: -0.15, rateUnit: 'year', method: 'compound', compoundsPerYear: 1, effectiveFrom: '2026-01-01' }] };
  const rent = scheduleEntries({ startDate: '2026-02-01', frequency: 'monthly', amountKobo: N(100000) }, '2027-01-01');
  eq(rent.length, 12, 'twelve monthly payments');
  const entries = [{ date: '2026-01-01', kind: 'capital_in', amountKobo: N(4000000) }, ...rent.map((e) => ({ date: e.date, kind: 'income', amountKobo: e.amountKobo }))];
  const m = investmentMetrics({ investment, entries, asOf: '2027-01-01' });
  eq(formatNaira(m.valueKobo), '₦3,400,000.00'); eq(m.valueSource, 'assumed');
  eq(formatNaira(m.incomeKobo), '₦1,200,000.00'); eq(formatNaira(m.netGainKobo), '₦600,000.00');
  eq(formatPercent(m.roi), '15.00%'); eq(m.basis, 'unrealized');
  eq(formatPercent(m.yield.rate), '30.00%', 'trailing yield');
  if (m.annualized.method !== 'xirr' || !(m.annualized.rate > 0.1 && m.annualized.rate < 0.3)) throw new Error('xirr sanity');
});
test('GOLDEN 5: partnership 50/30/20 on ₦12,000,000 splits exactly and reconciles to the kobo', () => {
  const ownership = [{ partnerId: 'me', percentage: 5000, contributionKobo: N(6000000) }, { partnerId: 'a', percentage: 3000, contributionKobo: N(3600000) }, { partnerId: 'b', percentage: 2000, contributionKobo: N(2400000) }];
  const entries = [{ date: '2026-01-01', kind: 'capital_in', amountKobo: N(12000000) }, { date: '2026-06-01', kind: 'income', amountKobo: 123457 }, { date: '2026-07-01', kind: 'cost', amountKobo: 55555 }];
  const m = investmentMetrics({ investment: { status: 'active' }, entries, valuations: [{ date: '2026-12-31', valueKobo: N(14000001) + 7 }], asOf: '2026-12-31' });
  const s = partnerShares({ ownership, entries, totalValueKobo: m.totalValueKobo, netGainKobo: m.netGainKobo, asOf: '2026-12-31' });
  const total = (k) => s.partners.reduce((t, p) => t + p[k], 0);
  eq(total('valueShareKobo'), m.totalValueKobo, 'value'); eq(total('incomeShareKobo'), m.incomeKobo, 'income');
  eq(total('costShareKobo'), m.costsKobo, 'costs'); eq(total('netGainKobo'), m.netGainKobo, 'net gain');
  eq(total('contributionKobo'), N(12000000)); eq(s.partners[0].contributionShare, 0.5);
  eq(total('netPositionKobo'), m.netGainKobo, 'net positions add up to the net gain');
});
test('GOLDEN 6: XIRR matches the published spreadsheet example (0.373362535)', () => {
  const r = xirr([{ date: '2008-01-01', amountKobo: -10000 }, { date: '2008-03-01', amountKobo: 2750 }, { date: '2008-10-30', amountKobo: 4250 },
    { date: '2009-02-15', amountKobo: 3250 }, { date: '2009-04-01', amountKobo: 2750 }]);
  near(r, 0.373362535, 1e-7);
});

// ---------- value formulas ----------
test('rate periods: values carry forward segment by segment', () => {
  const P = N(1000000); const d1 = daysBetween('2026-01-01', '2026-07-02'), d2 = daysBetween('2026-07-02', '2027-01-01');
  const rates = [{ rate: 0.10, method: 'simple', effectiveFrom: '2026-01-01', effectiveTo: '2026-07-02' }, { rate: 0.20, method: 'compound', effectiveFrom: '2026-07-02' }];
  const expected = Math.round(P * (1 + 0.10 * d1 / 365) * Math.pow(1.2, d2 / 365));
  near(valueKobo(P, '2026-01-01', '2027-01-01', rates), expected, 1);
});
test('monthly rates: 1%/month simple for a year = 12% simple; 1%/month compound = 1.01^12', () => {
  eq(valueKobo(P10M, '2026-01-01', '2027-01-01', [{ rate: 0.01, rateUnit: 'month', method: 'simple' }]), N(11200000));
  near(valueKobo(P10M, '2026-01-01', '2027-01-01', [{ rate: 0.01, rateUnit: 'month', method: 'compound' }]), Math.round(P10M * Math.pow(1.01, 12)), 1);
});
test('compound with n periods per year (quarterly)', () => {
  near(valueKobo(P10M, '2026-01-01', '2027-01-01', [{ rate: 0.12, method: 'compound', compoundsPerYear: 4 }]), Math.round(P10M * Math.pow(1.03, 4)), 1);
});
test('rounding is half away from zero, once, at the end', () => {
  eq(valueKobo(5, '2026-01-01', '2027-01-01', [{ rate: 0.10, method: 'simple' }]), 6); // 5.5 -> 6
  eq(toKobo('-5.5'), -6); eq(toKobo('2.4999999'), 2);
});
test('depreciation never goes below zero; no rates means no change; same day is unchanged', () => {
  eq(valueKobo(N(1000), '2026-01-01', '2030-01-01', [{ rate: -0.5, method: 'simple' }]), 0);
  eq(valueKobo(N(1000), '2026-01-01', '2030-01-01', []), N(1000)); eq(valueKobo(N(1000), '2026-01-01', '2026-01-01', [{ rate: 0.5 }]), N(1000));
});
test('overlapping rates and bad inputs are refused, not guessed', () => {
  throws(() => valueKobo(100, '2026-01-01', '2027-01-01', [{ rate: 0.1, effectiveTo: '2026-09-01' }, { rate: 0.2, effectiveFrom: '2026-06-01' }]), 'RATE_OVERLAP');
  throws(() => valueKobo(100, '2027-01-01', '2026-01-01', []), 'BAD_RANGE'); throws(() => valueKobo(100, '2026-02-30', '2027-01-01', []), 'BAD_DATE');
  throws(() => valueKobo(100, '2026-01-01', '2027-01-01', [{ rate: 0.1, method: 'compound', compoundsPerYear: 0 }]), 'BAD_RATE');
});

// ---------- dates and schedules ----------
test('dates: month arithmetic clamps to month end; leap years are real days', () => {
  eq(addMonths('2026-01-31', 1), '2026-02-28'); eq(addMonths('2028-01-31', 1), '2028-02-29'); eq(addMonths('2026-03-31', -1), '2026-02-28');
  eq(addMonths('2026-07-15', -12), '2025-07-15'); eq(daysBetween('2028-01-01', '2029-01-01'), 366);
  eq(horizonEnd('2026-08-31', '6M'), '2027-02-28'); eq(horizonEnd('2026-01-01', '5Y'), '2031-01-01'); eq(horizonEnd('2026-01-01', { months: 18 }), '2027-07-01');
});
test('schedule: month-end anchor does not drift; skips, rent increases and end dates apply', () => {
  const s = scheduleEntries({ startDate: '2026-01-31', frequency: 'monthly', amountKobo: 100, skippedDates: ['2026-03-31'],
    adjustments: [{ from: '2026-05-01', amountKobo: 150 }], endDate: '2026-06-30' }, '2026-12-31');
  eq(s.map((e) => e.date).join(), '2026-01-31,2026-02-28,2026-04-30,2026-05-31,2026-06-30');
  eq(s.map((e) => e.amountKobo).join(), '100,100,100,150,150');
  eq(scheduleEntries({ startDate: '2026-01-01', frequency: 'quarterly', amountKobo: 1 }, '2026-12-31').length, 4);
  eq(scheduleEntries({ startDate: '2026-01-01', frequency: 'custom', everyDays: 10, amountKobo: 1 }, '2026-01-31').length, 4);
  throws(() => scheduleEntries({ startDate: '2026-01-01', frequency: 'custom', everyDays: 0, amountKobo: 1 }, '2026-01-31'), 'BAD_SCHEDULE');
});

// ---------- returns ----------
test('CAGR for a single lump sum; short holds are flagged; no flows of both signs gives "not defined"', () => {
  near(cagr(N(1000000), N(1210000), 730), 0.10, 1e-9);
  const m = investmentMetrics({ investment: { status: 'active' }, entries: [{ date: '2026-01-01', kind: 'capital_in', amountKobo: N(1000000) }], valuations: [{ date: '2026-07-01', valueKobo: N(1100000) }], asOf: '2026-07-01' });
  eq(m.annualized.method, 'cagr'); eq(m.annualized.shortHold, true); eq(m.valueSource, 'valuation'); eq(formatPercent(m.roi), '10.00%');
  eq(xirr([{ date: '2026-01-01', amountKobo: -100 }, { date: '2026-06-01', amountKobo: -50 }]), null);
});
test('XIRR fallback handles extreme returns', () => {
  const r = xirr([{ date: '2026-01-01', amountKobo: -10000 }, { date: '2026-04-01', amountKobo: 100000 }]);
  near(r / (Math.pow(10, 365 / 90) - 1), 1, 1e-6);
  near(xirr([{ date: '2026-01-01', amountKobo: -N(1000) }, { date: '2027-01-01', amountKobo: N(1120) }]), 0.12, 1e-9);
});
test('metrics: cost basis when there is no valuation or rate; valuation beats assumed rate; zero invested gives no ROI', () => {
  const cap = [{ date: '2026-01-01', kind: 'capital_in', amountKobo: N(500000) }];
  let m = investmentMetrics({ investment: { status: 'active' }, entries: cap, asOf: '2026-06-01' });
  eq(m.valueSource, 'cost'); eq(m.currentValueKobo, N(500000)); eq(m.netGainKobo, 0);
  m = investmentMetrics({ investment: { status: 'active', rates: [{ rate: 0.1 }] }, entries: cap, valuations: [{ date: '2026-03-01', valueKobo: N(520000) }], asOf: '2026-06-01' });
  eq(m.valueSource, 'valuation'); eq(m.valuationDate, '2026-03-01');
  m = investmentMetrics({ investment: { status: 'active' }, entries: [], asOf: '2026-06-01' }); eq(m.roi, null); eq(m.annualized.rate, null);
});
test('metrics: closed investments report realized figures from proceeds and ignore later entries', () => {
  const entries = [{ date: '2026-01-01', kind: 'capital_in', amountKobo: N(2000000) }, { date: '2026-02-01', kind: 'cost', amountKobo: N(100000) }, { date: '2027-01-01', kind: 'proceeds', amountKobo: N(2600000) }, { date: '2028-01-01', kind: 'income', amountKobo: N(999) }];
  const m = investmentMetrics({ investment: { status: 'closed', closedOn: '2027-01-01' }, entries, asOf: '2027-06-01' });
  eq(m.basis, 'realized'); eq(m.currentValueKobo, N(2600000)); eq(m.netGainKobo, N(500000)); eq(formatPercent(m.roi), '23.81%'); eq(m.incomeKobo, 0, 'later entries ignored');
  eq(m.annualized.method, 'xirr'); if (!(m.annualized.rate > 0.2 && m.annualized.rate < 0.3)) throw new Error('xirr sanity');
});

// ---------- partners ----------
test('allocation always adds up exactly (1,000 random splits) and is stable on ties', () => {
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 1000; i++) {
    const total = Math.floor(rnd() * 1e13) * (rnd() < 0.2 ? -1 : 1), a = Math.floor(rnd() * 9999) + 1, b = Math.floor(rnd() * (10000 - a)), parts = allocate(total, [a, b, 10000 - a - b]);
    eq(parts.reduce((s, x) => s + x, 0), total, 'sum');
    parts.forEach((p, k) => near(p, total * [a, b, 10000 - a - b][k] / 10000, 1.0001, 'within a kobo'));
  }
  eq(allocate(100, [3333, 3333, 3334]).join(), '33,33,34'); eq(allocate(1, [5000, 5000]).join(), '1,0');
});
test('ownership must total 100% on the date; changes over time are respected', () => {
  throws(() => ownershipOn([{ partnerId: 'me', percentage: 6000 }, { partnerId: 'a', percentage: 3000 }], '2026-01-01'), 'OWNERSHIP_TOTAL');
  const own = [{ partnerId: 'me', percentage: 10000, effectiveTo: '2026-06-01' }, { partnerId: 'me', percentage: 6000, effectiveFrom: '2026-06-01' }, { partnerId: 'a', percentage: 4000, effectiveFrom: '2026-06-01' }];
  eq(ownershipOn(own, '2026-05-31').length, 1); eq(ownershipOn(own, '2026-06-01').length, 2);
});

// ---------- projections ----------
test('projection table: horizons, income schedule, flagged as projection; scenario comparison', () => {
  const rows = project({ principalKobo: P10M, startDate: '2026-01-01', rates: [{ rate: 0.12, method: 'simple' }], horizons: ['1M', '6M', '1Y', '5Y', { years: 2 }] });
  eq(rows.length, 5); eq(rows[2].valueKobo, N(11200000)); eq(rows[2].isProjection, true); eq(rows[0].shortHold, true); eq(rows[2].shortHold, false);
  near(rows[2].annualizedRate, 0.12, 1e-9); eq(formatPercent(rows[2].roi), '12.00%');
  const withRent = project({ principalKobo: N(4000000), startDate: '2026-01-01', rates: [{ rate: -0.15, method: 'compound' }], incomeSchedule: { startDate: '2026-02-01', frequency: 'monthly', amountKobo: N(100000) }, horizons: ['1Y'] })[0];
  eq(withRent.incomeKobo, N(1200000)); eq(withRent.netGainKobo, N(600000));
  const cmp = compareScenarios({ principalKobo: P10M, startDate: '2026-01-01', rates: [{ rate: 0.10, method: 'compound' }], horizons: ['1Y', '5Y'] }, { principalKobo: P10M, startDate: '2026-01-01', rates: [{ rate: 0.15, method: 'compound' }], horizons: ['1Y', '5Y'] });
  eq(cmp[0].deltaValueKobo, N(500000)); if (!(cmp[1].deltaValueKobo > 0)) throw new Error('15% beats 10%');
  throws(() => project({ principalKobo: 1, startDate: '2026-01-01', horizons: ['xyz'] }), 'BAD_HORIZON');
});

// ---------- formatting ----------
test('formatting: full, signed, compact and percent', () => {
  eq(formatNaira(1245000000), '₦12,450,000.00'); eq(formatNaira(-30000000), '−₦300,000.00'); eq(formatNaira(5), '₦0.05'); eq(formatNaira(1250000, { sign: true }), '+₦12,500.00');
  eq(formatNairaCompact(1245000000), '₦12.45M'); eq(formatNairaCompact(120000000000), '₦1.2B'); eq(formatNairaCompact(8500000000), '₦85M'); eq(formatNairaCompact(15000000), '₦150K'); eq(formatNairaCompact(1245000), '₦12,450.00'); eq(formatNairaCompact(-1245000000), '−₦12.45M');
  eq(formatPercent(0.1116, { sign: true }), '+11.16%'); eq(formatPercent(-0.024), '−2.40%'); eq(formatPercent(null), 'n/a'); eq(formatPercent(0.00001, { sign: true }), '0.00%');
});

test('closed investments viewed BEFORE the closing date are still open then (value grown, no proceeds); status alone means closed always', () => {
  const investment = { status: 'closed', closedOn: '2026-05-31', openedOn: '2025-06-01', behaviors: { valueChange: 'interest' },
    rates: [{ type: 'agreed', rate: 0.185, method: 'simple', effectiveFrom: '2025-06-01' }] };
  const entries = [{ date: '2025-06-01', kind: 'capital_in', amountKobo: N(5000000) }, { date: '2026-05-31', kind: 'proceeds', amountKobo: 592246575 }];
  const before = investmentMetrics({ investment, entries, asOf: '2025-12-01' });
  eq(before.basis, 'unrealized'); eq(before.proceedsKobo, 0); eq(before.valueSource, 'assumed');
  if (!(before.valueKobo > N(5000000) && before.netGainKobo > 0)) throw new Error('should show accrued value, not a total loss');
  const after = investmentMetrics({ investment, entries, asOf: '2026-05-31' });
  eq(after.basis, 'realized'); eq(after.valueKobo, 0); eq(after.proceedsKobo, 592246575);
  const noDate = investmentMetrics({ investment: { status: 'closed' }, entries: [entries[0], { ...entries[1], date: '2026-05-31' }], asOf: '2026-12-31' });
  eq(noDate.basis, 'realized');
});

export async function runEngineTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) {
    try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); }
  }
  log(`\n${passed} passed, ${failed} failed (calculation engine).`);
  return { passed, failed };
}
