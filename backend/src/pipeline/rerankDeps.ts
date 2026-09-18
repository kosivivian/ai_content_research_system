import { getSupabaseClient } from "../clients/supabase.js";
import * as voyage from "../clients/voyage.js";
import { completeStructured } from "../clients/anthropic.js";
import type { Brief, ContentRequest } from "../types/db.js";
import type { Candidate, RankedSource, RerankDeps } from "./rerank.js";

const MAX_CHARS_PER_CANDIDATE = 600;

export function createRerankDeps(): RerankDeps {
  const supabase = getSupabaseClient();

  return {
    async getBrief(requestId) {
      const { data, error } = await supabase
        .from("content_requests")
        .select("brief")
        .eq("id", requestId)
        .single();
      if (error || !data) throw new Error(`getBrief failed: ${error?.message ?? "not found"}`);
      return (data as Pick<ContentRequest, "brief">).brief;
    },

    async embedQuery(text) {
      const [embedding] = await voyage.embed([text]);
      if (!embedding) throw new Error("embedQuery: voyage returned no embedding");
      return embedding;
    },

    async getCandidates(requestId, queryEmbedding, limit) {
      const { data, error } = await supabase.rpc("match_source_materials", {
        p_request_id: requestId,
        p_query_embedding: queryEmbedding,
        p_match_count: limit,
      });
      if (error) throw new Error(`getCandidates failed: ${error.message}`);

      return (data ?? []).map(
        (row: { id: string; source_url: string | null; extracted_text: string; distance: number }) => ({
          id: row.id,
          sourceUrl: row.source_url,
          extractedText: row.extracted_text,
          distance: row.distance,
        }),
      );
    },

    async rankCandidates(brief, candidates, topN) {
      const { result, inputTokens, outputTokens } = await completeStructured<{
        rankings: { source_index: number; score: number; reason: string }[];
      }>({
        tier: "fast",
        system: RERANK_SYSTEM_PROMPT,
        prompt: buildRerankPrompt(brief, candidates, topN),
        toolName: "rank_sources",
        toolDescription: "Records the ranked list of the most relevant sources.",
        inputSchema: buildRerankSchema(topN, candidates.length),
        maxTokens: 1024,
      });

      const ranked: RankedSource[] = result.rankings
        .map((r, i) => {
          const candidate = candidates[r.source_index - 1];
          if (!candidate) return null;
          return { sourceMaterialId: candidate.id, relevanceScore: r.score, rank: i + 1 };
        })
        .filter((r): r is RankedSource => r !== null);

      return { ranked, tokensUsed: inputTokens + outputTokens };
    },

    async replaceRankedSources(requestId, ranked) {
      const { error: deleteError } = await supabase
        .from("reranked_sources")
        .delete()
        .eq("request_id", requestId);
      if (deleteError) throw new Error(`replaceRankedSources delete failed: ${deleteError.message}`);

      if (ranked.length === 0) return;

      const rows = ranked.map((r) => ({
        request_id: requestId,
        source_material_id: r.sourceMaterialId,
        relevance_score: r.relevanceScore,
        rank: r.rank,
      }));

      const { error: insertError } = await supabase.from("reranked_sources").insert(rows);
      if (insertError) throw new Error(`replaceRankedSources insert failed: ${insertError.message}`);
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

const RERANK_SYSTEM_PROMPT = `You choose which candidate sources are actually worth using for a piece of content, given its brief. Prefer sources that are specific, credible, and directly useful over ones that are merely on-topic. Return fewer sources than requested if fewer are genuinely relevant -- never pad the list with weak sources just to fill it.`;

function buildRerankPrompt(brief: Brief, candidates: Candidate[], topN: number): string {
  const listing = candidates
    .map(
      (c, i) =>
        `${i + 1}. (${c.sourceUrl ?? "user-provided text"})\n${c.extractedText.slice(0, MAX_CHARS_PER_CANDIDATE)}`,
    )
    .join("\n\n");

  return [
    `Topic: ${brief.topic ?? "(unknown)"}`,
    `Audience: ${brief.audience ?? "(unknown)"}`,
    `Overview: ${brief.overview ?? "(none)"}`,
    `Candidate sources:\n${listing}`,
    `Select and rank up to ${topN} of the most relevant sources, best first.`,
  ].join("\n\n");
}

function buildRerankSchema(topN: number, candidateCount: number) {
  return {
    type: "object",
    properties: {
      rankings: {
        type: "array",
        maxItems: Math.min(topN, candidateCount),
        items: {
          type: "object",
          properties: {
            source_index: {
              type: "integer",
              description: "The 1-based index of this source from the candidate list.",
            },
            score: { type: "number", description: "Relevance score from 0 to 1." },
            reason: { type: "string", description: "One short sentence on why this source is useful." },
          },
          required: ["source_index", "score", "reason"],
        },
      },
    },
    required: ["rankings"],
  };
}
