import type {
  PipelineJob,
  ContentRequest,
  ContentRequestStatus,
  Brief,
  BlockedSource,
  SourceOrigin,
  AccessStatus,
  SupportingMaterial,
} from "../types/db.js";
import { registerStage, type StageResult } from "../worker/registry.js";
import { createIntakeDeps } from "./intakeDeps.js";

/** Hard-blocking fields: without these, the request cannot proceed past intake. */
export const REQUIRED_BRIEF_FIELDS = ["topic", "audience"] as const;

export interface ExtractedSource {
  origin: SourceOrigin;
  sourceUrl: string | null;
  extractedText: string | null;
  accessStatus: AccessStatus;
  metadata: Record<string, unknown>;
  blockedReason?: string;
  blockedSuggestion?: string;
}

/** What the LLM is allowed to produce -- deliberately no "missing_fields" here; that's computed in code, not by the model. */
export interface BriefDraft {
  topic?: string;
  audience?: string;
  tone?: string;
  overview: string;
}

export interface IntakeDeps {
  getContentRequest(requestId: string): Promise<ContentRequest>;
  extractSupportingMaterial(material: SupportingMaterial): Promise<ExtractedSource>;
  replaceSourceMaterials(requestId: string, sources: ExtractedSource[]): Promise<void>;
  generateBriefDraft(input: {
    rawIdea: string | null;
    targetAudience: string | null;
    tone: string | null;
    okSources: ExtractedSource[];
  }): Promise<{ draft: BriefDraft; tokensUsed: number }>;
  updateContentRequest(
    requestId: string,
    patch: { brief: Brief; status: ContentRequestStatus },
  ): Promise<void>;
  logActivity(requestId: string, action: string, detail?: Record<string, unknown>): Promise<void>;
}

/**
 * Intake stage: extract every supporting material, structure a brief from
 * the raw submission, and decide whether the request has enough to
 * proceed. Blocking is enforced here (in code, before returning "advance")
 * -- not left to the UI to merely suggest.
 */
export async function runIntake(job: PipelineJob, deps: IntakeDeps): Promise<StageResult> {
  const request = await deps.getContentRequest(job.request_id);

  const extracted = await Promise.all(
    request.supporting_materials.map((material) => deps.extractSupportingMaterial(material)),
  );
  await deps.replaceSourceMaterials(request.id, extracted);

  const okSources = extracted.filter((s) => s.accessStatus === "ok");
  const blockedSources: BlockedSource[] = extracted
    .filter((s) => s.accessStatus !== "ok")
    .map((s) => ({
      source_url: s.sourceUrl,
      reason: s.blockedReason ?? `Could not access this source (status: ${s.accessStatus}).`,
      suggestion: s.blockedSuggestion ?? "Paste the content directly, or provide a different link.",
    }));

  const { draft, tokensUsed } = await deps.generateBriefDraft({
    rawIdea: request.raw_idea,
    targetAudience: request.target_audience,
    tone: request.tone,
    okSources,
  });

  const missingFields: string[] = [];
  if (!draft.topic?.trim()) missingFields.push("topic");
  if (!draft.audience?.trim()) missingFields.push("audience");

  const brief: Brief = {
    topic: draft.topic,
    audience: draft.audience,
    tone: draft.tone ?? "professional",
    overview: draft.overview,
    missing_fields: missingFields,
    blocked_sources: blockedSources,
  };

  const isComplete = missingFields.length === 0 && blockedSources.length === 0;
  const status: ContentRequestStatus = isComplete ? "researching" : "awaiting_creator";

  await deps.updateContentRequest(request.id, { brief, status });
  await deps.logActivity(request.id, "brief_generated", { brief, tokensUsed, complete: isComplete });

  return {
    // "advance" -> research; "stop" -> parked on awaiting_creator until the
    // creator fixes something and resubmits (which re-enqueues intake).
    nextAction: isComplete ? "advance" : "stop",
    tokensUsed,
  };
}

registerStage("intake", (job) => runIntake(job, createIntakeDeps()));
