import { getSupabaseClient } from "../clients/supabase.js";
import * as tavily from "../clients/tavily.js";
import { completeStructured, webSearchFallback } from "../clients/anthropic.js";
import type { Brief, ContentRequest } from "../types/db.js";
import type { ResearchDeps, SearchHit, SearchOutcome } from "./research.js";

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

export function createResearchDeps(): ResearchDeps {
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

    async generateQueries(brief) {
      const { result, inputTokens, outputTokens } = await completeStructured<{ queries: string[] }>({
        tier: "fast",
        system: QUERY_SYSTEM_PROMPT,
        prompt: buildQueryPrompt(brief),
        toolName: "propose_search_queries",
        toolDescription: "Records the list of web search queries to run for this content request.",
        inputSchema: QUERY_SCHEMA,
        maxTokens: 1024,
      });
      return { queries: result.queries, tokensUsed: inputTokens + outputTokens };
    },

    async searchWithFallback(query) {
      return searchWithFallback(query);
    },

    async logResearchQuery(requestId, queryText, toolUsed, resultCount) {
      const { error } = await supabase.from("research_queries").insert({
        request_id: requestId,
        query_text: queryText,
        tool_used: toolUsed,
        result_count: resultCount,
      });
      if (error) throw new Error(`logResearchQuery failed: ${error.message}`);
    },

    async replaceResearchSources(requestId, hits) {
      const { error: deleteError } = await supabase
        .from("source_materials")
        .delete()
        .eq("request_id", requestId)
        .eq("origin", "research_result");
      if (deleteError) throw new Error(`replaceResearchSources delete failed: ${deleteError.message}`);

      if (hits.length === 0) return;

      const rows = hits.map((hit) => ({
        request_id: requestId,
        origin: "research_result" as const,
        source_url: hit.url,
        extracted_text: hit.content,
        access_status: "ok" as const,
        metadata: { title: hit.title, score: hit.score, query: hit.query },
      }));

      const { error: insertError } = await supabase.from("source_materials").insert(rows);
      if (insertError) throw new Error(`replaceResearchSources insert failed: ${insertError.message}`);
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

async function searchWithFallback(query: string): Promise<SearchOutcome> {
  try {
    const res = await tavilyWithBackoff(query);
    return {
      toolUsed: "tavily",
      hits: res.results.map((r) => ({
        url: r.url,
        title: r.title,
        content: r.content,
        score: r.score,
        query,
      })),
    };
  } catch {
    // fall through to the Claude web-search fallback
  }

  try {
    const hits = await webSearchFallback(query);
    return {
      toolUsed: "claude_web_search",
      hits: hits.map((h) => ({ url: h.url, title: h.title, content: h.content, score: 0, query })),
    };
  } catch {
    return { toolUsed: "none", hits: [] };
  }
}

async function tavilyWithBackoff(query: string) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await tavily.search(query, { maxResults: 5 });
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt);
      }
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const QUERY_SYSTEM_PROMPT = `You generate web search queries for a content research pipeline. Given a brief (topic, audience, overview), produce a diverse set of specific, well-formed search queries that will surface credible, relevant source material -- not just restatements of the topic. Cover different angles: definitions/background, current data or statistics, expert opinion or debate, practical examples, and anything the audience would specifically care about.`;

function buildQueryPrompt(brief: Brief): string {
  return [
    `Topic: ${brief.topic ?? "(unknown)"}`,
    `Audience: ${brief.audience ?? "(unknown)"}`,
    `Overview: ${brief.overview ?? "(none)"}`,
    "Produce between 10 and 15 search queries.",
  ].join("\n");
}

const QUERY_SCHEMA = {
  type: "object",
  properties: {
    queries: {
      type: "array",
      items: { type: "string" },
      minItems: 10,
      maxItems: 15,
      description: "10-15 diverse, specific web search queries for this content request.",
    },
  },
  required: ["queries"],
};

export type { SearchHit };
