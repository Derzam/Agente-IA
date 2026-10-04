import { randomUUID } from "node:crypto";
import type { Repository, Row } from "../infrastructure/repository.js";
import { minor } from "../domain/rules.js";
export interface Actor {
  id: string | null;
  type: "human" | "customer" | "system";
  role?: "owner" | "manager" | "operator";
}
export async function audit(
  r: Repository,
  actor: Actor,
  request: string,
  action: string,
  type: string,
  row: Row,
  before?: Row,
) {
  const redact = (v?: Row) => {
    if (!v) return null;
    const moneyField = [
      "total_minor",
      "price_minor",
      "price_delta_minor",
      "fee_minor",
      "amount_minor",
    ].find((k) => v[k] !== undefined);
    return {
      resource_id: v.id ?? v.business_id,
      version: v.version,
      ...(v.status ? { status: v.status } : {}),
      ...(moneyField
        ? {
            total_minor: minor(v[moneyField]),
            action: moneyField,
            ...(v.currency ? { currency: v.currency } : {}),
          }
        : {}),
    };
  };
  await r.db.query(
    "INSERT INTO app.audit_logs(business_id,actor_type,actor_id,action,resource_type,resource_id,request_id,before_redacted,after_redacted) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      r.tenant,
      actor.type,
      actor.id,
      action,
      type,
      row.id ?? row.business_id,
      request,
      redact(before),
      redact(row),
    ],
  );
}
export async function outbox(
  r: Repository,
  event: string,
  row: Row,
  request: string,
  conversation?: string,
  text?: string,
): Promise<string> {
  const id = randomUUID(),
    key = `${event}:${row.id}:${row.version}`;
  const inserted = await r.db.query(
    "INSERT INTO app.outbox_events(id,business_id,conversation_id,event_type,aggregate_id,aggregate_version,causation_id,dedupe_key,payload,automation_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(business_id,dedupe_key) DO NOTHING RETURNING id",
    [
      id,
      r.tenant,
      conversation ?? null,
      event,
      row.id,
      row.version,
      request,
      key,
      {
        resource_id: row.id,
        resource_version: row.version,
        ...(text ? { text } : {}),
      },
      row.automation_epoch ?? null,
    ],
  );
  return (
    inserted.rows[0]?.id ??
    (
      await r.db.query(
        "SELECT id FROM app.outbox_events WHERE business_id=$1 AND dedupe_key=$2",
        [r.tenant, key],
      )
    ).rows[0].id
  );
}
export async function transitionEvidence(
  r: Repository,
  actor: Actor,
  request: string,
  before: Row,
  after: Row,
  action: string,
) {
  await r.db.query(
    "INSERT INTO app.order_transitions(business_id,order_id,from_status,to_status,actor_type,actor_id,trigger,causation_id,resulting_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      r.tenant,
      after.id,
      before.status,
      after.status,
      actor.type,
      actor.id,
      action,
      request,
      after.version,
    ],
  );
  await audit(r, actor, request, `order.${action}`, "order", after, before);
  await outbox(
    r,
    "order.status_changed",
    after,
    request,
    after.conversation_id,
  );
}
