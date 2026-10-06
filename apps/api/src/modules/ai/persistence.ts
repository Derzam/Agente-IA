import { randomUUID } from "node:crypto";
import type pg from "pg";
import { scoped, rate } from "../../platform/runtime-safety.js";
import type { AiPersistence, Turn } from "./ports.js";
import { minimizedText } from "./context.js";
import { ProviderFailure } from "./provider.js";
import { Repository, type Row } from "../domain/infrastructure/repository.js";
import { outbox, audit } from "../domain/application/evidence.js";
import type {
  QuoteTransport,
  CustomerContext,
} from "../domain/application/ordering.js";
import {
  ChallengeCipher,
  challengeBinding,
} from "../../providers/meta/challenge-cipher.js";
// Use the durable ingress timestamp when available; provider clocks are not a handoff boundary.
const inboundAfterHandoff = `NOT EXISTS(
 SELECT 1 FROM app.human_handoffs h
 JOIN app.conversations hc ON hc.business_id=h.business_id AND hc.id=h.conversation_id
 WHERE h.business_id=m.business_id AND hc.customer_id=c.customer_id AND hc.channel_id=c.channel_id
 AND h.resolved_at>=coalesce((SELECT min(w.created_at) FROM app.webhook_events w
  WHERE w.business_id=m.business_id AND w.channel_id=c.channel_id AND w.event_type='message'
  AND w.payload->>'provider_message_id'=m.provider_message_id),m.created_at))`;
export async function disposeHandoffInbound(r: Repository, message: Row, conversation: Row, event: Row) {
  if (!["text", "location"].includes(message.kind)) return;
  const resumed = (await r.db.query(
    "SELECT max(h.resolved_at) resumed_at FROM app.human_handoffs h JOIN app.conversations c ON c.business_id=h.business_id AND c.id=h.conversation_id WHERE h.business_id=$1 AND c.customer_id=$2 AND c.channel_id=$3",
    [r.tenant, conversation.customer_id, conversation.channel_id],
  )).rows[0]?.resumed_at;
  if (conversation.status === "bot_active" && (!resumed || event.created_at > resumed)) return;
  await r.db.query(
    "INSERT INTO app.conversation_turns(business_id,conversation_id,inbound_message_id,automation_epoch,status,completed_at,error_code) VALUES($1,$2,$3,$4,'failed',clock_timestamp(),'AI_INBOUND_HANDOFF') ON CONFLICT(business_id,inbound_message_id) DO NOTHING",
    [r.tenant, conversation.id, message.id, conversation.automation_epoch],
  );
}
async function enqueue(
  r: Repository,
  ctx: CustomerContext,
  text: string,
  key: string,
  challenge?: string,
) {
  const c = await r.one("conversations", ctx.conversation, true);
  if (
    c.status !== "bot_active" ||
    Number(c.automation_epoch) !== ctx.automationEpoch
  )
    throw new ProviderFailure("AI_EPOCH_CHANGED");
  const previous = (
    await r.db.query(
      "SELECT dedupe_key,status FROM app.outbox_events WHERE business_id=$1 AND (dedupe_key=$2 OR dedupe_key LIKE $3) ORDER BY created_at DESC FOR UPDATE",
      [r.tenant, key, `${key}:retry:%`],
    )
  ).rows;
  // Pending, sending, unknown and sent rows already represent a viable or
  // ambiguous transport attempt. Only a definitive terminal failure permits
  // a new message, and that attempt gets its own durable dedupe key.
  if (previous.some((row) => row.status !== "dead_letter")) return;
  const outboxKey = previous.length
    ? `${key}:retry:${randomUUID()}`
    : key;
  const id = randomUUID(),
    box = randomUUID();
  await r.db.query(
    "INSERT INTO app.outbox_events(id,business_id,conversation_id,event_type,aggregate_id,aggregate_version,causation_id,dedupe_key,payload,automation_epoch) VALUES($1,$2,$3,'whatsapp.message',$4,1,$5,$6,$7,$8)",
    [
      box,
      r.tenant,
      c.id,
      id,
      id,
      outboxKey,
      { resource_id: id, resource_version: 1, text },
      c.automation_epoch,
    ],
  );
  const message = await r.insert("messages", {
    id,
    conversation_id: c.id,
    direction: "outbound",
    kind: "text",
    content: { text },
    actor_type: "bot",
    delivery_status: "pending",
    outbox_id: box,
    ...(challenge ? { confirmation_challenge_id: challenge } : {}),
  });
  await audit(
    r,
    { id: null, type: "system" },
    id,
    "message.enqueue",
    "message",
    message,
  );
}
export class EncryptedQuoteTransport implements QuoteTransport {
  constructor(private cipher: ChallengeCipher) {}
  seal(ctx: CustomerContext, order: Row, c: Row, button: string) {
    return this.cipher.seal(
      challengeBinding(
        ctx.tenant,
        ctx.conversation,
        ctx.customer,
        order.id,
        order.version,
        c.id,
      ),
      button,
    );
  }
  async enqueue(r: Repository, ctx: CustomerContext, order: Row, c: Row) {
    if (
      order.status !== "awaiting_confirmation" ||
      c.consumed_at ||
      c.expires_at <= new Date()
    )
      throw new ProviderFailure("CHALLENGE_EXPIRED");
    const text = `Cotización ${order.id}\nSubtotal: ${order.currency} ${(Number(order.subtotal_minor) / 100).toFixed(2)}\nImpuesto: ${order.currency} ${(Number(order.tax_minor) / 100).toFixed(2)}\nEntrega: ${order.currency} ${(Number(order.delivery_minor) / 100).toFixed(2)}\nTotal: ${order.currency} ${(Number(order.total_minor) / 100).toFixed(2)}\nConfirma únicamente con el botón antes de ${c.expires_at.toISOString()}. Pago contra entrega pendiente.`;
    await enqueue(r, ctx, text, `quote:${order.id}:${order.version}`, c.id);
  }
}
export class PostgresAiPersistence implements AiPersistence {
  constructor(readonly pool: pg.Pool) {}
  async start(
    tenant: string,
    inbound: string,
    model: string,
  ): Promise<Turn | null> {
    return scoped(this.pool, tenant, async (r) => {
      const m = await r.one("messages", inbound);
      if (m.direction !== "inbound" || !["text", "location"].includes(m.kind))
        return null;
      const c = await r.one("conversations", m.conversation_id, true);
      if (
        c.status !== "bot_active" ||
        c.expires_at <= new Date() ||
        !(await r.one("business_settings", tenant)).ai_enabled
      )
        return null;
      if (!(await r.db.query(
        `SELECT 1 FROM app.messages m JOIN app.conversations c ON c.business_id=m.business_id AND c.id=m.conversation_id WHERE m.business_id=$1 AND m.id=$2 AND ${inboundAfterHandoff}`,
        [tenant, inbound],
      )).rowCount) return null;
      if (
        (
          await r.db.query(
            "SELECT 1 FROM app.conversation_turns WHERE business_id=$1 AND inbound_message_id=$2",
            [tenant, inbound],
          )
        ).rowCount
      )
        return null;
      await r.db.query(
        "UPDATE app.conversation_turns SET status='failed',error_code='AI_TURN_INTERRUPTED',completed_at=clock_timestamp(),lease_until=NULL WHERE business_id=$1 AND conversation_id=$2 AND status IN ('pending','planned') AND lease_until<=clock_timestamp()",
        [tenant, c.id],
      );
      if (
        (
          await r.db.query(
            "SELECT 1 FROM app.conversation_turns WHERE business_id=$1 AND conversation_id=$2 AND status IN ('pending','planned')",
            [tenant, c.id],
          )
        ).rowCount
      )
        return null;
      const row = await r.insert("conversation_turns", {
        conversation_id: c.id,
        inbound_message_id: inbound,
        automation_epoch: c.automation_epoch,
        provider: "openai",
        model,
        started_at: new Date(),
        lease_until: new Date(Date.now() + 120000),
        fencing_token: 1,
        plan: { actions: [] },
        runtime_plan: { actions: [] },
      });
      const prior = (
        await r.db.query(
          "SELECT content->>'text' AS text FROM app.messages WHERE business_id=$1 AND conversation_id=$2 AND direction='outbound' AND actor_type='bot' AND kind='text' AND created_at<$3 ORDER BY created_at DESC,id DESC LIMIT 1",
          [tenant, c.id, m.created_at],
        )
      ).rows[0]?.text;
      return {
        id: row.id,
        inbound,
        kind: m.kind,
        ...(prior ? { prior: minimizedText(prior).slice(0, 1800) } : {}),
        text:
          m.kind === "location"
            ? "Ubicación de entrega enviada por el cliente: " +
              JSON.stringify({
                latitude: m.content.latitude,
                longitude: m.content.longitude,
              })
            : minimizedText(m.content?.text ?? ""),
        ctx: {
          tenant,
          conversation: c.id,
          customer: c.customer_id,
          automationEpoch: Number(c.automation_epoch),
          turnId: row.id,
        },
      };
    });
  }
  async check(t: Turn) {
    return scoped(this.pool, t.ctx.tenant, async (r) => {
      const c = await r.one("conversations", t.ctx.conversation);
      const row = (
        await r.db.query(
          "SELECT lease_until,error_code FROM app.conversation_turns WHERE business_id=$1 AND id=$2",
          [r.tenant, t.id],
        )
      ).rows[0];
      return (
        c.status === "bot_active" &&
        Number(c.automation_epoch) === t.ctx.automationEpoch &&
        (await r.one("business_settings", r.tenant)).ai_enabled &&
        (!row?.lease_until || row.lease_until > new Date()) &&
        row?.error_code !== "AI_TURN_INTERRUPTED"
      );
    });
  }
  async attempt(t: Turn) {
    await scoped(this.pool, t.ctx.tenant, async (r) => {
      const updated = await r.db.query(
        "UPDATE app.conversation_turns SET responses=responses+1 WHERE business_id=$1 AND id=$2 AND status='pending' AND lease_until>clock_timestamp() RETURNING id",
        [r.tenant, t.id],
      );
      if (updated.rowCount !== 1)
        throw new ProviderFailure("AI_TURN_INTERRUPTED");
    });
  }
  async usage(t: Turn, input: number, output: number) {
    await scoped(this.pool, t.ctx.tenant, async (r) => {
      await r.db.query(
        "UPDATE app.conversation_turns SET input_tokens=input_tokens+$3,output_tokens=output_tokens+$4,lease_until=clock_timestamp()+interval '120 seconds' WHERE business_id=$1 AND id=$2 AND status='pending' AND lease_until>clock_timestamp()",
        [r.tenant, t.id, input, output],
      );
    });
  }
  async toolStart(t: Turn, sequence: number, name: string, hash: string) {
    return scoped(this.pool, t.ctx.tenant, async (r) => {
      const c = await r.one("conversations", t.ctx.conversation, true);
      if (
        c.status !== "bot_active" ||
        Number(c.automation_epoch) !== t.ctx.automationEpoch
      )
        throw new ProviderFailure("AI_EPOCH_CHANGED");
      const appended = await r.db.query(
        "UPDATE app.conversation_turns SET runtime_plan=jsonb_set(runtime_plan,'{actions}',(runtime_plan->'actions')||$3::jsonb),tool_calls=tool_calls+1 WHERE business_id=$1 AND id=$2 AND status='pending' AND lease_until>clock_timestamp() RETURNING id",
        [
          r.tenant,
          t.id,
          JSON.stringify([{ tool_name: name, arguments_hash: hash }]),
        ],
      );
      if (appended.rowCount !== 1)
        throw new ProviderFailure("AI_TURN_INTERRUPTED");
      const row = await r.insert("tool_executions", {
        turn_id: t.id,
        action_index: sequence,
        tool_name: name,
        arguments_hash: hash,
        arguments_redacted: { tool_name: name, arguments_hash: hash },
      });
      return row.id;
    });
  }
  async toolFinish(
    t: Turn,
    id: string,
    duration: number,
    code?: string,
    resource?: string,
  ) {
    await scoped(this.pool, t.ctx.tenant, async (r) => {
      await r.db.query(
        "UPDATE app.tool_executions SET status=$3,duration_ms=$4,error_code=$5,result_redacted=$6 WHERE business_id=$1 AND id=$2",
        [
          r.tenant,
          id,
          code ? "failed" : "completed",
          duration,
          code ?? null,
          {
            ...(code ? { code } : {}),
            ...(resource ? { resource_id: resource } : {}),
          },
        ],
      );
    });
  }
  async outbound(t: Turn, text: string) {
    await scoped(this.pool, t.ctx.tenant, (r) =>
      enqueue(r, t.ctx, text, `ai:${t.id}`),
    );
  }
  async finish(t: Turn, code?: string) {
    await scoped(this.pool, t.ctx.tenant, async (r) => {
      await r.db.query(
        "UPDATE app.conversation_turns SET status=$3,error_code=$4,completed_at=clock_timestamp(),lease_until=NULL WHERE business_id=$1 AND id=$2 AND status='pending'",
        [r.tenant, t.id, code ? "failed" : "completed", code ?? null],
      );
    });
  }
  async confirmedWithin(
    r: Repository,
    ctx: CustomerContext,
    order: Row,
    inbound: string,
  ) {
    const c = await r.one("conversations", ctx.conversation, true);
    if (
      c.status !== "bot_active" ||
      !(await r.one("business_settings", r.tenant)).ai_enabled
    )
      return;
    await enqueue(
      r,
      { ...ctx, automationEpoch: Number(c.automation_epoch) },
      "Pedido " +
        order.id +
        " confirmado mediante tu selección interactiva. El pago continúa pendiente.",
      "confirmed:" + inbound,
    );
  }
  async pending(tenant: string) {
    return scoped(
      this.pool,
      tenant,
      async (r) =>
        (
          await r.db.query(
            `SELECT m.id FROM app.messages m JOIN app.conversations c ON c.business_id=m.business_id AND c.id=m.conversation_id JOIN app.business_settings s ON s.business_id=m.business_id WHERE m.business_id=$1 AND m.direction='inbound' AND m.kind IN ('text','location') AND c.status='bot_active' AND c.expires_at>clock_timestamp() AND s.ai_enabled AND ${inboundAfterHandoff} AND NOT EXISTS(SELECT 1 FROM app.conversation_turns t WHERE t.business_id=m.business_id AND t.inbound_message_id=m.id) AND NOT EXISTS(SELECT 1 FROM app.conversation_turns t WHERE t.business_id=m.business_id AND t.conversation_id=c.id AND t.status IN ('pending','planned') AND (t.lease_until IS NULL OR t.lease_until>clock_timestamp())) ORDER BY m.created_at,m.id LIMIT 1`,
            [tenant],
          )
        ).rows[0]?.id as string | undefined,
    );
  }
}
