# Phase 13, batch 2: calendar export (.ics)

Paste each file at the path in its name. NEW: js/models/calendar.js, tests/calendar.test.mjs. sw.js is now apex-shell-11 (replace it too).
No Supabase change. Made entirely on the device; nothing is sent anywhere.

## Where
Settings, Export and print, new Calendar section. Outlook's Coming up panel has a "Put these in my calendar" button that goes there.

## What is in the file
- Your reminders that are not done. A repeating reminder (monthly, every 3 months, yearly) is written out date by date, exactly as Apex repeats it. A one-off that is overdue lands on today as "Overdue: ...". A missed repeat is not shown again; the next one is.
- The payments your saved payment plans expect and that are not recorded yet (the same ones as Coming up). Once you record a payment it is no longer expected.
- Reminders and payments of deleted investments, finished reminders and closed investments are left out.
- Range: next 3, 6 or 12 months. All-day events marked "free" so they never block a meeting. Reminders get a 9 am alert on the day. At most 1000 events, and the file says so if it was cut.
- Every event has a steady id (record plus date), so opening the file again updates the dates in your calendar instead of doubling them.

## Privacy choices
- Default: a payment shows only as "Payment expected" or "Cost expected" (plus your own plan label such as Monthly rent). No amount, no investment name.
- The switch "Include amounts and investment names" adds them. It is off every time you open the page.
- The page warns that calendar apps often sync to a cloud service and that the file is not encrypted, the same as the CSV files.
- Reminder text is your own words, so it is always included. Keep that in mind when you write reminders.

## Files
NEW: js/models/calendar.js, tests/calendar.test.mjs
CHANGED: js/models/portfolio.js (payments now carry their plan id), js/models/help-content.js, js/ui/report-views.js, js/ui/outlook-views.js, sw.js, tests/run-node.mjs

## Check on your phone
1. Settings, Export and print, Calendar: choose Next 12 months, Download calendar (.ics).
2. Open the file. iPhone: it offers to add events to Calendar. Android: open it with Google Calendar or Samsung Calendar.
3. Your reminders appear as all-day events and your rent/costs as "Payment expected". No amounts.
4. Turn the switch on and download again: amounts and investment names are in the titles. Import it again: nothing doubles.
5. Make a repeating reminder on Home: it shows up on each of its dates.
