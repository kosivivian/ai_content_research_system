import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupportingMaterial } from "@/lib/types/db";
import type { MaterialDraft } from "@/components/requests/supporting-materials-editor";

/** Uploads any not-yet-uploaded file drafts to Storage and passes already-resolved materials through unchanged. */
export async function resolveMaterial(
  supabase: SupabaseClient,
  userId: string,
  draft: MaterialDraft,
): Promise<SupportingMaterial> {
  if (draft.kind === "upload" && "file" in draft) {
    const path = `${userId}/${Date.now()}-${draft.file.name}`;
    const { error } = await supabase.storage.from("supporting-materials").upload(path, draft.file);
    if (error) throw new Error(`Upload failed for ${draft.file.name}: ${error.message}`);
    return { kind: "upload", storagePath: path, mimeType: draft.file.type, filename: draft.file.name };
  }
  return draft;
}

export async function resolveMaterials(
  supabase: SupabaseClient,
  userId: string,
  drafts: MaterialDraft[],
): Promise<SupportingMaterial[]> {
  return Promise.all(drafts.map((d) => resolveMaterial(supabase, userId, d)));
}
