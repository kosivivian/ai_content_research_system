import { loadEnv } from "../config/env.js";

// Buffer's classic REST API (api.bufferapp.com/1/...). This client covers
// what the publishing_queue worker needs (create + look up a scheduled
// update); the OAuth flow that produces BUFFER_ACCESS_TOKEN and the
// per-user Buffer "profile_ids" (one per connected LinkedIn/X account) is
// wired up together with the UI in a later build step, not here.

interface BufferUpdate {
  id: string;
  status: string;
  scheduled_at?: number;
}

export async function createUpdate(params: {
  profileId: string;
  text: string;
  scheduledAt?: Date;
}): Promise<BufferUpdate> {
  const env = loadEnv();
  const body = new URLSearchParams();
  body.set("access_token", env.BUFFER_ACCESS_TOKEN);
  body.append("profile_ids[]", params.profileId);
  body.set("text", params.text);
  if (params.scheduledAt) {
    body.set("scheduled_at", String(Math.floor(params.scheduledAt.getTime() / 1000)));
  }

  const res = await fetch("https://api.bufferapp.com/1/updates/create.json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = (await res.json()) as { success?: boolean; updates?: BufferUpdate[]; message?: string };

  if (!res.ok || !json.updates?.[0]) {
    throw new Error(`Buffer createUpdate failed: ${json.message ?? res.statusText}`);
  }

  return json.updates[0];
}

export async function getUpdateStatus(updateId: string): Promise<BufferUpdate> {
  const env = loadEnv();
  const res = await fetch(
    `https://api.bufferapp.com/1/updates/${updateId}.json?access_token=${env.BUFFER_ACCESS_TOKEN}`,
  );
  const json = (await res.json()) as BufferUpdate & { message?: string };
  if (!res.ok) {
    throw new Error(`Buffer getUpdateStatus failed: ${json.message ?? res.statusText}`);
  }
  return json;
}
