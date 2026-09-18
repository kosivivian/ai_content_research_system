-- =========================================================================
-- content_requests: the top-level unit of work, one per submitted idea/URL.
-- =========================================================================
create table public.content_requests (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id),
  raw_idea text,
  target_audience text,
  tone text,
  supporting_materials jsonb not null default '[]'::jsonb, -- [{type, url|filename, ...}]
  brief jsonb not null default '{}'::jsonb,                -- {topic, audience, tone, overview, missing_fields[]}
  status text not null default 'intake' check (status in (
    'intake', 'researching', 'retrieving', 'reranking', 'planning', 'generating',
    'evaluating', 'awaiting_creator', 'awaiting_approval', 'changes_requested',
    'approved', 'scheduled', 'published', 'errored'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger content_requests_set_updated_at
  before update on public.content_requests
  for each row execute procedure public.set_updated_at();

-- =========================================================================
-- source_materials: everything the pipeline can cite from — user uploads,
-- user-supplied URLs, and research results. Embeddings use Voyage AI
-- (voyage-3-lite, 1024 dims) since Claude does not offer an embeddings API.
-- =========================================================================
create table public.source_materials (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.content_requests (id) on delete cascade,
  origin text not null check (origin in ('user_upload', 'user_url', 'research_result')),
  source_url text,
  extracted_text text,
  access_status text not null default 'pending' check (access_status in ('pending', 'ok', 'blocked', 'unreadable')),
  embedding vector(1024),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.research_queries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.content_requests (id) on delete cascade,
  query_text text not null,
  tool_used text not null,
  result_count int not null default 0,
  created_at timestamptz not null default now()
);

create table public.reranked_sources (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.content_requests (id) on delete cascade,
  source_material_id uuid not null references public.source_materials (id) on delete cascade,
  relevance_score numeric not null,
  rank int not null,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- Plan -> draft -> channel adaptation chain.
-- =========================================================================
create table public.content_plans (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.content_requests (id) on delete cascade,
  outline jsonb not null,
  version int not null default 1,
  created_at timestamptz not null default now()
);

create table public.article_drafts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.content_requests (id) on delete cascade,
  plan_id uuid not null references public.content_plans (id) on delete cascade,
  option_number int not null,
  body_markdown text not null,
  citations jsonb not null default '[]'::jsonb, -- [{source_material_id, quote_or_claim}]
  version int not null default 1,
  created_at timestamptz not null default now()
);

create table public.channel_drafts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.content_requests (id) on delete cascade,
  article_draft_id uuid not null references public.article_drafts (id) on delete cascade,
  channel text not null check (channel in ('linkedin', 'x', 'email')),
  body text not null,
  version int not null default 1,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

-- =========================================================================
-- Self-evaluation, human approval, and publishing.
-- =========================================================================
create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.content_requests (id) on delete cascade,
  target_type text not null check (target_type in ('article', 'channel_draft')),
  target_id uuid not null,
  rubric_scores jsonb not null default '{}'::jsonb,
  overall_status text not null check (overall_status in ('pass', 'revise', 'reject')),
  notes text,
  iteration_number int not null default 1,
  created_at timestamptz not null default now()
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.content_requests (id) on delete cascade,
  approver_id uuid not null references public.profiles (id),
  decision text not null check (decision in ('approved', 'rejected')),
  comments text,
  decided_at timestamptz not null default now()
);

create table public.publishing_queue (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.content_requests (id) on delete cascade,
  channel text not null check (channel in ('linkedin', 'x', 'email')),
  scheduled_time timestamptz,
  buffer_post_id text,
  status text not null default 'queued' check (status in ('queued', 'scheduled', 'published', 'failed')),
  created_at timestamptz not null default now()
);

-- =========================================================================
-- Observability: activity timeline + error log the approver dashboard reads.
-- =========================================================================
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.content_requests (id) on delete cascade,
  actor_type text not null check (actor_type in ('system', 'ai_agent', 'creator', 'approver')),
  actor_id uuid references public.profiles (id),
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.error_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.content_requests (id) on delete cascade,
  stage text not null,
  detail jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- Worker queue: the backend polls this table instead of standing up Redis.
-- =========================================================================
create table public.pipeline_jobs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.content_requests (id) on delete cascade,
  stage text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempt_count int not null default 0,
  token_budget jsonb not null default '{}'::jsonb, -- {used, soft_cap}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger pipeline_jobs_set_updated_at
  before update on public.pipeline_jobs
  for each row execute procedure public.set_updated_at();
