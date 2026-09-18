// Hand-written types mirroring supabase/migrations/*.sql, extended from
// backend/src/types/db.ts with the read-side tables the UI needs that the
// worker didn't. Keep in sync manually with both the migrations and the
// backend's copy until this becomes a shared package.

export type ProfileRole = "creator" | "approver";

export interface Profile {
  id: string;
  email: string;
  role: ProfileRole;
  active: boolean;
  created_at: string;
}

export type ContentRequestStatus =
  | "intake"
  | "researching"
  | "retrieving"
  | "reranking"
  | "planning"
  | "generating"
  | "evaluating"
  | "awaiting_creator"
  | "awaiting_approval"
  | "changes_requested"
  | "approved"
  | "scheduled"
  | "published"
  | "errored";

export interface BlockedSource {
  source_url: string | null;
  reason: string;
  suggestion: string;
}

export interface Brief {
  topic?: string;
  audience?: string;
  tone?: string;
  overview?: string;
  missing_fields?: string[];
  blocked_sources?: BlockedSource[];
}

export type SupportingMaterial =
  | { kind: "url"; url: string }
  | { kind: "youtube"; url: string }
  | { kind: "text"; text: string; label?: string }
  | { kind: "upload"; storagePath: string; mimeType: string; filename: string };

export interface ContentRequest {
  id: string;
  created_by: string;
  raw_idea: string | null;
  target_audience: string | null;
  tone: string | null;
  supporting_materials: SupportingMaterial[];
  brief: Brief;
  status: ContentRequestStatus;
  created_at: string;
  updated_at: string;
}

export type SourceOrigin = "user_upload" | "user_url" | "research_result";
export type AccessStatus = "pending" | "ok" | "blocked" | "unreadable";

export interface SourceMaterial {
  id: string;
  request_id: string;
  origin: SourceOrigin;
  source_url: string | null;
  extracted_text: string | null;
  access_status: AccessStatus;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface OutlineSection {
  heading: string;
  level: "h2" | "h3";
  key_points: string[];
}

export interface Outline {
  title: string;
  primary_keyword: string;
  secondary_keywords: string[];
  hook: string;
  sections: OutlineSection[];
  cta: string;
}

export interface ContentPlan {
  id: string;
  request_id: string;
  outline: Outline;
  version: number;
  created_at: string;
}

export interface Citation {
  source_material_id: string;
}

export interface ArticleDraft {
  id: string;
  request_id: string;
  plan_id: string;
  option_number: number;
  body_markdown: string;
  citations: Citation[];
  version: number;
  created_at: string;
}

export type Channel = "linkedin" | "x" | "email";

export interface ChannelDraft {
  id: string;
  request_id: string;
  article_draft_id: string;
  channel: Channel;
  body: string;
  version: number;
  status: string;
  created_at: string;
}

export type EvaluationTargetType = "article" | "channel_draft";
export type EvaluationVerdict = "pass" | "revise" | "reject";

export interface EvaluationDetail {
  scores: Record<string, number>;
  weak_claims: string[];
  sections_needing_revision: string[];
  /** Article evaluations only -- the weighted average that actually decided pass/revise (see ARTICLE_PASS_THRESHOLD in the backend). */
  weighted_score?: number;
}

export interface Evaluation {
  id: string;
  request_id: string;
  target_type: EvaluationTargetType;
  target_id: string;
  rubric_scores: EvaluationDetail;
  overall_status: EvaluationVerdict;
  notes: string | null;
  iteration_number: number;
  created_at: string;
}

export type ApprovalDecision = "approved" | "rejected";

export interface Approval {
  id: string;
  request_id: string;
  approver_id: string;
  decision: ApprovalDecision;
  comments: string | null;
  decided_at: string;
}

export type PublishingStatus = "queued" | "processing" | "scheduled" | "published" | "failed";

export interface PublishingQueueItem {
  id: string;
  request_id: string;
  channel: Channel;
  scheduled_time: string | null;
  buffer_post_id: string | null;
  status: PublishingStatus;
  created_at: string;
}

export type PipelineJobStatus = "queued" | "running" | "done" | "failed";

export interface PipelineJob {
  id: string;
  request_id: string;
  stage: string;
  status: PipelineJobStatus;
  attempt_count: number;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ActorType = "system" | "ai_agent" | "creator" | "approver";

export interface ActivityLogEntry {
  id: string;
  request_id: string;
  actor_type: ActorType;
  actor_id: string | null;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface ErrorLogEntry {
  id: string;
  request_id: string | null;
  stage: string;
  detail: Record<string, unknown>;
  resolved: boolean;
  created_at: string;
}
