import type pg from "pg";
import type { RuntimeConfig } from "../../config/runtime.js";
import { scoped, rate, RuntimeSafety } from "../../platform/runtime-safety.js";
import { ChallengeCipher, challengeBinding } from "./challenge-cipher.js";
import type { MetaProvider, MetaResult, MetaSend } from "./provider.js";
import type {
  Repository,
  Row,
} from "../../modules/domain/infrastructure/repository.js";
import { audit, outbox } from "../../modules/domain/application/evidence.js";
async function deliveryEvidence(
  r: Repository,
  before: Row,
  changed: Row,
  request: string,
) {
  if (before.delivery_status === changed.delivery_status) return;
  await audit(
    r,
    { id: null, type: "system" },
    request,
    "message.delivery_status",
    "message",
    { ...changed, status: changed.delivery_status },
    { ...before, status: before.delivery_status },
  );
  await outbox(
    r, "message.delivery_updated", changed, request, changed.conversation_id,
  );
}
async function transportDelivery(
  r: Repository,
  outboxId: string,
  status: string,
  from: string[],
  providerId?: string,
) {
  const before = (
    await r.db.query(
      "SELECT * FROM app.messages WHERE business_id=$1 AND outbox_id=$2 FOR UPDATE",
      [r.tenant, outboxId],
    )
  ).rows[0];
  if (!before || !from.includes(before.delivery_status)) return;
  if (
    before.delivery_status === status &&
    (!providerId || before.provider_message_id === providerId)
  ) return;
  const changed = await r.update("messages", before.id, {
    delivery_status: status,
    ...(providerId ? { provider_message_id: providerId } : {}),
  });
  await deliveryEvidence(r, before, changed, outboxId);
}
export class MetaDispatcher {
  constructor(
    private pool: pg.Pool,
    private provider: MetaProvider,
    private cipher: ChallengeCipher,
    private config: RuntimeConfig,
    private safety: RuntimeSafety,
  ) {}
  async tick(tenant: string) {
    if (!this.config.metaEnabled) return false;
    if (!(await this.safety.circuit(tenant, "meta"))) return false;
    const work = await scoped(this.pool, tenant, async (r) => {
      // A durable send intent may have reached Meta. Recover it as unknown, never resend.
      const expired = await r.db.query(
        "UPDATE app.outbox_events SET status='unknown',lease_until=NULL,last_error_code='META_INTERRUPTED' WHERE business_id=$1 AND event_type='whatsapp.message' AND status='sending' AND lease_until<=clock_timestamp() AND transport_started_at IS NOT NULL RETURNING id",
        [tenant],
      );
      for (const row of expired.rows)
        await transportDelivery(r, row.id, "unknown", ["pending"]);
      const o = (
        await r.db.query(
          "SELECT * FROM app.outbox_events WHERE business_id=$1 AND event_type='whatsapp.message' AND (status='pending' OR (status='sending' AND transport_started_at IS NULL AND lease_until<=clock_timestamp())) AND next_attempt_at<=clock_timestamp() ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
          [tenant],
        )
      ).rows[0];
      if (!o) return null;
      const m = (
        await r.db.query(
          "SELECT * FROM app.messages WHERE business_id=$1 AND outbox_id=$2",
          [tenant, o.id],
        )
      ).rows[0];
      if (!m) {
        await r.db.query(
          "UPDATE app.outbox_events SET status='dead_letter',lease_until=NULL,last_error_code='META_MESSAGE_MISSING' WHERE id=$1",
          [o.id],
        );
        return null;
      }
      const c = await r.one("conversations", o.conversation_id, true),
        customer = await r.one("customers", c.customer_id),
        channel = (
          await r.db.query(
            "SELECT phone_number_id,enabled FROM app.whatsapp_channels WHERE business_id=$1 AND id=$2",
            [tenant, c.channel_id],
          )
        ).rows[0];
      let error: string | undefined;
      if (
        Number(o.automation_epoch) !== Number(c.automation_epoch) ||
        c.status ===
          (m.actor_type === "human" ? "bot_active" : "human_active") ||
        c.status === "closed" ||
        c.status === "human_pending"
      )
        error = "META_EPOCH_CHANGED";
      if (
        m.actor_type === "bot" &&
        (!this.config.aiEnabled ||
          !(await r.one("business_settings", tenant)).ai_enabled ||
          c.status !== "bot_active")
      )
        error = "META_AUTOMATION_DISABLED";
      if (m.actor_type === "human" && c.status !== "human_active")
        error = "META_HANDOFF_REQUIRED";
      if (
        !c.last_customer_message_at ||
        Date.now() - c.last_customer_message_at.getTime() >= 86400000 ||
        c.last_customer_message_at > new Date()
      )
        error = "META_WINDOW_CLOSED";
      if (
        !channel?.enabled ||
        channel.phone_number_id !== this.config.meta.phone ||
        !this.config.meta.recipients.includes(customer.channel_user_id)
      )
        error = "META_SANDBOX_NOT_AUTHORIZED";
      let button: string | undefined;
      if (m.confirmation_challenge_id) {
        const challenge = await r.one(
            "confirmation_challenges",
            m.confirmation_challenge_id,
          ),
          order = await r.one("orders", challenge.order_id),
          cart = await r.one("carts", order.source_cart_id, true);
        const now = new Date();
        if (
          challenge.customer_id !== c.customer_id ||
          challenge.conversation_id !== c.id ||
          challenge.consumed_at ||
          challenge.expires_at <= now ||
          order.status !== "awaiting_confirmation" ||
          order.version !== challenge.order_version
        )
          error = "META_CHALLENGE_EXPIRED";
        else if (
          order.quote_expires_at <= now ||
          cart.status !== "active" ||
          cart.expires_at <= now ||
          order.source_cart_version !== cart.version
        )
          error = "META_QUOTE_STALE";
        else
          try {
            button = this.cipher.open(
              challengeBinding(
                tenant,
                c.id,
                c.customer_id,
                order.id,
                order.version,
                challenge.id,
              ),
              challenge.transport_cipher,
            );
          } catch {
            error = "META_CHALLENGE_INVALID";
          }
      }
      if (error || o.attempts >= 5) {
        await r.db.query(
          "UPDATE app.outbox_events SET status='dead_letter',lease_until=NULL,last_error_code=$2 WHERE id=$1",
          [o.id, error ?? "META_ATTEMPTS_EXCEEDED"],
        );
        await transportDelivery(r, o.id, "failed", ["pending"]);
        return null;
      }
      // Reserve both scopes atomically; a blocked customer must not spend tenant quota.
      await r.db.query("SAVEPOINT meta_rate");
      const rateError = !(await rate(r, "outbound", "tenant", 60))
        ? "META_TENANT_RATE_LIMITED"
        : !(await rate(r, "outbound", c.customer_id, 10))
          ? "META_CUSTOMER_RATE_LIMITED"
          : undefined;
      if (rateError) {
        await r.db.query("ROLLBACK TO SAVEPOINT meta_rate");
        await r.db.query("RELEASE SAVEPOINT meta_rate");
        await r.db.query(
          "UPDATE app.outbox_events SET next_attempt_at=date_trunc('minute',clock_timestamp())+interval '1 minute',last_error_code=$2 WHERE id=$1",
          [o.id, rateError],
        );
        return null;
      }
      await r.db.query("RELEASE SAVEPOINT meta_rate");
      const claimed = (
        await r.db.query(
          "UPDATE app.outbox_events SET status='sending',attempts=attempts+1,fencing_token=fencing_token+1,lease_until=clock_timestamp()+interval '45 seconds',transport_started_at=clock_timestamp(),last_error_code=NULL WHERE id=$1 RETURNING fencing_token",
          [o.id],
        )
      ).rows[0];
      return {
        id: o.id,
        token: claimed.fencing_token,
        payload: {
          recipient: customer.channel_user_id,
          text: m.content.text,
          callback: o.id,
          ...(button ? { button } : {}),
        } as MetaSend,
      };
    });
    if (!work) return false;
    let result: MetaResult;
    try {
      result = await this.provider.send(work.payload);
    } catch {
      result = { kind: "unknown", code: "META_AMBIGUOUS" };
    }
    await this.safety.circuit(tenant, "meta", result.kind === "accepted");
    await scoped(this.pool, tenant, async (r) => {
      const o = (
        await r.db.query(
          "SELECT * FROM app.outbox_events WHERE business_id=$1 AND id=$2 FOR UPDATE",
          [tenant, work.id],
        )
      ).rows[0];
      if (o.fencing_token !== work.token) return;
      if (o.status === "sent") {
        if (result.kind === "accepted" && o.provider_message_id !== result.id)
          throw Error("META_PROVIDER_ID_CONFLICT");
        return;
      }
      if (!["sending", "unknown"].includes(o.status)) return;
      if (result.kind === "accepted") {
        if (o.provider_message_id && o.provider_message_id !== result.id)
          throw Error("META_PROVIDER_ID_CONFLICT");
        await r.db.query(
          "SELECT set_config('app.meta_reconcile','verified',true)",
        );
        await r.db.query(
          "UPDATE app.outbox_events SET status='sent',provider_message_id=$3,accepted_at=coalesce(accepted_at,clock_timestamp()),delivery_status=coalesce(delivery_status,'sent'),lease_until=NULL,last_error_code=NULL WHERE business_id=$1 AND id=$2",
          [tenant, work.id, result.id],
        );
        await transportDelivery(
          r, work.id, "sent", ["pending", "unknown"], result.id,
        );
      } else {
        const status =
          result.kind === "unknown"
            ? "unknown"
            : result.kind === "retry" && o.attempts < 5
              ? "pending"
              : "dead_letter";
        await r.db.query(
          "UPDATE app.outbox_events SET status=$3,lease_until=NULL,last_error_code=$4,next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,power(2,attempts)::integer)),transport_started_at=CASE WHEN $3='pending' THEN NULL ELSE transport_started_at END WHERE business_id=$1 AND id=$2",
          [tenant, work.id, status, result.code],
        );
        await transportDelivery(
          r,
          work.id,
          status === "unknown"
            ? "unknown"
            : status === "dead_letter"
              ? "failed"
              : "pending",
          ["pending", "unknown"],
        );
      }
    });
    return true;
  }
}
const ranks: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
export async function reconcileStatus(
  r: Repository,
  event: Row,
): Promise<boolean> {
  const p = event.payload,
    status = p.content?.status;
  if (!p.provider_message_id || (!ranks[status] && status !== "failed"))
    return true;
  if (typeof p.provider_timestamp !== "string" || !Number.isFinite(Date.parse(p.provider_timestamp)))
    return true;
  const callback =
    typeof p.content?.callback === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      p.content.callback,
    )
      ? p.content.callback
      : undefined;
  let m = (
    await r.db.query(
      "SELECT m.* FROM app.messages m JOIN app.conversations c ON c.business_id=m.business_id AND c.id=m.conversation_id WHERE m.business_id=$1 AND c.channel_id=$2 AND m.direction='outbound' AND (m.provider_message_id=$3 OR ($4::uuid IS NOT NULL AND m.outbox_id=$4))",
      [r.tenant, event.channel_id, p.provider_message_id, callback ?? null],
    )
  ).rows[0];
  if (!m) return true;
  const o = (
    await r.db.query(
      "SELECT * FROM app.outbox_events WHERE business_id=$1 AND id=$2 FOR UPDATE",
      [r.tenant, m.outbox_id],
    )
  ).rows[0];
  m = (
    await r.db.query(
      "SELECT * FROM app.messages WHERE business_id=$1 AND id=$2 FOR UPDATE",
      [r.tenant, m.id],
    )
  ).rows[0];
  if (!o.transport_started_at && !o.provider_message_id) return true;
  if (
    o.provider_status_at &&
    new Date(p.provider_timestamp) < o.provider_status_at
  )
    return true;
  if (o.provider_message_id && o.provider_message_id !== p.provider_message_id)
    return true;
  if (status === m.delivery_status) {
    // Refresh only the watermark: repeated states must not create versions/events.
    await r.db.query(
      "UPDATE app.outbox_events SET provider_status_at=$3 WHERE business_id=$1 AND id=$2 AND (provider_status_at IS NULL OR provider_status_at<$3)",
      [r.tenant, o.id, p.provider_timestamp],
    );
    return true;
  }
  if (
    (status === "failed" &&
      ["delivered", "read"].includes(m.delivery_status)) ||
    (ranks[status] && (ranks[status] ?? 0) <= (ranks[m.delivery_status] ?? 0))
  )
    return true;
  const changed = (
    await r.db.query(
      "UPDATE app.messages SET provider_message_id=$3,delivery_status=$4,provider_timestamp=$5 WHERE business_id=$1 AND id=$2 RETURNING *",
      [r.tenant, m.id, p.provider_message_id, status, p.provider_timestamp],
    )
  ).rows[0];
  await r.db.query("SELECT set_config('app.meta_reconcile','verified',true)");
  await r.db.query(
    "UPDATE app.outbox_events SET status='sent',provider_message_id=$3,delivery_status=$4,provider_status_at=$5,accepted_at=coalesce(accepted_at,clock_timestamp()),lease_until=NULL,last_error_code=CASE WHEN $4='failed' THEN 'META_DELIVERY_FAILED' ELSE NULL END WHERE business_id=$1 AND id=$2",
    [r.tenant, o.id, p.provider_message_id, status, p.provider_timestamp],
  );
  await deliveryEvidence(r, m, changed, event.id);
  return true;
}
