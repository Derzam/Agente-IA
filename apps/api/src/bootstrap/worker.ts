import { setTimeout as delay } from "node:timers/promises";
import { createPool, checkDatabaseRole } from "../platform/database.js";
import { InternalWorker } from "../worker/internal-worker.js";
export function workerDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const value = env.WORKER_DATABASE_URL;
  if (!value) throw Error("WORKER_DATABASE_URL requerida.");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    ["postgres", "supabase_admin", "service_role"].includes(
      decodeURIComponent(url.username),
    ) ||
    (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.searchParams.get("sslmode") !== "verify-full")
  )
    throw Error(
      "WORKER_DATABASE_URL debe usar principal restringido y TLS verificable.",
    );
  return value;
}
async function main() {
  const pool = createPool(workerDatabaseUrl(process.env));
  let stop = false;
  process.once("SIGINT", () => {
    stop = true;
  });
  process.once("SIGTERM", () => {
    stop = true;
  });
  try {
    await checkDatabaseRole(pool, "worker");
    const worker = new InternalWorker(pool, 5, 30, (event) =>
      process.stdout.write(JSON.stringify(event) + "\n"),
    );
    while (!stop) {
      const result = await worker.tick();
      process.stdout.write(
        JSON.stringify({ event_type: "worker.tick", ...result }) + "\n",
      );
      await delay(1000);
    }
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  process.stderr.write(
    JSON.stringify({ level: "fatal", event_type: "worker.startup_failed" }) +
      "\n",
  );
  process.exitCode = 1;
});
