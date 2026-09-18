# AI Content Research & Publishing Agent

See `.claude/plans` (or ask Claude) for the full architecture plan. This step covers the Supabase schema, RLS policies, and auth roles only — backend and frontend come next.

## Applying the schema

You don't need the Supabase CLI for this. In your Supabase project dashboard, open the SQL editor and run the files in `supabase/migrations/` **in filename order** (they're numbered):

1. `20250101000000_extensions.sql`
2. `20250101000001_profiles_and_auth.sql`
3. `20250101000002_pipeline_tables.sql`
4. `20250101000003_indexes.sql`
5. `20250101000004_rls_policies.sql`
6. `20250101000005_grants.sql`
7. `20250101000006_job_claiming.sql`
8. `20250101000007_advance_job.sql`
9. `20250101000008_intake_trigger.sql`
10. `20250101000009_status_transition_guard.sql`
11. `20250101000010_storage_bucket.sql`
12. `20250101000011_match_source_materials.sql`
13. `20250101000012_allow_send_for_approval.sql`
14. `20250101000013_publishing.sql`
15. `20250101000014_voyage_512_dims.sql`
16. `20250101000015_retry_pipeline_job.sql`
17. `20250101000016_realtime.sql`
18. `20250101000017_reclaim_stale_jobs.sql`
19. `20250101000018_creator_edit_drafts.sql`
20. `20250101000019_regenerate.sql`

If you later install the Supabase CLI and link this project (`supabase link`), `supabase db push` will pick up this same `supabase/migrations/` folder directly.

## Roles: creator vs approver

Every `auth.users` row gets a matching `public.profiles` row automatically (via trigger), defaulting to `role = 'creator'`. There is deliberately **no way to self-register as an approver** — approvers create accounts (including other approvers) through a backend endpoint that uses the Supabase **service role key** and the Admin API, passing `role` in the new user's metadata.

**Bootstrapping the first approver:** since account creation is normally approver-only, there's a chicken-and-egg problem for the very first account. Sign up one user through Supabase Auth (dashboard "Add user" or your own sign-up screen), then promote them manually in the SQL editor:

```sql
update public.profiles set role = 'approver' where email = 'you@example.com';
```

From then on, that approver can create every other account (creator or approver) through the app.

## RLS model

- The frontend talks to Supabase using the **anon/authenticated key** and is bound by the RLS policies in `20250101000004_rls_policies.sql` — role checks happen in Postgres, not just in the UI.
- The backend worker (research/generation/evaluation/etc.) uses the **service role key**, which bypasses RLS, since it needs to write pipeline data regardless of who owns the request. **Never expose the service role key to the frontend.**
- Notably, `publishing_queue` inserts are only allowed by Postgres when the parent `content_requests.status = 'approved'` — the "don't schedule until approved" rule is enforced at the database level, not only in application code.
- `content_requests.status` is guarded by a trigger (`20250101000009`, refined in `20250101000012`): a creator's direct update can only ever move status to `'intake'` (resubmitting after an intake block) or to `'awaiting_approval'` from `'awaiting_creator'`/`'changes_requested'` (sending a reviewed package to the approver). Every other transition — `researching`, `approved`, `scheduled`, etc. — requires the backend's service role, an internal trusted write (see below), or a superuser/admin session. Without the original version of this guard, the broad "creator can update their own row" policy would have let a creator set `status = 'approved'` themselves and skip the approver entirely — caught and fixed while building the intake stage; the `awaiting_approval` case was caught the same way while building the frontend's "send for approval" action.
- `publishing_queue` inserts are also allowed once the request is already `'scheduled'` (not just `'approved'`), refined in `20250101000013` — a creator queueing LinkedIn today and X next week for the same approved request is a normal flow, and the original policy would have locked out every channel after the first (the `mark_request_scheduled` trigger below flips the request to `'scheduled'` on that very first insert).

## How a request actually starts moving

There's no custom "submit" HTTP endpoint. The frontend inserts directly into `content_requests` using the authenticated Supabase client (RLS-permitted for the owning creator); a trigger (`20250101000008`) auto-enqueues the first `intake` pipeline_jobs row. The same trigger fires again whenever a creator resets `status` back to `'intake'` to resubmit after fixing something flagged at intake (missing audience, a blocked source, etc.).

Likewise, the approver's client only ever inserts into `approvals` — never updates `content_requests` directly (there's no RLS policy letting it). A trigger (`apply_approval_decision`, in `20250101000009`) propagates that decision onto `content_requests.status` (`approved` or `changes_requested`), marking itself as a trusted internal write (via a transaction-local `app.internal_write` setting) so the status-transition guard above lets it through.

## The pipeline job queue

`pipeline_jobs` is a plain Postgres table the backend worker polls instead of standing up Redis. Two RPCs (called from the backend via the service role key) keep this race-safe under concurrency:

- `claim_next_pipeline_job()` — atomically claims the oldest `queued` row using `FOR UPDATE SKIP LOCKED`, so multiple worker slots polling at once never grab the same job.
- `advance_pipeline_job(job_id, next_stage)` — atomically marks a job `done` and enqueues the next stage in one transaction, so a crash mid-pipeline can't leave a request stuck or double-queued.
- `match_source_materials(request_id, query_embedding, match_count)` — cosine-distance vector search over one request's embedded sources, used by the rerank stage. supabase-js has no way to express `order by embedding <=> x` directly, hence the RPC.
- `claim_next_publishing_item()` — same `FOR UPDATE SKIP LOCKED` claim pattern, but over `publishing_queue` instead of `pipeline_jobs`. Publishing has no stage chain (one item = one Buffer call), so it's a separate table/queue/worker loop rather than another pipeline stage — see "Publishing" below.

## Publishing

Once a request is `approved`, the creator can queue LinkedIn/X posts (with an optional schedule time) directly into `publishing_queue` from the frontend — RLS requires the parent request to be `approved` or already `scheduled` (widened in `20250101000013` so a second/third channel can be queued after the first). Inserting the first row for a request also flips `content_requests.status` to `'scheduled'` via a trigger (`mark_request_scheduled`), the same trusted-internal-write pattern as `apply_approval_decision` — so the UI reflects "scheduled" immediately, without waiting on the backend's poll loop. The backend's publishing worker (`backend/src/worker/publishingLoop.ts`) then claims queued items and calls Buffer to actually create the update. Buffer doesn't manage email delivery, so email is a manual-send channel by design: the frontend never queues an email row at all — the review page just shows the draft for copy/paste — and if one ever does show up, the worker treats it as a bug rather than quietly no-oping. This app doesn't poll Buffer back for a final `'published'` confirmation; `'scheduled'` is the practical terminal state, and a Buffer-status-sync job is the natural next step if that's ever needed.

## Retrieval design note

`source_materials.embedding` holds one vector per source, not per chunk — there's no separate chunks table. At this project's scale (a handful of sources per request), embedding each source's full extracted text is enough; the rerank stage does a vector prefilter (top ~10 via `match_source_materials`) followed by an LLM re-score down to the top ~5 that actually reach generation. If a future source runs long enough that a single embedding stops representing it well, that's the point to introduce chunking — not before.

## Verifying locally before applying to a real project

`supabase/test/` has a throwaway harness (a stub `auth` schema + smoke tests) used to verify every migration, policy, and RPC against a plain `pgvector/pgvector:pg16` Docker container — not part of the schema itself, just a regression check. Rerun it after any schema/policy change:

```
docker run -d --name content_agent_pg_test -e POSTGRES_PASSWORD=postgres -p 55432:5432 pgvector/pgvector:pg16
# copy supabase/test/*.sql and supabase/migrations/*.sql into the container, then, in order:
psql -U postgres -d postgres -f 00_stub_auth.sql
psql -U postgres -d postgres -f <each migration file, in filename order>
psql -U postgres -d postgres -f 01_rls_smoke_test.sql
psql -U postgres -d postgres -f 02_job_claim_seed.sql
psql -U postgres -d postgres -f 03_job_claim_concurrent.sql   # run this one twice, concurrently, to check for double-claims
psql -U postgres -d postgres -f 04_advance_job_test.sql
psql -U postgres -d postgres -f 05_intake_and_guard_test.sql
psql -U postgres -d postgres -f 06_match_source_materials_test.sql
psql -U postgres -d postgres -f 07_send_for_approval_test.sql
psql -U postgres -d postgres -f 08_publishing_test.sql
psql -U postgres -d postgres -f 09_retry_pipeline_job_test.sql
psql -U postgres -d postgres -f 10_reclaim_stale_jobs_test.sql
psql -U postgres -d postgres -f 11_creator_edit_drafts_test.sql
psql -U postgres -d postgres -f 12_regenerate_insert_test.sql
docker rm -f content_agent_pg_test
```

What's asserted: a creator can only create/see their own requests; an approver sees all requests but can't author content directly; `approvals` inserts are rejected unless the request is `awaiting_approval`; `publishing_queue` inserts are rejected unless the request is `approved` or `scheduled`; two concurrent callers of `claim_next_pipeline_job()` never claim the same row; `advance_pipeline_job()` marks the source job done while enqueueing exactly one successor; inserting a `content_request` auto-enqueues an `intake` job; a creator cannot set `status` to `'approved'` directly; resubmitting (`status` back to `'intake'`) enqueues a fresh `intake` job; an approver's `approvals` insert auto-propagates to `content_requests.status` with no manual update needed; `match_source_materials()` orders candidates by actual cosine distance while excluding rows with no embedding yet; a creator can send `awaiting_creator`/`changes_requested` requests to `awaiting_approval` but still can't jump straight to `approved` or send an `intake` request there; queueing the first channel for an approved request flips it to `scheduled` and a second channel can still be queued afterward; a creator can't queue publishing for a request that isn't `approved`/`scheduled` yet; `claim_next_publishing_item()` claims exactly one queued row at a time, oldest first; `retry_pipeline_job()` only succeeds for the owning creator or an approver on a genuinely `failed` job, rejecting a non-owner creator and a job that isn't `failed` anymore; `claim_next_pipeline_job()` reclaims a `'running'` job stale for 5+ minutes but leaves a fresh one alone; the owning creator can edit `article_drafts.body_markdown`/`channel_drafts.body` while the request is `awaiting_creator`/`changes_requested`, can't touch any other column, a non-owner's edit has no effect, and the ability disappears once the request is `approved`; and the creator can insert a `regenerate_article`/`regenerate_channel` job for their own request in that same window, can't sneak in an arbitrary stage or set `status`/`attempt_count` directly, and loses the ability once `approved`.

Note: `20250101000010_storage_bucket.sql` (the upload bucket) isn't covered by this harness — the stub Postgres image has no `storage` schema, only a real Supabase project does. Verify that one manually.

## Backend worker

See `backend/README.md` for the Node/TypeScript worker: env config, the Supabase/Anthropic/Voyage/Tavily/Firecrawl/Resend/Buffer client wrappers, and two polling loops running in one process — the pipeline worker (intake through evaluate_channel, all nine stages implemented, with retry/backoff and a per-stage handler registry) and the publishing worker (Buffer integration over `publishing_queue`, see "Publishing" above).

## Frontend

See `frontend/README.md` for the Next.js app: auth, the role-aware creator/approver shell, the submission and review screens, and account/error-log management. It talks to Supabase directly (RLS-bound) for everything except account creation, which needs a server route with the service role key.

## Embeddings

Claude doesn't offer an embeddings endpoint, so `source_materials.embedding` is sized for **Voyage AI's `voyage-3-lite`** (512 dims) — Anthropic's recommended embedding partner, with a generous free tier. The original schema assumed 1024 dims (only `voyage-3`/`voyage-3-large` default to that; `voyage-3-lite` doesn't) — caught when `retrieve` started failing with "expected 1024 dimensions, not 512" against a real project, fixed in `20250101000014_voyage_512_dims.sql`. `backend/npm run test:voyage` is a standalone script that calls the real embeddings API and prints the actual vector size, useful for catching this kind of mismatch before it shows up mid-pipeline. If you swap providers/models later, update the `vector(512)` dimension in that migration (and `match_source_materials`'s parameter type) to match whatever the new model actually returns.

## Retrying a stuck request

A pipeline stage that fails past `WORKER_MAX_ATTEMPTS` marks its job `failed` and the request `errored` — visible on the request page (a "This request got stuck" card) to the owning creator or any approver, both of whom can retry just that stage via `retry_pipeline_job()` (`20250101000015_retry_pipeline_job.sql`) instead of resubmitting from intake. The RPC does its own authorization check (owner creator or any active approver) since `pipeline_jobs` has no direct update grant for `authenticated`; it resets `attempt_count` to 0 so the retried job gets a full fresh retry budget rather than immediately re-failing.

## Reclaiming orphaned jobs

Nothing previously reclaimed a job whose worker died mid-flight (crash, a `tsx watch` restart, a hung network call) -- it stayed `'running'` forever, since only the process that originally claimed it was ever going to mark it done/failed. Caught live: an `evaluate_article` job got claimed, its worker process restarted moments later from an unrelated code change, and the job was orphaned with nothing able to pick it back up short of a manual database fix. `20250101000017_reclaim_stale_jobs.sql` has `claim_next_pipeline_job()` also reclaim a `'running'` job whose `updated_at` is more than 5 minutes old (comfortably above the Anthropic client's own 120s request timeout, so this only fires for something actually orphaned). `attempt_count` still increments on a reclaim, so a job that keeps getting orphaned for some other reason still eventually hits `WORKER_MAX_ATTEMPTS` and surfaces as `'errored'` rather than reclaim-looping forever.

## Editing a draft after changes are requested

An approver's "request changes" decision moves a request to `'changes_requested'`, but there was originally no way for the creator to actually change anything -- `article_drafts`/`channel_drafts` had no write policy for `authenticated` at all (only the backend's service role could write them), and the "Send for approval" button only rendered for `'awaiting_creator'`, not `'changes_requested'`. `20250101000018_creator_edit_drafts.sql` grants the owning creator `UPDATE` on just the content column (`body_markdown`/`body`, via column-level grants -- not `version`, `citations`, or anything else) while the request is `'awaiting_creator'` or `'changes_requested'`; the request page now shows an inline editor on the article and each channel draft, and the rejection's comments prominently at the top, when those conditions hold.

## Weighted article scoring

The article rubric's pass/revise decision is no longer the model's own subjective call -- `evaluate_article` asks the model for 8 raw per-criterion scores (1-5) only, and the backend computes a weighted average itself: `sum(score * weight) / sum(weight)`, compared against `ARTICLE_PASS_THRESHOLD` (3.90). Weights (`ARTICLE_RUBRIC_WEIGHTS` in `backend/src/pipeline/rubric.ts`) favor factual accuracy and source grounding (5 each) over tone (2), on the reasoning that an unreliable article is unusable regardless of how well it reads, while a slightly-off tone shouldn't block an otherwise-solid, well-grounded draft. See `backend/README.md` for the full weight table and worked example.

## Regenerating a section or a channel

Beyond hand-editing (above), the creator can ask the AI to redo just the article or just one channel, with optional instructions (e.g. pasting in the approver's rejection comments). This reuses the existing `pipeline_jobs` queue rather than a new HTTP endpoint -- two new terminal, creator-triggered stages, `regenerate_article` and `regenerate_channel`, each a single AI call that updates the existing row in place (no new version, no evaluation cycle; this is a manual "try again," not part of the automated quality loop). `20250101000019_regenerate.sql` lets the owning creator insert a job directly (same pattern as `content_requests`/`approvals`/`publishing_queue`), column-scoped so only `request_id`/`stage`/`payload` are settable -- `status`/`attempt_count` always fall back to their defaults regardless of what a client sends. Regenerating one channel never touches the other two, which matters now that channel drafts can be hand-edited directly -- regenerating "the whole batch" (channel_adapt's normal behavior) would otherwise silently overwrite an edit to a channel nobody asked to change.

## Live updates on the request page

The request detail page is a Server Component -- it only re-fetches after a button the *viewer* clicked (approve/schedule/retry). Without anything more, it wouldn't reflect the backend worker progressing through the pipeline in the background while someone just sits on the page watching. `20250101000016_realtime.sql` adds `content_requests`, `activity_log`, and `error_logs` to Supabase's `supabase_realtime` publication, and `frontend/src/components/requests/realtime-refresh.tsx` subscribes to changes on those tables (scoped to the open request) and calls `router.refresh()` — so the page updates live instead of needing a manual browser refresh. Like the storage bucket migration, this is a Supabase Cloud feature the plain Docker test stub doesn't have (it no-ops there rather than failing); verify it manually against a real project.
