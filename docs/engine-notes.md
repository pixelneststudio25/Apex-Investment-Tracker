# Calculation engine: conventions and decisions

Code: `js/engine/` (pure functions; no UI, storage or network). Tests: `tests/engine.test.mjs`, including the six golden cases from the General System Plan 8.6.

**Fixed by the plan:** money is integer kobo; intermediate maths uses 60-digit decimals and rounds once per reported figure; day count is actual days / 365; a horizon such as "6 months" is the calendar date six months later, then actual days are used; rates may be negative.

**Decisions made while building (please review):**
1. **Rounding** is half away from zero (so -5.5 kobo becomes -6, 5.5 becomes 6).
2. **"5 years" by calendar** is 1,826 days when a leap day falls inside it, so it grows slightly more than exactly 5.0 years. Golden case 2 uses 1,825 days to match the plan's figure. The UI should show the day count.
3. **Monthly rates:** a monthly rate r is treated as a nominal annual rate 12r; monthly compounding defaults to 12 periods a year.
4. **Rate periods:** `effectiveFrom` is inclusive; `effectiveTo` is the day the rate stops applying. Overlapping rates are an error, never guessed. Gaps mean no change.
5. **Value never goes below zero** (simple depreciation over a long time stops at zero).
6. **Schedules:** `startDate` is the first due date; later dates are counted from the start date (no month-end drift). Custom frequency uses `everyDays`.
7. **Current value (active):** latest valuation on or before the as-of date (not extrapolated); else each capital-in entry grown at the assumed/agreed rates; else cost.
8. **Net gain** = value + proceeds received + income - invested - costs. Income includes payouts. ROI divides by invested + costs.
9. **Yield** = trailing 12 months of (income + payout - costs) divided by total invested.
10. **Annualised return:** one lump sum and nothing else uses CAGR; anything else uses XIRR. If XIRR has no sensible answer the app shows "not defined". Under one year held, the result is flagged `shortHold`. XIRR may have several answers when cash flows change direction more than once; the one found first is returned.
11. **Partnerships:** ownership rows must total 100% on every date used (otherwise an error). Shares are split with largest-remainder allocation so they add up to the kobo. Contribution on a partner's row in effect on the as-of date is used for contribution share and net position.
12. **Verification:** XIRR is checked against the published spreadsheet example (0.373362535). To be added: your friend's real investments, once collected.
13. **Closed investments on past dates (fixed in Phase 4).** If an investment has a closing date, the date decides whether it is closed on the as-of date. Viewing a date before it closed shows it as it was while still open (value grown at its rate, no proceeds). A closed status with no closing date is closed on every date. Found by the simulation tests.
