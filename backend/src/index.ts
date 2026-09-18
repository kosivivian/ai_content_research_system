import { loadEnv } from "./config/env.js";
import { getSupabaseClient } from "./clients/supabase.js";
import { createSupabaseWorkerDeps } from "./worker/supabaseDeps.js";
import { runWorker } from "./worker/loop.js";
import { createSupabasePublishingDeps } from "./worker/publishingDeps.js";
import { runPublishingWorker } from "./worker/publishingLoop.js";
import "./worker/registry.js"; // registers placeholder handlers for every stage
import "./pipeline/intake.js";
import "./pipeline/research.js";
import "./pipeline/retrieve.js";
import "./pipeline/rerank.js";
import "./pipeline/plan.js";
import "./pipeline/generate.js";
import "./pipeline/evaluateArticle.js";
import "./pipeline/channelAdapt.js";
import "./pipeline/evaluateChannel.js";
import "./pipeline/regenerateArticle.js";
import "./pipeline/regenerateChannel.js";

// Every stage now has a real handler -- the automated part of the
// pipeline (intake through evaluate_channel) is fully wired end to end.
// regenerate_article/regenerate_channel are creator-triggered one-shots,
// not part of that automated chain (see stages.ts's STAGE_STATUS note).

async function main() {
  const env = loadEnv();
  const supabase = getSupabaseClient();
  const deps = createSupabaseWorkerDeps(supabase, { maxAttempts: env.WORKER_MAX_ATTEMPTS });
  const publishingDeps = createSupabasePublishingDeps(supabase, env);

  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`Received ${signal}, shutting down worker...`);
      controller.abort();
    });
  }

  console.log(
    `Worker starting: concurrency=${env.WORKER_CONCURRENCY}, pollIntervalMs=${env.WORKER_POLL_INTERVAL_MS}`,
  );

  // Two independent poll loops in one process: the pipeline_jobs worker
  // (intake through evaluate_channel, up to WORKER_CONCURRENCY in flight)
  // and a single-slot publishing_queue worker -- publishing volume never
  // approaches pipeline volume, and a second Railway/Render service just to
  // run one more poll loop isn't worth the free-tier resource cost.
  await Promise.all([
    runWorker(deps, {
      concurrency: env.WORKER_CONCURRENCY,
      pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
      signal: controller.signal,
    }),
    runPublishingWorker(publishingDeps, {
      pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
      signal: controller.signal,
    }),
  ]);

  console.log("Worker stopped.");
}

main().catch((err) => {
  console.error("Fatal error starting worker:", err);
  process.exit(1);
});
