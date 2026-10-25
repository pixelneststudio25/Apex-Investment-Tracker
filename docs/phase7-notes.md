# Phase 7 notes: projections, export, printable statement

## What was built
- `#/projections` (choose an open investment) and `#/projections/:id` (the what-if screen).
- `#/export` (three CSV files) and `#/statement[/:id]` (printable page).
- Links: a "Look ahead" button on open investments, a panel in Settings, and three items in search (Ctrl+K).
- Help topic "Looking ahead, exporting and printing" and the glossary term "Projection".

## Decisions
- A projection starts from what the investment is worth today and applies ONE yearly rate to the end of each horizon (1, 3, 5, 10 years, plus one number of years the person adds, up to 50). Horizons are calendar years, then actual days / 365, like the rest of the engine.
- Rates saved on the investment are not replayed. They are only offered as Scenario A's starting answer, and only when this screen can apply them the same way (simple, yearly compounding, or monthly compounding). Anything else is left blank rather than guessed.
- Scenario B is optional. The comparison table is B minus A.
- Regular payments (rent, service charges) are included from tomorrow on, following the saved plan (increases, skipped dates, stop date), minus dates already recorded. Payments already due and not recorded are NOT counted, and the screen says how many: Apex never assumes money arrived. A switch turns payments off.
- Yearly return with payments is XIRR over the dated flows; without payments it is the engine's CAGR.
- Nothing from Projections is saved or synced. Every row carries `isProjection: true` and every table is labelled "Projection".
- Closed investments cannot be projected.
- CSV: plain naira with two decimals built from whole kobo (no floating point), money leaving you is minus, UTF-8 with a byte-order mark and CRLF so Excel reads the naira sign. Text that a spreadsheet could run as a formula (starts with = + - @ tab return) gets a leading apostrophe. Deleted investments are left out. The page warns that a downloaded file is not encrypted.
- Statement: always plain figures. If "Hide amounts" is on, the page asks to show amounts first instead of printing made-up numbers. Print rules live in `css/reports.css` (menus and controls are hidden, black on white).

## Not built
- Projecting the whole portfolio at once (only one investment at a time).
- Saving a projection, or printing it.
- Quarterly or other compounding choices in the screen.
- A PDF made by Apex itself: printing uses the browser's "Save as PDF".
- Export of reminders, schedules or change history.
