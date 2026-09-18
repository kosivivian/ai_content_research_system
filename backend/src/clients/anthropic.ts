import Anthropic from "@anthropic-ai/sdk";
import { loadEnv } from "../config/env.js";

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (client) return client;
  const env = loadEnv();
  // The SDK's own default timeout (10 minutes) is far too long for a worker
  // loop meant to move through a queue -- a single hung call (no response,
  // no error) would wedge that job in 'running' forever, since nothing else
  // reclaims it. 2 minutes is generous for any of this pipeline's calls
  // (largest is generate's 6144-token budget) while still bounding the
  // worst case to something the existing retry/fail logic actually sees.
  client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 120_000 });
  return client;
}

export type ModelTier = "fast" | "strong";

export interface CompletionRequest {
  tier: ModelTier;
  system: string;
  prompt: string;
  maxTokens?: number;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Thin wrapper every pipeline stage prompt goes through, so token usage is
 * always captured for pipeline_jobs.token_budget bookkeeping. "fast" ->
 * ANTHROPIC_MODEL_FAST (mechanical steps: query gen, re-rank scoring);
 * "strong" -> ANTHROPIC_MODEL_STRONG (planning/drafting/evaluation/adaptation).
 */
export async function complete(req: CompletionRequest): Promise<CompletionResult> {
  const env = loadEnv();
  const model = req.tier === "fast" ? env.ANTHROPIC_MODEL_FAST : env.ANTHROPIC_MODEL_STRONG;

  const response = await getClient().messages.create({
    model,
    max_tokens: req.maxTokens ?? 4096,
    system: req.system,
    messages: [{ role: "user", content: req.prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

export interface StructuredCompletionRequest {
  tier: ModelTier;
  system: string;
  prompt: string;
  /** Name of the forced tool -- purely internal, never seen by the end user. */
  toolName: string;
  toolDescription: string;
  /** JSON schema for the tool's input; only mark a property "required" if the model should never be allowed to omit it. */
  inputSchema: Record<string, unknown>;
  maxTokens?: number;
}

export interface StructuredCompletionResult<T> {
  result: T;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Forces the model to respond via a single tool call matching inputSchema,
 * which is the reliable way to get structured JSON out of Claude (rather
 * than asking it to "respond in JSON" in prose and hoping it parses).
 */
export async function completeStructured<T>(
  req: StructuredCompletionRequest,
): Promise<StructuredCompletionResult<T>> {
  const env = loadEnv();
  const model = req.tier === "fast" ? env.ANTHROPIC_MODEL_FAST : env.ANTHROPIC_MODEL_STRONG;

  const response = await getClient().messages.create({
    model,
    max_tokens: req.maxTokens ?? 1024,
    system: req.system,
    messages: [{ role: "user", content: req.prompt }],
    tools: [
      {
        name: req.toolName,
        description: req.toolDescription,
        input_schema: req.inputSchema as Anthropic.Tool["input_schema"],
      },
    ],
    tool_choice: { type: "tool", name: req.toolName },
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(`Model did not return a tool_use block for "${req.toolName}"`);
  }

  // A truncated tool call (hit max_tokens mid-JSON) still comes back as a
  // tool_use block, just with incomplete/malformed `input` -- e.g. a
  // required array field silently missing. That surfaces downstream as a
  // confusing "X.map is not a function" instead of the actual cause, so
  // catch it here where the real explanation is available.
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      `completeStructured("${req.toolName}"): response was cut off by max_tokens (${req.maxTokens ?? 1024}) before the tool call finished -- its input is likely incomplete. Raise maxTokens for this call.`,
    );
  }

  return {
    result: toolUse.input as T,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/**
 * Reads an uploaded image or PDF via Claude's native multimodal input --
 * no separate OCR tool needed. Used for creator-uploaded supporting
 * material (as opposed to a URL or pasted text).
 */
export async function extractFromFile(params: {
  base64Data: string;
  mimeType: string;
  instructions: string;
}): Promise<CompletionResult> {
  const env = loadEnv();
  const isPdf = params.mimeType === "application/pdf";

  const block = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: params.base64Data } }
    : { type: "image", source: { type: "base64", media_type: params.mimeType, data: params.base64Data } };

  const response = await getClient().messages.create({
    model: env.ANTHROPIC_MODEL_STRONG,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [block, { type: "text", text: params.instructions }] as unknown as Anthropic.MessageParam["content"],
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

export interface WebSearchHit {
  url: string;
  title: string;
  content: string;
}

/**
 * Fallback research path used only when Tavily is down/rate-limited for a
 * given query (see src/pipeline/researchDeps.ts) -- Claude's server-side
 * web search tool. The tool identifier/response shape for server-side web
 * search has changed across Anthropic API versions; verify
 * "web_search_20250305" is still current against the live docs before
 * relying on this path. Parsing here is deliberately tolerant: any shape
 * mismatch just yields zero hits (treated as "fallback also failed"
 * upstream, not a crash) rather than throwing.
 */
export async function webSearchFallback(query: string): Promise<WebSearchHit[]> {
  const env = loadEnv();
  const response = await getClient().messages.create({
    model: env.ANTHROPIC_MODEL_FAST,
    max_tokens: 1024,
    messages: [{ role: "user", content: `Search the web for: ${query}` }],
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: 3 } as unknown as Anthropic.Tool,
    ],
  });

  const hits: WebSearchHit[] = [];
  for (const block of response.content as unknown as Record<string, unknown>[]) {
    const items = (block as { content?: unknown }).content;
    if (block["type"] !== "web_search_tool_result" || !Array.isArray(items)) continue;
    for (const item of items as Record<string, unknown>[]) {
      const url = typeof item["url"] === "string" ? item["url"] : undefined;
      if (!url) continue;
      hits.push({
        url,
        title: typeof item["title"] === "string" ? item["title"] : url,
        content: typeof item["encrypted_content"] === "string" ? item["encrypted_content"] : "",
      });
    }
  }
  return hits;
}
