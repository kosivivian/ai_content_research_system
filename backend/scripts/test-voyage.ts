// Standalone check for the Voyage AI embeddings key/model, independent of
// the worker/pipeline. Run with: npx tsx scripts/test-voyage.ts (from
// backend/). Uses the exact same embed() the retrieve stage calls, so a
// pass here means the pipeline's embedding step will work too.
import { loadEnv } from "../src/config/env.js";
import { embed } from "../src/clients/voyage.js";

async function main() {
  const env = loadEnv();
  console.log(`Calling Voyage with model "${env.VOYAGE_MODEL}"...`);

  const [vector] = await embed(["This is a test sentence for Voyage AI embeddings."]);
  if (!vector) throw new Error("Voyage returned no embedding at all.");

  console.log(`OK -- got a ${vector.length}-dimension vector.`);
  console.log(`First 5 values: [${vector.slice(0, 5).join(", ")}]`);

  if (vector.length !== 512) {
    console.warn(
      `Note: source_materials.embedding is vector(512) (see migration 20250101000014) -- ` +
        `this model returned ${vector.length} dims, which will fail to store. If you changed ` +
        `VOYAGE_MODEL, either pick a model/output_dimension that returns 512, or update the schema.`,
    );
  }
}

main().catch((err) => {
  console.error("Voyage test FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
