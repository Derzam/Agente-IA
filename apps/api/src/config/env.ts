import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  WEBHOOK_DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().min(16).max(512),
  WHATSAPP_APP_SECRET: z.string().min(16).max(512),
  ADMIN_ALLOWED_ORIGINS: z.string().min(1),
});

export interface Config {
  environment: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  webhookDatabaseUrl: string;
  supabaseUrl: string;
  whatsappVerifyToken: string;
  whatsappAppSecret: string;
  adminAllowedOrigins: string[];
}
export class ConfigurationError extends Error {
  constructor(fields: string[]) {
    super(`Configuración inválida: ${[...new Set(fields)].join(", ")}.`);
    this.name = "ConfigurationError";
  }
}
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = schema.safeParse({
    ...env,
    WHATSAPP_VERIFY_TOKEN: env.META_VERIFY_TOKEN || env.WHATSAPP_VERIFY_TOKEN,
    WHATSAPP_APP_SECRET: env.META_APP_SECRET || env.WHATSAPP_APP_SECRET,
  });
  if (!parsed.success)
    throw new ConfigurationError(
      parsed.error.issues.map((issue) => String(issue.path[0])),
    );
  const values = parsed.data;
  const invalid: string[] = [];
  for (const field of ["DATABASE_URL", "WEBHOOK_DATABASE_URL"] as const) {
    try {
      const url = new URL(values[field]);
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !url.hostname ||
        !url.username ||
        url.pathname === "/"
      )
        invalid.push(field);
      // TLS with certificate verification required for remote hosts; local test/development may omit TLS.
      if (
        !localHosts.has(url.hostname) &&
        url.searchParams.get("sslmode") !== "verify-full"
      )
        invalid.push(field);
      if (
        ["postgres", "supabase_admin", "service_role"].includes(
          decodeURIComponent(url.username),
        )
      )
        invalid.push(field);
    } catch {
      invalid.push(field);
    }
  }
  const origins = values.ADMIN_ALLOWED_ORIGINS.split(",").map((origin) =>
    origin.trim(),
  );
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (
        origin !== url.origin ||
        (url.protocol !== "https:" &&
          !(
            values.NODE_ENV !== "production" &&
            url.protocol === "http:" &&
            localHosts.has(url.hostname)
          ))
      )
        invalid.push("ADMIN_ALLOWED_ORIGINS");
    } catch {
      invalid.push("ADMIN_ALLOWED_ORIGINS");
    }
  }
  const supabase = new URL(values.SUPABASE_URL);
  if (
    supabase.username ||
    supabase.password ||
    supabase.search ||
    supabase.hash ||
    supabase.pathname !== "/" ||
    (supabase.protocol !== "https:" &&
      !(
        values.NODE_ENV !== "production" &&
        supabase.protocol === "http:" &&
        localHosts.has(supabase.hostname)
      ))
  )
    invalid.push("SUPABASE_URL");
  if (invalid.length) throw new ConfigurationError(invalid);
  return {
    environment: values.NODE_ENV,
    port: values.PORT,
    databaseUrl: values.DATABASE_URL,
    webhookDatabaseUrl: values.WEBHOOK_DATABASE_URL,
    supabaseUrl: supabase.origin,
    whatsappVerifyToken: values.WHATSAPP_VERIFY_TOKEN,
    whatsappAppSecret: values.WHATSAPP_APP_SECRET,
    adminAllowedOrigins: [...new Set(origins)],
  };
}
