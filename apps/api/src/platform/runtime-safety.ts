import type pg from "pg";
import { transaction, userContext } from "./database.js";
import {
  Repository,
  type Row,
} from "../modules/domain/infrastructure/repository.js";
import type { RuntimeConfig } from "../config/runtime.js";
import { ProviderFailure } from "../modules/ai/provider.js";
export async function scoped<T>(
  pool: pg.Pool,
  tenant: string,
  fn: (r: Repository) => Promise<T>,
) {
  return transaction(pool, async (db) => {
    await userContext(db, "", tenant);
    return fn(new Repository(db, tenant));
  });
}
const windowAt = (seconds: number) =>
  new Date(Math.floor(Date.now() / 1000 / seconds) * seconds * 1000);
export async function rate(
  r: Repository,
  kind: "admin" | "inbound" | "outbound",
  scope: string,
  limit: number,
) {
  const start = windowAt(60);
  const row = await r.db.query(
    `INSERT INTO app.runtime_windows(business_id,kind,scope,window_start,count) VALUES($1,$2,$3,$4,1) ON CONFLICT(business_id,kind,scope,window_start) DO UPDATE SET count=app.runtime_windows.count+1 WHERE app.runtime_windows.count<$5 RETURNING count`,
    [r.tenant, kind, scope, start, limit],
  );
  return row.rowCount === 1;
}
export class RuntimeSafety {
  constructor(
    readonly pool: pg.Pool,
    readonly config: RuntimeConfig["budget"],
  ) {}
  async reserve(
    tenant: string,
    conversation: string,
    input: number,
    output: number,
    tools = 0,
  ) {
    const start = windowAt(this.config.windowSeconds);
    await scoped(this.pool, tenant, async (r) => {
      for (const [scope, cap] of [
        ["tenant", this.config.tenant],
        [conversation, this.config.conversation],
      ] as const) {
        await r.db.query(
          "INSERT INTO app.runtime_windows(business_id,kind,scope,window_start) VALUES($1,'ai',$2,$3) ON CONFLICT DO NOTHING",
          [tenant, scope, start],
        );
        const result = await r.db.query(
          `UPDATE app.runtime_windows SET input_tokens=input_tokens+$4,output_tokens=output_tokens+$5,responses=responses+$6,tools=tools+$7 WHERE business_id=$1 AND kind='ai' AND scope=$2 AND window_start=$3 AND input_tokens+$4<=$8 AND output_tokens+$5<=$9 AND responses+$6<=$10 AND tools+$7<=$11 RETURNING count`,
          [
            tenant,
            scope,
            start,
            input,
            output,
            tools ? 0 : 1,
            tools,
            cap.input,
            cap.output,
            cap.responses,
            cap.tools,
          ],
        );
        if (result.rowCount !== 1)
          throw new ProviderFailure("AI_BUDGET_EXCEEDED");
      }
    });
    return start;
  }
  async settle(
    tenant: string,
    conversation: string,
    start: Date,
    reservedInput: number,
    reservedOutput: number,
    actualInput: number,
    actualOutput: number,
  ) {
    if (
      !Number.isSafeInteger(actualInput) ||
      !Number.isSafeInteger(actualOutput) ||
      actualInput < 0 ||
      actualOutput < 0
    )
      throw new ProviderFailure("AI_INVALID_USAGE");
    await scoped(this.pool, tenant, async (r) => {
      for (const scope of ["tenant", conversation])
        await r.db.query(
          "UPDATE app.runtime_windows SET input_tokens=input_tokens+$4,output_tokens=output_tokens+$5 WHERE business_id=$1 AND kind='ai' AND scope=$2 AND window_start=$3",
          [
            tenant,
            scope,
            start,
            actualInput - reservedInput,
            actualOutput - reservedOutput,
          ],
        );
    });
    if (actualInput > reservedInput || actualOutput > reservedOutput)
      throw new ProviderFailure("AI_USAGE_RESERVATION_EXCEEDED");
  }
  async circuit(
    tenant: string,
    provider: "openai" | "meta",
    outcome?: boolean,
  ) {
    return scoped(this.pool, tenant, async (r) => {
      await r.db.query(
        "INSERT INTO app.provider_circuits(business_id,provider) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [tenant, provider],
      );
      const c = (
        await r.db.query(
          "SELECT * FROM app.provider_circuits WHERE business_id=$1 AND provider=$2 FOR UPDATE",
          [tenant, provider],
        )
      ).rows[0];
      if (outcome === true) {
        await r.db.query(
          "UPDATE app.provider_circuits SET state='closed',failures=0,retry_at=NULL,probe_until=NULL WHERE business_id=$1 AND provider=$2",
          [tenant, provider],
        );
        return true;
      }
      if (outcome === false) {
        await r.db.query(
          "UPDATE app.provider_circuits SET failures=failures+1,state=CASE WHEN failures+1>=3 OR state='half_open' THEN 'open' ELSE 'closed' END,retry_at=clock_timestamp()+interval '60 seconds',probe_until=NULL WHERE business_id=$1 AND provider=$2",
          [tenant, provider],
        );
        return false;
      }
      if (c.state === "closed") return true;
      if (
        (c.state === "open" && c.retry_at > new Date()) ||
        (c.state === "half_open" && c.probe_until > new Date())
      )
        return false;
      await r.db.query(
        "UPDATE app.provider_circuits SET state='half_open',probe_until=clock_timestamp()+interval '45 seconds' WHERE business_id=$1 AND provider=$2",
        [tenant, provider],
      );
      return true;
    });
  }
}
