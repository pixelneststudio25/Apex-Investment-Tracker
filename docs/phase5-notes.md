# Phase 5: backup and sync

**What changed for you:** your records are now backed up online (encrypted) and appear on every device you sign in on. The status chip at the top says whether you are safe, Settings has a Backup and sync panel, and there is an explicit "Remove my data from this device".

## One-time step (needed before it works)
Run `tests/supabase/phase5-sync.sql` once in the Supabase SQL Editor. Without it, history uploads fail and the chip shows "Backup problem".

## How it works
- Every save is encrypted on the device first. Within about 1.5 seconds Apex sends the encrypted row up (and the old version to history). Every minute, and whenever the device comes back online, it also asks the server for changes made elsewhere.
- Sync only runs while Apex is unlocked. Locking stops it; unlocking starts it.
- Each push says "change version N, but only if the server still has version N-1". If another device got there first, nothing is overwritten.

## Decisions to review
1. **Conflicts keep both sides.** If two devices change the same record before syncing, the change with the later saved time (the time recorded inside the record) becomes the current version, and the other is kept as a version in history. Offline edits on one device stay in order. The rule works on the whole record, so a delete that is newer than an edit wins, and the edit stays in history.
2. **History for a new device** is not downloaded yet. A new device gets every current record; old versions stay on the server until the history screens arrive (Phase 6).
3. **Signing out keeps this device's encrypted copy** so unsynced work is never lost. Apex tries to back up first and warns if something could not be.
4. **Remove my data from this device** backs up, then asks the server to confirm it holds every record, then deletes the local copy and signs out. If it cannot confirm, it says why and asks again.
5. **Backup file** is the stored ciphertext as JSON. Restore only adds records the device lacks or has older versions of; it never deletes or overwrites newer work. A file from another account is refused.
6. **Settings (theme, text size, hide amounts) now sync too**, because they are ordinary records. If two devices disagree, the newer wins.
7. **Device-only:** the PIN and the "recovery key checked" tick are not synced.

## Tests
`tests/sync.test.mjs` adds 26 tests with a simulated server and two or three simulated devices: push, pull, pages, edits, deletes, five conflict cases, offline, expired sign-in, lost replies, one refused record, duplicate-safe history, an unreadable row, verification, and backup and restore including recovery after the server loses everything. Node now runs 163 tests. The Settings panel and chip were also exercised in a simulated browser.

## Not verified yet
The Supabase request code (`js/core/remote.js`) has only run against a simulation. Use the two-browser check in the chat message before trusting it with real records.

## Housekeeping
Delete the stray copies in the repo root: `git rm "files (13).zip" workspace.js formkit.js help.js icons.js palette.js`
