# Phase 13, batch 1: speed and touch feedback

Paste each file at the path in its name. NEW: js/ui/haptics.js, tests/speed-haptics.test.mjs. sw.js is now apex-shell-10 (replace it too).
No Supabase change.

## Speed
- The store now counts changes (a "generation": every save, delete, restore, sync, backup restore, lock or new key adds one).
- portfolio.js keeps one calculated snapshot per generation: the overview, totals, timeline, upcoming, recent, each investment's bundle and metrics. While nothing changes, every screen reuses it. The moment anything changes, it is thrown away, so a screen can never show an old number. Every screen gets its own copy, so changing a result cannot change the snapshot.
- Reads were the real cost: each investment re-read every record of every type (so time grew with the square of the count). Each kind of record is now read once per generation.
- Measured on a test portfolio (in memory, so a phone will differ): 30 investments, Home went 1,227 ms to 376 ms the first time and about 0 ms on every later visit. 60 investments went 4,796 ms to 847 ms, then about 1 ms. After you save something, the next screen recalculates once.
- The first visit still takes real time because the history chart works out 72 month-end points for every investment. That is the next thing to tune if it ever feels slow.

## Touch feedback (haptics)
- Settings, Appearance, Touch feedback: a switch (off by default). It uses the setting that was already in your records.
- When on: a light tick as you move along the Outlook charts (only when you land on a new point, and spaced so a fast scrub is a texture, not a buzz), a short tap on switches and segmented controls, and the PIN keypad's taps. When off, nothing vibrates anywhere (the PIN keypad used to vibrate regardless).
- iPhones and iPads do not let web apps vibrate, so on those the switch does nothing and says so. Most Android phones do.
- The last choice is also remembered on the device so the PIN keypad can follow it before unlocking.

## Files
NEW: js/ui/haptics.js, tests/speed-haptics.test.mjs
CHANGED: js/core/store.js, js/models/portfolio.js, js/ui/charts.js, js/ui/formkit.js, js/ui/pin-views.js, js/ui/settings-views.js, js/ui/workspace.js, sw.js, tests/run-node.mjs

## Check on your phone
1. Everything looks and adds up the same as before: Home totals, Investments list, an investment's page.
2. Add an entry or a valuation, go back to Home: the totals changed at once (this is the cache being thrown away correctly).
3. Delete an investment, check Home, then Undo: the totals follow both ways.
4. Android only: Settings, Appearance, turn on Touch feedback (you feel a tap). Slide along an Outlook chart and flip a switch. Turn it off: silence.
