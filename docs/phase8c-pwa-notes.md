# Phase 8C: installable app

What it does: Apex can be installed on a phone or computer, opens in its own window, and opens with no connection.

## How it works
- `manifest.webmanifest` names the app and lists four icons (two "any", two maskable for Android's round and squircle masks).
- `sw.js` saves the app's own files (list in `SHELL`). It is **network first**: online, you always get the newest deploy; offline, or if the network takes more than 4 seconds, you get the saved copy. Any address opens the saved `index.html` when offline.
- It ignores everything that is not a same-site GET: Supabase calls, document uploads and downloads, other sites. Records are never saved by it (they already live encrypted in IndexedDB).
- `js/pwa.js` registers the worker and holds the browser's install offer. `js/ui/install-panel.js` shows it in Settings. iPhone gets Share > Add to Home Screen instructions; other browsers without an offer get a menu hint.

## When you add or remove a file
Add or remove it in `SHELL` in `sw.js` and change `VERSION` (for example `apex-shell-2`). A test fails if the list and the real files disagree, so this cannot be forgotten quietly.

## Not included
No update banner (network first makes it unnecessary), no offline sign-in (signing in with a password still needs the server; PIN unlock works offline), no push notifications, no Help topic yet.
