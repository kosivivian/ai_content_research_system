"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { resolveMaterials } from "@/lib/materials";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { SupportingMaterialsEditor, type MaterialDraft } from "@/components/requests/supporting-materials-editor";
import type { ContentRequest } from "@/lib/types/db";

export function ResubmitForm({ request }: { request: ContentRequest }) {
  const router = useRouter();
  const [rawIdea, setRawIdea] = useState(request.raw_idea ?? "");
  const [targetAudience, setTargetAudience] = useState(request.target_audience ?? "");
  const [tone, setTone] = useState(request.tone ?? "");
  const [materials, setMaterials] = useState<MaterialDraft[]>(request.supporting_materials);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (!targetAudience.trim()) {
      setError("Target audience is required -- who is this content for?");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const resolvedMaterials = await resolveMaterials(supabase, request.created_by, materials);

      const { error: updateError } = await supabase
        .from("content_requests")
        .update({
          raw_idea: rawIdea.trim(),
          target_audience: targetAudience.trim(),
          tone: tone.trim() || null,
          supporting_materials: resolvedMaterials,
          status: "intake",
        })
        .eq("id", request.id);

      if (updateError) throw new Error(updateError.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="resubmit-idea">Idea</Label>
        <Textarea id="resubmit-idea" value={rawIdea} onChange={(e) => setRawIdea(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="resubmit-audience">Target audience *</Label>
          <Input
            id="resubmit-audience"
            required
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="resubmit-tone">Tone</Label>
          <Input id="resubmit-tone" value={tone} onChange={(e) => setTone(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Supporting material</Label>
        <SupportingMaterialsEditor materials={materials} onChange={setMaterials} />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button onClick={handleSubmit} disabled={submitting} className="self-start">
        {submitting ? "Resubmitting..." : "Resubmit"}
      </Button>
    </div>
  );
}
