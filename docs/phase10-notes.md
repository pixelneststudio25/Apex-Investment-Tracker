# Phase 10: fixes

## What changed
- **Theme is per device.** The Appearance cards read the theme that is really applied (`getThemeMode()` in `js/ui/motion.js`) and repaint on the `apex:theme` event, which `applyTheme()` sends on every change (sign-in screen button, header button, search, the cards). The theme is no longer written to the synced records. The old `theme` field stays in the schema so existing records still load.
- **No more jumping to the top.**
  - `render({ keepScroll: true })` refreshes a page in place: no skeleton, no entrance animation, same scroll position. Used by: the eye button, checklist Hide/Done, saving the portfolio name, adding/removing the sample portfolio, reopening an investment, Undo after delete, and the "Show the setup checklist" command.
  - The add-investment wizard resets scroll and focus only on a new step. A tap inside a step (owner, value behaviour, simple/compounding, income, payment frequency) keeps the scroll position and the focused control.
- **Auto-lock is a setting.** Settings > Security > "Lock automatically after" (1, 2, 5, 15 minutes, or only when locked by hand or closed). Applied straight away and on every unlock. Default stays 2 minutes.
- **Small ones.** `<main>` is no longer a live region (screen readers stop re-reading whole screens). Tab labels are capped at 14px so four fit at any text size. More space between the label and the amount in the text-size preview. Reminders now highlight Settings (their entry point) until the Outlook tab arrives.

## Not changed
`sw.js` needs no version bump: no app file was added or removed.

## Check on your phone
1. Sign-in screen: switch to dark, sign in, open Settings > Appearance. "Dark" is highlighted. Switch with the header button (tablet/desktop) or search: the highlighted card follows.
2. Home, scrolled down: tap the eye. The page stays where it is. Same with the checklist "Hide" and with adding/removing the sample portfolio (Settings).
3. Add investment: on each step with choices, scroll down and tap a choice. The page stays put. Tap Continue: the next step starts at the top.
4. Settings > Security: change the lock time to 1 minute, leave the app idle, it locks. Choose the last option: it does not lock while open.
5. Text size at Largest: the bottom tab labels are not clipped.
