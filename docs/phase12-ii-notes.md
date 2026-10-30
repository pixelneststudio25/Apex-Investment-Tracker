# Phase 12-ii: the two Outlook charts (no screen yet)

Paste each file at the same path. No new app files, so sw.js stays at apex-shell-7 (do not change it).
Nothing visible changes in the app yet: the charts are used by the Outlook screen in 12-iii.

## What was added (js/ui/charts.js, css/workspace.css)
- bandChart: the base line with a shaded Cautious-to-Optimistic band around it. Fed by projectBand() from the engine.
- stackedChart: stacked areas showing which investments the worth comes from, biggest at the bottom. stackLayers() folds the
  smallest ones into "Everything else", so there are never more than six colours (the chart tokens).
- Both are hand-built SVG (no library), so the security policy is unaffected.
- Scrubbing by finger, mouse or keyboard (left/right arrows, Page Up/Down for a year, Home, End, Escape). Each move calls
  onHover(point, index) so the screen can show a live readout. Screen readers get a slider with a value text, plus a written
  description of the whole chart (describeBand, describeStack), which says "in today's money" when real terms is on.
- No animation, so Reduce Motion needs nothing special. Colours are tokens only and work in both themes.
- The existing lineChart, ghostChart and donut are unchanged.

## Checked
- 6 new tests (npm test, section "outlook charts"); all other sections still pass.
- Rendered in a real browser at 360px wide in light and dark: both charts drew, pointer scrubbing and keyboard scrubbing moved
  the line and the readout, and there were no console errors.
