import type pg from "pg";
import type { Role } from "@agente-ia/shared";
import { transaction, userContext } from "../../../platform/database.js";
import { digest } from "../../../platform/idempotency.js";
import { AppError, unavailable } from "../../../platform/errors.js";
import { Repository, type Row } from "../infrastructure/repository.js";
import { fail } from "../domain/rules.js";
import { rate } from "../../../platform/runtime-safety.js";
export interface Result {
  status: number;
  body: unknown;
  replayed?: boolean;
}
export interface Command {
  user: string;
  tenant: string;
  roles: Role[];
  operation: string;
  key?: string;
  request: string;
  input: unknown;
}
export class DomainTransactions {
  constructor(
    readonly pool: pg.Pool,
    private runtimeRateLimit = false,
  ) {}
  async run(
    command: Command,
    execute: (r: Repository, role: Role) => Promise<Result>,
    authorizeReplay?: (
      r: Repository,
      role: Role,
      response: Row,
    ) => Promise<void>,
  ): Promise<Result> {
    try {
      return await transaction(this.pool, async (db) => {
        await userContext(db, command.user, command.tenant);
        // Lock membership so revocation cannot interleave authorization and replay/commit.
        await db.query(
          "SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
          [`membership:${command.tenant}:${command.user}`],
        );
        const m = await db.query(
          "SELECT m.role FROM app.business_memberships m JOIN app.businesses b ON b.id=m.business_id WHERE m.user_id=$1 AND m.business_id=$2 AND m.active AND b.status='active' AND b.deleted_at IS NULL",
          [command.user, command.tenant],
        );
        const role = m.rows[0]?.role as Role | undefined;
        if (!role || !command.roles.includes(role)) fail("FORBIDDEN", 403);
        const r = new Repository(db, command.tenant);
        if (
          this.runtimeRateLimit &&
          !(await rate(r, "admin", command.user, 120))
        )
          fail("RATE_LIMITED", 429);
        if (!command.key) return execute(r, role);
        const actor = `human:${command.user}`,
          key = digest(command.key),
          hash = digest(command.input);
        const lock = digest([
          command.tenant,
          actor,
          command.operation,
          key,
        ]).slice(0, 16);
        const locked = await db.query(
          "SELECT pg_try_advisory_xact_lock($1::bigint) AS ok",
          [BigInt.asIntN(64, BigInt("0x" + lock)).toString()],
        );
        if (!locked.rows[0].ok) fail("REQUEST_IN_PROGRESS");
        let row: Row | undefined = (
          await db.query(
            "SELECT * FROM app.idempotency_keys WHERE business_id=$1 AND actor_scope=$2 AND operation=$3 AND key_hash=$4 FOR UPDATE",
            [command.tenant, actor, command.operation, key],
          )
        ).rows[0];
        if (row && row.expires_at > new Date()) {
          if (row.request_hash !== hash) fail("IDEMPOTENCY_CONFLICT");
          if (row.status === "completed") {
            if (authorizeReplay)
              await authorizeReplay(r, role, row.response_body);
            return {
              status: row.response_status,
              body: row.response_body,
              replayed: true,
            };
          }
          if (row.lease_until > new Date()) fail("REQUEST_IN_PROGRESS");
        }
        if (row)
          row = (
            await db.query(
              "UPDATE app.idempotency_keys SET status='in_progress',request_hash=$2,response_body=NULL,response_status=NULL,response_redacted=NULL,expires_at=now()+interval '1 day',lease_until=now()+interval '30 seconds',fencing_token=fencing_token+1 WHERE id=$1 RETURNING *",
              [row.id, hash],
            )
          ).rows[0];
        else
          row = (
            await db.query(
              "INSERT INTO app.idempotency_keys(business_id,actor_scope,operation,key_hash,request_hash,expires_at,lease_until,fencing_token) VALUES($1,$2,$3,$4,$5,now()+interval '1 day',now()+interval '30 seconds',1) RETURNING *",
              [command.tenant, actor, command.operation, key, hash],
            )
          ).rows[0];
        const result = await execute(r, role);
        const stored = await db.query(
          "UPDATE app.idempotency_keys SET status='completed',response_status=$2,response_body=$3,response_redacted=$4,lease_until=NULL WHERE id=$1 AND fencing_token=$5 AND status='in_progress'",
          [
            row!.id,
            result.status,
            result.body,
            { status: "completed" },
            row!.fencing_token,
          ],
        );
        if (stored.rowCount !== 1) fail("REQUEST_IN_PROGRESS");
        return result;
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      const code = (error as { code?: string }).code;
      if (["23514", "23503", "22023", "22P02", "22003"].includes(code ?? ""))
        fail("VALIDATION_ERROR", 422);
      if (code === "23505") fail("VERSION_CONFLICT");
      if (["40001", "40P01", "55P03", "57014"].includes(code ?? ""))
        fail("REQUEST_IN_PROGRESS");
      if (
        code?.startsWith("08") ||
        [
          "ECONNREFUSED",
          "ECONNRESET",
          "ETIMEDOUT",
          "57P01",
          "57P02",
          "57P03",
        ].includes(code ?? "")
      )
        throw unavailable();
      throw error;
    }
  }
}
