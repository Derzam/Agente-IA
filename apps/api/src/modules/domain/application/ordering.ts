import { createHash, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import type { AddressSnapshot } from "@agente-ia/shared";
import { transaction, userContext } from "../../../platform/database.js";
import { digest } from "../../../platform/idempotency.js";
import { AppError } from "../../../platform/errors.js";
import { Repository, type Row } from "../infrastructure/repository.js";
import { fail, inPolygon, minor, openNow } from "../domain/rules.js";
import { audit, outbox, transitionEvidence } from "./evidence.js";
import { OperationsService } from "./operations.js";
export interface CustomerContext {
  tenant: string;
  customer: string;
  conversation: string;
}
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const safeContext = (ctx: CustomerContext) =>
  Object.values(ctx).every((v) => z.uuid().safeParse(v).success);
const actor = (ctx: CustomerContext) => ({
  id: ctx.customer,
  type: "customer" as const,
});
export class OrderingService {
  constructor(readonly pool: pg.Pool) {}
  private async run<T>(
    ctx: CustomerContext,
    execute: (r: Repository) => Promise<T>,
  ): Promise<T> {
    if (!safeContext(ctx)) fail("VALIDATION_ERROR", 422);
    return transaction(this.pool, async (db) => {
      await userContext(db, "", ctx.tenant);
      const r = new Repository(db, ctx.tenant);
      const conv = await r.one("conversations", ctx.conversation, true);
      if (conv.customer_id !== ctx.customer) fail("FORBIDDEN", 403);
      return execute(r);
    });
  }
  private async mutable(
    ctx: CustomerContext,
    key: string,
    operation: string,
    input: unknown,
    execute: (r: Repository, request: string) => Promise<Row>,
  ): Promise<Row> {
    if (!z.uuid().safeParse(key).success) fail("VALIDATION_ERROR", 422);
    return this.run(ctx, async (r) => {
      if (
        operation !== "request_human" &&
        (await r.one("conversations", ctx.conversation)).status !== "bot_active"
      )
        fail("HANDOFF_REQUIRED");
      const scope = `customer:${ctx.customer}:${ctx.conversation}`,
        keyHash = digest(key),
        hash = digest(input);
      const existing = (
        await r.db.query(
          "SELECT * FROM app.idempotency_keys WHERE business_id=$1 AND actor_scope=$2 AND operation=$3 AND key_hash=$4 FOR UPDATE",
          [r.tenant, scope, operation, keyHash],
        )
      ).rows[0];
      if (existing && existing.expires_at > new Date()) {
        if (existing.request_hash !== hash) fail("IDEMPOTENCY_CONFLICT");
        if (existing.status === "completed") return existing.response_body;
        if (existing.lease_until > new Date()) fail("REQUEST_IN_PROGRESS");
      }
      let id: string;
      if (existing) {
        id = existing.id;
        await r.db.query(
          "UPDATE app.idempotency_keys SET status='in_progress',request_hash=$2,response_body=NULL,response_status=NULL,response_redacted=NULL,expires_at=now()+interval '1 day',lease_until=now()+interval '30 seconds',fencing_token=fencing_token+1 WHERE id=$1",
          [id, hash],
        );
      } else
        id = (
          await r.db.query(
            "INSERT INTO app.idempotency_keys(business_id,actor_scope,operation,key_hash,request_hash,expires_at,lease_until,fencing_token) VALUES($1,$2,$3,$4,$5,now()+interval '1 day',now()+interval '30 seconds',1) RETURNING id",
            [r.tenant, scope, operation, keyHash, hash],
          )
        ).rows[0].id;
      const value = await execute(r, key);
      await r.db.query(
        "UPDATE app.idempotency_keys SET status='completed',response_status=200,response_body=$2,response_redacted=$3,lease_until=NULL WHERE id=$1",
        [id, value, { status: "completed" }],
      );
      return value;
    });
  }
  async searchMenu(ctx: CustomerContext, query: string) {
    if (typeof query !== "string" || query.length > 120)
      fail("VALIDATION_ERROR", 422);
    return this.run(ctx, async (r) => {
      const rows = (
        await r.db.query(
          "SELECT p.* FROM app.products p JOIN app.categories c ON c.business_id=p.business_id AND c.id=p.category_id WHERE p.business_id=$1 AND p.deleted_at IS NULL AND p.available AND c.deleted_at IS NULL AND c.active AND p.name ILIKE $2 ORDER BY p.created_at DESC,p.id DESC LIMIT 20",
          [ctx.tenant, `%${query.replace(/[\\%_]/g, "\\$&")}%`],
        )
      ).rows;
      return Promise.all(rows.map((p) => r.dto("Product", p)));
    });
  }
  async getProduct(ctx: CustomerContext, id: string) {
    if (!z.uuid().safeParse(id).success) fail("VALIDATION_ERROR", 422);
    return this.run(ctx, async (r) =>
      r.dto("Product", await r.one("products", id)),
    );
  }
  private async cart(
    r: Repository,
    ctx: CustomerContext,
    create = true,
  ): Promise<Row> {
    let cart = (
      await r.db.query(
        "SELECT * FROM app.carts WHERE business_id=$1 AND conversation_id=$2 AND status='active' FOR UPDATE",
        [r.tenant, ctx.conversation],
      )
    ).rows[0];
    if (cart && cart.expires_at <= new Date()) {
      const expired = await r.update("carts", cart.id, { status: "expired" });
      await audit(
        r,
        actor(ctx),
        randomUUID(),
        "cart.expire",
        "cart",
        expired,
        cart,
      );
      cart = undefined;
    }
    if (!cart && create) {
      const b = await r.pricingBusiness(),
        s = await r.one("business_settings", r.tenant);
      cart = await r.insert("carts", {
        customer_id: ctx.customer,
        conversation_id: ctx.conversation,
        currency: b.currency,
        expires_at: new Date(Date.now() + s.session_ttl_minutes * 60000),
      });
      await audit(r, actor(ctx), randomUUID(), "cart.create", "cart", cart);
    }
    if (!cart) fail("NOT_FOUND", 404);
    return cart;
  }
  async getCart(ctx: CustomerContext) {
    return this.run(ctx, async (r) => this.cartDto(r, await this.cart(r, ctx)));
  }
  private async cartDto(r: Repository, cart: Row): Promise<Row> {
    const lines = await this.lines(r, cart);
    return {
      ...(await r.dto("Cart", cart)),
      items: lines.map((l) => ({
        id: l.id,
        product_id: l.product_id,
        option_ids: l.selected_options,
        quantity: l.quantity,
        notes: l.notes,
        unit_price_minor: l.unit_price_minor,
        line_total_minor: l.line_total_minor,
      })),
      subtotal_minor: minor(
        lines.reduce((s, l) => s + BigInt(l.line_total_minor), 0n),
      ),
    };
  }
  async addToCart(
    ctx: CustomerContext,
    key: string,
    input: {
      product_id: string;
      option_ids: string[];
      quantity: number;
      notes: string | null;
    },
  ) {
    if (
      !z
        .object({
          product_id: z.uuid(),
          option_ids: z.array(z.uuid()).max(20),
          quantity: z.number().int().min(1).max(99),
          notes: z.string().max(1000).nullable(),
        })
        .strict()
        .safeParse(input).success ||
      new Set(input.option_ids).size !== input.option_ids.length
    )
      fail("VALIDATION_ERROR", 422);
    return this.mutable(ctx, key, "add_to_cart", input, async (r, request) => {
      await this.catalogLock(r);
      const cart = await this.cart(r, ctx);
      const conv = await r.one("conversations", ctx.conversation);
      if (conv.status !== "bot_active") fail("HANDOFF_REQUIRED");
      await this.productLine(
        r,
        input.product_id,
        input.option_ids,
        input.quantity,
        input.notes,
      );
      const fingerprint = sha([...input.option_ids].sort().join(","));
      const prior = (
        await r.db.query(
          "SELECT * FROM app.cart_items WHERE business_id=$1 AND cart_id=$2 AND product_id=$3 AND options_fingerprint=$4 FOR UPDATE",
          [r.tenant, cart.id, input.product_id, fingerprint],
        )
      ).rows[0];
      if (prior) {
        if (prior.quantity + input.quantity > 99) fail("VALIDATION_ERROR", 422);
        await r.update("cart_items", prior.id, {
          quantity: prior.quantity + input.quantity,
          notes: input.notes,
        });
      } else
        await r.insert("cart_items", {
          cart_id: cart.id,
          product_id: input.product_id,
          selected_options: input.option_ids,
          options_fingerprint: fingerprint,
          quantity: input.quantity,
          notes: input.notes,
        });
      const after = await r.update("carts", cart.id, {
        expires_at: cart.expires_at,
      });
      await audit(r, actor(ctx), request, "cart.add", "cart", after, cart);
      return this.cartDto(r, after);
    });
  }
  async removeFromCart(
    ctx: CustomerContext,
    key: string,
    item: string,
    expected: number,
  ) {
    if (
      !z.uuid().safeParse(item).success ||
      !Number.isInteger(expected) ||
      expected < 1
    )
      fail("VALIDATION_ERROR", 422);
    return this.mutable(
      ctx,
      key,
      "remove_from_cart",
      { item, expected },
      async (r, request) => {
        const cart = await this.cart(r, ctx);
        if (cart.version !== expected) fail("VERSION_CONFLICT");
        const row = await r.one("cart_items", item);
        if (row.cart_id !== cart.id) fail("NOT_FOUND", 404);
        await r.db.query(
          "DELETE FROM app.cart_items WHERE business_id=$1 AND id=$2",
          [r.tenant, item],
        );
        const after = await r.update("carts", cart.id, {
          expires_at: cart.expires_at,
        });
        await audit(r, actor(ctx), request, "cart.remove", "cart", after, cart);
        return this.cartDto(r, after);
      },
    );
  }
  async setFulfillment(
    ctx: CustomerContext,
    key: string,
    fulfillment: "pickup" | "delivery",
    address: AddressSnapshot | null,
    expected: number,
  ) {
    const valid = z
      .object({
        address_text: z.string().min(1).max(1000),
        latitude: z.number().min(-90).max(90).nullable(),
        longitude: z.number().min(-180).max(180).nullable(),
        instructions: z.string().max(1000).nullable(),
      })
      .strict();
    if (
      !["pickup", "delivery"].includes(fulfillment) ||
      (fulfillment === "pickup"
        ? address !== null
        : !valid.safeParse(address).success) ||
      !Number.isInteger(expected) ||
      expected < 1
    )
      fail("VALIDATION_ERROR", 422);
    return this.mutable(
      ctx,
      key,
      "set_fulfillment",
      { fulfillment, address, expected },
      async (r, request) => {
        const c = await this.cart(r, ctx);
        if (c.version !== expected) fail("VERSION_CONFLICT");
        const row = await r.update("carts", c.id, {
          fulfillment,
          address_snapshot: address,
        });
        await audit(r, actor(ctx), request, "cart.fulfillment", "cart", row, c);
        return this.cartDto(r, row);
      },
    );
  }
  private async catalogLock(r: Repository) {
    await r.db.query(
      "SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
      [`catalog:${r.tenant}`],
    );
  }
  private async productLine(
    r: Repository,
    productId: string,
    ids: string[],
    quantity: number,
    notes: string | null,
  ): Promise<Row> {
    const p = await r.one("products", productId);
    if (p.currency !== (await r.pricingBusiness()).currency)
      fail("QUOTE_CHANGED");
    const c = await r.one("categories", p.category_id);
    if (!p.available || !c.active) fail("PRODUCT_UNAVAILABLE");
    const groups = (
      await r.db.query(
        "SELECT * FROM app.modifier_groups WHERE business_id=$1 AND product_id=$2 AND active AND deleted_at IS NULL ORDER BY id",
        [r.tenant, p.id],
      )
    ).rows;
    const options = (
      await r.db.query(
        "SELECT o.* FROM app.modifier_options o JOIN app.modifier_groups g ON g.business_id=o.business_id AND g.id=o.modifier_group_id WHERE o.business_id=$1 AND g.product_id=$2 AND o.id=ANY($3::uuid[]) AND o.available AND o.deleted_at IS NULL AND g.active AND g.deleted_at IS NULL ORDER BY o.id",
        [r.tenant, p.id, ids],
      )
    ).rows;
    if (options.length !== ids.length || ids.length > 20)
      fail("PRODUCT_UNAVAILABLE");
    for (const g of groups) {
      const count = options.filter((o) => o.modifier_group_id === g.id).length;
      if (count < g.min_select || count > g.max_select)
        fail("PRODUCT_UNAVAILABLE");
    }
    const unit = minor(
      BigInt(p.price_minor) +
        options.reduce((s, o) => s + BigInt(o.price_delta_minor), 0n),
    );
    return {
      product_id: p.id,
      name_snapshot: p.name,
      option_snapshots: options.map((o) => ({
        name: o.name,
        price_delta_minor: minor(o.price_delta_minor),
      })),
      selected_options: ids,
      quantity,
      notes,
      unit_price_minor: unit,
      line_total_minor: minor(BigInt(unit) * BigInt(quantity)),
      identity: {
        product: p.id,
        version: p.version,
        currency: p.currency,
        category_version: c.version,
        groups: groups.map((g) => [g.id, g.version]),
        options: options.map((o) => [o.id, o.version]),
      },
    };
  }
  private async lines(r: Repository, cart: Row): Promise<Row[]> {
    const lines: Row[] = [];
    for (const item of (
      await r.db.query(
        "SELECT * FROM app.cart_items WHERE business_id=$1 AND cart_id=$2 ORDER BY id",
        [r.tenant, cart.id],
      )
    ).rows)
      lines.push({
        ...(await this.productLine(
          r,
          item.product_id,
          item.selected_options,
          item.quantity,
          item.notes,
        )),
        id: item.id,
      });
    return lines;
  }
  private async calculate(r: Repository, cart: Row): Promise<Row> {
    if (cart.status !== "active" || cart.expires_at <= new Date())
      fail("QUOTE_EXPIRED");
    const conv = await r.one("conversations", cart.conversation_id);
    if (conv.status !== "bot_active") fail("HANDOFF_REQUIRED");
    const settings = await r.one("business_settings", r.tenant),
      b = await r.pricingBusiness();
    if (
      !settings.accepting_orders ||
      !openNow(settings.opening_hours, b.timezone, new Date())
    )
      fail("BUSINESS_CLOSED");
    if (!settings.tax_policy) fail("VALIDATION_ERROR", 422);
    if (b.currency !== cart.currency) fail("QUOTE_CHANGED");
    const lines = await this.lines(r, cart);
    if (!lines.length) fail("VALIDATION_ERROR", 422);
    const subtotal = minor(
      lines.reduce((s, l) => s + BigInt(l.line_total_minor), 0n),
    );
    if (subtotal < minor(settings.min_order_minor))
      fail("VALIDATION_ERROR", 422);
    let zone: Row | undefined;
    if (cart.fulfillment === "delivery") {
      const a = cart.address_snapshot;
      if (
        !settings.delivery_enabled ||
        !a ||
        typeof a.latitude !== "number" ||
        typeof a.longitude !== "number"
      )
        fail("DELIVERY_UNAVAILABLE");
      const zones = (
        await r.db.query(
          "SELECT * FROM app.delivery_zones WHERE business_id=$1 AND active AND deleted_at IS NULL ORDER BY priority ASC,id ASC",
          [r.tenant],
        )
      ).rows;
      zone = zones.find((z) =>
        inPolygon(a.latitude, a.longitude, z.polygon_geojson),
      );
      if (!zone || subtotal < minor(zone.min_order_minor))
        fail("DELIVERY_UNAVAILABLE");
    } else if (cart.fulfillment !== "pickup" || !settings.pickup_enabled)
      fail("DELIVERY_UNAVAILABLE");
    const tax = minor(
      lines.reduce(
        (s, l) =>
          s +
          (BigInt(l.line_total_minor) * BigInt(settings.tax_policy.rate_bps) +
            5000n) /
            10000n,
        0n,
      ),
    );
    const delivery = zone ? minor(zone.fee_minor) : 0;
    const quote = {
      fulfillment: cart.fulfillment,
      currency: b.currency,
      subtotal_minor: subtotal,
      tax_minor: tax,
      delivery_minor: delivery,
      discount_minor: 0,
      total_minor: minor(BigInt(subtotal) + BigInt(tax) + BigInt(delivery)),
      address_snapshot: cart.address_snapshot,
      zone_id: zone?.id ?? null,
    };
    return {
      quote,
      lines,
      fingerprint: digest({
        quote,
        cart: cart.version,
        lines,
        settings_version: settings.version,
        timezone: b.timezone,
        zone_version: zone?.version ?? null,
      }),
    };
  }
  async requestQuote(ctx: CustomerContext) {
    return this.run(ctx, async (r) => {
      await this.catalogLock(r);
      const cart = await this.cart(r, ctx, false);
      const existing = (
        await r.db.query(
          "SELECT * FROM app.orders WHERE business_id=$1 AND source_cart_id=$2 AND source_cart_version=$3",
          [r.tenant, cart.id, cart.version],
        )
      ).rows[0];
      if (existing)
        return {
          order: await r.dto("Order", existing),
          confirmation_button: null,
        };
      const { quote, lines, fingerprint } = await this.calculate(r, cart);
      const expires = new Date(
        Math.min(Date.now() + 600000, cart.expires_at.getTime()),
      );
      const order = await r.insert("orders", {
        ...quote,
        customer_id: ctx.customer,
        conversation_id: ctx.conversation,
        source_cart_id: cart.id,
        source_cart_version: cart.version,
        quote_fingerprint: fingerprint,
        quote_expires_at: expires,
      });
      for (const l of lines)
        await r.insert("order_items", {
          order_id: order.id,
          product_id: l.product_id,
          name_snapshot: l.name_snapshot,
          option_snapshots: l.option_snapshots,
          quantity: l.quantity,
          unit_price_minor: l.unit_price_minor,
          line_total_minor: l.line_total_minor,
          notes: l.notes,
        });
      const nonce = randomBytes(32).toString("base64url");
      const challenge = await r.insert("confirmation_challenges", {
        order_id: order.id,
        customer_id: ctx.customer,
        conversation_id: ctx.conversation,
        order_version: order.version,
        nonce_hash: sha(nonce),
        expires_at: expires,
      });
      const request = randomUUID();
      await audit(r, actor(ctx), request, "order.quote", "order", order);
      await outbox(r, "order.created", order, request, ctx.conversation);
      // Never write this opaque button/nonce to idempotency, audit, outbox or logs.
      return {
        order: await r.dto("Order", order),
        confirmation_button: `confirm:${challenge.id}:${nonce}`,
      };
    });
  }
  async confirmOrder(ctx: CustomerContext, message: string) {
    const result = await this.run(ctx, async (r) => {
      try {
        return { order: await this.confirmWithin(r, ctx, message) };
      } catch (error) {
        if (
          !(error instanceof AppError) ||
          !["QUOTE_CHANGED", "QUOTE_EXPIRED"].includes(error.code)
        )
          throw error;
        await this.invalidateQuoteWithin(r, ctx, message, error.code);
        return { error };
      }
    });
    if (result.error) throw result.error;
    return result.order!;
  }
  async invalidateQuoteWithin(
    r: Repository,
    ctx: CustomerContext,
    message: string,
    reason: string,
  ) {
    const m = await r.one("messages", message);
    const parts = (m.content?.id ?? "").split(":");
    if (parts.length !== 4 || parts[0] !== "confirm" || parts[2] !== "sha256")
      return;
    const c = await r.one("confirmation_challenges", parts[1], true);
    if (
      c.customer_id !== ctx.customer ||
      c.conversation_id !== ctx.conversation ||
      c.nonce_hash !== parts[3] ||
      c.consumed_at
    )
      return;
    const before = await r.one("orders", c.order_id, true);
    if (before.status !== "awaiting_confirmation") return;
    await r.db.query("SELECT set_config('app.order_action','cancel',true)");
    const after = await r.update("orders", before.id, {
      status: "cancelled",
      cancellation_reason: reason,
    });
    const cart = await r.one("carts", before.source_cart_id, true);
    if (cart.status === "active" && cart.version === before.source_cart_version)
      await r.update("carts", cart.id, { expires_at: cart.expires_at });
    await transitionEvidence(r, actor(ctx), message, before, after, "cancel");
  }
  async confirmWithin(r: Repository, ctx: CustomerContext, message: string) {
    if (!z.uuid().safeParse(message).success) fail("VALIDATION_ERROR", 422);
    const m = await r.one("messages", message);
    if (
      m.conversation_id !== ctx.conversation ||
      m.direction !== "inbound" ||
      m.actor_type !== "customer" ||
      m.kind !== "interactive"
    )
      fail("VALIDATION_ERROR", 422);
    const [prefix, id, algorithm, hash, ...extra] = (m.content?.id ?? "").split(
      ":",
    );
    if (
      prefix !== "confirm" ||
      !z.uuid().safeParse(id).success ||
      algorithm !== "sha256" ||
      !hash ||
      !/^[a-f0-9]{64}$/.test(hash) ||
      extra.length
    )
      fail("VALIDATION_ERROR", 422);
    const challenge = await r.one("confirmation_challenges", id, true);
    if (
      challenge.customer_id !== ctx.customer ||
      challenge.conversation_id !== ctx.conversation ||
      challenge.nonce_hash !== hash
    )
      fail("FORBIDDEN", 403);
    if (challenge.consumed_at) fail("INVALID_ORDER_TRANSITION");
    if (challenge.expires_at <= new Date()) fail("QUOTE_EXPIRED");
    const order = await r.one("orders", challenge.order_id, true),
      cart = await r.one("carts", order.source_cart_id, true);
    if (order.quote_expires_at <= new Date() || cart.expires_at <= new Date())
      fail("QUOTE_EXPIRED");
    if (
      order.version !== challenge.order_version ||
      order.source_cart_version !== cart.version ||
      order.status !== "awaiting_confirmation"
    )
      fail("QUOTE_CHANGED");
    await this.catalogLock(r);
    let calculated: Row;
    try {
      calculated = await this.calculate(r, cart);
    } catch (error) {
      if (error instanceof AppError && error.code !== "QUOTE_EXPIRED")
        fail("QUOTE_CHANGED");
      throw error;
    }
    if (calculated.fingerprint !== order.quote_fingerprint)
      fail("QUOTE_CHANGED");
    const consumed = await r.db.query(
      "SELECT app.consume_confirmation_challenge($1,$2,$3,$4) AS ok",
      [challenge.id, ctx.customer, hash, message],
    );
    if (!consumed.rows[0].ok) fail("QUOTE_CHANGED");
    await r.db.query("SELECT set_config('app.order_action','confirm',true)");
    const confirmed = await r.update("orders", order.id, {
      status: "confirmed",
      confirmed_at: new Date(),
      confirmation_message_id: message,
    });
    const converted = await r.update("carts", cart.id, { status: "converted" });
    await audit(
      r,
      actor(ctx),
      message,
      "cart.convert",
      "cart",
      converted,
      cart,
    );
    const payment = await r.insert("payments", {
      order_id: order.id,
      amount_minor: order.total_minor,
      currency: order.currency,
    });
    await audit(r, actor(ctx), message, "payment.create", "payment", payment);
    await transitionEvidence(
      r,
      actor(ctx),
      message,
      order,
      confirmed,
      "confirm",
    );
    return r.dto("Order", confirmed);
  }
  async requestHuman(
    ctx: CustomerContext,
    key: string,
    reason:
      | "explicit_request"
      | "misunderstanding"
      | "complaint"
      | "payment_issue"
      | "system_failure",
  ) {
    if (
      ![
        "explicit_request",
        "misunderstanding",
        "complaint",
        "payment_issue",
        "system_failure",
      ].includes(reason)
    )
      fail("VALIDATION_ERROR", 422);
    return this.mutable(
      ctx,
      key,
      "request_human",
      { reason },
      async (r, request) => {
        const conv = await r.one("conversations", ctx.conversation, true);
        const result = await new OperationsService().createHandoff(
          r,
          actor(ctx),
          {
            method: "post",
            path: "",
            params: { conversation_id: ctx.conversation },
            query: {},
            body: { reason, expected_conversation_version: conv.version },
            request,
          },
        );
        return (result.body as Row).data;
      },
    );
  }
}
