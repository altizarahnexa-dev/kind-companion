import "dotenv/config";
import { z } from "zod";

/**
 * Central, validated environment. Fail fast at boot if anything is missing
 * or malformed. All other modules import from here — never read process.env
 * directly outside this file.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8080),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  LOG_PRETTY: z
    .string()
    .optional()
    .transform((v) => v === "true")
    .default("false"),

  API_KEYS: z
    .string()
    .min(1, "API_KEYS is required (comma-separated list of bearer tokens)")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  CORS_ORIGINS: z
    .string()
    .default("*")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(10_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_SEARCH_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_PRODUCT_MAX: z.coerce.number().int().positive().default(40),

  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  REQUEST_BUDGET_MS: z.coerce.number().int().positive().default(20_000),

  PLAYWRIGHT_HEADLESS: z
    .string()
    .optional()
    .transform((v) => v !== "false")
    .default("true"),
  PLAYWRIGHT_BROWSER: z
    .enum(["chromium", "firefox", "webkit"])
    .default("chromium"),
  PLAYWRIGHT_PROXY_URL: z.string().optional().default(""),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Print a compact, human-readable error and exit before the server starts.
  // eslint-disable-next-line no-console
  console.error(
    "[env] Invalid environment configuration:\n" +
      parsed.error.issues
        .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n"),
  );
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
