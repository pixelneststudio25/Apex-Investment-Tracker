# Phase 12-iii: the Outlook tab

Paste every file at the path in its name. Three are NEW (outlook-views.js, sheet.js, outlook.css) and sw.js is now apex-shell-8.
Send sw.js and index.html with the rest, or the new tab will not load offline or look right.

## What changed
- Fourth tab: Home, Investments, Outlook, Settings (the sidebar follows). Reminders and Projections left Settings.
- #/outlook is the whole portfolio; #/outlook/<investment id> is the same screen for one investment (the Look ahead button on an investment goes there).
- Old links keep working: #/projections and #/projections/all go to Outlook, #/projections/<id> goes to that investment. The address bar is corrected, so Back does not bounce.
- Reminders sit under the Outlook tab (its back link says Outlook). Home's Coming up panel stays, and Outlook has its own with Reminders inside it.
- Search: one "Outlook" command replaces the two Projections ones. Help text for this topic was rewritten.
- The old Projections screens (Scenario A and B, the chooser) are removed from report-views.js. Their calculations stay in the models and tests.

## The Outlook screen, top to bottom
1. Horizon: 1Y, 3Y, 5Y, 10Y or Custom (any whole number up to 50).
2. Headline: "In 5 years" with the figure in short form (full figure on hover and in the table), the gain, Real terms switch (you type the inflation figure; none is built in), and Full value / My share (only shown if you have a shared investment). The number counts up when it changes (not with Reduce Motion).
3. Chart: Range (base line with the Cautious to Optimistic band) or Where from (stacked by investment), scrubbable, plus a table by year.
4. Assumptions: one row per open investment with its rate in words and Saved / Edited / None. Tap to try a rate in a sheet. Edited rows show a dot and Reset. Figures update live; there is no Show projection button.
5. Scenarios: Cautious, Base, Optimistic (3 points lower or higher), plus your own number of points lower or higher.
6. Coming up: the next 45 days with reminders and an Add a reminder button.
7. Cash flow: twelve months of expected income against costs.
8. Maturities: term investments still to mature, with the projected worth that day.
9. Goals: type a target worth to see when you reach it (up to 50 years), and the regular payments expected in the last year of the horizon.

## Choices to know about
- Nothing is saved yet. Your choices last while the app is open; saving edited rates and named scenarios, and remembering the inflation figure, is 12-iv. A reload starts again.
- Home's My share switch is not added in this step (it only exists on Outlook). Say if you want it on Home in 12-iv.
- Investments list rows do not get their own Look ahead link: the Outlook tab and the Look ahead button on each investment cover it.
- Goals: the year-N income line counts only your saved payment plans (rent and costs), the same as before.
- The "Reminders" page itself is unchanged apart from its back link.

## Check on your phone
1. The bottom bar shows four tabs and "Investments" is not clipped at the largest text size.
2. Outlook: tap 1Y, 3Y, 10Y and Custom (type 7). The headline changes at once.
3. Turn on Real terms, type 6 for inflation: the headline gets smaller and says "in today's money". Clear the box: it goes back.
4. Tap an investment under Assumptions, type a rate, Use this rate. A dot and Reset appear. Reset puts it back.
5. Tap Cautious, then Optimistic: the figure goes down, then up. Slide a finger over the chart.
6. Open an old bookmark such as /#/projections/all: it lands on Outlook.
7. Settings no longer lists Reminders or Projections. Reminders (Outlook, Coming up) says "< Outlook".
8. Open an investment and tap Look ahead: Outlook shows just that one, with its name as the back link.
