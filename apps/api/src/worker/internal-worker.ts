import type pg from "pg";
import { transaction, userContext } from "../platform/database.js";
import { AppError } from "../platform/errors.js";
import {
  Repository,
  type Row,
} from "../modules/domain/infrastructure/repository.js";
import { outbox, audit } from "../modules/domain/application/evidence.js";
import { OrderingService } from "../modules/domain/application/ordering.js";
export type Queue = "inbox" | "outbox";
export interface Lease {
  tenant: string;
  id: string;
  token: string;
  queue: Queue;
}
export class InternalWorker {
  private cursor = "00000000-0000-0000-0000-000000000000";
  constructor(
    readonly pool: pg.Pool,
    readonly maxAttempts = 5,
    readonly leaseSeconds = 30,
    readonly observe: (event: Row) => void = () => {},
    readonly extensions?: {
      status?: (r: Repository, event: Row) => Promise<boolean>;
      inbound?: (r: Repository, customer: string) => Promise<void>;
      confirmed?: (
        r: Repository,
        ctx: import("../modules/domain/application/ordering.js").CustomerContext,
        order: Row,
        inbound: string,
      ) => Promise<void>;
    },
  ) {}
  private async scoped<T>(
    tenant: string,
    execute: (r: Repository) => Promise<T>,
  ) {
    return transaction(this.pool, async (db) => {
      await userContext(db, "", tenant);
      return execute(new Repository(db, tenant));
    });
  }
  async claim(tenant: string, queue: Queue): Promise<Lease | null> {
    return this.scoped(tenant, async (r) => {
      const table = queue === "inbox" ? "webhook_events" : "outbox_events",
        processing = queue === "inbox" ? "processing" : "sending";
      const row = (
        await r.db.query(
          `SELECT id FROM app.${table} WHERE business_id=$1 AND (status='pending' OR (status=$2 AND lease_until<=clock_timestamp())) AND next_attempt_at<=clock_timestamp() ${queue === "outbox" ? "AND event_type<>'whatsapp.message'" : ""} ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,
          [tenant, processing],
        )
      ).rows[0];
      if (!row) return null;
      const updated = (
        await r.db.query(
          `UPDATE app.${table} SET status=$2,attempts=attempts+1,lease_until=clock_timestamp()+make_interval(secs=>$3),fencing_token=fencing_token+1 WHERE business_id=$1 AND id=$4 RETURNING fencing_token`,
          [tenant, processing, this.leaseSeconds, row.id],
        )
      ).rows[0];
      return { tenant, id: row.id, token: updated.fencing_token, queue };
    });
  }
  async process(lease: Lease): Promise<boolean> {
    try {
      return await this.scoped(lease.tenant, async (r) => {
        const table =
            lease.queue === "inbox" ? "webhook_events" : "outbox_events",
          processing = lease.queue === "inbox" ? "processing" : "sending";
        const row = (
          await r.db.query(
            `SELECT * FROM app.${table} WHERE business_id=$1 AND id=$2 AND fencing_token=$3 AND status=$4 AND lease_until>clock_timestamp() FOR UPDATE`,
            [lease.tenant, lease.id, lease.token, processing],
          )
        ).rows[0];
        if (!row) return false;
        if (row.attempts > this.maxAttempts)
          throw new AppError(500, "INTERNAL_ERROR", "Límite de reintentos.");
        if (lease.queue === "inbox") await this.inbox(r, row);
        else
          await r.db.query(
            "INSERT INTO app.internal_event_receipts(business_id,outbox_id) VALUES($1,$2) ON CONFLICT(business_id,outbox_id) DO NOTHING",
            [lease.tenant, lease.id],
          );
        const result = await r.db.query(
          `UPDATE app.${table} SET status=$4,lease_until=NULL ${lease.queue === "inbox" ? ",last_error_code=NULL" : ""} WHERE business_id=$1 AND id=$2 AND fencing_token=$3 AND lease_until>clock_timestamp()`,
          [
            lease.tenant,
            lease.id,
            lease.token,
            lease.queue === "inbox" ? "processed" : "sent",
          ],
        );
        if (result.rowCount !== 1)
          throw new AppError(409, "REQUEST_IN_PROGRESS", "Lease vencido.");
        return true;
      });
    } catch (error) {
      await this.retry(
        lease,
        error instanceof AppError ? error.code : "INTERNAL_ERROR",
      );
      return false;
    }
  }
  async retry(lease: Lease, code: string) {
    return this.scoped(lease.tenant, async (r) => {
      const table =
        lease.queue === "inbox" ? "webhook_events" : "outbox_events";
      const result = await r.db.query(
        `UPDATE app.${table} SET status=CASE WHEN attempts>=$4 THEN 'dead_letter' ELSE 'pending' END,lease_until=NULL,next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,power(2,least(attempts,10))::integer)) ${lease.queue === "inbox" ? ",last_error_code=$5" : ""} WHERE business_id=$1 AND id=$2 AND fencing_token=$3 AND status=$${lease.queue === "inbox" ? 6 : 5} AND lease_until>clock_timestamp() RETURNING status,attempts`,
        lease.queue === "inbox"
          ? [
              lease.tenant,
              lease.id,
              lease.token,
              this.maxAttempts,
              code,
              "processing",
            ]
          : [lease.tenant, lease.id, lease.token, this.maxAttempts, "sending"],
      );
      if (result.rowCount === 1)
        this.observe({
          event_type: "worker.retry",
          business_id: lease.tenant,
          job_id: lease.id,
          queue: lease.queue,
          code,
          ...result.rows[0],
        });
      return result.rowCount === 1;
    });
  }
  private async inbox(r: Repository, event: Row) {
    const p = event.payload;
    if (!p || typeof p !== "object")
      throw new AppError(422, "VALIDATION_ERROR", "Evento inválido.");
    if (p.kind === "status") {
      await this.status(r, event);
      return;
    }
    if (
      !["text", "interactive", "location", "unsupported"].includes(p.kind) ||
      typeof p.channel_user_id !== "string" ||
      !p.channel_user_id
    )
      return;
    await r.db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `inbox:${r.tenant}:${event.channel_id}:${p.channel_user_id}`,
    ]);
    // Dedupe before customer/session/cart effects, including after a session has expired.
    if (
      p.provider_message_id &&
      (
        await r.db.query(
          "SELECT 1 FROM app.messages WHERE business_id=$1 AND provider_message_id=$2",
          [r.tenant, p.provider_message_id],
        )
      ).rowCount
    )
      return;
    const system = { id: null, type: "system" as const };
    const channel = await r.db.query(
      "SELECT id FROM app.whatsapp_channels WHERE business_id=$1 AND id=$2 AND enabled",
      [r.tenant, event.channel_id],
    );
    if (!channel.rowCount)
      throw new AppError(422, "VALIDATION_ERROR", "Canal inválido.");
    let customer = (
      await r.db.query(
        "SELECT * FROM app.customers WHERE business_id=$1 AND channel_user_id=$2",
        [r.tenant, p.channel_user_id],
      )
    ).rows[0];
    if (customer?.deleted_at)
      throw new AppError(422, "VALIDATION_ERROR", "Cliente no disponible.");
    if (!customer) {
      customer = await r.insert("customers", {
        channel_user_id: p.channel_user_id,
      });
      await audit(r, system, event.id, "customer.create", "customer", customer);
    }
    const settings = await r.one("business_settings", r.tenant);
    if (this.extensions?.inbound) await this.extensions.inbound(r, customer.id);
    let c = (
      await r.db.query(
        "SELECT * FROM app.conversations WHERE business_id=$1 AND customer_id=$2 AND channel_id=$3 AND status<>'closed' FOR UPDATE",
        [r.tenant, customer.id, event.channel_id],
      )
    ).rows[0];
    // Human attention never resumes or closes automatically on timeout.
    if (c?.status === "bot_active" && c.expires_at <= new Date()) {
      const closed = await r.update("conversations", c.id, {
        status: "closed",
        automation_epoch: Number(c.automation_epoch) + 1,
      });
      await audit(
        r,
        system,
        event.id,
        "conversation.expire",
        "conversation",
        closed,
        c,
      );
      const expired = await r.db.query(
        "UPDATE app.carts SET status='expired' WHERE business_id=$1 AND conversation_id=$2 AND status='active' RETURNING *",
        [r.tenant, c.id],
      );
      for (const cart of expired.rows)
        await audit(r, system, event.id, "cart.expire", "cart", cart, {
          id: cart.id,
          version: cart.version - 1,
          status: "active",
        });
      c = undefined;
    }
    if (!c) {
      c = await r.insert("conversations", {
        customer_id: customer.id,
        channel_id: event.channel_id,
        expires_at: new Date(Date.now() + settings.session_ttl_minutes * 60000),
      });
      await audit(
        r,
        system,
        event.id,
        "conversation.create",
        "conversation",
        c,
      );
    }
    const raw = p.content ?? {};
    let content: Row;
    switch (p.kind) {
      case "text":
        content = { text: raw.text };
        break;
      case "interactive":
        content = { id: raw.reply_id, title: raw.title ?? "" };
        break;
      case "location":
        content = { latitude: raw.latitude, longitude: raw.longitude };
        break;
      default:
        content = { type: raw.provider_type ?? "unknown" };
    }
    const m = await r.insert("messages", {
      conversation_id: c.id,
      direction: "inbound",
      provider_message_id: p.provider_message_id ?? null,
      kind: p.kind,
      content,
      actor_type: "customer",
      provider_timestamp: p.provider_timestamp ?? null,
    });
    await audit(r, system, event.id, "message.receive", "message", m);
    const stamp = p.provider_timestamp ? new Date(p.provider_timestamp) : null;
    if (
      stamp &&
      Number.isFinite(stamp.getTime()) &&
      stamp <= new Date() &&
      (!c.last_customer_message_at || stamp > c.last_customer_message_at)
    ) {
      const before = c;
      c = await r.update("conversations", c.id, {
        last_customer_message_at: stamp,
        expires_at: new Date(Date.now() + settings.session_ttl_minutes * 60000),
      });
      await audit(
        r,
        system,
        event.id,
        "conversation.receive",
        "conversation",
        c,
        before,
      );
    }
    await outbox(r, "message.received", m, event.id, c.id);
    if (
      p.kind === "interactive" &&
      typeof content.id === "string" &&
      content.id.startsWith("confirm:")
    ) {
      // A rejected button is a processed inbound message; isolate any partial command effects.
      await r.db.query("SAVEPOINT confirmation");
      try {
        const confirmed = await new OrderingService(this.pool).confirmWithin(
          r,
          { tenant: r.tenant, customer: customer.id, conversation: c.id },
          m.id,
        );
        await this.extensions?.confirmed?.(
          r,
          { tenant: r.tenant, customer: customer.id, conversation: c.id },
          confirmed,
          m.id,
        );
        await r.db.query("RELEASE SAVEPOINT confirmation");
      } catch (error) {
        await r.db.query("ROLLBACK TO SAVEPOINT confirmation");
        if (!(error instanceof AppError)) throw error;
        await r.db.query("RELEASE SAVEPOINT confirmation");
        if (["QUOTE_CHANGED", "QUOTE_EXPIRED"].includes(error.code))
          await new OrderingService(this.pool).invalidateQuoteWithin(
            r,
            { tenant: r.tenant, customer: customer.id, conversation: c.id },
            m.id,
            error.code,
          );
      }
    }
  }
  private async status(r: Repository, event: Row) {
    if (this.extensions?.status && (await this.extensions.status(r, event)))
      return;
    const p = event.payload;
    const status = p.content?.status;
    const rank: Record<string, number> = {
      pending: 0,
      sent: 1,
      delivered: 2,
      read: 3,
    };
    if (!p.provider_message_id || (!(status in rank) && status !== "failed"))
      return;
    const m = (
      await r.db.query(
        "SELECT * FROM app.messages WHERE business_id=$1 AND provider_message_id=$2 AND direction='outbound' FOR UPDATE",
        [r.tenant, p.provider_message_id],
      )
    ).rows[0];
    if (!m) return;
    if (
      (status === "failed" &&
        ["delivered", "read"].includes(m.delivery_status)) ||
      (status in rank && (rank[status] ?? 0) <= (rank[m.delivery_status] ?? -1))
    )
      return;
    const changed = await r.update("messages", m.id, {
      delivery_status: status,
    });
    await audit(
      r,
      { id: null, type: "system" },
      event.id,
      "message.delivery_status",
      "message",
      { ...changed, status: changed.delivery_status },
      { ...m, status: m.delivery_status },
    );
    await outbox(
      r,
      "message.delivery_updated",
      changed,
      event.id,
      m.conversation_id,
    );
  }
  async tick() {
    let tenants = (
      await this.pool.query(
        "SELECT id FROM app.businesses WHERE id>$1 ORDER BY id LIMIT 20",
        [this.cursor],
      )
    ).rows;
    if (!tenants.length) {
      this.cursor = "00000000-0000-0000-0000-000000000000";
      tenants = (
        await this.pool.query(
          "SELECT id FROM app.businesses ORDER BY id LIMIT 20",
        )
      ).rows;
    }
    let completed = 0;
    for (const t of tenants) {
      this.cursor = t.id;
      for (const queue of ["inbox", "outbox"] as const) {
        const lease = await this.claim(t.id, queue);
        if (lease && (await this.process(lease))) completed++;
      }
    }
    return { tenants: tenants.length, completed };
  }
}
