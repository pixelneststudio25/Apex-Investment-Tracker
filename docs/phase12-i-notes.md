# Phase 12-i: Outlook engine (no screens yet)

Paste each file at the same path. outlook.js is new, so sw.js is bumped to apex-shell-7 (replace it too).
Nothing visible changes in the app yet. The old Projections screens still work exactly as before; they are replaced in 12-iii.

## What it does (js/models/outlook.js)
1. Saved rates are used exactly as saved (quarterly, daily, any compounding). Nothing is turned into a different kind of rate.
2. A term investment stops growing at its maturity date and then sits at its maturity value. One already past maturity is held at today's worth.
3. Rate changes already saved with a future start date are replayed on their dates. A rate that ended before today is ignored.
4. Monthly points (today plus 12 a year) for smooth charts, with a per-investment breakdown for the stacked chart, and whole-year rows for tables.
5. Full value (default, matches Home) or My share (your own percentage on shared investments, taken from the ownership on today's date).
6. Real terms: you type the inflation figure; none is built in. Every future figure is divided by it for the days between today and that figure's date.
7. Also ready for 12-iii: edited rates per investment (source: Saved, Edited or None), a portfolio-wide nudge in points, and Cautious/Base/Optimistic bands.

## Choices to know about
- No rate after today means held flat and named in `held`. Apex never invents a rate, and a nudge never gives a flat investment one.
- Expected rent and costs follow the saved payment plans from tomorrow, as before. They do not stop at maturity.
- Share is taken on today's ownership and applied to the whole projection. A future change in ownership is not replayed.
- An investment whose ownership or rates cannot be calculated is named in `broken` and left out; it never blocks the rest.
- Yearly return (XIRR) is not part of this engine. The Outlook headline uses worth and gain.

## Check
Tests only this time: run `npm test`. The new section is "outlook engine" (16 tests). All other sections still pass.
