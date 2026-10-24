# Phase 4, first release: screens (read-only) and sample portfolio

**What is here:** the signed-in workspace (bottom tabs on phones, sidebar on desktop), Home dashboard, Investments list with search and filters, investment detail (Overview, Ledger, People for shared ones, Details), Settings, hide-amounts, light/dark, text size, and a made-up sample portfolio that can be added and removed. Lora and Inter are now actually bundled in `/fonts` (they were not before, so earlier screens used fallback fonts).

**Not here yet:** adding and editing investments, entries, valuations and partners (next release), the Projections tab, offline app shell (service worker), syncing.

## Decisions to review
1. **The big number on Home is what you hold today** (value of active investments). Net gain beside it counts everything: income received and anything already sold.
2. **"Money put in" = invested + costs**, the same base the return on investment divides by.
3. **The growth chart** shows worth *including investments already sold* (so a maturing bill never looks like a drop) against money put in, at each month end. It can still dip honestly, for example when an agent's valuation replaces an earlier projection.
4. **Amounts are short (₦106.12M) with the full amount one tap away** on the big figures; tables and the "how this is calculated" lines always use full amounts. Hide-amounts replaces every amount with dots; percentages stay visible.
5. **No cards for lists.** Lists are ledger rows separated by hairlines; gold is used for the active tab, key actions and the line on the chart only.
6. **Honest status chip:** "Saved on this device" until syncing exists.
7. **Locking clears decrypted records from memory immediately** (the vault is closed), not just the key.

## Found by the simulation
- A closed investment looked closed on every date, so a past date showed a total loss. Fixed in the engine (see engine-notes 13).
- The "Loan given" template cannot model repayments properly yet: repayments reduce what is owed, but the engine would count the repaid amount twice (as income and still inside the grown value). Until a balance-based loan type exists, a loan is best recorded as a manually valued investment (value = amount still owed) with repayments as payouts. Flagged for Phase 5.
