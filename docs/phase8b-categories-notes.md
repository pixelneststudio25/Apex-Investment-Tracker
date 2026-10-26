# Phase 8b: your own categories, delete forever, documents backup, preview

No Supabase change in this step. Your existing `vault` policies already allow removing a file (`phase8-storage-check.sql` checks them).

## My categories
- **Where**: Settings, My categories (`#/categories`); "Create your own" at the end of the category list when adding an investment; Ctrl+K entries.
- **A category sets**: a name, an icon (16 to choose from), how value changes, what income it pays, who usually owns it, and up to 15 extra details (text, number, date or link).
- **Start from**: copy the answers and details of a built-in or one of your own. The name is left blank to choose.
- **Names**: cannot repeat a built-in or another of your own (capitals ignored).
- **Details keep their key.** A key is made from the label the first time (Plot size becomes `plotSize`) and never changes, so renaming a detail keeps values already saved on investments attached.
- **Editing**: the three answers apply to investments added from then on. Existing investments keep their own settings (tested). Removing a detail stops asking for it on new investments. A value already saved stays saved and still shows, under a readable name made from its key.
- **Deleting**: blocked while any live (active or closed) investment uses the category. An unused one deletes with Undo, and it is listed in Recently deleted so it can be restored. Deleted investments do not block it. If one is restored later, restore the category first.
- **Not included**: moving an investment to another category, reordering details, and a fixed-term (maturity date) option for your own categories.

## Delete forever (documents only)
- Recently deleted shows **Delete forever** on documents, with a confirmation.
- Order: the sealed file is removed from the server first. If that fails (offline), nothing changes and you can try again. Then the record is replaced by an empty deleted shell (`purged`), which syncs to your other devices like any change. The name, label, size and link are gone from the current version everywhere.
- Older versions of that record stay in the locked history (on this device and the server). They hold the file name but only your key can open them. The file itself is gone.
- Edge case: if one device restores the document while another erases it, whichever change is newer wins. If the restore wins, the document's file is already gone and it says so when opened.

## Documents backup
- Settings, Documents backup. **Download documents backup** saves one `.apexdocs` file holding every document exactly as stored, still locked with your key. It includes documents you deleted but can still restore, and leaves out ones erased forever. A file missing from the server is counted and left out.
- **Restore documents** reads such a file, checks every file opens with your key (a damaged one is skipped and counted, never uploaded), and uploads only files the server does not already have.
- A backup from a different account, a wrong file, or a cut-short or altered file is refused with a plain message.
- The file can be large (it holds up to 20 files of 10 MB per investment) and is held in memory while it is made, so use a computer for a big collection. An internet connection is needed.
- Your normal backup file is unchanged: it holds records only.

## Preview (document screen)
- Photos (PNG, JPG, WEBP) and text or CSV files (up to 2 MB, first 20,000 characters) show inside Apex, as plain text. PDFs open in a new browser tab (if the browser blocks the tab, a "Tap to open the PDF" button appears). Word, Excel and HEIC files only download.
- The kind comes from the file name, never from what the file claims. The decrypted copy lives in memory only and is released when you hide it or leave the screen.

## Other
- Help: new topic "Making your own category"; the documents topic now covers preview, delete forever and the documents backup.
- New styles: `css/categories.css`; preview styles added to `css/documents.css`.

## Tests
226 became 245 passing (1 skipped, the browser-only IndexedDB test). New: 9 category tests (keys, names, validation, wizard lookup, start from, rename and remove keep values, existing investments untouched, delete rules); 10 document tests (delete forever including offline failure and syncing the erased shell to a second device, `store.scrub`, backup round trip, deleted and erased and missing files, refused and damaged files, duplicate upload code, preview kinds and text cutting).
In a simulated browser (jsdom): the category screens, preview, new-tab and blocked-tab paths, Delete forever with confirm and cancel, and the documents backup panel all ran with no errors.

## Live check (10 minutes)
1. Settings, My categories, Add a category. Try the name "Land" (refused), add two details, save. Add an investment and pick it: the answers and details are there.
2. Edit that category and rename a detail. Open the investment: its saved value shows under the new label.
3. Try to delete a category an investment uses: refused. Delete an unused one, then Undo.
4. Open a photo, a text file and a PDF in Documents: Preview, and Open in a new tab (on your phone too).
5. Delete a document, then Recently deleted, Delete forever. Check the `vault` bucket in Supabase: the object is gone. Open Apex on a second device: the document is gone there too.
6. Settings, Documents backup, Download. Then restore it: it should say the files were already stored (or put them back if you removed one in Supabase).
