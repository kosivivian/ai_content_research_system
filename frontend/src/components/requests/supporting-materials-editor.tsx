"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { X, Link2, Video, FileText, Upload } from "lucide-react";
import type { SupportingMaterial } from "@/lib/types/db";

type DraftKind = SupportingMaterial["kind"];

interface PendingFile {
  kind: "upload";
  file: File;
}

/** The file itself hasn't been uploaded to Storage yet -- that happens on submit, see requests/new/page.tsx. */
export type MaterialDraft = SupportingMaterial | PendingFile;

function isPendingFile(m: MaterialDraft): m is PendingFile {
  return m.kind === "upload" && "file" in m;
}

function labelFor(m: MaterialDraft): string {
  if (isPendingFile(m)) return m.file.name;
  switch (m.kind) {
    case "url":
      return m.url;
    case "youtube":
      return m.url;
    case "text":
      return m.label || m.text.slice(0, 60);
    case "upload":
      return m.filename;
  }
}

const ICONS: Record<DraftKind, typeof Link2> = {
  url: Link2,
  youtube: Video,
  text: FileText,
  upload: Upload,
};

export function SupportingMaterialsEditor({
  materials,
  onChange,
}: {
  materials: MaterialDraft[];
  onChange: (materials: MaterialDraft[]) => void;
}) {
  const [kind, setKind] = useState<DraftKind>("url");
  const [urlValue, setUrlValue] = useState("");
  const [textValue, setTextValue] = useState("");
  const fileInputId = useId();

  function addUrlOrYoutube() {
    if (!urlValue.trim()) return;
    const isYoutube = /youtube\.com|youtu\.be/.test(urlValue);
    onChange([...materials, { kind: isYoutube ? "youtube" : "url", url: urlValue.trim() }]);
    setUrlValue("");
  }

  function addText() {
    if (!textValue.trim()) return;
    onChange([...materials, { kind: "text", text: textValue.trim() }]);
    setTextValue("");
  }

  function addFile(file: File) {
    onChange([...materials, { kind: "upload", file }]);
  }

  function remove(index: number) {
    onChange(materials.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      {materials.length > 0 && (
        <ul className="flex flex-col gap-2">
          {materials.map((m, i) => {
            const Icon = ICONS[m.kind];
            return (
              <li
                key={i}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{labelFor(m)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="shrink-0 text-muted-foreground hover:text-danger"
                  aria-label="Remove"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {(["url", "text", "upload"] as DraftKind[]).map((k) => (
          <Button key={k} type="button" variant={kind === k ? "default" : "outline"} size="sm" onClick={() => setKind(k)}>
            {k === "url" ? "Link / YouTube" : k === "text" ? "Paste text" : "Upload file"}
          </Button>
        ))}
      </div>

      {kind === "url" && (
        <div className="flex gap-2">
          <Input
            placeholder="https://example.com/article or a YouTube link"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addUrlOrYoutube())}
          />
          <Button type="button" onClick={addUrlOrYoutube}>
            Add
          </Button>
        </div>
      )}

      {kind === "text" && (
        <div className="flex flex-col gap-2">
          <Textarea
            placeholder="Paste reference text, notes, or a document's contents"
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
          />
          <Button type="button" onClick={addText} className="self-start">
            Add
          </Button>
        </div>
      )}

      {kind === "upload" && (
        <div>
          <Label htmlFor={fileInputId} className="sr-only">
            Upload a file
          </Label>
          <input
            id={fileInputId}
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) addFile(file);
              e.target.value = "";
            }}
            className="text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">Images or PDFs.</p>
        </div>
      )}
    </div>
  );
}
