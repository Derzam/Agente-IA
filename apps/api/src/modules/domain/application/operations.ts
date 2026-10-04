import { randomUUID } from "node:crypto";
import type { Repository, Row } from "../infrastructure/repository.js";
import { cas, fail, minor, nextOrder } from "../domain/rules.js";
import { audit, outbox, transitionEvidence, type Actor } from "./evidence.js";
import { page, type Operation } from "./catalog.js";
export class OperationsService {
  async execute(r: Repository, actor: Actor, op: Operation) {
    if (op.path.endsWith("/metrics")) return this.metrics(r, op);
    if (op.method === "get") return this.read(r, op);
    if (op.path.endsWith("/transitions")) {
      const lookup = await r.one("orders", op.params.order_id);
      await r.one("conversations", lookup.conversation_id, true);
      const before = await r.one("orders", op.params.order_id, true);
      cas(before, op.body.expected_version);
      const status = nextOrder(
        before.status,
        before.fulfillment,
        op.body.action,
        actor.role!,
        op.body.reason,
      );
      await r.db.query("SELECT set_config('app.order_action',$1,true)", [
        op.body.action,
      ]);
      const row = await r.update("orders", before.id, {
        status,
        cancellation_reason: status === "cancelled" ? op.body.reason : null,
        updated_by: actor.id,
      });
      await transitionEvidence(
        r,
        actor,
        op.request,
        before,
        row,
        op.body.action,
      );
      if (status === "cancelled") {
        await r.db.query(
          "SELECT set_config('app.payment_action','cancel',true)",
        );
        const cancelled = await r.db.query(
          "UPDATE app.payments SET status='cancelled',updated_by=$3 WHERE business_id=$1 AND order_id=$2 AND status='pending' RETURNING *",
          [r.tenant, row.id, actor.id],
        );
        for (const payment of cancelled.rows)
          await audit(
            r,
            actor,
            op.request,
            "payment.cancel",
            "payment",
            payment,
            {
              ...payment,
              status: "pending",
              version: Number(payment.version) - 1,
            },
          );
      }
      return this.response(r, "Order", row, op);
    }
    if (op.path.endsWith("/cash-record")) {
      const order = await r.one("orders", op.params.order_id, true);
      const payment = (
        await r.db.query(
          "SELECT * FROM app.payments WHERE business_id=$1 AND order_id=$2 AND method='cash_on_delivery' FOR UPDATE",
          [r.tenant, order.id],
        )
      ).rows[0];
      if (!payment) fail("NOT_FOUND", 404);
      cas(payment, op.body.expected_version);
      if (
        payment.status !== "pending" ||
        ["awaiting_confirmation", "cancelled"].includes(order.status)
      )
        fail("INVALID_ORDER_TRANSITION");
      if (Date.parse(op.body.paid_at) > Date.now() || !op.body.note.trim())
        fail("VALIDATION_ERROR", 422);
      await r.db.query(
        "SELECT set_config('app.payment_action','cash_record',true)",
      );
      const row = await r.update("payments", payment.id, {
        status: "paid",
        paid_at: op.body.paid_at,
        note: op.body.note,
        recorded_by: actor.id,
        updated_by: actor.id,
      });
      await audit(
        r,
        actor,
        op.request,
        "payment.cash_record",
        "payment",
        row,
        payment,
      );
      return this.response(r, "Payment", row, op);
    }
    if (op.path.endsWith("/messages")) return this.message(r, actor, op);
    if (op.path.endsWith("/handoffs")) return this.createHandoff(r, actor, op);
    return this.handoffAction(r, actor, op);
  }
  private response(
    r: Repository,
    name: string,
    row: Row,
    op: Operation,
    status = 200,
  ) {
    return r.dto(name, row).then((data) => ({
      status,
      body: { data, meta: { request_id: op.request } },
    }));
  }
  private async read(r: Repository, op: Operation) {
    const parts = op.path.split("/");
    const name = parts[4]!;
    const mapping = {
      orders: ["orders", "Order", "order_id"],
      customers: ["customers", "Customer", "customer_id"],
      conversations: ["conversations", "Conversation", "conversation_id"],
      handoffs: ["human_handoffs", "HumanHandoff", "handoff_id"],
    } as const;
    const spec = mapping[name as keyof typeof mapping];
    if (!spec) throw Error("Unmapped operation");
    if (parts.at(-1) === "payments") {
      await r.one("orders", op.params.order_id);
      return page(r, "payments", "Payment", op.query, op.request, {
        order_id: op.params.order_id,
      });
    }
    if (parts.at(-1) === "messages") {
      await r.one("conversations", op.params.conversation_id);
      return page(r, "messages", "Message", op.query, op.request, {
        conversation_id: op.params.conversation_id,
      });
    }
    if (op.params[spec[2]])
      return this.response(
        r,
        spec[1],
        await r.one(spec[0], op.params[spec[2]]),
        op,
      );
    const filters: Row = {};
    for (const k of ["status", "customer_id"])
      if (op.query[k] !== undefined) filters[k] = op.query[k];
    return page(r, spec[0], spec[1], op.query, op.request, filters);
  }
  async createHandoff(r: Repository, actor: Actor, op: Operation) {
    const before = await r.one(
      "conversations",
      op.params.conversation_id,
      true,
    );
    const existing = (
      await r.db.query(
        "SELECT * FROM app.human_handoffs WHERE business_id=$1 AND conversation_id=$2 AND status IN ('pending','active')",
        [r.tenant, before.id],
      )
    ).rows[0];
    if (existing) return this.response(r, "HumanHandoff", existing, op, 200);
    cas(before, op.body.expected_conversation_version);
    if (before.status === "closed") fail("HANDOFF_REQUIRED");
    const row = await r.insert("human_handoffs", {
      conversation_id: before.id,
      reason: op.body.reason,
      created_by: actor.type === "human" ? actor.id : null,
    });
    const c = await r.update("conversations", before.id, {
      status: "human_pending",
      automation_epoch: minor(BigInt(before.automation_epoch) + 1n),
      updated_by: actor.type === "human" ? actor.id : null,
    });
    await audit(r, actor, op.request, "handoff.create", "handoff", row);
    await audit(
      r,
      actor,
      op.request,
      "conversation.pause",
      "conversation",
      c,
      before,
    );
    await outbox(r, "handoff.created", row, op.request, before.id);
    return this.response(r, "HumanHandoff", row, op, 201);
  }
  private async handoffAction(r: Repository, actor: Actor, op: Operation) {
    const lookup = await r.one("human_handoffs", op.params.handoff_id);
    const beforeConversation = await r.one(
      "conversations",
      lookup.conversation_id,
      true,
    );
    const before = await r.one("human_handoffs", lookup.id, true);
    cas(before, op.body.expected_version);
    if (op.path.endsWith("/claim")) {
      if (before.status !== "pending") fail("HANDOFF_REQUIRED");
      if (actor.role === "operator" && op.body.assigned_user_id !== actor.id)
        fail("FORBIDDEN", 403);
      await r.db.query(
        "SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
        [`membership:${r.tenant}:${op.body.assigned_user_id}`],
      );
      const member = await r.db.query(
        "SELECT 1 FROM app.handoff_assignees WHERE business_id=$1 AND user_id=$2 AND active",
        [r.tenant, op.body.assigned_user_id],
      );
      if (!member.rowCount) fail("VALIDATION_ERROR", 422);
      const row = await r.update("human_handoffs", before.id, {
        status: "active",
        assigned_user_id: op.body.assigned_user_id,
        updated_by: actor.id,
      });
      const c = await r.update("conversations", before.conversation_id, {
        status: "human_active",
        updated_by: actor.id,
      });
      await audit(
        r,
        actor,
        op.request,
        "handoff.claim",
        "handoff",
        row,
        before,
      );
      await outbox(r, "conversation.updated", c, op.request, c.id);
      return this.response(r, "HumanHandoff", row, op);
    }
    if (before.status !== "active") fail("HANDOFF_REQUIRED");
    if (actor.role === "operator" && before.assigned_user_id !== actor.id)
      fail("FORBIDDEN", 403);
    if (!op.body.resolution.trim()) fail("VALIDATION_ERROR", 422);
    const row = await r.update("human_handoffs", before.id, {
      status: "resolved",
      resolved_at: new Date(),
      resolution: op.body.resolution,
      updated_by: actor.id,
    });
    const c = await r.update("conversations", before.conversation_id, {
      status: op.body.action === "close" ? "closed" : "bot_active",
      automation_epoch: minor(BigInt(beforeConversation.automation_epoch) + 1n),
      updated_by: actor.id,
    });
    await audit(
      r,
      actor,
      op.request,
      "handoff.resolve",
      "handoff",
      row,
      before,
    );
    await audit(
      r,
      actor,
      op.request,
      "conversation.resolve",
      "conversation",
      c,
      beforeConversation,
    );
    await outbox(r, "handoff.resolved", row, op.request, c.id);
    return this.response(r, "HumanHandoff", row, op);
  }
  private async message(r: Repository, actor: Actor, op: Operation) {
    const c = await r.one("conversations", op.params.conversation_id, true);
    cas(c, op.body.expected_conversation_version);
    if (c.status !== "human_active") fail("HANDOFF_REQUIRED");
    const h = (
      await r.db.query(
        "SELECT assigned_user_id FROM app.human_handoffs WHERE business_id=$1 AND conversation_id=$2 AND status='active'",
        [r.tenant, c.id],
      )
    ).rows[0];
    if (!h || (actor.role === "operator" && h.assigned_user_id !== actor.id))
      fail("FORBIDDEN", 403);
    if (
      !c.last_customer_message_at ||
      Date.now() - c.last_customer_message_at.getTime() >= 86400000 ||
      c.last_customer_message_at > new Date()
    )
      fail("WINDOW_CLOSED");
    if (!op.body.text.trim()) fail("VALIDATION_ERROR", 422);
    const messageId = randomUUID();
    const box = await outbox(
      r,
      "whatsapp.message",
      { id: messageId, version: 1, automation_epoch: c.automation_epoch },
      op.request,
      c.id,
      op.body.text,
    );
    const m = await r.insert("messages", {
      id: messageId,
      conversation_id: c.id,
      direction: "outbound",
      kind: "text",
      content: { text: op.body.text },
      actor_type: "human",
      delivery_status: "pending",
      outbox_id: box,
      created_by: actor.id,
    });
    await audit(r, actor, op.request, "message.enqueue", "message", m);
    return {
      status: 202,
      body: {
        data: { outbox_id: box, status: "queued" },
        meta: { request_id: op.request },
      },
    };
  }
  private async metrics(r: Repository, op: Operation) {
    const from = new Date(op.query.from),
      to = new Date(op.query.to);
    if (!(to > from) || to.getTime() - from.getTime() > 31 * 86400000)
      fail("VALIDATION_ERROR", 422);
    const stats = (
      await r.db.query(
        `SELECT
  (SELECT count(*) FROM app.orders WHERE business_id=$1 AND confirmed_at>=$2 AND confirmed_at<$3) AS orders_confirmed,
  (SELECT count(*) FROM app.order_transitions WHERE business_id=$1 AND to_status='cancelled' AND created_at>=$2 AND created_at<$3) AS orders_cancelled,
  (SELECT count(*) FROM app.human_handoffs WHERE business_id=$1 AND created_at>=$2 AND created_at<$3) AS handoffs_created,
  (SELECT coalesce(sum(o.total_minor),0) FROM app.orders o JOIN app.order_transitions t ON t.business_id=o.business_id AND t.order_id=o.id AND t.to_status='delivered' WHERE o.business_id=$1 AND t.created_at>=$2 AND t.created_at<$3) AS sales_minor`,
        [r.tenant, from, to],
      )
    ).rows[0];
    const b = await r.one("businesses", r.tenant);
    return {
      status: 200,
      body: {
        data: {
          from: from.toISOString(),
          to: to.toISOString(),
          ...Object.fromEntries(
            Object.entries(stats).map(([k, v]) => [k, minor(v as string)]),
          ),
          currency: b.currency,
          generated_at: new Date().toISOString(),
        },
        meta: { request_id: op.request },
      },
    };
  }
}
