# Phase 4b: adding and changing your own records

**What is here:** the add-investment wizard (one step per screen, then a review), add/edit/delete for ledger entries and valuations, closing and reopening an investment, deleting an investment with Undo. Everything is saved encrypted on the device through the same data layer as before.

**Not here yet (planned for 4c):** editing an investment's basics, rates and details after it is saved; editing or skipping individual rent payments and rent increases; the history and "revert to an earlier version" screens; creating your own categories; adding or renaming partners outside the wizard; the Projections tab; a proper loan type (still flagged for Phase 5).

## The wizard
Steps: category, basics, details (only if the category has them), money put in, how its value changes, income, who shares it (only if shared), review. Every answer is checked before Continue; the review lists anything still wrong with a Fix button. Nothing is saved until Save.

## Decisions to review
1. **One step per screen**, with a review at the end where any section can be changed.
2. **Amounts and percentages are read as text.** "₦18,000,000", "18 000 000.50" and "12.5%" are converted without floating-point multiplication. Under each amount box Apex shows what it understood (for example "= ₦18,000,000.00"). More than two decimals, bad commas, negatives and rates over 1000% are refused with a sentence.
3. **Money put in is required** (more than zero). Later costs go in the ledger.
4. **Past rent is never assumed received.** If a regular payment has already fallen due, a tick box offers to record those payments (it shows how many and the total). It is off by default.
5. **A value you enter beats a rate.** A "worth today" entered in the wizard is saved as a valuation, and the latest valuation replaces any growth rate (the engine's existing rule).
6. **Shared investments:** shares must total exactly 100.00%, and what everyone put in must equal the money put in. "Fill amounts from shares" splits to the kobo. People already on record can be picked again instead of being created twice.
7. **Depreciation is typed as a positive number** ("15") and saved as a negative rate.
8. **Saving is several small writes.** If one fails, the records already made are removed again, so no half-made investment is left on your list. (The removed records stay in the encrypted history as deleted.)
9. **Deleting has Undo.** Entries and valuations delete with an Undo button. Deleting a whole investment asks first and also offers Undo. Closing is reversible with Reopen. Reopening keeps any "Sale proceeds" entry, so delete it from the ledger if it no longer applies.
10. **The wizard draft lives in memory only.** Locking, reloading or the idle lock discards it. The eye (hide amounts) does not.
11. **Entries on a closed investment** can still be added or edited, but the figures ignore entries after the closing date (engine rule), and the form says so.

## Tests
`tests/forms.test.mjs` adds 28 tests: parsing, every wizard rule, all 16 templates, saving and rollback, the 50/30/20 split from the wizard, closing, and delete with undo. Node now runs 127 tests; the one browser-only database test makes 128 on the live /tests/ page. The screens themselves were also clicked through in a simulated browser (jsdom), not yet in a real one.
