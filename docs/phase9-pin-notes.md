# Phase 9: PIN screen redesign

Chosen: K1 round keys, K2 spacing and layout, K3 lock emblem, F1 dots, F2 attempts pips, G1 greeting with initials.
Not done on purpose: S1 scramble keypad, S2 biometric unlock, G2 real name on the lock screen (needs a plain copy of the name on the device).

## What changed
- Keys: round, borderless, thin numerals, a soft tint that blooms on press. The delete key dims when there is nothing to delete.
- Layout: the block sits in the middle of the screen, with clear space between the message and the keys. "Use password" is a text key in the empty bottom-left slot; the old link underneath is gone.
- Emblem: padlock in a soft ring. Right PIN: the shackle lifts, the ring pulses, a tinted circle spreads across the screen, then the existing logo splash plays.
- Dots: larger, fill with a spring. Success: green dots, a check drawn in, "Unlocked". Error: dots flash red, shake, double buzz, then empty.
- Pips: five small marks under the dots, shown once a wrong PIN has been tried (also after a reload). The text "N attempts left" is kept for screen readers only.
- Greeting: time-aware "Good morning / afternoon / evening" in the serif, and an email chip with initials (derived from the email, nothing stored).
- Set-a-PIN screen: same keys, dots, emblem and spacing. After the second entry it shows "PIN set" with the same open-lock moment. It keeps its "Skip for now" link.
- Reduced motion: no bloom and no waiting; the app opens at once.

## Files
New: css/pin.css, tests/pin.test.mjs, docs/phase9-pin-notes.md
Replaced: js/ui/pin-views.js, js/app.js (two lines), css/components.css (PIN block moved out), index.html (one link), sw.js (pin.css added, version apex-shell-3), tests/run-node.mjs
Not touched: js/core/auth.js, the unlock logic, the security model, js/ui/icons.js.

## js/app.js
`onPin` and `onSet` now receive the pad as a second argument and wait for `ui.success()` before `enterApp()`. That is the whole change.

## Verified (Node suite, and headless Chromium at 390 x 844, light and dark)
- Full Node suite passes (260 checks, 0 failures), including 5 new tests for the initials and for reading attempts-left from the auth message.
- Keys, keyboard entry, delete, error flash and shake, dots emptying, pips going from 5 to 4 after one wrong PIN, pips showing 2 lost when the device already had 3 left, the success state, the "Use password" key firing, the setup screen, and no sideways scroll.
- Reduced motion opens the app straight away with no bloom.

## Not verified
- A real phone: the buzz patterns, the feel of the press tint, and smoothness on iPhone Safari and Samsung Internet.
- The real header height on a phone, which decides how well the block is centred.
- The full sign-in flow against Supabase (the browser check used a stand-in for unlock).
- Phones under 640px tall: the setup screen scrolls a little because of its long footer text.
- tests/browser.mjs (the in-browser test page) was not updated with the new PIN tests; only the Node runner was.

## Live check (about 3 minutes)
1. Lock the app and open it on your phone, in light and dark. Look at the spacing and the keys.
2. Enter a wrong PIN: red flash, shake, buzz, pips go from 5 to 4. Reload the page: the pips should still show 4.
3. Enter the right PIN: the lock opens, green dots, a check, then the logo splash and Home.
4. Tap "Use password" in the bottom-left and check it goes to the password screen.
5. Set a new PIN: both entries use the new pad and "PIN set" shows at the end.
6. Turn on Reduce Motion in the phone settings and unlock: there should be no waiting.
