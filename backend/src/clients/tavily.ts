import { loadEnv } from "../config/env.js";

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface TavilySearchResponse {
  query: string;
  results: TavilySearchResult[];
}

export async function search(
  query: string,
  opts: { maxResults?: number; searchDepth?: "basic" | "advanced" } = {},
): Promise<TavilySearchResponse> {
  const env = loadEnv();
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: env.TAVILY_API_KEY,
      query,
      search_depth: opts.searchDepth ?? "basic",
      max_results: opts.maxResults ?? 5,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tavily search failed (${res.status}): ${body}`);
  }

  return (await res.json()) as TavilySearchResponse;
}

export interface TavilyExtractResult {
  url: string;
  raw_content: string;
}

export interface TavilyExtractResponse {
  results: TavilyExtractResult[];
  failed_results: { url: string; error: string }[];
}

/** Content extraction for a specific URL (a user-supplied link, or a research hit worth pulling in full). */
export async function extract(urls: string[]): Promise<TavilyExtractResponse> {
  const env = loadEnv();
  const res = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: env.TAVILY_API_KEY, urls }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tavily extract failed (${res.status}): ${body}`);
  }

  return (await res.json()) as TavilyExtractResponse;
}
