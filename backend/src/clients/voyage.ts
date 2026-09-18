import { loadEnv } from "../config/env.js";

interface VoyageEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
  model: string;
  usage: { total_tokens: number };
}

/**
 * Embeds a batch of texts via Voyage AI (voyage-3-lite by default), used to
 * populate source_materials.embedding. Claude has no embeddings endpoint,
 * so this is a separate provider -- see README.md for why.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const env = loadEnv();
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: texts, model: env.VOYAGE_MODEL }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Voyage embeddings request failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as VoyageEmbeddingResponse;
  return json.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
}
