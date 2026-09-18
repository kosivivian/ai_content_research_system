import { test } from "node:test";
import assert from "node:assert/strict";
import { runIntake, type IntakeDeps, type ExtractedSource, type BriefDraft } from "./intake.js";
import type { ContentRequest, PipelineJob, SupportingMaterial } from "../types/db.js";

function makeJob(overrides: Partial<PipelineJob> = {}): PipelineJob {
  return {
    id: "job-1",
    request_id: "req-1",
    stage: "intake",
    status: "running",
    attempt_count: 1,
    token_budget: {},
    payload: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ContentRequest> = {}): ContentRequest {
  return {
    id: "req-1",
    created_by: "creator-1",
    raw_idea: "Why small teams should adopt async standups",
    target_audience: null,
    tone: null,
    supporting_materials: [],
    brief: {},
    status: "intake",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

interface Harness {
  deps: IntakeDeps;
  updateCalls: { requestId: string; patch: { brief: unknown; status: string } }[];
  replaceCalls: { requestId: string; sources: ExtractedSource[] }[];
  activityCalls: { requestId: string; action: string; detail?: Record<string, unknown> }[];
}

function makeHarness(opts: {
  request: ContentRequest;
  extract?: (m: SupportingMaterial) => Promise<ExtractedSource>;
  draft: BriefDraft;
}): Harness {
  const updateCalls: Harness["updateCalls"] = [];
  const replaceCalls: Harness["replaceCalls"] = [];
  const activityCalls: Harness["activityCalls"] = [];

  const deps: IntakeDeps = {
    async getContentRequest() {
      return opts.request;
    },
    async extractSupportingMaterial(material) {
      if (opts.extract) return opts.extract(material);
      return {
        origin: "user_upload",
        sourceUrl: null,
        extractedText: "irrelevant",
        accessStatus: "ok",
        metadata: {},
      };
    },
    async replaceSourceMaterials(requestId, sources) {
      replaceCalls.push({ requestId, sources });
    },
    async generateBriefDraft() {
      return { draft: opts.draft, tokensUsed: 123 };
    },
    async updateContentRequest(requestId, patch) {
      updateCalls.push({ requestId, patch });
    },
    async logActivity(requestId, action, detail) {
      activityCalls.push({ requestId, action, detail });
    },
  };

  return { deps, updateCalls, replaceCalls, activityCalls };
}

test("a complete brief with no blocked sources advances to research", async () => {
  const request = makeRequest({ target_audience: "engineering managers" });
  const h = makeHarness({
    request,
    draft: { topic: "Async standups", audience: "engineering managers", tone: "practical", overview: "..." },
  });

  const result = await runIntake(makeJob(), h.deps);

  assert.equal(result.nextAction, "advance");
  assert.equal(h.updateCalls[0]?.patch.status, "researching");
  const brief = h.updateCalls[0]?.patch.brief as { missing_fields: string[]; blocked_sources: unknown[] };
  assert.deepEqual(brief.missing_fields, []);
  assert.deepEqual(brief.blocked_sources, []);
});

test("a missing audience stops the pipeline and flags missing_fields", async () => {
  const request = makeRequest();
  const h = makeHarness({
    request,
    draft: { topic: "Async standups", overview: "..." }, // no audience -- model wasn't confident
  });

  const result = await runIntake(makeJob(), h.deps);

  assert.equal(result.nextAction, "stop");
  assert.equal(h.updateCalls[0]?.patch.status, "awaiting_creator");
  const brief = h.updateCalls[0]?.patch.brief as { missing_fields: string[] };
  assert.deepEqual(brief.missing_fields, ["audience"]);
});

test("a blocked source stops the pipeline even when the brief itself is complete", async () => {
  const request = makeRequest({
    target_audience: "engineering managers",
    supporting_materials: [{ kind: "url", url: "https://example.com/blocked" }],
  });
  const h = makeHarness({
    request,
    extract: async () => ({
      origin: "user_url",
      sourceUrl: "https://example.com/blocked",
      extractedText: null,
      accessStatus: "blocked",
      metadata: {},
      blockedReason: "bot-blocked",
      blockedSuggestion: "paste it instead",
    }),
    draft: { topic: "Async standups", audience: "engineering managers", overview: "..." },
  });

  const result = await runIntake(makeJob(), h.deps);

  assert.equal(result.nextAction, "stop");
  assert.equal(h.updateCalls[0]?.patch.status, "awaiting_creator");
  const brief = h.updateCalls[0]?.patch.brief as {
    blocked_sources: { source_url: string; reason: string; suggestion: string }[];
  };
  assert.equal(brief.blocked_sources.length, 1);
  assert.equal(brief.blocked_sources[0]?.reason, "bot-blocked");
});

test("extracted sources are all replaced in one call, in order", async () => {
  const materials: SupportingMaterial[] = [
    { kind: "url", url: "https://a.example" },
    { kind: "text", text: "pasted context" },
  ];
  const request = makeRequest({ target_audience: "devs", supporting_materials: materials });
  const h = makeHarness({
    request,
    extract: async (m) => ({
      origin: m.kind === "url" ? "user_url" : "user_upload",
      sourceUrl: m.kind === "url" ? m.url : null,
      extractedText: "text",
      accessStatus: "ok",
      metadata: {},
    }),
    draft: { topic: "T", audience: "devs", overview: "..." },
  });

  await runIntake(makeJob(), h.deps);

  assert.equal(h.replaceCalls.length, 1);
  assert.equal(h.replaceCalls[0]?.sources.length, 2);
  assert.equal(h.replaceCalls[0]?.sources[0]?.sourceUrl, "https://a.example");
});
