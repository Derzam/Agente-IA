import type { Repository, Row } from "../infrastructure/repository.js";
import type { Actor } from "./evidence.js";
import type { Operation } from "./catalog.js";
import { fail } from "../domain/rules.js";
/** Dynamic resource permissions are checked again before replay, as well as current DB membership/role. */
export async function authorizeReplay(
  r: Repository,
  actor: Actor,
  op: Operation,
  response: Row,
) {
  if (actor.role !== "operator") return;
  if (op.path.endsWith("/claim") && op.body.assigned_user_id !== actor.id)
    fail("FORBIDDEN", 403);
  if (op.path.endsWith("/resolve")) {
    const h = await r.one("human_handoffs", op.params.handoff_id);
    if (h.assigned_user_id !== actor.id) fail("FORBIDDEN", 403);
  }
  if (op.method === "post" && op.path.endsWith("/messages")) {
    const h = (
      await r.db.query(
        "SELECT assigned_user_id FROM app.human_handoffs WHERE business_id=$1 AND conversation_id=$2 AND status='active'",
        [r.tenant, op.params.conversation_id],
      )
    ).rows[0];
    if (h?.assigned_user_id !== actor.id) fail("FORBIDDEN", 403);
  }
  if (op.path.endsWith("/transitions") && op.body.action === "cancel") {
    const evidence = (
      await r.db.query(
        "SELECT before_redacted FROM app.audit_logs WHERE business_id=$1 AND resource_id=$2 AND request_id=$3 AND action='order.cancel'",
        [r.tenant, op.params.order_id, response.meta.request_id],
      )
    ).rows[0];
    if (
      !["awaiting_confirmation", "confirmed"].includes(
        evidence?.before_redacted?.status,
      )
    )
      fail("FORBIDDEN", 403);
  }
}
