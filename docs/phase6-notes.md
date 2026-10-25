# Phase 6: changing what you saved

**What is new:** edit an investment after saving it, manage regular payments (rent), see and restore earlier versions of anything, reminders, change who shares an investment, a Recently deleted list, and loan repayments that are no longer counted twice. No new Supabase step is needed.

## Where things are
- **Edit:** investment page, Edit button (or Details tab). Name, dates, notes, details, how its value changes, rates (several periods allowed), income mode.
- **Regular payments:** Overview tab, Regular payments, Manage. Edit amount and dates, record due payments as received (one by one or all), skip a month, add a rent increase from a date, stop or resume, delete.
- **Change history:** Details tab, Change history. Also a link at the bottom of every entry and valuation you open.
- **Reminders:** Home, Coming up, Reminders; or Settings; or Ctrl+K. Each investment's Overview also lists its own.
- **Who shares it:** People tab, Change who shares it.
- **Recently deleted:** Settings, Recently deleted.

## Decisions to review
1. **Loan repayment is a new kind of entry.** It takes the repayment off what is still owed (growing from its own date, so interest runs only on what is left) and counts it as money received. Worked example in the tests: ₦1,000,000 at 12% simple for a year, ₦500,000 repaid on day 182, still owed ₦589,917.81, interest earned ₦89,917.81. Home's "Sold for" is now "Sold or repaid". A manual valuation on a loan means "what is still owed".
2. **Shares: fix or change.** "Fixing a mistake" corrects the split from the start. "The shares really changed" ends the old split on a date and starts the new one that day, so income received before keeps the old split. If anything fails part-way, the earlier steps are undone.
3. **Restoring a version makes a new version** (history is never rewound). Undo restores the version you replaced.
4. **A device that did not make the older versions** fetches them from the server when you open Change history (needs to be online; offline it shows what the device has).
5. **Marking a repeating reminder done** moves it to its next date after today without drifting (31 Jan, then 28 Feb, then 31 Mar).
6. **Switching to "I will update the value"** removes saved rates when you save (the form says so first). Changing to Earns interest requires a rate.
7. **Whole-record conflicts still apply:** if you delete on one device and edit on another, the later action wins and the other stays in history.

## Not here yet
Documents (uploading deeds and photos), your own categories, projections screen, readable export (CSV or printable statement), installable app and offline start.

## Tests
`tests/manage.test.mjs` adds 23 tests (loan golden numbers, edit round trips for five kinds of investment, overlapping rates, schedules, reminders, shares that change over time and roll back on failure, history including pulling old versions from the server, recently deleted). Node now runs 186 tests. All screens were also clicked through in a simulated browser, not a real one.
