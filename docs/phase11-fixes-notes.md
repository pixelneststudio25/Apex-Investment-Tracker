# Phase 11 fixes (second pass)

Paste each file over the one at the same path. nav.js is new, so sw.js is bumped to apex-shell-6 (replace it too).
Several js/ui files changed only mechanically (they now use fill() from dom.js instead of replaceChildren): this is what stops a
missing section printing the word "false".

## What was wrong, and what changed
1. Cards touching each other in Settings: my CSS used a spacing token (--space-5) that does not exist, so the gap silently vanished. Fixed, and a test now fails if any stylesheet uses a spacing token that is not defined.
2. Back links: Reminders and Recently deleted had none. Help said "Home" while lighting the Settings tab. Projections said "Projections". Now Reminders, Recently deleted, Export and My categories always go back to Settings. Help and Projections go back to wherever you came from (Settings or Home), and their bottom tab matches.
3. "false" printed under Reminders: a hidden "Done" section was being printed as text. Fixed everywhere with fill().
4. Export: each file's text was squeezed into a thin column, one letter per line. Rows now stack with a full-width button on phones.
5. Projections: Name, rate and "How the rate is applied" ran past the card edge and widened the whole page (that is why the tab bar shifted). Fixed, plus a page-wide guard so no field can do that again.
6. Section pages (This device, Appearance...): titles now match page titles, card headings match the other cards, Appearance is two cards, and the empty space under Install Apex is gone.
7. Settings list: long values no longer push the arrow off the row; "Amounts and privacy" shows an open eye when amounts are shown.

## Check on your phone
1. Settings: even gaps between every group; the arrow shows on every row.
2. Open Reminders, Recently deleted, Export and print, My categories: each shows "< Settings" and goes there.
3. Settings > Projections: "< Settings", then Whole portfolio: "< Settings". Same screens from Home's Look ahead: "< Home".
4. Help from Settings: "< Settings" with the Settings tab lit. Help from Home: "< Home" with Home lit.
5. Reminders with none: no word "false". Export: three tidy rows. Projections form: nothing wider than the card.
