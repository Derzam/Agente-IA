import { setTimeout as delay } from "node:timers/promises";
import { createPool, checkDatabaseRole } from "../platform/database.js";
import { RuntimeWorker } from "../worker/runtime-worker.js";
import { loadRuntime } from "../config/runtime.js";
import { createServer } from "node:http";
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
export function workerHealthPort(env: NodeJS.ProcessEnv): number {
  const port = Number(env.WORKER_HEALTH_PORT || env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("WORKER_HEALTH_PORT inválido");
  return port;
}
async function main() {
  const pool = createPool(workerDatabaseUrl(process.env));
  const config = loadRuntime(process.env);
  let stop = false;
  process.once("SIGINT", () => {
    stop = true;
  });
  process.once("SIGTERM", () => {
    stop = true;
  });
  try {
    await checkDatabaseRole(pool, "worker");
    const port = workerHealthPort(process.env);
    const health = createServer(async (req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/health") {
        res.end('{"status":"ok"}');
        return;
      }
      if (req.url !== "/ready") {
        res.statusCode = 404;
        res.end("{}");
        return;
      }
      try {
        if (stop) throw Error();
        await checkDatabaseRole(pool, "worker");
        res.end('{"status":"ready"}');
      } catch {
        res.statusCode = 503;
        res.end('{"status":"unavailable"}');
      }
    });
    await new Promise<void>((resolve, reject) => {
      health.once("error", reject);
      health.listen(port, "0.0.0.0", resolve);
    });
    const worker = new RuntimeWorker(pool, config, (event) =>
      process.stdout.write(JSON.stringify(event) + "\n"),
    );
    try {
      while (!stop) {
        const result = await worker.tick();
        process.stdout.write(
          JSON.stringify({ event_type: "worker.tick", ...result }) + "\n",
        );
        await delay(1000);
      }
    } finally {
      await worker.drain();
      await new Promise<void>((resolve) => health.close(() => resolve()));
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
