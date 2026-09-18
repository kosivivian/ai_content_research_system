import { config } from "dotenv";
import { z } from "zod";

// tsx (unlike Next.js) never reads .env on its own -- this is what actually
// populates process.env from backend/.env. A no-op if the file is missing
// (e.g. in CI/tests, which only exercise stage logic with fake deps and
// never call loadEnv for real).
config();

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL_FAST: z.string().default("claude-haiku-4-5-20251001"),
  ANTHROPIC_MODEL_STRONG: z.string().default("claude-sonnet-5"),

  VOYAGE_API_KEY: z.string().min(1),
  VOYAGE_MODEL: z.string().default("voyage-3-lite"),

  TAVILY_API_KEY: z.string().min(1),
  FIRECRAWL_API_KEY: z.string().min(1),

  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().email(),

  BUFFER_ACCESS_TOKEN: z.string().min(1),
  // Buffer "profile" = one connected social account. Not required to boot
  // the worker (email-only requests never need one) but a linkedin/x item
  // fails loudly at publish time if its channel's profile id is missing.
  BUFFER_PROFILE_ID_LINKEDIN: z.string().optional(),
  BUFFER_PROFILE_ID_X: z.string().optional(),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}
