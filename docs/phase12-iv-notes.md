# Phase 12-iv: saving what you try on Outlook

## Supabase: nothing to run
The server only holds encrypted blobs, and the record type lives inside the encryption, so the new record type needs NO change to your Supabase SQL. A test checks this (the records table has no type column, and none of the new data is readable in storage).

## Files (paste at the same path; two are new, sw.js is now apex-shell-9)
NEW: js/models/outlook-plans.js, tests/outlook-plans.test.mjs
CHANGED: js/models/schemas.js, js/ui/outlook-views.js, js/ui/workspace.js, js/models/help-content.js, css/outlook.css, sw.js, tests/outlook-ui.test.mjs, tests/run-node.mjs

## What it does
- Remembered automatically: your edited rates, how far ahead, Cautious/Base/Optimistic or your own points, Real terms and the inflation figure you typed, My share, and the goal target. Saved quietly about a second after you stop changing things, and loaded when you open Outlook after the app starts or unlocks. It is the same on every device you sign in on.
- Saved scenarios: type a name under Saved scenarios and choose Save these choices. Up to 5. Load puts that set on screen, Delete removes it (with an Undo for a few seconds). Duplicate names (any capitals) are refused with a sentence.
- Reset everything puts the screen back to your saved rates, 5 years and Base. Saved scenarios stay.
- Only choices are stored, never a result. Every figure is worked out fresh and stays a projection.
- Everything is encrypted like the rest of your records and goes into the same backup and sync.

## Choices to know about
- Opening Outlook the first time does not write anything. The first save happens when you change something.
- If you delete an investment, a saved rate for it is quietly ignored when a set is loaded.
- A deleted scenario is not listed under Recently deleted (the Undo button is the way back).
- Update Apex on every device before using this. An older copy cannot read the new record type and would skip it (nothing breaks, it just does not show there).
- Home's My share switch is still not added (Outlook only). Say if you want it.

## Check on your phone
1. Outlook: choose 10Y, tap an investment under Assumptions, use a rate, tap Cautious. Wait 2 seconds, close the app fully and reopen: the same choices are there.
2. Type a name under Saved scenarios, Save these choices. It appears in the list with "10 years, 1 edited rate, 3 points lower".
3. Reset everything, then Load your scenario: everything comes back.
4. Delete it and tap Undo within a few seconds: it returns.
5. Save a scenario with the same name again: you get a sentence, not a crash.
6. Save five, try a sixth: it says you can keep up to 5.
