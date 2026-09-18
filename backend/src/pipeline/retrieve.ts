import type { PipelineJob } from "../types/db.js";
import { registerStage, type StageResult } from "../worker/registry.js";
import { createRetrieveDeps } from "./retrieveDeps.js";

export interface UnembeddedSource {
  id: string;
  extractedText: string;
}

export interface RetrieveDeps {
  getUnembeddedSources(requestId: string): Promise<UnembeddedSource[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  storeEmbeddings(items: { id: string; embedding: number[] }[]): Promise<void>;
  logActivity(requestId: string, action: string, detail?: Record<string, unknown>): Promise<void>;
}

/**
 * Retrieve stage: embed every source_materials row for this request that
 * doesn't have an embedding yet (both the research stage's finds and the
 * intake stage's user-supplied sources land here). One vector per source
 * -- no separate chunk table -- which is enough at this project's scale;
 * the rerank stage does a vector prefilter + LLM re-score over these.
 */
export async function runRetrieve(job: PipelineJob, deps: RetrieveDeps): Promise<StageResult> {
  const sources = await deps.getUnembeddedSources(job.request_id);

  if (sources.length === 0) {
    await deps.logActivity(job.request_id, "retrieval_completed", { embedded: 0 });
    return { nextAction: "advance", tokensUsed: 0 };
  }

  const BATCH_SIZE = 50;
  let embeddedCount = 0;

  for (let i = 0; i < sources.length; i += BATCH_SIZE) {
    const batch = sources.slice(i, i + BATCH_SIZE);
    const embeddings = await deps.embedBatch(batch.map((s) => s.extractedText));
    if (embeddings.length !== batch.length) {
      throw new Error(`embedBatch returned ${embeddings.length} vectors for ${batch.length} inputs`);
    }
    await deps.storeEmbeddings(batch.map((s, idx) => ({ id: s.id, embedding: embeddings[idx] as number[] })));
    embeddedCount += batch.length;
  }

  await deps.logActivity(job.request_id, "retrieval_completed", { embedded: embeddedCount });

  return { nextAction: "advance", tokensUsed: 0 };
}

registerStage("retrieve", (job) => runRetrieve(job, createRetrieveDeps()));
