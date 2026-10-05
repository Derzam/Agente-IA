import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID, randomBytes, createHash, createHmac } from "node:crypto";
import pg from "pg";
import { loadRuntime, type RuntimeConfig } from "../src/config/runtime.js";
import { RuntimeSafety, scoped, rate } from "../src/platform/runtime-safety.js";
import { checkDatabaseRole } from "../src/platform/database.js";
import {
  PostgresAiPersistence,
  EncryptedQuoteTransport,
} from "../src/modules/ai/persistence.js";
import {
  OrderingService,
  type CustomerContext,
} from "../src/modules/domain/application/ordering.js";
import { ToolExecutor } from "../src/modules/ai/tools.js";
import { Orchestrator } from "../src/modules/ai/orchestrator.js";
import {
  ProviderFailure,
  type AiProvider,
  type AiReply,
} from "../src/modules/ai/provider.js";
import {
  ChallengeCipher,
  challengeBinding,
} from "../src/providers/meta/challenge-cipher.js";
import {
  MetaDispatcher,
  reconcileStatus,
} from "../src/providers/meta/dispatcher.js";
import { InternalWorker } from "../src/worker/internal-worker.js";
import { RuntimeWorker } from "../src/worker/runtime-worker.js";
import { confirmationEvidence } from "../src/platform/confirmation-evidence.js";
import type { MetaProvider, MetaSend } from "../src/providers/meta/provider.js";
import { normalizeEnvelope } from "../src/integrations/whatsapp/normalize.js";
import { PostgresInboxRepository } from "../src/modules/inbox/infrastructure/postgres-inbox.js";
import { ingressLimiter } from "../src/platform/ingress-limits.js";
import { buildApp } from "../src/bootstrap/app.js";
import type { Config } from "../src/config/env.js";
import { DomainTransactions } from "../src/modules/domain/application/transaction.js";
import { OperationsService } from "../src/modules/domain/application/operations.js";
const source = new URL(process.env.TEST_DATABASE_URL ?? "invalid:");
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(source.hostname) ||
  !source.pathname.endsWith("_test") ||
  source.search ||
  source.hash
)
  throw Error("Disposable loopback *_test DB required");
const cluster = new pg.Pool({ connectionString: source.toString() });
const target = new URL(source);
target.pathname = "/agente_ia_runtime_test";
const admin = new pg.Pool({ connectionString: target.toString() });
const login = (name: string) => {
  const url = new URL(target);
  url.username = name;
  url.password = "";
  return new pg.Pool({ connectionString: url.toString() });
};
const worker = login("worker_runtime_test"),
  api = login("api_runtime_test"),
  ingress = login("ingress_runtime_test");
const cipher = new ChallengeCipher("v1", {
  v1: randomBytes(32).toString("hex"),
});
const base = new OrderingService(worker),
  store = new PostgresAiPersistence(worker);
let serial = 0;
async function insert(table: string, data: Record<string, any>) {
  const keys = Object.keys(data);
  return (
    await admin.query(
      `INSERT INTO app.${table}(${keys.join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
      Object.values(data).map((v) =>
        v && typeof v === "object" && !(v instanceof Date)
          ? JSON.stringify(v)
          : v,
      ),
    )
  ).rows[0];
}
before(async () => {
  await cluster.query("CREATE DATABASE agente_ia_runtime_test");
  await admin.query(
    "CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY)",
  );
  const dir = new URL("../../../supabase/migrations/", import.meta.url);
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(new URL(f, dir), "utf8");
    if (f.includes("staging_runtime")) {
      await admin.query("BEGIN");
      await admin.query(
        sql.replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, ""),
      );
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int n FROM pg_tables WHERE schemaname='app'",
          )
        ).rows[0].n,
        32,
      );
      await admin.query("ROLLBACK");
      assert.equal(
        (await admin.query("SELECT to_regclass('app.runtime_windows') n"))
          .rows[0].n,
        null,
      );
    }
    await admin.query(sql);
  }
  await admin.query(
    "CREATE ROLE worker_runtime_test LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;GRANT app_worker TO worker_runtime_test;CREATE ROLE api_runtime_test LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;GRANT app_api TO api_runtime_test;CREATE ROLE ingress_runtime_test LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;GRANT app_ingress TO ingress_runtime_test",
  );
  await admin.query(
    readFileSync(
      new URL("../../../docs/phase-05/staging-smoke.sql", import.meta.url),
      "utf8",
    ),
  );
});
after(async () => {
  await Promise.all([
    admin.end(),
    worker.end(),
    api.end(),
    ingress.end(),
    cluster.end(),
  ]);
});
async function fixture() {
  serial++;
  const biz = await insert("businesses", {
    name: "Runtime synthetic",
    slug: randomUUID(),
    currency: "USD",
    timezone: "UTC",
  });
  const tenant = biz.id;
  await insert("business_settings", {
    business_id: tenant,
    ai_enabled: true,
    accepting_orders: true,
    pickup_enabled: true,
    tax_policy: { mode: "none", rate_bps: 0, rounding: "per_line_half_up" },
    opening_hours: Array.from({ length: 7 }, (_, day) => ({
      day,
      opens_at: "00:00",
      closes_at: "23:59",
    })),
  });
  const phone = String(100000000000 + serial),
    recipient = String(12025550000 + serial),
    channel = await insert("whatsapp_channels", {
      business_id: tenant,
      phone_number_id: phone,
      waba_id: "synthetic",
      app_reference: "synthetic",
    });
  const customer = await insert("customers", {
    business_id: tenant,
    channel_user_id: recipient,
  });
  const conversation = await insert("conversations", {
    business_id: tenant,
    customer_id: customer.id,
    channel_id: channel.id,
    expires_at: new Date(Date.now() + 3600000),
    last_customer_message_at: new Date(),
  });
  const category = await insert("categories", {
      business_id: tenant,
      name: "Synthetic",
    }),
    product = await insert("products", {
      business_id: tenant,
      category_id: category.id,
      name: "Canonical Meal",
      currency: "USD",
      price_minor: 500,
    });
  const inbound = await insert("messages", {
    business_id: tenant,
    conversation_id: conversation.id,
    direction: "inbound",
    kind: "text",
    content: { text: "Menú" },
    actor_type: "customer",
    provider_message_id: "wamid.in." + randomUUID(),
  });
  const ctx: CustomerContext = {
    tenant,
    customer: customer.id,
    conversation: conversation.id,
  };
  const config = loadRuntime({
    WORKER_DATABASE_URL: `postgres://worker_runtime_test@127.0.0.1:5432/agente_ia_runtime_test`,
  });
  config.aiEnabled = true;
  config.openai.model = "synthetic-model";
  config.openai.retries = 0;
  config.metaEnabled = true;
  config.meta.phone = phone;
  config.meta.recipients = [recipient];
  config.challenge = {
    active: "v1",
    keys: { v1: randomBytes(32).toString("hex") },
  };
  return {
    tenant,
    ctx,
    phone,
    recipient,
    channel: channel.id,
    inbound: inbound.id,
    product: product.id,
    config,
  };
}
const reply = (name?: string, args: Record<string, any> = {}): AiReply => {
  const call = {
    name: name ?? "",
    arguments: JSON.stringify(args),
    call_id: "call_" + randomUUID(),
  };
  return {
    items: name
      ? [
          {
            type: "function_call",
            id: "fc_" + randomUUID(),
            status: "completed",
            ...call,
          },
        ]
      : [],
    calls: name ? [call] : [],
    text: "¿Qué producto y cantidad deseas pedir?",
    input: 50,
    output: 10,
  };
};
function harness(
  f: Awaited<ReturnType<typeof fixture>>,
  provider: AiProvider,
  executor?: ToolExecutor,
) {
  const safety = new RuntimeSafety(worker, f.config.budget);
  return new Orchestrator(
    provider,
    store,
    executor ??
      new ToolExecutor(
        new OrderingService(worker, new EncryptedQuoteTransport(cipher)),
      ),
    safety,
    f.config,
  );
}
test("restricted API, ingress and worker readiness succeeds; mismatch fails", async () => {
  await Promise.all([
    checkDatabaseRole(api, "api"),
    checkDatabaseRole(ingress, "ingress"),
    checkDatabaseRole(worker, "worker"),
  ]);
  await assert.rejects(() => checkDatabaseRole(api, "worker"));
});
test("signed HTTP inbound completes inbox, AI, deterministic tools, Meta acceptance and signed status with no duplicate send", async () => {
  const f = await fixture();
  await admin.query("DELETE FROM app.messages WHERE id=$1", [f.inbound]);
  const events: Record<string, unknown>[] = [];
  let responses = 0,
    sends = 0;
  const runtime = new RuntimeWorker(worker, f.config, (e) => events.push(e), {
    ai: {
      respond: async () =>
        ++responses === 1 ? reply("search_menu", { query: "" }) : reply(),
    },
    meta: {
      send: async (p) => {
        sends++;
        assert.equal(p.recipient, f.recipient);
        assert.ok(p.text.includes("USD 5.00"));
        return { kind: "accepted", id: "wamid.pipeline" };
      },
    },
  });
  const secret = randomBytes(32).toString("hex");
  const cfg: Config = {
    environment: "test",
    port: 3000,
    databaseUrl: target.toString(),
    webhookDatabaseUrl: target.toString(),
    supabaseUrl: "https://pqffgbpbreuhivxxctvr.supabase.co",
    whatsappVerifyToken: randomBytes(32).toString("hex"),
    whatsappAppSecret: secret,
    adminAllowedOrigins: ["http://localhost:5173"],
  };
  const app = await buildApp({
    config: cfg,
    auth: {
      verify: async () => {
        throw Error("unused");
      },
    },
    identities: {} as any,
    inbox: new PostgresInboxRepository(ingress),
    readiness: async () => {
      await checkDatabaseRole(api, "api");
      await checkDatabaseRole(ingress, "ingress");
    },
    logger: false,
    ingressLimit: ingressLimiter(ingress, randomBytes(32).toString("hex")),
  });
  try {
    const post = async (value: object) => {
      const body = JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            id: "synthetic",
            changes: [
              {
                field: "messages",
                value: { metadata: { phone_number_id: f.phone }, ...value },
              },
            ],
          },
        ],
      });
      return app.inject({
        method: "POST",
        url: "/webhooks/whatsapp",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256":
            "sha256=" + createHmac("sha256", secret).update(body).digest("hex"),
        },
        payload: body,
      });
    };
    const inbound = {
      messages: [
        {
          from: f.recipient,
          id: "wamid.pipeline.in",
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body: "Menú" },
        },
      ],
    };
    assert.equal((await post(inbound)).statusCode, 200);
    assert.equal((await post(inbound)).statusCode, 200);
    await runtime.tick();
    await runtime.drain();
    assert.equal(responses, 2);
    assert.equal(sends, 1);
    const row = (
      await admin.query(
        "SELECT * FROM app.outbox_events WHERE business_id=$1 AND event_type='whatsapp.message'",
        [f.tenant],
      )
    ).rows[0];
    assert.equal(row.status, "sent");
    assert.equal(row.provider_message_id, "wamid.pipeline");
    const status = {
      statuses: [
        {
          id: "wamid.pipeline",
          status: "delivered",
          timestamp: String(Math.floor(Date.now() / 1000)),
          recipient_id: f.recipient,
          biz_opaque_callback_data: row.id,
        },
      ],
    };
    assert.equal((await post(status)).statusCode, 200);
    assert.equal((await post(status)).statusCode, 200);
    await runtime.tick();
    await runtime.drain();
    assert.equal(sends, 1);
    assert.equal(
      (
        await admin.query(
          "SELECT delivery_status FROM app.messages WHERE outbox_id=$1",
          [row.id],
        )
      ).rows[0].delivery_status,
      "delivered",
    );
    assert.equal((await app.inject({ url: "/ready" })).statusCode, 200);
    assert.equal((await admin.query("SELECT count(*)::int n FROM app.outbox_events WHERE business_id=$1 AND event_type='message.delivery_updated'", [f.tenant])).rows[0].n, 2);
    assert.ok(!JSON.stringify(events).includes(f.recipient));
    assert.ok(!JSON.stringify(events).includes("USD 5.00"));
  } finally {
    await runtime.drain();
    await app.close();
  }
});
test("duplicate AI job creates one turn, one response and one outbound", async () => {
  const f = await fixture();
  let calls = 0;
  const ai = harness(f, {
    respond: async () => {
      calls++;
      return reply();
    },
  });
  await Promise.all([ai.run(f.tenant, f.inbound), ai.run(f.tenant, f.inbound)]);
  await ai.run(f.tenant, f.inbound);
  assert.equal(calls, 1);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM app.conversation_turns WHERE business_id=$1",
        [f.tenant],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM app.outbox_events WHERE business_id=$1 AND event_type='whatsapp.message'",
        [f.tenant],
      )
    ).rows[0].n,
    1,
  );
});
for (const code of ["AI_TIMEOUT", "AI_RATE_LIMITED", "AI_PROVIDER_ERROR"])
  test(`${code} stops with a real handoff and bounded provider retries`, async () => {
    const f = await fixture();
    f.config.openai.retries = 1;
    let calls = 0;
    await harness(f, {
      respond: async () => {
        calls++;
        throw new ProviderFailure(code, true);
      },
    }).run(f.tenant, f.inbound);
    assert.equal(calls, 2);
    assert.equal(
      (
        await admin.query("SELECT status FROM app.conversations WHERE id=$1", [
          f.ctx.conversation,
        ])
      ).rows[0].status,
      "human_pending",
    );
    assert.equal(
      (
        await admin.query(
          "SELECT error_code FROM app.conversation_turns WHERE business_id=$1",
          [f.tenant],
        )
      ).rows[0].error_code,
      code,
    );
  });
test("budget exceeded does not call OpenAI and records AI_BUDGET_EXCEEDED", async () => {
  const f = await fixture();
  f.config.budget.conversation.responses = 0;
  let calls = 0;
  await harness(f, {
    respond: async () => {
      calls++;
      return reply();
    },
  }).run(f.tenant, f.inbound);
  assert.equal(calls, 0);
  assert.equal(
    (
      await admin.query(
        "SELECT error_code FROM app.conversation_turns WHERE business_id=$1",
        [f.tenant],
      )
    ).rows[0].error_code,
    "AI_BUDGET_EXCEEDED",
  );
});
for (const [name, args, code] of [
  ["execute_sql", {}, "AI_INVALID_TOOL"],
  [
    "add_to_cart",
    {
      product_id: randomUUID(),
      quantity: 1,
      option_ids: [],
      notes: null,
      price_minor: 0,
    },
    "AI_INVALID_TOOL_SCHEMA",
  ],
  ["set_price", { price: 0 }, "AI_INVALID_TOOL"],
  ["send_whatsapp_to_number", { recipient: "12025550000" }, "AI_INVALID_TOOL"],
] as const)
  test(`prompt injection cannot execute ${name}`, async () => {
    const f = await fixture();
    await harness(f, { respond: async () => reply(name, args) }).run(
      f.tenant,
      f.inbound,
    );
    assert.equal(
      (
        await admin.query("SELECT price_minor FROM app.products WHERE id=$1", [
          f.product,
        ])
      ).rows[0].price_minor,
      "500",
    );
    assert.equal(
      (
        await admin.query(
          "SELECT error_code FROM app.conversation_turns WHERE business_id=$1",
          [f.tenant],
        )
      ).rows[0].error_code,
      code,
    );
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int n FROM app.tool_executions WHERE business_id=$1",
          [f.tenant],
        )
      ).rows[0].n,
      0,
    );
  });
test("excessive tool loop stops at the hard limit with no additional calls", async () => {
  const f = await fixture();
  f.config.openai.maxTools = 2;
  let calls = 0;
  await harness(f, {
    respond: async () => {
      calls++;
      return reply("search_menu", { query: "" });
    },
  }).run(f.tenant, f.inbound);
  assert.equal(calls, 3);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM app.tool_executions WHERE business_id=$1",
        [f.tenant],
      )
    ).rows[0].n,
    2,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT error_code FROM app.conversation_turns WHERE business_id=$1",
        [f.tenant],
      )
    ).rows[0].error_code,
    "AI_TOOL_LIMIT",
  );
});
test("handoff while model is thinking discards its result before tools or outbound", async () => {
  const f = await fixture();
  let signal!: () => void, release!: (v: AiReply) => void;
  const started = new Promise<void>((r) => (signal = r)),
    wait = new Promise<AiReply>((r) => (release = r));
  const pending = harness(f, {
    respond: async () => {
      signal();
      return wait;
    },
  }).run(f.tenant, f.inbound);
  await started;
  await base.requestHuman(f.ctx, randomUUID(), "explicit_request");
  release(
    reply("add_to_cart", {
      product_id: f.product,
      quantity: 1,
      option_ids: [],
      notes: null,
    }),
  );
  await pending;
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM app.tool_executions WHERE business_id=$1",
        [f.tenant],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM app.outbox_events WHERE business_id=$1 AND event_type='whatsapp.message'",
        [f.tenant],
      )
    ).rows[0].n,
    0,
  );
});
test("epoch race immediately before mutating service is rejected inside its transaction", async () => {
  const f = await fixture();
  class RacingExecutor extends ToolExecutor {
    override async execute(
      n: string,
      a: any,
      c: CustomerContext,
      k: string,
      i: string,
    ) {
      await base.requestHuman(f.ctx, randomUUID(), "explicit_request");
      return super.execute(n, a, c, k, i);
    }
  }
  await harness(
    f,
    {
      respond: async () =>
        reply("add_to_cart", {
          product_id: f.product,
          quantity: 1,
          option_ids: [],
          notes: null,
        }),
    },
    new RacingExecutor(base),
  ).run(f.tenant, f.inbound);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM app.cart_items WHERE business_id=$1",
        [f.tenant],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT status FROM app.tool_executions WHERE business_id=$1",
        [f.tenant],
      )
    ).rows[0].status,
    "failed",
  );
});
test("shared budgets and circuit breaker survive separate worker instances and isolate tenants", async () => {
  const f = await fixture(),
    other = await fixture();
  const first = new RuntimeSafety(worker, f.config.budget),
    second = new RuntimeSafety(worker, f.config.budget);
  for (let i = 0; i < 3; i++) await first.circuit(f.tenant, "openai", false);
  assert.equal(await second.circuit(f.tenant, "openai"), false);
  assert.equal(await second.circuit(other.tenant, "openai"), true);
  await admin.query(
    "UPDATE app.provider_circuits SET retry_at=now()-interval '1 second' WHERE business_id=$1",
    [f.tenant],
  );
  assert.equal(await first.circuit(f.tenant, "openai"), true);
  assert.equal(await second.circuit(f.tenant, "openai"), false);
  await first.circuit(f.tenant, "openai", true);
  assert.equal(await second.circuit(f.tenant, "openai"), true);
  f.config.budget.tenant.responses = 1;
  await first.reserve(f.tenant, f.ctx.conversation, 1, 1);
  await assert.rejects(
    () => second.reserve(f.tenant, f.ctx.conversation, 1, 1),
    { message: "AI_BUDGET_EXCEEDED" },
  );
  assert.ok(await second.reserve(other.tenant, other.ctx.conversation, 1, 1));
});
async function quoteFixture() {
  const f = await fixture();
  let cart = await base.addToCart(f.ctx, randomUUID(), {
    product_id: f.product,
    option_ids: [],
    quantity: 1,
    notes: null,
  });
  await base.setFulfillment(f.ctx, randomUUID(), "pickup", null, cart.version);
  let calls = 0;
  await harness(f, {
    respond: async (input) => {
      if (++calls === 1) return reply("request_quote");
      assert.ok(!JSON.stringify(input).includes("confirm:"));
      return reply();
    },
  }).run(f.tenant, f.inbound);
  const c = (
      await admin.query(
        "SELECT * FROM app.confirmation_challenges WHERE business_id=$1",
        [f.tenant],
      )
    ).rows[0],
    o = (
      await admin.query(
        "SELECT * FROM app.outbox_events WHERE business_id=$1 AND event_type='whatsapp.message'",
        [f.tenant],
      )
    ).rows[0];
  const button = cipher.open(
    challengeBinding(
      f.tenant,
      f.ctx.conversation,
      f.ctx.customer,
      c.order_id,
      c.order_version,
      c.id,
    ),
    c.transport_cipher,
  );
  return { ...f, challenge: c, outbox: o, button };
}
test("quote transport is encrypted atomically, one-shot and excluded from AI, logs and outbox plaintext", async () => {
  const f = await quoteFixture();
  assert.equal(
    f.challenge.nonce_hash,
    createHash("sha256").update(f.button.split(":")[2]!).digest("hex"),
  );
  assert.ok(f.outbox.payload.text.includes("Total: USD 5.00"));
  assert.ok(!f.outbox.payload.text.includes("NaN"));
  for (const table of [
    "outbox_events",
    "messages",
    "conversation_turns",
    "tool_executions",
    "audit_logs",
    "idempotency_keys",
    "confirmation_challenges",
  ]) {
    const rows = (
      await admin.query(
        `SELECT to_jsonb(t) v FROM app.${table} t WHERE business_id=$1`,
        [f.tenant],
      )
    ).rows;
    assert.ok(!JSON.stringify(rows).includes(f.button));
  }
  const encrypted = new OrderingService(
    worker,
    new EncryptedQuoteTransport(cipher),
  );
  await encrypted.requestQuote({ ...f.ctx, automationEpoch: 1 });
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM app.outbox_events WHERE business_id=$1 AND event_type='whatsapp.message'",
        [f.tenant],
      )
    ).rows[0].n,
    1,
  );
});
test("expired encrypted quote is cancelled and replaced at a new cart version", async () => {
  const f = await quoteFixture();
  const cartBefore = (
    await admin.query("SELECT * FROM app.carts WHERE business_id=$1", [
      f.tenant,
    ])
  ).rows[0];
  await admin.query(
    "UPDATE app.confirmation_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",
    [f.challenge.id],
  );

  const replacement = await new OrderingService(
    worker,
    new EncryptedQuoteTransport(cipher),
  ).requestQuote({ ...f.ctx, automationEpoch: 1 });

  assert.notEqual(replacement.order.id, f.challenge.order_id);
  assert.ok(replacement.confirmation_button);
  const oldOrder = (
    await admin.query("SELECT * FROM app.orders WHERE id=$1", [
      f.challenge.order_id,
    ])
  ).rows[0];
  assert.equal(oldOrder.status, "cancelled");
  assert.equal(oldOrder.cancellation_reason, "QUOTE_EXPIRED");
  const cartAfter = (
    await admin.query("SELECT * FROM app.carts WHERE id=$1", [cartBefore.id])
  ).rows[0];
  assert.equal(cartAfter.status, "active");
  assert.equal(cartAfter.version, cartBefore.version + 1);
  const newOrder = (
    await admin.query("SELECT * FROM app.orders WHERE id=$1", [
      replacement.order.id,
    ])
  ).rows[0];
  assert.equal(newOrder.source_cart_version, cartAfter.version);

  const newChallenge = (
    await admin.query(
      "SELECT * FROM app.confirmation_challenges WHERE order_id=$1",
      [replacement.order.id],
    )
  ).rows[0];
  assert.ok(newChallenge.transport_cipher);
  assert.equal(
    cipher.open(
      challengeBinding(
        f.tenant,
        f.ctx.conversation,
        f.ctx.customer,
        replacement.order.id,
        replacement.order.version,
        newChallenge.id,
      ),
      newChallenge.transport_cipher,
    ),
    replacement.confirmation_button,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM app.outbox_events WHERE business_id=$1 AND event_type='whatsapp.message'",
        [f.tenant],
      )
    ).rows[0].n,
    2,
  );

  const staleMessage = await insert("messages", {
    business_id: f.tenant,
    conversation_id: f.ctx.conversation,
    direction: "inbound",
    kind: "interactive",
    content: { id: confirmationEvidence(f.button), title: "Confirm" },
    actor_type: "customer",
  });
  await assert.rejects(
    () => base.confirmOrder(f.ctx, staleMessage.id),
    { code: "QUOTE_EXPIRED" },
  );
});
test("Meta acceptance persists provider id and monotonic duplicated/out-of-order statuses", async () => {
  const f = await quoteFixture();
  const safety = new RuntimeSafety(worker, f.config.budget);
  let sends = 0;
  const dispatcher = new MetaDispatcher(
    worker,
    {
      send: async (p) => {
        sends++;
        assert.equal(p.button, f.button);
        return { kind: "accepted", id: "wamid.synthetic" };
      },
    },
    cipher,
    f.config,
    safety,
  );
  await dispatcher.tick(f.tenant);
  await dispatcher.tick(f.tenant);
  assert.equal(sends, 1);
  for (const status of ["read", "sent", "delivered", "read", "failed"])
    await scoped(worker, f.tenant, (r) =>
      reconcileStatus(r, {
        id: randomUUID(),
        channel_id: f.channel,
        payload: {
          provider_message_id: "wamid.synthetic",
          provider_timestamp: new Date().toISOString(),
          content: { status, callback: f.outbox.id },
        },
      }),
    );
  assert.equal(
    (
      await admin.query(
        "SELECT delivery_status,status FROM app.outbox_events WHERE id=$1",
        [f.outbox.id],
      )
    ).rows[0].delivery_status,
    "read",
  );
  assert.equal(
    (
      await admin.query(
        "SELECT delivery_status FROM app.messages WHERE outbox_id=$1",
        [f.outbox.id],
      )
    ).rows[0].delivery_status,
    "read",
  );
});
for (const initial of ["pending", "unknown"] as const)
  test(`Meta acceptance emits sent evidence atomically from ${initial}, with duplicate callback ignored`, async () => {
    const f = await quoteFixture(), id = "wamid.acceptance." + randomUUID();
    const sent: string[] = [];
    const dispatcher = new MetaDispatcher(worker, {
      send: async () => {
        sent.push(id);
        if (initial === "unknown") {
          await admin.query("UPDATE app.outbox_events SET status='unknown' WHERE id=$1", [f.outbox.id]);
          await admin.query("UPDATE app.messages SET delivery_status='unknown' WHERE outbox_id=$1", [f.outbox.id]);
        }
        return { kind: "accepted", id };
      },
    }, cipher, f.config, new RuntimeSafety(worker, f.config.budget));
    assert.ok(await dispatcher.tick(f.tenant));
    const message = (await admin.query("SELECT * FROM app.messages WHERE outbox_id=$1", [f.outbox.id])).rows[0];
    assert.equal(message.delivery_status, "sent");
    assert.equal(message.provider_message_id, id);
    const evidence = async () => (await admin.query("SELECT * FROM app.outbox_events WHERE business_id=$1 AND event_type='message.delivery_updated'", [f.tenant])).rows;
    const events = await evidence();
    assert.equal(events.length, 1);
    assert.equal(events[0].aggregate_id, message.id);
    assert.equal(events[0].aggregate_version, message.version);
    assert.equal(events[0].conversation_id, message.conversation_id);
    assert.equal(events[0].causation_id, f.outbox.id);
    const entry = (await admin.query("SELECT * FROM app.audit_logs WHERE business_id=$1 AND action='message.delivery_status'", [f.tenant])).rows[0];
    assert.equal(entry.before_redacted.status, initial);
    assert.equal(entry.after_redacted.status, "sent");
    assert.equal(entry.after_redacted.version, message.version);
    await scoped(worker, f.tenant, r => reconcileStatus(r, {
      id: randomUUID(), channel_id: f.channel, payload: {
        provider_message_id: id, provider_timestamp: new Date().toISOString(), content: { status: "sent", callback: f.outbox.id },
      },
    }));
    assert.equal(await dispatcher.tick(f.tenant), false);
    assert.equal(sent.length, 1);
    assert.equal((await evidence()).length, 1);
    assert.equal((await admin.query("SELECT count(*)::int n FROM app.audit_logs WHERE business_id=$1 AND action='message.delivery_status'", [f.tenant])).rows[0].n, 1);
  });
test("failed acceptance evidence rolls back delivery and recovers unknown without resending", async () => {
  const f = await quoteFixture();
  await admin.query(`CREATE FUNCTION app.fail_delivery_evidence_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.business_id='${f.tenant}'::uuid AND NEW.event_type='message.delivery_updated' THEN RAISE EXCEPTION 'controlled evidence failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_delivery_evidence_test BEFORE INSERT ON app.outbox_events FOR EACH ROW EXECUTE FUNCTION app.fail_delivery_evidence_test()`);
  let sends = 0;
  const dispatcher = new MetaDispatcher(worker, {
    send: async () => { sends++; return { kind: "accepted", id: "wamid.accepted-rollback" }; },
  }, cipher, f.config, new RuntimeSafety(worker, f.config.budget));
  try {
    await assert.rejects(() => dispatcher.tick(f.tenant), /controlled evidence failure/);
    const message = (await admin.query("SELECT * FROM app.messages WHERE outbox_id=$1", [f.outbox.id])).rows[0];
    assert.equal(message.delivery_status, "pending");
    assert.equal(message.provider_message_id, null);
    assert.equal((await admin.query("SELECT status FROM app.outbox_events WHERE id=$1", [f.outbox.id])).rows[0].status, "sending");
    assert.equal((await admin.query("SELECT count(*)::int n FROM app.audit_logs WHERE business_id=$1 AND action='message.delivery_status'", [f.tenant])).rows[0].n, 0);
  } finally {
    await admin.query("DROP TRIGGER fail_delivery_evidence_test ON app.outbox_events; DROP FUNCTION app.fail_delivery_evidence_test()");
  }
  await admin.query("UPDATE app.outbox_events SET lease_until=now()-interval '1 second' WHERE id=$1", [f.outbox.id]);
  assert.equal(await dispatcher.tick(f.tenant), false);
  assert.equal(sends, 1);
  assert.equal((await admin.query("SELECT delivery_status FROM app.messages WHERE outbox_id=$1", [f.outbox.id])).rows[0].delivery_status, "unknown");
  assert.equal((await admin.query("SELECT count(*)::int n FROM app.outbox_events WHERE business_id=$1 AND event_type='message.delivery_updated'", [f.tenant])).rows[0].n, 1);
});
for (const stale of ["sent", "delivered", "read"] as const)
  test(`stale Meta ${stale} cannot overwrite a newer failed callback`, async () => {
    const f = await quoteFixture(), id = "wamid.stale." + randomUUID();
    await new MetaDispatcher(worker, { send: async () => ({ kind: "accepted", id }) }, cipher, f.config, new RuntimeSafety(worker, f.config.budget)).tick(f.tenant);
    const at = Date.now();
    const callback = (status: string, timestamp: number) => scoped(worker, f.tenant, r => reconcileStatus(r, {
      id: randomUUID(), channel_id: f.channel, payload: {
        provider_message_id: id, provider_timestamp: new Date(timestamp).toISOString(), content: { status, callback: f.outbox.id },
      },
    }));
    await callback("failed", at);
    const before = (await admin.query("SELECT * FROM app.messages WHERE outbox_id=$1", [f.outbox.id])).rows[0];
    const transport = (await admin.query("SELECT * FROM app.outbox_events WHERE id=$1", [f.outbox.id])).rows[0];
    await callback(stale, at - 1000);
    assert.equal(before.delivery_status, "failed");
    assert.deepEqual((await admin.query("SELECT * FROM app.messages WHERE outbox_id=$1", [f.outbox.id])).rows[0], before);
    assert.deepEqual((await admin.query("SELECT * FROM app.outbox_events WHERE id=$1", [f.outbox.id])).rows[0], transport);
    assert.equal((await admin.query("SELECT count(*)::int n FROM app.outbox_events WHERE business_id=$1 AND event_type='message.delivery_updated'", [f.tenant])).rows[0].n, 2);
    assert.equal((await admin.query("SELECT count(*)::int n FROM app.audit_logs WHERE business_id=$1 AND action='message.delivery_status'", [f.tenant])).rows[0].n, 2);
  });
test("duplicate failed callback advances only the watermark and blocks intervening stale success", async () => {
  const f = await quoteFixture(), id = "wamid.watermark." + randomUUID();
  await new MetaDispatcher(worker, { send: async () => ({ kind: "accepted", id }) }, cipher, f.config, new RuntimeSafety(worker, f.config.budget)).tick(f.tenant);
  const at = Date.now();
  const callback = (status: string, timestamp: number) => scoped(worker, f.tenant, r => reconcileStatus(r, {
    id: randomUUID(), channel_id: f.channel, payload: {
      provider_message_id: id, provider_timestamp: new Date(timestamp).toISOString(), content: { status, callback: f.outbox.id },
    },
  }));
  await callback("failed", at);
  const before = (await admin.query("SELECT * FROM app.messages WHERE outbox_id=$1", [f.outbox.id])).rows[0];
  await callback("failed", at + 2000);
  await callback("delivered", at + 1000);
  assert.deepEqual((await admin.query("SELECT * FROM app.messages WHERE outbox_id=$1", [f.outbox.id])).rows[0], before);
  assert.equal((await admin.query("SELECT provider_status_at FROM app.outbox_events WHERE id=$1", [f.outbox.id])).rows[0].provider_status_at.getTime(), at + 2000);
  assert.equal((await admin.query("SELECT count(*)::int n FROM app.outbox_events WHERE business_id=$1 AND event_type='message.delivery_updated'", [f.tenant])).rows[0].n, 2);
});
for (const status of ["sent", "delivered", "read", "failed"] as const)
  test(`Meta ${status} callback emits a versioned domain event once through inbox processing`, async () => {
    const f = await quoteFixture();
    await admin.query("UPDATE app.outbox_events SET status='unknown',transport_started_at=now() WHERE id=$1", [f.outbox.id]);
    await admin.query("UPDATE app.messages SET delivery_status='unknown' WHERE outbox_id=$1", [f.outbox.id]);
    const repo = new PostgresInboxRepository(ingress),
      core = new InternalWorker(worker, 5, 30, () => {}, { status: reconcileStatus });
    const timestamp = Math.floor(Date.now() / 1000);
    const callback = (at: number) => normalizeEnvelope({
      object: "whatsapp_business_account",
      entry: [{ id: "synthetic", changes: [{ field: "messages", value: {
        metadata: { phone_number_id: f.phone },
        statuses: [{ id: "wamid.event." + f.outbox.id, status, timestamp: String(at), recipient_id: f.recipient, biz_opaque_callback_data: f.outbox.id }],
      } }] }],
    }).events;
    const first = callback(timestamp);
    assert.equal((await repo.ingest(first)).inserted, 1);
    assert.equal((await repo.ingest(first)).duplicates, 1);
    const lease = (await core.claim(f.tenant, "inbox"))!;
    assert.ok(await core.process(lease));
    assert.equal(await core.process(lease), false);
    const message = (await admin.query("SELECT * FROM app.messages WHERE outbox_id=$1", [f.outbox.id])).rows[0];
    const evidence = async () => (await admin.query("SELECT * FROM app.outbox_events WHERE business_id=$1 AND event_type='message.delivery_updated'", [f.tenant])).rows;
    const events = await evidence();
    assert.equal(events.length, 1);
    assert.equal(message.delivery_status, status);
    assert.equal(events[0].conversation_id, f.ctx.conversation);
    assert.equal(events[0].aggregate_id, message.id);
    assert.equal(events[0].aggregate_version, message.version);
    assert.equal(events[0].causation_id, lease.id);
    assert.deepEqual(events[0].payload, { resource_id: message.id, resource_version: message.version });
    // A duplicate state with a different timestamp is a distinct inbox event.
    assert.equal((await repo.ingest(callback(timestamp + 1))).inserted, 1);
    assert.ok(await core.process((await core.claim(f.tenant, "inbox"))!));
    assert.equal((await evidence()).length, 1);
    assert.equal((await admin.query("SELECT version FROM app.messages WHERE id=$1", [message.id])).rows[0].version, message.version);
    assert.equal((await admin.query("SELECT count(*)::int n FROM app.audit_logs WHERE business_id=$1 AND action='message.delivery_status'", [f.tenant])).rows[0].n, 1);
  });
test("Meta message, transport and delivery event reconciliation roll back together", async () => {
  const f = await quoteFixture();
  await admin.query("UPDATE app.outbox_events SET status='unknown',transport_started_at=now() WHERE id=$1", [f.outbox.id]);
  const before = (await admin.query("SELECT * FROM app.messages WHERE outbox_id=$1", [f.outbox.id])).rows[0];
  await assert.rejects(() => scoped(worker, f.tenant, async (r) => {
    await reconcileStatus(r, { id: randomUUID(), channel_id: f.channel, payload: {
      provider_message_id: "wamid.rollback", provider_timestamp: new Date().toISOString(), content: { status: "read", callback: f.outbox.id },
    } });
    throw Error("controlled rollback");
  }), /controlled rollback/);
  assert.deepEqual((await admin.query("SELECT * FROM app.messages WHERE id=$1", [before.id])).rows[0], before);
  assert.equal((await admin.query("SELECT status FROM app.outbox_events WHERE id=$1", [f.outbox.id])).rows[0].status, "unknown");
  assert.equal((await admin.query("SELECT count(*)::int n FROM app.outbox_events WHERE business_id=$1 AND event_type='message.delivery_updated'", [f.tenant])).rows[0].n, 0);
  assert.equal((await admin.query("SELECT count(*)::int n FROM app.audit_logs WHERE business_id=$1 AND action='message.delivery_status'", [f.tenant])).rows[0].n, 0);
});
test("ambiguous Meta timeout stays unknown and signed callback reconciles without resend", async () => {
  const f = await quoteFixture();
  let sends = 0;
  const dispatcher = new MetaDispatcher(
    worker,
    {
      send: async () => {
        sends++;
        return { kind: "unknown", code: "META_AMBIGUOUS" };
      },
    },
    cipher,
    f.config,
    new RuntimeSafety(worker, f.config.budget),
  );
  await dispatcher.tick(f.tenant);
  await dispatcher.tick(f.tenant);
  assert.equal(sends, 1);
  assert.equal(
    (
      await admin.query("SELECT status FROM app.outbox_events WHERE id=$1", [
        f.outbox.id,
      ])
    ).rows[0].status,
    "unknown",
  );
  await scoped(worker, f.tenant, (r) =>
    reconcileStatus(r, {
      id: randomUUID(),
      channel_id: f.channel,
      payload: {
        provider_message_id: "wamid.accepted-late",
        provider_timestamp: new Date().toISOString(),
        content: { status: "delivered", callback: f.outbox.id },
      },
    }),
  );
  assert.equal(
    (
      await admin.query("SELECT status FROM app.outbox_events WHERE id=$1", [
        f.outbox.id,
      ])
    ).rows[0].status,
    "sent",
  );
  await dispatcher.tick(f.tenant);
  assert.equal(sends, 1);
});
test("crash after durable send intent is recovered as unknown without a second HTTP call", async () => {
  const f = await quoteFixture();
  await admin.query(
    "UPDATE app.outbox_events SET status='sending',lease_until=now()-interval '1 second',transport_started_at=now(),attempts=1 WHERE id=$1",
    [f.outbox.id],
  );
  let sends = 0;
  await new MetaDispatcher(
    worker,
    {
      send: async () => {
        sends++;
        return { kind: "accepted", id: "wamid.duplicate" };
      },
    },
    cipher,
    f.config,
    new RuntimeSafety(worker, f.config.budget),
  ).tick(f.tenant);
  assert.equal(sends, 0);
  assert.equal(
    (
      await admin.query("SELECT status FROM app.outbox_events WHERE id=$1", [
        f.outbox.id,
      ])
    ).rows[0].status,
    "unknown",
  );
});
test("concurrent Meta claims dispatch once and provider rejection dead-letters", async () => {
  const f = await quoteFixture();
  let sends = 0;
  const dispatcher = new MetaDispatcher(
    worker,
    {
      send: async () => {
        sends++;
        return { kind: "rejected", code: "META_REJECTED" };
      },
    },
    cipher,
    f.config,
    new RuntimeSafety(worker, f.config.budget),
  );
  await Promise.all(Array.from({ length: 6 }, () => dispatcher.tick(f.tenant)));
  assert.equal(sends, 1);
  assert.equal(
    (
      await admin.query("SELECT status FROM app.outbox_events WHERE id=$1", [
        f.outbox.id,
      ])
    ).rows[0].status,
    "dead_letter",
  );
});
for (const blockedScope of ["customer", "tenant"] as const)
  test(`Meta ${blockedScope} quota defers the row without spending partial quota`, async () => {
    const f = await fixture();
    await harness(f, { respond: async () => reply() }).run(f.tenant, f.inbound);
    const otherCustomer = await insert("customers", {
        business_id: f.tenant,
        channel_user_id: f.recipient + "1",
      }),
      otherConversation = await insert("conversations", {
        business_id: f.tenant,
        customer_id: otherCustomer.id,
        channel_id: f.channel,
        expires_at: new Date(Date.now() + 3600000),
        last_customer_message_at: new Date(),
      }),
      otherInbound = await insert("messages", {
        business_id: f.tenant,
        conversation_id: otherConversation.id,
        direction: "inbound",
        kind: "text",
        content: { text: "Menú" },
        actor_type: "customer",
        provider_message_id: "wamid.other." + randomUUID(),
      });
    f.config.meta.recipients.push(otherCustomer.channel_user_id);
    await harness({
      ...f,
      ctx: { tenant: f.tenant, customer: otherCustomer.id, conversation: otherConversation.id },
      inbound: otherInbound.id,
    }, { respond: async () => reply() }).run(f.tenant, otherInbound.id);
    const blocked = (await admin.query(
      "UPDATE app.outbox_events SET next_attempt_at=now()-interval '2 minutes' WHERE business_id=$1 AND event_type='whatsapp.message' AND conversation_id=$2 RETURNING *",
      [f.tenant, f.ctx.conversation],
    )).rows[0];
    await admin.query(
      "UPDATE app.outbox_events SET next_attempt_at=now()-interval '1 minute' WHERE business_id=$1 AND event_type='whatsapp.message' AND conversation_id=$2",
      [f.tenant, otherConversation.id],
    );
    // Seed adjacent windows too, so crossing a minute boundary cannot weaken this test.
    for (const [scope, count] of [
      ["tenant", blockedScope === "tenant" ? 60 : 7],
      [f.ctx.customer, blockedScope === "customer" ? 10 : 3],
    ] as const)
      await admin.query(
        "INSERT INTO app.runtime_windows(business_id,kind,scope,window_start,count) SELECT $1,'outbound',$2,date_trunc('minute',clock_timestamp())+make_interval(mins=>n),$3 FROM generate_series(-1,1) n",
        [f.tenant, scope, count],
      );
    const counters = async () => (await admin.query(
      "SELECT scope,window_start,count FROM app.runtime_windows WHERE business_id=$1 AND kind='outbound' ORDER BY scope,window_start",
      [f.tenant],
    )).rows;
    const before = await counters(), sent: string[] = [];
    const dispatcher = new MetaDispatcher(worker, {
      send: async (payload) => {
        sent.push(payload.recipient);
        return { kind: "accepted", id: "wamid.quota." + randomUUID() };
      },
    }, cipher, f.config, new RuntimeSafety(worker, f.config.budget));
    assert.equal(await dispatcher.tick(f.tenant), false);
    assert.deepEqual(await counters(), before);
    const deferred = (await admin.query("SELECT * FROM app.outbox_events WHERE id=$1", [blocked.id])).rows[0];
    assert.equal(deferred.status, "pending");
    assert.equal(deferred.attempts, 0);
    assert.equal(deferred.fencing_token, blocked.fencing_token);
    assert.equal(deferred.transport_started_at, null);
    assert.ok(deferred.next_attempt_at > new Date());
    assert.equal(deferred.last_error_code, blockedScope === "customer" ? "META_CUSTOMER_RATE_LIMITED" : "META_TENANT_RATE_LIMITED");
    assert.equal(await dispatcher.tick(f.tenant), blockedScope === "customer");
    assert.deepEqual(sent, blockedScope === "customer" ? [otherCustomer.channel_user_id] : []);
    if (blockedScope === "customer") {
      const after = await counters();
      assert.equal(after.filter(row => row.scope === "tenant").reduce((n, row) => n + Number(row.count), 0), 22);
      assert.equal(after.filter(row => row.scope === f.ctx.customer).reduce((n, row) => n + Number(row.count), 0), 30);
      assert.equal(after.filter(row => row.scope === otherCustomer.id).reduce((n, row) => n + Number(row.count), 0), 1);
    } else assert.deepEqual(await counters(), before);
  });
test("definite Meta 429 is retried with backoff; fifth failure dead-letters", async () => {
  const f = await quoteFixture();
  const dispatcher = new MetaDispatcher(
    worker,
    { send: async () => ({ kind: "retry", code: "META_RATE_LIMITED" }) },
    cipher,
    f.config,
    new RuntimeSafety(worker, f.config.budget),
  );
  for (let i = 0; i < 5; i++) {
    await admin.query(
      "UPDATE app.provider_circuits SET state='closed' WHERE business_id=$1",
      [f.tenant],
    );
    await admin.query(
      "UPDATE app.outbox_events SET next_attempt_at=now() WHERE id=$1",
      [f.outbox.id],
    );
    await dispatcher.tick(f.tenant);
  }
  assert.equal(
    (
      await admin.query(
        "SELECT status,attempts FROM app.outbox_events WHERE id=$1",
        [f.outbox.id],
      )
    ).rows[0].status,
    "dead_letter",
  );
});
for (const invalid of [
  "expired",
  "version",
  "wrong_customer",
  "wrong_conversation",
  "replay",
])
  test(`encrypted interactive confirmation rejects ${invalid}`, async () => {
    const f = await quoteFixture();
    const message = async (conversation: string) =>
      insert("messages", {
        business_id: f.tenant,
        conversation_id: conversation,
        direction: "inbound",
        actor_type: "customer",
        kind: "interactive",
        content: { id: confirmationEvidence(f.button), title: "Confirm" },
      });
    let ctx = f.ctx;
    if (invalid === "expired")
      await admin.query(
        "UPDATE app.confirmation_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",
        [f.challenge.id],
      );
    if (invalid === "version")
      await admin.query("UPDATE app.orders SET updated_by=NULL WHERE id=$1", [
        f.challenge.order_id,
      ]);
    if (["wrong_customer", "wrong_conversation"].includes(invalid)) {
      if (invalid === "wrong_conversation")
        await admin.query(
          "UPDATE app.conversations SET status='closed',automation_epoch=automation_epoch+1 WHERE id=$1",
          [f.ctx.conversation],
        );
      const customer =
        invalid === "wrong_customer"
          ? await insert("customers", {
              business_id: f.tenant,
              channel_user_id: String(13025550000 + serial),
            })
          : { id: f.ctx.customer };
      const conv = await insert("conversations", {
        business_id: f.tenant,
        customer_id: customer.id,
        channel_id: f.channel,
        expires_at: new Date(Date.now() + 3600000),
      });
      ctx = { ...f.ctx, customer: customer.id, conversation: conv.id };
    }
    if (invalid === "replay") {
      const first = await message(ctx.conversation);
      await base.confirmOrder(ctx, first.id);
    }
    const m = await message(ctx.conversation);
    await assert.rejects(() => base.confirmOrder(ctx, m.id));
  });
test("duplicate normalized interactive inbox consumes encrypted challenge exactly once", async () => {
  const f = await quoteFixture();
  const raw = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "synthetic",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: f.phone },
              messages: [
                {
                  from: f.recipient,
                  id: "wamid.confirm." + randomUUID(),
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "interactive",
                  interactive: {
                    type: "button_reply",
                    button_reply: { id: f.button, title: "Confirm" },
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const events = normalizeEnvelope(raw).events;
  const repo = new PostgresInboxRepository(ingress);
  assert.equal((await repo.ingest(events)).inserted, 1);
  assert.equal((await repo.ingest(events)).duplicates, 1);
  const core = new InternalWorker(worker, 5, 30, () => {}, {
    status: reconcileStatus,
    confirmed: (r, ctx, order, inbound) =>
      store.confirmedWithin(r, ctx, order, inbound),
  });
  assert.ok(await core.process((await core.claim(f.tenant, "inbox"))!));
  assert.equal(
    (
      await admin.query("SELECT status FROM app.orders WHERE id=$1", [
        f.challenge.order_id,
      ])
    ).rows[0].status,
    "confirmed",
  );
  assert.ok(
    (
      await admin.query(
        "SELECT consumed_at FROM app.confirmation_challenges WHERE id=$1",
        [f.challenge.id],
      )
    ).rows[0].consumed_at,
  );
  const ack = (
    await admin.query(
      "SELECT payload FROM app.outbox_events WHERE business_id=$1 AND dedupe_key LIKE 'confirmed:%'",
      [f.tenant],
    )
  ).rows;
  assert.equal(ack.length, 1);
  assert.ok(ack[0].payload.text.includes("pago continúa pendiente"));
});
test("tenant and customer rate limits are durable, concurrent and tenant isolated", async () => {
  const f = await fixture(),
    other = await fixture();
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      scoped(worker, f.tenant, (r) => rate(r, "inbound", f.ctx.customer, 3)),
    ),
  );
  assert.equal(results.filter(Boolean).length, 3);
  assert.ok(
    await scoped(worker, other.tenant, (r) =>
      rate(r, "inbound", other.ctx.customer, 3),
    ),
  );
});
test("runtime metadata has RLS and denies cross-tenant worker and API budget writes", async () => {
  const f = await fixture(),
    other = await fixture();
  await new RuntimeSafety(worker, other.config.budget).reserve(
    other.tenant,
    other.ctx.conversation,
    1,
    1,
  );
  assert.equal(
    await scoped(
      worker,
      f.tenant,
      async (r) =>
        (
          await r.db.query(
            "SELECT * FROM app.runtime_windows WHERE business_id=$1",
            [other.tenant],
          )
        ).rowCount,
    ),
    0,
  );
  await assert.rejects(
    () =>
      scoped(api, f.tenant, (r) =>
        r.db.query(
          "INSERT INTO app.runtime_windows(business_id,kind,scope,window_start) VALUES($1,'ai','tenant',now())",
          [f.tenant],
        ),
      ),
    { code: "42501" },
  );
});
function inboundText(f: Awaited<ReturnType<typeof fixture>>, id: string, sender = f.recipient) {
  return normalizeEnvelope({ object: "whatsapp_business_account", entry: [{ id: "synthetic", changes: [{ field: "messages", value: {
    metadata: { phone_number_id: f.phone }, messages: [{ from: sender, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Menú" } }],
  } }] }] }).events;
}
function tenantRuntimePool(tenant: string) {
  // Limit scheduler discovery to this fixture; scoped DB operations use the real worker LOGIN.
  return {
    query: async (sql: string, values?: any[]) => sql.startsWith("SELECT id FROM app.businesses")
      ? { rows: [{ id: tenant }] } : worker.query(sql, values),
    connect: () => worker.connect(),
  } as pg.Pool;
}
async function handoffOperator(f: Awaited<ReturnType<typeof fixture>>) {
  const user = randomUUID();
  await admin.query("INSERT INTO auth.users(id) VALUES($1)", [user]);
  await insert("business_memberships", { business_id: f.tenant, user_id: user, role: "owner" });
  return async (action: "claim" | "resolve") => {
    const handoff = (await admin.query("SELECT * FROM app.human_handoffs WHERE business_id=$1", [f.tenant])).rows[0];
    const body = action === "claim"
      ? { expected_version: handoff.version, assigned_user_id: user }
      : { expected_version: handoff.version, action: "resume_bot", resolution: "Synthetic operator resume" };
    const request = randomUUID();
    return new DomainTransactions(api).run({ user, tenant: f.tenant, roles: ["owner"], operation: "handoff." + action, key: randomUUID(), request, input: body },
      (r, role) => new OperationsService().execute(r, { id: user, type: "human", role }, {
        method: "post", path: "/handoffs/{handoff_id}/" + action, params: { handoff_id: handoff.id }, query: {}, body, request,
      }));
  };
}
test("expired AI conversation cannot starve a newer conversation of the same tenant", async () => {
  const f = await fixture();
  await admin.query("UPDATE app.conversations SET expires_at=now()-interval '1 second' WHERE id=$1", [f.ctx.conversation]);
  const customer = await insert("customers", { business_id: f.tenant, channel_user_id: f.recipient + "1" });
  const conversation = await insert("conversations", { business_id: f.tenant, customer_id: customer.id, channel_id: f.channel, expires_at: new Date(Date.now() + 3600000) });
  const inbound = await insert("messages", { business_id: f.tenant, conversation_id: conversation.id, direction: "inbound", kind: "text", actor_type: "customer", content: { text: "Menú" } });
  assert.equal(await store.pending(f.tenant), inbound.id);
  assert.equal(await store.start(f.tenant, f.inbound, "synthetic-model"), null);
  f.config.metaEnabled = false;
  let calls = 0;
  const runtime = new RuntimeWorker(tenantRuntimePool(f.tenant), f.config, () => {}, { ai: { respond: async () => { calls++; return reply(); } } });
  await runtime.tick(); await runtime.drain();
  assert.equal(calls, 1);
  assert.equal((await admin.query("SELECT inbound_message_id FROM app.conversation_turns WHERE business_id=$1", [f.tenant])).rows[0].inbound_message_id, inbound.id);
});
test("AI selection skips a held conversation and recovers its queued work after lease expiry", async () => {
  const f = await fixture(), held = (await store.start(f.tenant, f.inbound, "synthetic-model"))!;
  const queued = await insert("messages", { business_id: f.tenant, conversation_id: f.ctx.conversation, direction: "inbound", kind: "text", actor_type: "customer", content: { text: "Otro mensaje" } });
  const customer = await insert("customers", { business_id: f.tenant, channel_user_id: f.recipient + "1" });
  const conversation = await insert("conversations", { business_id: f.tenant, customer_id: customer.id, channel_id: f.channel, expires_at: new Date(Date.now() + 3600000) });
  const other = await insert("messages", { business_id: f.tenant, conversation_id: conversation.id, direction: "inbound", kind: "text", actor_type: "customer", content: { text: "Menú" } });
  assert.equal(await store.pending(f.tenant), other.id);
  await admin.query("UPDATE app.conversation_turns SET lease_until=now()-interval '1 second' WHERE id=$1", [held.id]);
  assert.equal(await store.pending(f.tenant), queued.id);
  assert.ok(await store.start(f.tenant, queued.id, "synthetic-model"));
  assert.equal((await admin.query("SELECT error_code FROM app.conversation_turns WHERE id=$1", [held.id])).rows[0].error_code, "AI_TURN_INTERRUPTED");
});
for (const phase of ["human_pending", "human_active", "delayed_ingress"] as const)
  test(`messages from ${phase} cannot replay after resume, while fresh messages can run`, async () => {
    const f = await fixture();
    f.config.aiEnabled = false; f.config.metaEnabled = false;
    await base.requestHuman(f.ctx, randomUUID(), "explicit_request");
    const operator = await handoffOperator(f);
    if (phase !== "human_pending") await operator("claim");
    const ingressRepo = new PostgresInboxRepository(ingress), id = "wamid.handoff." + randomUUID();
    await ingressRepo.ingest(inboundText(f, id));
    const disabled = new RuntimeWorker(tenantRuntimePool(f.tenant), f.config);
    if (phase !== "delayed_ingress") { await disabled.tick(); await disabled.drain(); }
    if (phase === "human_pending") await operator("claim");
    await operator("resolve");
    if (phase === "delayed_ingress") { await disabled.tick(); await disabled.drain(); }
    const message = (await admin.query("SELECT * FROM app.messages WHERE business_id=$1 AND provider_message_id=$2", [f.tenant, id])).rows[0];
    const disposition = (await admin.query("SELECT * FROM app.conversation_turns WHERE inbound_message_id=$1", [message.id])).rows[0];
    assert.equal(disposition.status, "failed"); assert.equal(disposition.error_code, "AI_INBOUND_HANDOFF");
    assert.equal(disposition.provider, null); assert.equal(disposition.responses, 0);
    assert.equal(await store.pending(f.tenant), undefined);
    assert.equal(await store.start(f.tenant, message.id, "synthetic-model"), null);
    assert.equal(await store.start(f.tenant, f.inbound, "synthetic-model"), null);
    f.config.aiEnabled = true;
    let calls = 0;
    const resumed = new RuntimeWorker(tenantRuntimePool(f.tenant), f.config, () => {}, { ai: { respond: async () => { calls++; return reply(); } } });
    await resumed.tick(); await resumed.drain(); assert.equal(calls, 0);
    await ingressRepo.ingest(inboundText(f, "wamid.fresh." + randomUUID()));
    await resumed.tick(); await resumed.drain(); assert.equal(calls, 1);
    assert.equal((await admin.query("SELECT count(*)::int n FROM app.cart_items WHERE business_id=$1", [f.tenant])).rows[0].n, 0);
  });
for (const scope of ["customer", "tenant"] as const)
  test(`inbound ${scope} rate limit defers without spending failure attempts or quota`, async () => {
    const f = await fixture(); f.config.aiEnabled = false; f.config.metaEnabled = false;
    const observations: Record<string, unknown>[] = [];
    const runtime = new RuntimeWorker(worker, f.config, v => observations.push(v));
    const id = "wamid.inbound-rate." + randomUUID();
    await new PostgresInboxRepository(ingress).ingest(inboundText(f, id));
    const event = (await admin.query("SELECT * FROM app.webhook_events WHERE business_id=$1", [f.tenant])).rows[0];
    await admin.query("UPDATE app.webhook_events SET attempts=4 WHERE id=$1", [event.id]);
    for (const [key, count] of [["tenant", scope === "tenant" ? 600 : 7], [f.ctx.customer, scope === "customer" ? 30 : 3]] as const)
      await admin.query("INSERT INTO app.runtime_windows(business_id,kind,scope,window_start,count) SELECT $1,'inbound',$2,date_trunc('minute',clock_timestamp())+make_interval(mins=>n),$3 FROM generate_series(-1,1) n", [f.tenant, key, count]);
    const counters = async () => (await admin.query("SELECT scope,window_start,count FROM app.runtime_windows WHERE business_id=$1 AND kind='inbound' ORDER BY scope,window_start", [f.tenant])).rows;
    const before = await counters();
    for (let n = 0; n < 6; n++) {
      await admin.query("UPDATE app.webhook_events SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [event.id]);
      const lease = (await runtime.internal.claim(f.tenant, "inbox"))!;
      assert.equal(await runtime.internal.process(lease), false);
      assert.equal(await runtime.internal.process(lease), false);
      const deferred = (await admin.query("SELECT * FROM app.webhook_events WHERE id=$1", [event.id])).rows[0];
      assert.equal(deferred.status, "pending"); assert.equal(deferred.attempts, 4);
      assert.equal(deferred.last_error_code, "INBOUND_RATE_LIMITED");
      assert.ok(deferred.next_attempt_at > new Date());
      assert.equal(await runtime.internal.claim(f.tenant, "inbox"), null);
    }
    assert.deepEqual(await counters(), before);
    assert.equal((await admin.query("SELECT count(*)::int n FROM app.messages WHERE business_id=$1 AND provider_message_id=$2", [f.tenant, id])).rows[0].n, 0);
    assert.ok(observations.every(v => v.event_type === "worker.deferred"));
    await admin.query("UPDATE app.runtime_windows SET count=0 WHERE business_id=$1 AND kind='inbound'", [f.tenant]);
    await admin.query("UPDATE app.webhook_events SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [event.id]);
    assert.ok(await runtime.internal.process((await runtime.internal.claim(f.tenant, "inbox"))!));
    const processed = (await admin.query("SELECT status,attempts FROM app.webhook_events WHERE id=$1", [event.id])).rows[0];
    assert.equal(processed.status, "processed"); assert.equal(processed.attempts, 5);
    assert.equal((await admin.query("SELECT count(*)::int n FROM app.messages WHERE business_id=$1 AND provider_message_id=$2", [f.tenant, id])).rows[0].n, 1);
  });
test("feature flags disabled invoke neither provider and paused conversations create no turn", async () => {
  const f = await fixture();
  f.config.aiEnabled = false;
  let calls = 0;
  await harness(f, {
    respond: async () => {
      calls++;
      return reply();
    },
  }).run(f.tenant, f.inbound);
  assert.equal(calls, 0);
  f.config.aiEnabled = true;
  await admin.query(
    "UPDATE app.business_settings SET ai_enabled=false WHERE business_id=$1",
    [f.tenant],
  );
  await harness(f, {
    respond: async () => {
      calls++;
      return reply();
    },
  }).run(f.tenant, f.inbound);
  assert.equal(calls, 0);
  await admin.query(
    "UPDATE app.business_settings SET ai_enabled=true WHERE business_id=$1",
    [f.tenant],
  );
  await base.requestHuman(f.ctx, randomUUID(), "explicit_request");
  await harness(f, {
    respond: async () => {
      calls++;
      return reply();
    },
  }).run(f.tenant, f.inbound);
  assert.equal(calls, 0);
});

for (const dimension of ["input", "output", "tools"] as const)
  test(
    "local " +
      dimension +
      " budget is checked before the provider or tool executes",
    async () => {
      const f = await fixture();
      f.config.budget.conversation[dimension] = 0;
      let calls = 0;
      await harness(f, {
        respond: async () => {
          calls++;
          return reply("add_to_cart", {
            product_id: f.product,
            quantity: 1,
            option_ids: [],
            notes: null,
          });
        },
      }).run(f.tenant, f.inbound);
      assert.equal(calls, dimension === "tools" ? 1 : 0);
      assert.equal(
        (
          await admin.query(
            "SELECT error_code FROM app.conversation_turns WHERE business_id=$1",
            [f.tenant],
          )
        ).rows[0].error_code,
        "AI_BUDGET_EXCEEDED",
      );
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int n FROM app.cart_items WHERE business_id=$1",
            [f.tenant],
          )
        ).rows[0].n,
        0,
      );
    },
  );
test("readiness rejects direct grants in addition to mismatched capability roles", async () => {
  await admin.query("GRANT SELECT ON app.businesses TO worker_runtime_test");
  try {
    await assert.rejects(() => checkDatabaseRole(worker, "worker"));
  } finally {
    await admin.query(
      "REVOKE SELECT ON app.businesses FROM worker_runtime_test",
    );
  }
  await checkDatabaseRole(worker, "worker");
});
test("webhook limits share durable HMAC windows and store no IP", async () => {
  const key = randomBytes(32).toString("hex");
  const hash = (s: string) =>
    createHmac("sha256", Buffer.from(key, "hex")).update(s).digest("hex");
  const ip = "198.51.100.44";
  await admin.query(
    "INSERT INTO app.ingress_rate_windows VALUES($1,date_trunc('minute',clock_timestamp()),300)",
    [hash("ip:" + ip)],
  );
  await assert.rejects(() => ingressLimiter(ingress, key)(ip), {
    code: "RATE_LIMITED",
  });
  await ingressLimiter(ingress, key)("198.51.100.45");
  await admin.query(
    "UPDATE app.ingress_rate_windows SET count=10000 WHERE key_hash=$1",
    [hash("emergency")],
  );
  await assert.rejects(() => ingressLimiter(ingress, key)("198.51.100.46"), {
    code: "RATE_LIMITED",
  });
  assert.ok(
    !(
      await admin.query("SELECT key_hash FROM app.ingress_rate_windows")
    ).rows.some((r) => r.key_hash.includes("198.51")),
  );
});
for (const issue of [
  "handoff",
  "expired",
  "wrong_key",
  "window_expired",
  "window_missing",
  "window_future",
] as const)
  test("Meta preflight rejects " + issue + " before sending", async () => {
    const f = await quoteFixture();
    if (issue === "handoff")
      await base.requestHuman(f.ctx, randomUUID(), "explicit_request");
    if (issue === "expired")
      await admin.query(
        "UPDATE app.confirmation_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",
        [f.challenge.id],
      );
    if (issue.startsWith("window_"))
      await admin.query(
        "UPDATE app.conversations SET last_customer_message_at=$2 WHERE id=$1",
        [
          f.ctx.conversation,
          issue === "window_missing"
            ? null
            : new Date(
                Date.now() +
                  (issue === "window_expired" ? -25 * 3600000 : 3600000),
              ),
        ],
      );
    let calls = 0;
    await new MetaDispatcher(
      worker,
      {
        send: async () => {
          calls++;
          return { kind: "accepted", id: "wamid.forbidden" };
        },
      },
      issue === "wrong_key"
        ? new ChallengeCipher("v2", { v2: randomBytes(32).toString("hex") })
        : cipher,
      f.config,
      new RuntimeSafety(worker, f.config.budget),
    ).tick(f.tenant);
    assert.equal(calls, 0);
    assert.equal(
      (
        await admin.query("SELECT status FROM app.outbox_events WHERE id=$1", [
          f.outbox.id,
        ])
      ).rows[0].status,
      "dead_letter",
    );
    if (issue.startsWith("window_"))
      assert.equal(
        (
          await admin.query(
            "SELECT last_error_code FROM app.outbox_events WHERE id=$1",
            [f.outbox.id],
          )
        ).rows[0].last_error_code,
        "META_WINDOW_CLOSED",
      );
  });
test("unknown, malformed and foreign-channel status cannot corrupt known messages", async () => {
  const f = await quoteFixture();
  await new MetaDispatcher(
    worker,
    { send: async () => ({ kind: "accepted", id: "wamid.status-scope" }) },
    cipher,
    f.config,
    new RuntimeSafety(worker, f.config.budget),
  ).tick(f.tenant);
  for (const [channel, callback, id] of [
    [f.channel, "-".repeat(36), "wamid.unknown"],
    [randomUUID(), f.outbox.id, "wamid.status-scope"],
  ])
    await scoped(worker, f.tenant, (r) =>
      reconcileStatus(r, {
        id: randomUUID(),
        channel_id: channel,
        payload: {
          provider_message_id: id,
          provider_timestamp: new Date().toISOString(),
          content: { status: "read", callback },
        },
      }),
    );
  assert.equal(
    (
      await admin.query(
        "SELECT delivery_status FROM app.messages WHERE outbox_id=$1",
        [f.outbox.id],
      )
    ).rows[0].delivery_status,
    "sent",
  );
});
test("SQL keeps approved tool slots immutable and prevents blind resend of unknown", async () => {
  const f = await fixture();
  const turn = (await store.start(f.tenant, f.inbound, "synthetic-model"))!;
  const hash = createHash("sha256").update("{}").digest("hex");
  await store.toolStart(turn, 0, "get_cart", hash);
  await assert.rejects(
    () =>
      scoped(worker, f.tenant, (r) =>
        r.db.query(
          "UPDATE app.conversation_turns SET runtime_plan=$2 WHERE id=$1",
          [turn.id, JSON.stringify({ actions: [] })],
        ),
      ),
    { code: "23514" },
  );
  const q = await quoteFixture();
  await admin.query(
    "UPDATE app.outbox_events SET status='unknown',transport_started_at=now() WHERE id=$1",
    [q.outbox.id],
  );
  await assert.rejects(
    () =>
      scoped(worker, q.tenant, (r) =>
        r.db.query(
          "UPDATE app.outbox_events SET status='pending' WHERE id=$1",
          [q.outbox.id],
        ),
      ),
    { code: "23514" },
  );
});
test("location inbound exposes only the current coordinates and no customer identifier", async () => {
  const f = await fixture();
  await admin.query(
    "UPDATE app.messages SET kind='location',content=$2 WHERE id=$1",
    [f.inbound, { latitude: -0.2, longitude: -78.5 }],
  );
  let text = "";
  await harness(f, {
    respond: async (input) => {
      text = JSON.stringify(input);
      return reply();
    },
  }).run(f.tenant, f.inbound);
  assert.ok(text.includes("-78.5"));
  assert.ok(!text.includes(f.recipient));
  assert.ok(!text.includes(f.ctx.customer));
});

test("a slow Responses call does not block processing another inbound of the same tenant", async () => {
  const f = await fixture();
  f.config.metaEnabled = false;
  const pool = {
    connect: () => worker.connect(),
    query: async (sql: string, ...args: any[]) =>
      sql.startsWith("SELECT id FROM app.businesses")
        ? { rows: [{ id: f.tenant }] }
        : worker.query(sql, ...args),
  } as unknown as pg.Pool;
  let signal!: () => void, release!: (r: AiReply) => void;
  const started = new Promise<void>((r) => (signal = r)),
    waiting = new Promise<AiReply>((r) => (release = r));
  const runtime = new RuntimeWorker(pool, f.config, () => {}, {
    ai: {
      respond: async () => {
        signal();
        return waiting;
      },
    },
  });
  await runtime.tick();
  await started;
  const events = normalizeEnvelope({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "synthetic",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: f.phone },
              messages: [
                {
                  from: f.recipient,
                  id: "wamid.during-thought",
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: "Prefiero atención humana" },
                },
              ],
            },
          },
        ],
      },
    ],
  }).events;
  await new PostgresInboxRepository(ingress).ingest(events);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const tick = await Promise.race([
      runtime.tick(),
      new Promise<never>(
        (_, reject) =>
          (timeout = setTimeout(
            () => reject(Error("poll blocked by provider")),
            1500,
          )),
      ),
    ]);
    assert.equal(tick.completed >= 1, true);
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int n FROM app.messages WHERE business_id=$1 AND provider_message_id='wamid.during-thought'",
          [f.tenant],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    clearTimeout(timeout);
    await base.requestHuman(f.ctx, randomUUID(), "explicit_request");
    release(reply());
    await runtime.drain();
  }
});

test("multi-turn context includes the last canonical bot message, excludes earlier customer PII and keeps cart access through tools", async () => {
  const f = await fixture();
  let count = 0;
  await harness(f, {
    respond: async () =>
      ++count === 1 ? reply("search_menu", { query: "" }) : reply(),
  }).run(f.tenant, f.inbound);
  await insert("messages", {
    business_id: f.tenant,
    conversation_id: f.ctx.conversation,
    direction: "inbound",
    kind: "text",
    content: { text: "Dirección privada anterior" },
    actor_type: "customer",
  });
  const next = await insert("messages", {
    business_id: f.tenant,
    conversation_id: f.ctx.conversation,
    direction: "inbound",
    kind: "text",
    content: { text: "Dos de ese producto" },
    actor_type: "customer",
  });
  let input = "";
  await harness(f, {
    respond: async (items) => {
      input = JSON.stringify(items);
      return reply();
    },
  }).run(f.tenant, next.id);
  assert.ok(input.includes("Canonical Meal: USD 5.00"));
  assert.ok(input.includes("Dos de ese producto"));
  assert.ok(!input.includes("Dirección privada anterior"));
});

test("copied confirmation payload in text or button title is redacted before durable inbox", async () => {
  const f = await quoteFixture();
  const events = normalizeEnvelope({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "synthetic",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: f.phone },
              messages: [
                {
                  from: f.recipient,
                  id: "wamid.copied.text",
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: "confirmo " + f.button },
                },
                {
                  from: f.recipient,
                  id: "wamid.copied.title",
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "interactive",
                  interactive: {
                    type: "button_reply",
                    button_reply: { id: "ordinary", title: f.button },
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  }).events;
  await new PostgresInboxRepository(ingress).ingest(events);
  assert.ok(!JSON.stringify(events).includes(f.button));
  assert.ok(
    !JSON.stringify(
      (
        await admin.query(
          "SELECT payload FROM app.webhook_events WHERE business_id=$1",
          [f.tenant],
        )
      ).rows,
    ).includes(f.button),
  );
  assert.equal(
    (
      await admin.query(
        "SELECT consumed_at FROM app.confirmation_challenges WHERE id=$1",
        [f.challenge.id],
      )
    ).rows[0].consumed_at,
    null,
  );
});

test("canonical Message projection correlates a Phase 5 outbound through the typed outbox_id contract", async () => {
  const f = await fixture();
  await harness(f, { respond: async () => reply() }).run(f.tenant, f.inbound);
  const m = (
    await admin.query(
      "SELECT * FROM app.messages WHERE business_id=$1 AND direction='outbound'",
      [f.tenant],
    )
  ).rows[0];
  const dto = await scoped(worker, f.tenant, (r) => r.dto("Message", m));
  assert.equal(dto.outbox_id, m.outbox_id);
  assert.equal(
    (
      await admin.query(
        "SELECT conversation_id FROM app.outbox_events WHERE id=$1",
        [dto.outbox_id],
      )
    ).rows[0].conversation_id,
    dto.conversation_id,
  );
  const inbound = await scoped(worker, f.tenant, async (r) =>
    r.dto("Message", await r.one("messages", f.inbound)),
  );
  assert.equal(inbound.outbox_id, null);
});
