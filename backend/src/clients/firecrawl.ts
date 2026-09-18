import { loadEnv } from "../config/env.js";

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: { markdown?: string; metadata?: Record<string, unknown> };
  error?: string;
}

export interface ScrapeResult {
  markdown: string;
  metadata: Record<string, unknown>;
}

/**
 * Fallback scraper used only when Tavily Extract fails on a URL (different
 * scraping engine, better odds against bot-protected sites). Not the
 * primary path -- see README.md tool table.
 */
export async function scrape(url: string): Promise<ScrapeResult> {
  const env = loadEnv();
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, formats: ["markdown"] }),
  });

  const json = (await res.json()) as FirecrawlScrapeResponse;

  if (!res.ok || !json.success || !json.data?.markdown) {
    throw new Error(`Firecrawl scrape failed for ${url}: ${json.error ?? res.statusText}`);
  }

  return { markdown: json.data.markdown, metadata: json.data.metadata ?? {} };
}
