# Frontend

Next.js 16 (App Router) + Tailwind v4. Talks to Supabase directly from Server/Client Components using the anon key — RLS is what actually protects data (see `../supabase/`), not this app's own logic. The one privileged action (creating an account) goes through a server Route Handler using the service role key; everything else is a direct Supabase call bound by RLS.

## What's here

**Auth & shell:**

- `src/proxy.ts` + `src/lib/supabase/middleware.ts` — refreshes the Supabase session cookie on every request and redirects signed-out visitors to `/login`. (Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`; the exported function is `proxy`, not `middleware` — the framework itself flags the old name as deprecated.) API routes get a JSON 401 here instead of an HTML redirect, so a `fetch().then(r => r.json())` caller doesn't choke trying to parse the `/login` page as JSON — caught by actually running the dev server and hitting the route with `curl`, not by the type checker.
- `src/app/login/page.tsx` — email/password sign-in (accounts are approver-created with a temp password, not self-registered; see `../README.md`).
- `src/app/(app)/layout.tsx` + `src/components/layout/` — the authenticated shell: role-aware sidebar (creator sees Dashboard/New request; approver sees Dashboard/Accounts/Error log), sign-out. Redirects to `/deactivated` if the signed-in profile's `active` flag is false.
- `src/lib/supabase/{client,server,admin}.ts` — three separate Supabase clients: browser (Client Components), server (Server Components/Route Handlers, cookie-bound, still anon-key/RLS), and admin (service role, `server-only`-guarded so importing it from a Client Component is a build error). `src/lib/auth.ts` fetches the signed-in user's `profiles` row for role checks.

**Creator: submit & review:**

- `src/app/(app)/requests/new/page.tsx` — a single request (idea, audience, tone, supporting material) or a CSV bulk upload (up to 5 rows, needs a `raw_idea` column). `src/components/requests/supporting-materials-editor.tsx` handles links/YouTube/pasted text/file uploads; uploaded files go to Supabase Storage's `supporting-materials` bucket on submit (`src/lib/materials.ts`), not before.
- `src/app/(app)/requests/[id]/page.tsx` — the review screen: brief + status, the intake-blocked warning with a `ResubmitForm` when the brief has `missing_fields`/`blocked_sources`, the winning article draft, the three channel drafts, evaluation notes, an always-visible activity timeline, and the "Send for approval" / approve-reject actions depending on role and status.
- Submitting a request never goes through a custom API — it's a direct `content_requests` insert; a DB trigger enqueues the pipeline (see the backend/DB READMEs).

**Approver-only:**

- `src/app/(app)/accounts/page.tsx` + `src/app/api/admin/accounts/route.ts` — create an account (returns a temp password to hand off out-of-band; there's no email delivery wired up for this) and deactivate/reactivate existing ones. Deactivation is a plain client-side Supabase update (the `profiles` RLS policy already lets an approver update any row); only creation needs the service-role route, since inserting into `auth.users` isn't reachable through RLS/PostgREST at all.
- `src/app/(app)/errors/page.tsx` — every `error_logs` row, open ones first, with a "mark resolved" action.

**Scheduling (build step 9):**

- `src/components/requests/scheduling-panel.tsx`, rendered on the request detail page once a request is `approved` (or already `scheduled` — more channels can be queued later). For LinkedIn/X it's a datetime picker + "Schedule" button that inserts directly into `publishing_queue` (RLS already requires the parent request to be `approved`/`scheduled`; a DB trigger flips the request to `scheduled` the moment the first row lands, before the backend's publishing worker even wakes up), plus a live list of that channel's queue items and their status (`queued`/`processing`/`scheduled`/`failed`). For email — Buffer doesn't publish email — there's no queue row at all, just a "copy email body" button, matching the PRD's "flag for manual send" requirement instead of silently faking it.

**Recovering from a stuck request:**

- `src/components/requests/retry-failed-step.tsx`, shown on the request page to the owning creator or any approver whenever a `pipeline_jobs` row for that request is `failed` -- retries just that stage via the `retry_pipeline_job()` RPC instead of forcing a resubmit from intake.
- The dashboard shows an "N open errors need attention" banner (approver-only, linking to the Errors page) sourced directly from `error_logs where resolved = false` -- added after noticing `content_requests.status` never actually reached `'errored'` (a backend bug, now fixed) and the existing "Errored" queue-summary bucket was silently always zero as a result.

**Live updates:** `src/components/requests/realtime-refresh.tsx`, mounted on the request detail page, subscribes to Supabase Realtime changes on `content_requests`/`activity_log`/`error_logs` for the open request and calls `router.refresh()` -- otherwise this Server Component only re-fetches after a button the viewer themselves clicked, never in response to the backend worker progressing through the pipeline in the background. Requires `20250101000016_realtime.sql` (adds those tables to the `supabase_realtime` publication) applied to the real project.

**Editing after changes are requested:** `article-draft-view.tsx` and `channel-drafts-view.tsx` are now client components with an inline "Edit" toggle (textarea + Save/Cancel), shown only to the owning creator while the request is `awaiting_creator`/`changes_requested` -- gated again by RLS (`20250101000018_creator_edit_drafts.sql`), not just hidden in the UI. Saving logs an `article_draft_edited`/`channel_draft_edited` activity entry. Two real bugs found and fixed while building this: the "Send for approval" button only rendered for `awaiting_creator`, so after a rejection there was no way to resend at all; and `article_drafts`/`channel_drafts` had no write policy for `authenticated` whatsoever, so there was nothing to edit even before this. The rejection's comments now also show as a prominent banner at the top of the page (previously only visible by scrolling to "Approval history" at the bottom).

**Regenerating instead of hand-editing:** `regenerate-action.tsx`, shown next to the Edit button on the article draft and on each channel draft (same editable-window gating), inserts a `regenerate_article`/`regenerate_channel` job directly into `pipeline_jobs` with an optional free-text instruction, and the backend worker picks it up like any other job. Unlike editing, this is AI-assisted -- useful for "make this punchier" or pasting in the approver's rejection comments verbatim, without needing to write the replacement text by hand.

**Restructured layout:** the article section and the channel drafts are now each their own tabbed panel (`src/components/ui/tabs.tsx`, a small hand-rolled primitive -- no Radix Tabs installed) instead of a flat stack / 3-column grid:
- **Article tabs** (`article-panel.tsx`): Article (the editable draft), Sources (every source the draft actually cites, each a real clickable link via `source_materials.source_url` when it has one -- resolved from `article_drafts.citations`, not just a bare count), Outline (the plan stage's structured outline, read-only), Revision history (every version's evaluation, newest first, across the whole `generate ⇄ evaluate_article` loop -- not just the current best draft).
- **Channel tabs** (`channel-drafts-view.tsx`): one tab per channel instead of showing all 3 side by side.
- Both draft bodies now render through `markdown-body.tsx` (`react-markdown` + `remark-gfm`, hand-styled component overrides rather than `@tailwindcss/typography`) instead of a raw `whitespace-pre-wrap` text dump -- `##` headings, `` ``` `` code blocks, lists, and links actually render as such now.

**Evaluation breakdown:** `evaluation-breakdown.tsx`, in the sidebar next to Activity (not buried in a tab), shows the actual per-criterion scores behind the current article's weighted total and each channel's verdict -- the badges elsewhere on the page only ever showed the final number, not what drove it. Duplicates `ARTICLE_RUBRIC_WEIGHTS`/`ARTICLE_PASS_THRESHOLD` from the backend for display only (no shared package between frontend/backend here) -- the backend remains the only thing that actually enforces the pass/revise decision.

**Not here yet:** a diff view showing the approver what the creator changed since the AI's last output.

**Required fields:** `target_audience` is now required on both the single-request form and the bulk CSV upload (previously optional) -- enforced in `requests/new/page.tsx`, `resubmit-form.tsx` (the intake-block fix-and-resubmit path), and the CSV column check, not just a DB-level assumption.

## Design system

No shadcn CLI — it needs an interactive prompt and a registry fetch that don't play well non-interactively, so `src/components/ui/` is a small hand-rolled set (`button`, `card`, `input`/`textarea`/`label`, `badge`) in the same visual language (Tailwind + `class-variance-authority` + `cn()`), plus `buttonVariants` exported directly for styling a `<Link>` as a button (no Radix `Slot`/`asChild` support was built, so never pass `asChild` to `Button`). Color tokens live in `src/app/globals.css` (`--primary`, `--success`, `--warning`, `--danger`, etc.) — white background with a restrained indigo accent, per the brief. One deliberately-decorative touch: `src/components/dashboard/hero-accent.tsx`, a slow drifting gradient behind the dashboard header (Framer Motion) — one accent on one page, not 3D everywhere.

## Setup

```
npm install
cp .env.local.example .env.local   # fill in your real Supabase project's values
npm run dev
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only — never referenced with `NEXT_PUBLIC_`, only read from `lib/supabase/admin.ts`.

## Verification

No real Supabase project is available in this environment, so the data-bound pages (dashboard, request detail, accounts, errors) are verified by code review and a clean build/typecheck/lint, not by actually exercising them against live data. What *was* verified by running the dev server and hitting it with `curl`:

- `/`, `/dashboard`, `/requests/new`, `/accounts`, `/errors`, `/deactivated` all 307-redirect to `/login` when signed out.
- `/login` renders 200 with the expected content.
- `POST /api/admin/accounts` returns a proper 401 JSON body when signed out (this is what caught the redirect-instead-of-JSON bug above).

Before pointing this at a real project: run the Supabase migrations (`../README.md`), set the three env vars, create the bootstrap approver account, and re-check the full creator → approver flow by hand — none of the RLS-bound data flows have been exercised against a live database from this app yet, `scheduling-panel.tsx` included. The tabbed article/channel panels, markdown rendering, and regenerate actions are likewise verified only by a clean `npm run build`/`lint` and code review, not by clicking through them against a real request in a browser.
