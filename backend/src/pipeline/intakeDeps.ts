import { getSupabaseClient } from "../clients/supabase.js";
import * as tavily from "../clients/tavily.js";
import * as firecrawl from "../clients/firecrawl.js";
import * as youtube from "../clients/youtube.js";
import { completeStructured, extractFromFile } from "../clients/anthropic.js";
import type { ContentRequest, SupportingMaterial } from "../types/db.js";
import type { BriefDraft, ExtractedSource, IntakeDeps } from "./intake.js";

export function createIntakeDeps(): IntakeDeps {
  const supabase = getSupabaseClient();

  return {
    async getContentRequest(requestId) {
      const { data, error } = await supabase
        .from("content_requests")
        .select("*")
        .eq("id", requestId)
        .single();
      if (error || !data) throw new Error(`getContentRequest failed: ${error?.message ?? "not found"}`);
      return data as ContentRequest;
    },

    extractSupportingMaterial,

    async replaceSourceMaterials(requestId, sources) {
      // Clear any prior user-supplied rows (e.g. from an earlier resubmission)
      // but never touch research-stage results -- those don't exist yet at
      // intake time anyway, but this keeps the intent explicit.
      const { error: deleteError } = await supabase
        .from("source_materials")
        .delete()
        .eq("request_id", requestId)
        .neq("origin", "research_result");
      if (deleteError) {
        throw new Error(`replaceSourceMaterials delete failed: ${deleteError.message}`);
      }

      if (sources.length === 0) return;

      const rows = sources.map((s) => ({
        request_id: requestId,
        origin: s.origin,
        source_url: s.sourceUrl,
        extracted_text: s.extractedText,
        access_status: s.accessStatus,
        metadata: s.metadata,
      }));

      const { error: insertError } = await supabase.from("source_materials").insert(rows);
      if (insertError) {
        throw new Error(`replaceSourceMaterials insert failed: ${insertError.message}`);
      }
    },

    async generateBriefDraft({ rawIdea, targetAudience, tone, okSources }) {
      const sourceSummaries = okSources
        .map(
          (s, i) =>
            `Source ${i + 1} (${s.sourceUrl ?? "user-provided text"}):\n${(s.extractedText ?? "").slice(0, 800)}`,
        )
        .join("\n\n");

      const { result, inputTokens, outputTokens } = await completeStructured<BriefDraft>({
        tier: "fast",
        system: INTAKE_SYSTEM_PROMPT,
        prompt: buildIntakePrompt({ rawIdea, targetAudience, tone, sourceSummaries }),
        toolName: "structure_brief",
        toolDescription: "Records the structured content brief for this request.",
        inputSchema: BRIEF_SCHEMA,
        maxTokens: 1024,
      });

      return { draft: result, tokensUsed: inputTokens + outputTokens };
    },

    async updateContentRequest(requestId, patch) {
      const { error } = await supabase.from("content_requests").update(patch).eq("id", requestId);
      if (error) throw new Error(`updateContentRequest failed: ${error.message}`);
    },

    async logActivity(requestId, action, detail = {}) {
      const { error } = await supabase.from("activity_log").insert({
        request_id: requestId,
        actor_type: "ai_agent",
        action,
        detail,
      });
      if (error) throw new Error(`logActivity failed: ${error.message}`);
    },
  };
}

async function extractSupportingMaterial(material: SupportingMaterial): Promise<ExtractedSource> {
  switch (material.kind) {
    case "text":
      // Not a URL or file, but still "supplied by the user" -- there's no
      // separate origin value for pasted text in the schema.
      return {
        origin: "user_upload",
        sourceUrl: null,
        extractedText: material.text,
        accessStatus: "ok",
        metadata: { label: material.label ?? "pasted text" },
      };

    case "url":
      return extractUrl(material.url);

    case "youtube":
      return extractYoutube(material.url);

    case "upload":
      return extractUpload(material);

    default: {
      const exhaustiveCheck: never = material;
      throw new Error(`Unhandled supporting material kind: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

async function extractUrl(url: string): Promise<ExtractedSource> {
  try {
    const res = await tavily.extract([url]);
    const hit = res.results.find((r) => r.url === url);
    if (hit?.raw_content) {
      return {
        origin: "user_url",
        sourceUrl: url,
        extractedText: hit.raw_content,
        accessStatus: "ok",
        metadata: { extractedVia: "tavily" },
      };
    }
  } catch {
    // fall through to the Firecrawl fallback below
  }

  try {
    const scraped = await firecrawl.scrape(url);
    return {
      origin: "user_url",
      sourceUrl: url,
      extractedText: scraped.markdown,
      accessStatus: "ok",
      metadata: { extractedVia: "firecrawl", ...scraped.metadata },
    };
  } catch (err) {
    return {
      origin: "user_url",
      sourceUrl: url,
      extractedText: null,
      accessStatus: "blocked",
      metadata: {},
      blockedReason: `This site could not be accessed automatically (${errorMessage(err)}).`,
      blockedSuggestion: "Paste the article text directly, or try a different link.",
    };
  }
}

async function extractYoutube(url: string): Promise<ExtractedSource> {
  try {
    const text = await youtube.fetchTranscript(url);
    return {
      origin: "user_url",
      sourceUrl: url,
      extractedText: text,
      accessStatus: "ok",
      metadata: { extractedVia: "youtube_transcript" },
    };
  } catch (err) {
    return {
      origin: "user_url",
      sourceUrl: url,
      extractedText: null,
      accessStatus: "unreadable",
      metadata: {},
      blockedReason: `Could not fetch a transcript for this video (${errorMessage(err)}).`,
      blockedSuggestion: "Paste a transcript or summary directly instead.",
    };
  }
}

async function extractUpload(
  material: Extract<SupportingMaterial, { kind: "upload" }>,
): Promise<ExtractedSource> {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase.storage
      .from("supporting-materials")
      .download(material.storagePath);
    if (error || !data) throw new Error(error?.message ?? "download returned no data");

    const buffer = Buffer.from(await data.arrayBuffer());

    const { text } = await extractFromFile({
      base64Data: buffer.toString("base64"),
      mimeType: material.mimeType,
      instructions:
        "Transcribe all text and describe any important visual content in this file, in plain text, for use as source material for an article. Do not add commentary or opinions.",
    });

    return {
      origin: "user_upload",
      sourceUrl: null,
      extractedText: text,
      accessStatus: "ok",
      metadata: { filename: material.filename, mimeType: material.mimeType },
    };
  } catch (err) {
    return {
      origin: "user_upload",
      sourceUrl: null,
      extractedText: null,
      accessStatus: "unreadable",
      metadata: { filename: material.filename },
      blockedReason: `Could not read this file (${errorMessage(err)}).`,
      blockedSuggestion: "Try re-uploading, or paste the relevant text directly.",
    };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const INTAKE_SYSTEM_PROMPT = `You are the intake stage of a content pipeline. Your only job is to turn a raw content request into a short, structured brief. Never invent an audience, tone, or topic that isn't supported by what was actually given to you -- if something can't be confidently determined from the stated fields or the provided sources, omit that property entirely rather than guessing.`;

function buildIntakePrompt(input: {
  rawIdea: string | null;
  targetAudience: string | null;
  tone: string | null;
  sourceSummaries: string;
}): string {
  return [
    `Raw idea: ${input.rawIdea ?? "(none provided)"}`,
    `Target audience (as stated by the requester): ${input.targetAudience ?? "(not stated)"}`,
    `Tone (as stated by the requester): ${input.tone ?? "(not stated)"}`,
    input.sourceSummaries
      ? `Supporting source excerpts:\n${input.sourceSummaries}`
      : "No accessible supporting sources were provided.",
  ].join("\n\n");
}

const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    topic: {
      type: "string",
      description: "A concise topic/title for the content, derived from the raw idea and sources.",
    },
    audience: {
      type: "string",
      description:
        "The target audience, ONLY if confidently determinable from the stated audience, raw idea, or sources. Omit this property entirely if not confidently determinable -- never guess.",
    },
    tone: {
      type: "string",
      description: "The desired tone/voice, if stated or clearly implied. Omit if not determinable.",
    },
    overview: {
      type: "string",
      description:
        "A 2-4 sentence plain-language summary of what will be produced and why, for a human to review before the pipeline continues.",
    },
  },
  required: ["topic", "overview"],
};
