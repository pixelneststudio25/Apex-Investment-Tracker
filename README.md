# Apex: Phase 0 setup

*Every asset, on record.* Plain HTML/CSS/JS, Supabase backend, Vercel hosting. Plans: General System Plan and Design & Experience Plan (plus `docs/addendum-recovery.md`).

## 1. Supabase (do this for BOTH projects)
1. Create two projects: `apex-dev` and `apex-prod`, same region (closest to Lagos available). Save each database password somewhere safe.
2. In each: **SQL Editor > New query**, paste `supabase/schema.sql`, **Run**.
3. In **apex-dev only**: new query, paste `supabase/rls-test.sql`, **Run**. You want a notice reading `RLS isolation: ALL CHECKS PASSED`. If the first INSERT into `auth.users` errors, tell me the message and I'll adjust the test.
4. **Authentication > Providers > Email**: keep "Confirm email" ON.
5. **Authentication > URL Configuration**: set Site URL to your Vercel URL (dev: your preview/localhost URL) and add it under Redirect URLs.
6. **Project Settings > API**: copy the Project URL and `anon` key into `js/config.js` (dev into `DEV`, prod into `PROD`). Never copy the `service_role` key anywhere in this repo.

## 2. GitHub and Vercel
1. `git init`, commit, push to a new GitHub repo.
2. Vercel > Add New Project > import the repo. Framework Preset: **Other**. No build command, output directory `.` (root).
3. After deploy, set the real production domain in `PROD_HOSTS` in `js/config.js`.

## 3. Verify
- Open the deployed site: you should see the Apex placeholder. Press **Switch theme** and check both themes look right.
- Headers: `curl -I https://YOUR-SITE.vercel.app` should show `content-security-policy`, `strict-transport-security`, `x-content-type-options`.
- The browser console should show no CSP errors.

## 4. Still open in Phase 0
- Self-hosted Lora and Inter WOFF2 files (subset to Latin plus ₦), then `@font-face` rules; confirm the ₦ glyph in both.
- Contrast checks of every token pair in both themes; adjust gold values if needed.

## Phase 0 is done when
Both Supabase projects have the schema, the RLS test passes, the site deploys on Vercel with the security headers, and both themes render.
