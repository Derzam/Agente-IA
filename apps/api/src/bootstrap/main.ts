import { loadConfig } from "../config/env.js";
import { SupabaseJwtVerifier } from "../integrations/supabase/auth.js";
import { createPool, checkDatabaseRole } from "../platform/database.js";
import { PostgresIdentityRepository } from "../modules/identity/infrastructure/postgres-identity.js";
import { PostgresInboxRepository } from "../modules/inbox/infrastructure/postgres-inbox.js";
import { buildApp } from "./app.js";
import { loadRuntime } from "../config/runtime.js";
import { configureCursorKey } from "../platform/cursor.js";
import { ingressLimiter } from "../platform/ingress-limits.js";

async function main() {
  const config = loadConfig(process.env);
  const runtime = loadRuntime(process.env);
  configureCursorKey(
    runtime.cursorKey,
    process.env.CURSOR_HMAC_PREVIOUS_KEY || undefined,
  );
  const apiPool = createPool(config.databaseUrl);
  const ingressPool = createPool(config.webhookDatabaseUrl);
  const closePools = async () => {
    await Promise.all([apiPool.end(), ingressPool.end()]);
  };
  try {
    const readiness = async () => {
      await Promise.all([
        checkDatabaseRole(apiPool, "api"),
        checkDatabaseRole(ingressPool, "ingress"),
      ]);
    };
    await readiness(); // Reject superuser, bypass-RLS, owner or mixed-role credentials before listening.
    const app = await buildApp({
      config,
      auth: new SupabaseJwtVerifier(config.supabaseUrl),
      identities: new PostgresIdentityRepository(apiPool),
      inbox: new PostgresInboxRepository(ingressPool),
      domainPool: apiPool,
      runtimeRateLimit: true,
      ingressLimit: ingressLimiter(ingressPool, runtime.cursorKey),
      readiness,
      close: closePools,
    });
    const shutdown = async () => {
      await app.close();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    const host = process.env.HOST || "127.0.0.1";
    if (!["127.0.0.1", "0.0.0.0", "::1"].includes(host))
      throw Error("HOST inválido");
    await app.listen({ port: config.port, host });
  } catch {
    await closePools();
    throw new Error(
      "Backend no disponible; revisar configuración y roles de base de datos.",
    );
  }
}
main().catch((error) => {
  // ConfigurationError contains field names only; no URL/token/stack is emitted.
  const message =
    error instanceof Error && error.name === "ConfigurationError"
      ? error.message
      : "Inicio fallido; revisar configuración y base de datos.";
  process.stderr.write(
    JSON.stringify({ level: "fatal", event_type: "startup.failed", message }) +
      "\n",
  );
  process.exitCode = 1;
});
