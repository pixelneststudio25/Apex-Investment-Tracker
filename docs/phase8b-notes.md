# Phase 8a polish: upload screen, entry links, documents help

## Upload screen (`js/ui/document-views.js`, `css/documents.css`)
- **File area**: the plain browser "Choose File" box is replaced by a drop area. Tap it, press Enter on it, or drop a file onto it. The real file input sits invisibly on top, so the keyboard and screen readers work as before.
- **File card**: once a file is chosen, the area shows a badge (PDF, Photo, Word, Excel, CSV, Text), the name, the size and a remove button. A refused file (wrong type, empty, over 10 MB, or the investment is full) shows its reason under the area and the area turns red.
- **Upload steps**: Reading, Locking, Uploading, Saving. A four-part bar and a short list tick off as each step finishes. These are real steps, not a guessed percentage. If one fails, that step is marked and the form unlocks so you can try again. While it runs, the fields are locked and Cancel is disabled.
- **Buttons**: "Lock and upload" keeps its label on one line (text about 6% smaller on this button only). Cancel stays compact beside it. At very large text sizes the row stacks instead of squeezing.

## Linking a document to a ledger entry
- A document may point at one entry of the same investment. The link is optional.
- **Add screen**: a "Ledger entry" list (date, kind and the start of the note, no amounts, so Hide amounts is respected). Opening Add from an entry preselects it and returns you to that entry afterwards.
- **Entry screen** (Edit entry): a Documents section lists what is attached, with Attach.
- **Ledger tab**: entries with a document show a small paperclip.
- **Document screen**: shows the linked entry and lets you change or clear it, together with the label, in one save.
- **Overview list**: a linked document says which entry it is for.
- The check happens before anything is uploaded: an entry from another investment, a deleted entry or a missing one is refused.
- If an entry is deleted later, the document keeps its link. Restoring the entry brings it back into view. Until then the document screen says "The linked entry was deleted", and its label can still be edited.
- **No Supabase change.** The link lives inside the encrypted document record (`entryId`). Older documents have no link and read as "Not linked".

## Other changes
- Help: new topic "Keeping documents with an investment" and the question "Can I add or open a document without internet?".
- Tidy-up: the share image moved from `Apex.jpeg` in the root to `img/apex-share.jpg`, and both `og:image` and `twitter:image` now use `invest-apex.vercel.app`. `docs/README.md` no longer says "Phase 0 setup".
- New icons: upload and paperclip.

## Tests
220 became 226 passing (1 skipped, the browser-only IndexedDB test). New: upload step order and a failed upload never reaching the save step; linking and listing; refused links upload nothing; relink, clear and label edits (including a deleted entry); older records without a link; file kinds.

## Check on the live site (5 minutes)
1. Open an investment, Documents, Add. Pick a PDF: the file card appears. Pick a `.exe`: it is refused in red.
2. Choose "Lock and upload": the four steps tick off, and the button text is on one line.
3. In Edit entry for a cost, press Attach, add a file. You should land back on that entry with the file listed, and a paperclip on that row in the Ledger tab.
4. Open the document, clear the link, save. The paperclip disappears.
5. Check the screen in dark mode and with the largest text size.
