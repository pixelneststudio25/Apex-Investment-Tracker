# Phase 8a: documents

Attach a file (a contract, a receipt, a title deed) to an investment. The file is locked on the device before it is uploaded.

## How it works
- **Sealing** (`js/core/doccrypt.js`): AES-GCM with your data key and a fresh random IV for every file. The sealed file is 28 bytes larger than the original. The owner and the document id are bound into the seal, so a file copied under another name or another account refuses to open.
- **Storage** (`js/core/files.js`): the private `vault` bucket. The path is `<your user id>/<investment id>/<document id>`. The first folder is your id, which is what the access rules in `schema.sql` check. The server only ever sees sealed bytes.
- **Record** (`js/models/documents.js`): a small encrypted `document` record (file name, size, label, storage path, date) goes through the normal store and sync, so it appears on your other devices like everything else. The file itself is downloaded when you press Download.
- **Order of saving**: upload first, then save the record. If saving the record fails, the upload is removed. If the upload fails, no record is made.
- **Screens** (`js/ui/document-views.js`): a Documents section on the investment's Overview tab, `#/investments/:id/documents/new`, and `#/investments/:id/documents/:docId` (download, label, delete).

## Rules
- Up to 10 MB per file and 20 documents per investment.
- Accepted: PDF, PNG, JPG, JPEG, WEBP, HEIC, TXT, DOC, DOCX, XLS, XLSX, CSV.
- Needs an internet connection to add or open a document (the file lives on the server, not in the device database).
- Deleting a document hides it and you can Undo or Restore it from Recently deleted. The sealed file stays in storage so that Restore works.

## Not in this step
- (Done in the polish step, see phase8b-notes.md: linking a document to a ledger entry.)
- Previewing a file inside Apex (it downloads instead).
- Permanent removal of the sealed file when a deletion is final. No screen permanently deletes records yet, so nothing is orphaned today.
- Backup files do not include document files, only the records that point to them.
- (Done in the polish step: Help topic for documents.)

## Check on the live site (5 minutes)
1. Run `tests/supabase/phase8-storage-check.sql` in Supabase. Every row should be `true`.
2. Open an investment, then Add under Documents, choose a small PDF, add a label, press Lock and upload.
3. Press Download and open the file. Open Supabase, Storage, vault: the object should be there and unreadable.
4. Delete the document, press Undo, then delete it again and Restore it from Settings, Recently deleted.
5. Open the same investment in a second browser: the document should appear and download there too.
