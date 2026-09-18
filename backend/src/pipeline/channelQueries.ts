import type { SupabaseClient } from "@supabase/supabase-js";
import type { Channel } from "../types/db.js";

export interface ChannelDraftRow {
  id: string;
  channel: Channel;
  body: string;
}

/** Shared by channelAdaptDeps.ts (revision feedback) and evaluateChannelDeps.ts (what to evaluate). */
export async function getLatestChannelDrafts(
  supabase: SupabaseClient,
  requestId: string,
): Promise<{ version: number; drafts: ChannelDraftRow[] }> {
  const { data: latest, error: latestError } = await supabase
    .from("channel_drafts")
    .select("version")
    .eq("request_id", requestId)
    .order("version", { ascending: false })
    .limit(1);
  if (latestError) throw new Error(`getLatestChannelDrafts version lookup failed: ${latestError.message}`);

  const version = latest?.[0]?.version as number | undefined;
  if (version === undefined) return { version: 0, drafts: [] };

  const { data, error } = await supabase
    .from("channel_drafts")
    .select("id, channel, body")
    .eq("request_id", requestId)
    .eq("version", version)
    .order("channel");
  if (error) throw new Error(`getLatestChannelDrafts fetch failed: ${error.message}`);

  return {
    version,
    drafts: (data ?? []).map((row) => ({
      id: row.id as string,
      channel: row.channel as Channel,
      body: row.body as string,
    })),
  };
}
