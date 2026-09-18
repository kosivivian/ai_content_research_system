import { getSupabaseClient } from "../clients/supabase.js";
import * as voyage from "../clients/voyage.js";
import type { RetrieveDeps } from "./retrieve.js";

/** Voyage AI's own per-request batch cap is generous, but this keeps individual calls modest and retry-friendly. */
const MAX_CHARS_PER_SOURCE = 8000;

export function createRetrieveDeps(): RetrieveDeps {
  const supabase = getSupabaseClient();

  return {
    async getUnembeddedSources(requestId) {
      const { data, error } = await supabase
        .from("source_materials")
        .select("id, extracted_text")
        .eq("request_id", requestId)
        .eq("access_status", "ok")
        .is("embedding", null)
        .not("extracted_text", "is", null);
      if (error) throw new Error(`getUnembeddedSources failed: ${error.message}`);

      return (data ?? [])
        .filter((row): row is { id: string; extracted_text: string } => Boolean(row.extracted_text))
        .map((row) => ({ id: row.id, extractedText: row.extracted_text.slice(0, MAX_CHARS_PER_SOURCE) }));
    },

    embedBatch: voyage.embed,

    async storeEmbeddings(items) {
      // Supabase's JS client has no bulk "update many rows with different
      // values" in one call, so these go one at a time; fine at this scale
      // (a handful of sources per request).
      for (const item of items) {
        const { error } = await supabase
          .from("source_materials")
          .update({ embedding: item.embedding })
          .eq("id", item.id);
        if (error) throw new Error(`storeEmbeddings failed for ${item.id}: ${error.message}`);
      }
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
