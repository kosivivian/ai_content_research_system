import type { SupabaseClient } from "@supabase/supabase-js";
import type { Brief, ContentRequest } from "../types/db.js";
import type { RankedSourceForPlanning } from "./plan.js";

const MAX_CHARS_PER_SOURCE = 1500;

/** Shared by plan.ts and generate.ts -- both need the brief and the same ranked-source shape. */
export async function getBriefFromDb(supabase: SupabaseClient, requestId: string): Promise<Brief> {
  const { data, error } = await supabase
    .from("content_requests")
    .select("brief")
    .eq("id", requestId)
    .single();
  if (error || !data) throw new Error(`getBrief failed: ${error?.message ?? "not found"}`);
  return (data as Pick<ContentRequest, "brief">).brief;
}

export async function getRankedSourcesFromDb(
  supabase: SupabaseClient,
  requestId: string,
): Promise<RankedSourceForPlanning[]> {
  const { data, error } = await supabase
    .from("reranked_sources")
    .select("rank, source_material_id, source_materials(source_url, extracted_text)")
    .eq("request_id", requestId)
    .order("rank");
  if (error) throw new Error(`getRankedSources failed: ${error.message}`);

  return (data ?? []).map((row) => {
    const material = row.source_materials as unknown as
      | { source_url: string | null; extracted_text: string | null }
      | null;
    return {
      id: row.source_material_id as string,
      sourceUrl: material?.source_url ?? null,
      excerpt: (material?.extracted_text ?? "").slice(0, MAX_CHARS_PER_SOURCE),
    };
  });
}
