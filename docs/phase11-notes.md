# Phase 11: Settings restructure

Paste each file over the one at the same path (project root). Phase 11 builds on the dropdown files you already deployed
(js/ui/picker.js, css/picker.css, js/ui/formkit.js, css/categories.css), so deploy those first if you have not.
sw.js VERSION is now apex-shell-5. index.html, sw.js and tests/run-node.mjs are cumulative: replace them in full.

New: js/ui/settings-views.js, css/settings.css, tests/settings.test.mjs
Replaced: js/ui/workspace.js, index.html, sw.js, tests/help.test.mjs, tests/run-node.mjs

## Check on your phone
1. Settings shows a profile card, then grouped rows (Preferences, Your data, Backup, Security, Help, Account), each with icon, value and chevron.
2. Tap Appearance. It slides in with Theme and Text size. Change both, tap Back, and the row shows the new value.
3. Tap Auto-lock. The sheet opens; pick a time; the row updates and a toast confirms.
4. Tap Amounts and privacy, flip the switch; the row says Hidden or Shown and the page does not jump.
5. Backup and sync, Documents backup, This device (install app, sample portfolio) each open their own page.
6. Account, Danger zone: each button asks for its own confirmation first.
7. Browser back from a section returns to the list. Reminders, Projections, Export, Recently deleted and My categories still open.
8. Search (Ctrl K / the magnifier): type "appearance" or "danger"; it opens that exact section.
9. On a laptop (wide window): the list stays on the left, the section on the right, and the list does not scroll away when you switch.
