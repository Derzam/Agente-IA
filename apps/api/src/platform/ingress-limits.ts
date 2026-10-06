import { createHmac } from "node:crypto";
import type pg from "pg";
import { transaction } from "./database.js";
import { AppError } from "./errors.js";
export function ingressLimiter(pool: pg.Pool, key: string) {
  return async (ip: string) => {
    await transaction(pool, async (db) => {
      for (const [scope, limit] of [
        ["emergency", 10000],
        [`ip:${ip}`, 300],
      ] as const) {
        const hash = createHmac("sha256", Buffer.from(key, "hex"))
          .update(scope)
          .digest("hex");
        const v = await db.query(
          "INSERT INTO app.ingress_rate_windows(key_hash,window_start,count) VALUES($1,date_trunc('minute',clock_timestamp()),1) ON CONFLICT(key_hash,window_start) DO UPDATE SET count=app.ingress_rate_windows.count+1 WHERE app.ingress_rate_windows.count<$2 RETURNING count",
          [hash, limit],
        );
        if (v.rowCount !== 1)
          throw new AppError(429, "RATE_LIMITED", "Límite webhook.", true);
      }
    });
  };
}
