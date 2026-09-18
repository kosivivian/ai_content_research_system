// Hand-written types mirroring supabase/migrations/*.sql. Keep in sync
// manually for now; once the schema stabilizes, replace with
// `supabase gen types typescript` output.

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

/** What a creator can attach at submission time. Stored as content_requests.supporting_materials (jsonb array). */
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
  embedding: number[] | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type EvaluationTargetType = "article" | "channel_draft";
export type EvaluationStatus = "pass" | "revise" | "reject";

export interface Evaluation {
  id: string;
  request_id: string;
  target_type: EvaluationTargetType;
  target_id: string;
  rubric_scores: Record<string, unknown>;
  overall_status: EvaluationStatus;
  notes: string | null;
  iteration_number: number;
  created_at: string;
}

export type Channel = "linkedin" | "x" | "email";

export type PipelineJobStatus = "queued" | "running" | "done" | "failed";

export interface TokenBudget {
  used?: number;
  soft_cap?: number;
}

export interface PipelineJob {
  id: string;
  request_id: string;
  stage: string;
  status: PipelineJobStatus;
  attempt_count: number;
  token_budget: TokenBudget;
  /** Per-job parameters, only used by regenerate_article/regenerate_channel (e.g. { articleDraftId, instructions? } / { channelDraftId, instructions? }). Every other stage leaves this '{}'. */
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ActorType = "system" | "ai_agent" | "creator" | "approver";
