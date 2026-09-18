"use client";

import { useState, type FormEvent, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseCsv } from "@/lib/csv";
import { resolveMaterials } from "@/lib/materials";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SupportingMaterialsEditor,
  type MaterialDraft,
} from "@/components/requests/supporting-materials-editor";

const MAX_BULK_ROWS = 5;

export default function NewRequestPage() {
  const router = useRouter();
  const [rawIdea, setRawIdea] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [tone, setTone] = useState("");
  const [materials, setMaterials] = useState<MaterialDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [csvRows, setCsvRows] = useState<Record<string, string>[] | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!rawIdea.trim()) {
      setError("Describe the idea before submitting -- everything else can be filled in later.");
      return;
    }
    if (!targetAudience.trim()) {
      setError("Target audience is required -- who is this content for?");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const resolvedMaterials = await resolveMaterials(supabase, user.id, materials);

      const { data, error: insertError } = await supabase
        .from("content_requests")
        .insert({
          created_by: user.id,
          raw_idea: rawIdea.trim(),
          target_audience: targetAudience.trim(),
          tone: tone.trim() || null,
          supporting_materials: resolvedMaterials,
        })
        .select("id")
        .single();

      if (insertError) throw new Error(insertError.message);

      router.push(`/requests/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function handleCsvSelect(e: ChangeEvent<HTMLInputElement>) {
    setCsvError(null);
    setBulkResult(null);
    const file = e.target.files?.[0];
    if (!file) return;

    file.text().then((text) => {
      const rows = parseCsv(text);
      if (rows.length === 0) {
        setCsvError("That file didn't have any rows.");
        setCsvRows(null);
        return;
      }
      if (rows.length > MAX_BULK_ROWS) {
        setCsvError(`This form processes up to ${MAX_BULK_ROWS} requests at a time -- that file has ${rows.length} rows.`);
        setCsvRows(null);
        return;
      }
      if (!("raw_idea" in rows[0]!)) {
        setCsvError('The CSV needs a "raw_idea" column and a "target_audience" column (optionally "tone", "source_url").');
        setCsvRows(null);
        return;
      }
      if (!("target_audience" in rows[0]!) || rows.some((row) => !row.target_audience?.trim())) {
        setCsvError('Every row needs a non-empty "target_audience" value -- who is this content for?');
        setCsvRows(null);
        return;
      }
      setCsvRows(rows);
    });
    e.target.value = "";
  }

  async function submitBulk() {
    if (!csvRows) return;
    setBulkSubmitting(true);
    setCsvError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const rows = csvRows.map((row) => ({
        created_by: user.id,
        raw_idea: row.raw_idea,
        target_audience: row.target_audience,
        tone: row.tone || null,
        supporting_materials: row.source_url ? [{ kind: "url", url: row.source_url }] : [],
      }));

      const { error: insertError } = await supabase.from("content_requests").insert(rows);
      if (insertError) throw new Error(insertError.message);

      setBulkResult(`${rows.length} requests submitted.`);
      setCsvRows(null);
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold">New content request</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A raw idea is enough to start -- the system will flag anything else it needs before research begins.
      </p>

      <Card className="mt-6">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="raw_idea">Idea *</Label>
              <Textarea
                id="raw_idea"
                required
                placeholder="What should this content be about?"
                value={rawIdea}
                onChange={(e) => setRawIdea(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="audience">Target audience *</Label>
                <Input
                  id="audience"
                  required
                  placeholder="e.g. engineering managers"
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tone">Tone</Label>
                <Input
                  id="tone"
                  placeholder="e.g. friendly and direct"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Supporting material</Label>
              <SupportingMaterialsEditor materials={materials} onChange={setMaterials} />
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}

            <Button type="submit" disabled={submitting}>
              {submitting ? "Submitting..." : "Submit request"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Bulk upload</CardTitle>
          <CardDescription>
            A CSV with <code>raw_idea</code> and <code>target_audience</code> columns (optionally{" "}
            <code>tone</code>, <code>source_url</code>), up to {MAX_BULK_ROWS} rows.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <input type="file" accept=".csv,text/csv" onChange={handleCsvSelect} className="text-sm" />
          {csvError && <p className="text-sm text-danger">{csvError}</p>}
          {bulkResult && <p className="text-sm text-success">{bulkResult}</p>}
          {csvRows && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">{csvRows.length} request(s) ready to submit:</p>
              <ul className="list-inside list-disc text-sm">
                {csvRows.map((row, i) => (
                  <li key={i} className="truncate">
                    {row.raw_idea}
                  </li>
                ))}
              </ul>
              <Button type="button" onClick={submitBulk} disabled={bulkSubmitting} className="self-start">
                {bulkSubmitting ? "Submitting..." : `Submit ${csvRows.length} requests`}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
