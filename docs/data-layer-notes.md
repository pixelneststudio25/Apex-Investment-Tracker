# Data layer (Phase 3): decisions and contracts

Code: `js/core/db.js`, `store.js`, `vault.js`, `js/models/schemas.js`, `templates.js`, `portfolio.js`. Tests: `tests/store.test.mjs` (also run on the real IndexedDB in the browser at `/tests/`).

**How it fits together.** Screens (Phase 4) call `await vault.store()` for the encrypted store and `createPortfolio(store)` for ready-made numbers. The store encrypts every record with the data key (AES-GCM, AAD binds owner + record id) and keeps it in IndexedDB, one database per account (`apex-data-<userId>`). The calculation engine stays pure; `portfolio.js` is the only place that joins stored records to it.

## Decisions to review
1. **Record type is `type`, not `kind`.** `entry.kind` (capital_in, cost, income, payout, proceeds) and `schedule.kind` already mean something to the engine, so the record discriminator is `type` (investment, entry, schedule, valuation, partner, ownership, document, reminder, settings, categoryTemplate).
2. **What is readable on disk (and later on the server):** record id, owner id, ciphertext, record schema version, version number, createdAt / updatedAt / deletedAt, the dirty flag, and ciphertext sizes. Record types, names, amounts, dates of entries, notes: all inside the ciphertext. The number of records and when they were changed can be seen; the plan accepted this.
3. **History = the outgoing version.** Each edit saves the old ciphertext to `history` as version n, and the record becomes n + 1 in one atomic batch. `history(id)` returns every version, oldest first, the last being current. `revertTo` makes a new version from an old one; it never rewinds.
4. **Delete is soft; children are hidden, not rewritten.** Deleting an investment hides it and everything that belongs to it (entries, valuations, schedules, ownership, documents, reminders) without touching those records. Restoring the investment brings everything back exactly as it was. Orphaned children stay in storage until a purge (later).
5. **Overlapping rates are refused at save**, whatever their type, so only one rate applies on any day. (The engine would otherwise fail later with RATE_OVERLAP.) To compare an assumed and an agreed rate, use two projection scenarios.
6. **Strict validation.** Unknown fields, fractional kobo, impossible dates, years outside 1900 to 2200, entry amounts of zero or less, and inconsistent investments (active with a closing date, rates on a manual-only investment) are refused. Rates are stored as fractions (0.12 = 12%). **The screens must turn "12.5%" into 0.125 with decimal-safe string handling**, not floating-point multiplication.
7. **Unreadable records never break a list.** A damaged record, one from another account's key, or one saved by a newer app version is skipped and reported by `store.problems()`, so the screens can warn instead of failing silently.
8. **Sign-out does not delete local data.** Unsynced edits would be lost. Everything on the device is ciphertext without the key. `vault.wipe()` exists; Phase 6 offers it as an explicit "remove my data from this device" step after a successful sync.
9. **Settings is a singleton.** Created on first use. If two devices each create one before syncing, the newest wins.
10. **Safe writes.** Writes are serialised in the app and also version-checked inside the database transaction, so a second open tab cannot silently overwrite a newer save: the stale write re-reads and applies on top (tested).

## Contract for Phase 6 (sync)
- `store.pending()` returns ciphertext rows waiting to go up: dirty records and unpushed history.
- `store.markPushed({ records: [{id, version}], history: [keys] })` clears them. A record edited during a push stays dirty.
- Local timestamps come from the device clock. The server stamps its own `updated_at` on every update (trigger in `schema.sql`), so use **`version` as the conflict authority** and the server's `updated_at` only as the pull cursor.
- Not built yet: pulling remote rows, conflict review, and the retention purge of old soft-deleted rows.

## Not in this phase
Document encryption and upload (Phase 7), any screens (Phase 4), reminders logic, schedule confirmation flow (Phase 5).
