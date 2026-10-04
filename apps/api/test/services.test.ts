import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { testApp, signature, envelope } from "./helpers.js";
import { PostgresInboxRepository } from "../src/modules/inbox/infrastructure/postgres-inbox.js";
import { assertContract, contract } from "./schema.js";
import { PostgresIdentityRepository } from "../src/modules/identity/infrastructure/postgres-identity.js";
import {
  OrderingService,
  type CustomerContext,
} from "../src/modules/domain/application/ordering.js";
import { DomainTransactions } from "../src/modules/domain/application/transaction.js";
import { InternalWorker } from "../src/worker/internal-worker.js";
import { checkDatabaseRole } from "../src/platform/database.js";
import { digest } from "../src/platform/idempotency.js";
import { unauthenticated } from "../src/platform/errors.js";
import type { Row } from "../src/modules/domain/infrastructure/repository.js";
import { confirmationEvidence } from "../src/platform/confirmation-evidence.js";
import { normalizeEnvelope } from "../src/integrations/whatsapp/normalize.js";
const source = new URL(process.env.TEST_DATABASE_URL ?? "invalid:");
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(source.hostname) ||
  !source.pathname.endsWith("_test") ||
  source.search ||
  source.hash
)
  throw Error("Disposable loopback *_test DB required.");
const cluster = new pg.Pool({ connectionString: source.toString() });
const target = new URL(source);
target.pathname = "/agente_ia_services_test";
const db = new pg.Pool({ connectionString: target.toString() });
const apiUrl = new URL(target);
apiUrl.username = "api_services_test";
apiUrl.password = "";
const workerUrl = new URL(target);
workerUrl.username = "worker_services_test";
workerUrl.password = "";
const ingressUrl = new URL(target);
ingressUrl.username = "ingress_services_test";
ingressUrl.password = "";
const ingress = new pg.Pool({ connectionString: ingressUrl.toString() });
const api = new pg.Pool({ connectionString: apiUrl.toString() }),
  worker = new pg.Pool({ connectionString: workerUrl.toString() });
const ordering = new OrderingService(worker);
let app: FastifyInstance;
let rollback = false;
const migrations = [
  "20261003154547_backend_foundation.sql",
  "20261004010809_domain_schema.sql",
  "20261004031246_domain_services.sql",
].map((n) =>
  readFileSync(
    new URL("../../../supabase/migrations/" + n, import.meta.url),
    "utf8",
  ),
);
async function insert(table: string, data: Row) {
  const keys = Object.keys(data);
  return (
    await db.query(
      `INSERT INTO app.${table}(${keys.join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
      Object.values(data).map((v) =>
        v !== null && typeof v === "object" && !(v instanceof Date)
          ? JSON.stringify(v)
          : v,
      ),
    )
  ).rows[0];
}
type Fixture = {
  tenant: string;
  owner: string;
  operator: string;
  manager: string;
  customer: string;
  conversation: string;
  category: string;
  product: string;
  channel: string;
};
const ctx = (f: Fixture): CustomerContext => ({
  tenant: f.tenant,
  customer: f.customer,
  conversation: f.conversation,
});
async function fixture(): Promise<Fixture> {
  const users = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of users)
    await db.query("INSERT INTO auth.users VALUES($1)", [id]);
  const business = await insert("businesses", {
    name: "Synthetic",
    slug: "synthetic-" + randomUUID(),
    currency: "USD",
    timezone: new Date().getUTCHours() === 23 ? "Europe/Rome" : "UTC",
  });
  const scope = { business_id: business.id };
  for (const [i, role] of ["owner", "operator", "manager"].entries())
    await insert("business_memberships", { ...scope, user_id: users[i], role });
  await insert("business_settings", {
    ...scope,
    accepting_orders: true,
    pickup_enabled: true,
    delivery_enabled: true,
    tax_policy: { mode: "none", rate_bps: 0, rounding: "per_line_half_up" },
    opening_hours: Array.from({ length: 7 }, (_, day) => ({
      day,
      opens_at: "00:00",
      closes_at: "23:59",
    })),
  });
  const channel = await insert("whatsapp_channels", {
    ...scope,
    phone_number_id: randomUUID(),
    waba_id: "synthetic",
    app_reference: "synthetic",
  });
  const customer = await insert("customers", {
    ...scope,
    channel_user_id: randomUUID(),
    phone_e164: "+12025550123",
    display_name: "Synthetic",
  });
  const conversation = await insert("conversations", {
    ...scope,
    customer_id: customer.id,
    channel_id: channel.id,
    expires_at: new Date(Date.now() + 3600000),
    last_customer_message_at: new Date(),
  });
  const category = await insert("categories", { ...scope, name: "Menu" }),
    product = await insert("products", {
      ...scope,
      category_id: category.id,
      name: "Meal",
      currency: "USD",
      price_minor: 500,
    });
  return {
    tenant: business.id,
    owner: users[0]!,
    operator: users[1]!,
    manager: users[2]!,
    customer: customer.id,
    conversation: conversation.id,
    category: category.id,
    product: product.id,
    channel: channel.id,
  };
}
async function http(
  f: Fixture,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: Row,
  key = randomUUID(),
  user = f.owner,
) {
  return app.inject({
    method,
    url: `/v1/businesses/${f.tenant}${path}`,
    headers: {
      authorization: `Bearer ${user}`,
      ...(method !== "GET" ? { "idempotency-key": key } : {}),
    },
    ...(body ? { payload: body } : {}),
  });
}
async function propose(f: Fixture) {
  let c = await ordering.addToCart(ctx(f), randomUUID(), {
    product_id: f.product,
    option_ids: [],
    quantity: 2,
    notes: null,
  });
  c = await ordering.setFulfillment(
    ctx(f),
    randomUUID(),
    "pickup",
    null,
    c.version,
  );
  return ordering.requestQuote(ctx(f));
}
async function button(f: Fixture, value: string, kind = "interactive") {
  return insert("messages", {
    business_id: f.tenant,
    conversation_id: f.conversation,
    direction: "inbound",
    actor_type: "customer",
    kind,
    content:
      kind === "interactive"
        ? { id: confirmationEvidence(value), title: "Confirm" }
        : { text: value },
  });
}
async function confirmed(f: Fixture) {
  const q = await propose(f);
  const m = await button(f, q.confirmation_button!);
  return ordering.confirmOrder(ctx(f), m.id);
}
async function event(
  f: Fixture,
  kind: string,
  content: Row = {},
  id: string = randomUUID(),
  sender?: string,
) {
  const customer = (
    await db.query("SELECT channel_user_id FROM app.customers WHERE id=$1", [
      f.customer,
    ])
  ).rows[0];
  return insert("webhook_events", {
    business_id: f.tenant,
    channel_id: f.channel,
    event_key: "synthetic:" + id,
    event_type: kind === "status" ? "status" : "message",
    payload: {
      kind,
      content,
      channel_user_id: sender ?? customer.channel_user_id,
      provider_message_id: id,
      provider_timestamp: new Date().toISOString(),
    },
    payload_hash: digest([id, kind]),
  });
}
before(async () => {
  await cluster.query("CREATE DATABASE agente_ia_services_test");
  await db.query(
    "CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY)",
  );
  await db.query(migrations[0]!);
  await db.query(
    "DO $$ DECLARE r text;BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN',r);END IF;END LOOP;END $$;",
  );
  await db.query(migrations[1]!);
  await db.query(migrations[2]!.replace(/COMMIT;\s*$/, "ROLLBACK;"));
  rollback =
    (await db.query("SELECT to_regclass('app.handoff_assignees') AS absent"))
      .rows[0].absent === null;
  await db.query(migrations[2]!);
  await db.query(
    "CREATE ROLE api_services_test LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;CREATE ROLE worker_services_test LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;GRANT app_api TO api_services_test;GRANT app_worker TO worker_services_test;CREATE ROLE ingress_services_test LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;GRANT app_ingress TO ingress_services_test",
  );
  app = await testApp({
    domainPool: api,
    inbox: new PostgresInboxRepository(ingress),
    rateLimitMax: 10000,
    identities: new PostgresIdentityRepository(api),
    auth: {
      verify: async (token) => {
        if (!/^[0-9a-f-]{36}$/.test(token)) throw unauthenticated();
        return { userId: token };
      },
    },
  });
  await app.ready();
});
after(async () => {
  await app?.close();
  await Promise.all([
    db.end(),
    api.end(),
    worker.end(),
    ingress.end(),
    cluster.end(),
  ]);
});
test("new migration rolls back cleanly; runtime API and worker have separated restricted roles", async () => {
  assert.ok(rollback);
  await checkDatabaseRole(api, "api");
  await checkDatabaseRole(worker, "worker");
  await assert.rejects(() => checkDatabaseRole(worker, "api"));
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.prosecdef",
      )
    ).rowCount,
    0,
  );
});
test("every implemented OpenAPI administrative operation has a registered route", () => {
  for (const [path, item] of Object.entries(contract.paths))
    if (path.startsWith("/v1/"))
      for (const method of Object.keys(item as object))
        assert.ok(
          app.hasRoute({
            method: method.toUpperCase() as "GET",
            url: path.replace(/\{([^}]+)\}/g, ":$1"),
          }),
          method + " " + path,
        );
});
test("membership, role, revoked membership and cross-tenant resources are enforced", async () => {
  const a = await fixture(),
    b = await fixture();
  assert.equal((await http(a, "GET", "/products")).statusCode, 200);
  assert.equal(
    (await http(a, "GET", "/products", undefined, randomUUID(), b.owner))
      .statusCode,
    403,
  );
  assert.equal(
    (await http(a, "GET", `/products/${b.product}`)).statusCode,
    404,
  );
  assert.equal(
    (
      await http(
        a,
        "POST",
        "/categories",
        { name: "Denied", sort_order: 0, active: true },
        randomUUID(),
        a.operator,
      )
    ).statusCode,
    403,
  );
  await db.query(
    "UPDATE app.business_memberships SET active=false WHERE business_id=$1 AND user_id=$2",
    [a.tenant, a.owner],
  );
  assert.equal((await http(a, "GET", "/products")).statusCode, 403);
});
test("same key replays exact body and status; differing payload conflicts", async () => {
  const f = await fixture(),
    key = randomUUID(),
    payload = { name: "Replay", sort_order: 0, active: true };
  const a = await http(f, "POST", "/categories", payload, key),
    b = await http(f, "POST", "/categories", payload, key);
  assert.equal(a.statusCode, 201, a.body);
  assertContract("CategoryResponse", a.json());
  assert.equal(b.body, a.body);
  assert.equal(b.headers["idempotency-replayed"], "true");
  assert.equal(
    (
      await http(
        f,
        "POST",
        "/categories",
        { ...payload, name: "Different" },
        key,
      )
    ).json().error.code,
    "IDEMPOTENCY_CONFLICT",
  );
});
test("same key concurrency commits exactly one audit/mutation with safe replay or in-progress", async () => {
  const f = await fixture(),
    key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      http(
        f,
        "POST",
        "/categories",
        { name: "Concurrent", sort_order: 0, active: true },
        key,
      ),
    ),
  );
  assert.equal(
    results.filter(
      (r) => r.statusCode === 201 && !r.headers["idempotency-replayed"],
    ).length,
    1,
  );
  assert.ok(
    results.every(
      (r) =>
        r.statusCode === 201 || r.json().error.code === "REQUEST_IN_PROGRESS",
    ),
  );
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM app.categories WHERE business_id=$1 AND name='Concurrent'",
        [f.tenant],
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM app.audit_logs WHERE business_id=$1 AND action='categories.post'",
        [f.tenant],
      )
    ).rowCount,
    1,
  );
});
test("committed active lease returns REQUEST_IN_PROGRESS and Retry-After", async () => {
  const f = await fixture(),
    key = randomUUID(),
    body = { name: "Waiting", sort_order: 0, active: true };
  const operation =
    contract.paths["/v1/businesses/{business_id}/categories"].post.operationId;
  await insert("idempotency_keys", {
    business_id: f.tenant,
    actor_scope: "human:" + f.owner,
    operation,
    key_hash: digest(key),
    request_hash: digest({ path: { business_id: f.tenant }, query: {}, body }),
    lease_until: new Date(Date.now() + 30000),
    expires_at: new Date(Date.now() + 3600000),
  });
  const result = await http(f, "POST", "/categories", body, key);
  assert.equal(result.statusCode, 409);
  assert.equal(result.json().error.code, "REQUEST_IN_PROGRESS");
  assert.ok(result.headers["retry-after"]);
});
test("revoked permission cannot read historical idempotent result", async () => {
  const f = await fixture(),
    key = randomUUID(),
    body = { name: "Historical", sort_order: 0, active: true };
  assert.equal(
    (await http(f, "POST", "/categories", body, key)).statusCode,
    201,
  );
  await db.query(
    "UPDATE app.business_memberships SET active=false WHERE business_id=$1 AND user_id=$2",
    [f.tenant, f.owner],
  );
  assert.equal(
    (await http(f, "POST", "/categories", body, key)).statusCode,
    403,
  );
});
test("mutation, audit, outbox and idempotency roll back together on an application failure", async () => {
  const f = await fixture(),
    key = randomUUID();
  const tx = new DomainTransactions(api);
  await assert.rejects(() =>
    tx.run(
      {
        user: f.owner,
        tenant: f.tenant,
        roles: ["owner"],
        operation: "rollback",
        key,
        request: randomUUID(),
        input: {},
      },
      async (r) => {
        await r.insert("categories", { name: "Rolled back" });
        throw Error("Injected transaction failure");
      },
    ),
  );
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM app.categories WHERE business_id=$1 AND name='Rolled back'",
        [f.tenant],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM app.idempotency_keys WHERE business_id=$1 AND operation='rollback'",
        [f.tenant],
      )
    ).rowCount,
    0,
  );
});
test("settings validate intervals and store ai_enabled without activating AI", async () => {
  const f = await fixture();
  const read = await http(f, "GET", "/settings");
  assertContract("BusinessSettingsResponse", read.json());
  const bad = await http(f, "PATCH", "/settings", {
    expected_version: 1,
    opening_hours: [
      { day: 0, opens_at: "09:00", closes_at: "12:00" },
      { day: 0, opens_at: "11:00", closes_at: "13:00" },
    ],
  });
  assert.equal(bad.statusCode, 422);
  const good = await http(f, "PATCH", "/settings", {
    expected_version: 1,
    ai_enabled: true,
  });
  assert.equal(good.statusCode, 200, good.body);
  assert.equal(good.json().data.ai_enabled, true);
});
test("closed input rejects tenant/amount/status injection and undeclared filters", async () => {
  const f = await fixture();
  assert.equal(
    (
      await http(f, "POST", "/categories", {
        name: "Bad",
        sort_order: 0,
        active: true,
        business_id: f.tenant,
      })
    ).statusCode,
    422,
  );
  assert.equal((await http(f, "GET", "/products?role=owner")).statusCode, 422);
  assert.equal(
    (await http(f, "PATCH", `/orders/${randomUUID()}`, { status: "delivered" }))
      .statusCode,
    404,
  );
});
test("catalog uses group/option hierarchy, CAS, legacy compatibility, tenant FK and soft delete", async () => {
  const f = await fixture(),
    b = await fixture();
  const base = `/products/${f.product}/modifier-groups`;
  const g = await http(f, "POST", base, {
    name: "Extras",
    required: false,
    min_select: 0,
    max_select: 1,
    sort_order: 0,
    active: true,
  });
  assert.equal(g.statusCode, 201, g.body);
  assertContract("ModifierGroupResponse", g.json());
  const id = g.json().data.id;
  const o = await http(f, "POST", base + `/${id}/options`, {
    name: "Extra",
    price_delta_minor: 100,
    available: true,
    sort_order: 0,
  });
  assert.equal(o.statusCode, 201, o.body);
  assertContract("ModifierOptionResponse", o.json());
  assert.equal(
    (
      await http(f, "PATCH", base + `/${id}`, {
        expected_version: 9,
        name: "Wrong",
      })
    ).json().error.code,
    "VERSION_CONFLICT",
  );
  const product = await http(f, "GET", `/products/${f.product}`);
  assertContract("ProductResponse", product.json());
  assert.equal(
    product.json().data.modifier_groups[0].options[0].id,
    o.json().data.id,
  );
  assert.equal(product.json().data.options[0].group_key, id);
  assert.equal(
    (
      await http(f, "POST", "/products", {
        category_id: b.category,
        name: "Bad FK",
        description: null,
        price_minor: 1,
        currency: "USD",
        available: true,
        image_url: null,
      })
    ).statusCode,
    404,
  );
  const deleted = await http(
    f,
    "DELETE",
    base + `/${id}/options/${o.json().data.id}?expected_version=1`,
  );
  assert.equal(deleted.statusCode, 204, deleted.body);
  assert.equal(deleted.body, "");
  assert.equal(
    (
      await db.query(
        "SELECT deleted_at FROM app.modifier_options WHERE id=$1",
        [o.json().data.id],
      )
    ).rows[0].deleted_at instanceof Date,
    true,
  );
  assert.equal(
    (await http(f, "DELETE", `/categories/${f.category}?expected_version=1`))
      .statusCode,
    409,
  );
});
test("pagination is stable, bound to tenant/filters and rejects tampering", async () => {
  const f = await fixture();
  for (let i = 0; i < 3; i++)
    await http(f, "POST", "/categories", {
      name: "Category " + i,
      sort_order: i + 1,
      active: true,
    });
  const first = await http(f, "GET", "/categories?limit=2");
  assertContract("CategoryPage", first.json());
  const cursor = first.json().pagination.next_cursor;
  const second = await http(
    f,
    "GET",
    "/categories?limit=2&cursor=" + encodeURIComponent(cursor),
  );
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(
    new Set([...first.json().data, ...second.json().data].map((x: Row) => x.id))
      .size,
    4,
  );
  const other = await fixture();
  assert.equal(
    (
      await http(
        other,
        "GET",
        "/categories?limit=2&cursor=" + encodeURIComponent(cursor),
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (await http(f, "GET", "/categories?cursor=forged")).statusCode,
    422,
  );
});
test("customers minimize PII and conversations/messages match public DTOs", async () => {
  const f = await fixture();
  const c = await http(f, "GET", `/customers/${f.customer}`);
  assertContract("CustomerResponse", c.json());
  assert.equal(c.json().data.phone_masked, "***0123");
  assert.ok(!c.body.includes("+12025550123"));
  assertContract(
    "ConversationResponse",
    (await http(f, "GET", `/conversations/${f.conversation}`)).json(),
  );
  assertContract(
    "MessagePage",
    (await http(f, "GET", `/conversations/${f.conversation}/messages`)).json(),
  );
});
test("canonical quote has DB prices, configured tax, snapshots and one proposal per cart version", async () => {
  const f = await fixture();
  await db.query(
    "UPDATE app.business_settings SET tax_policy=$2 WHERE business_id=$1",
    [
      f.tenant,
      { mode: "exclusive", rate_bps: 500, rounding: "per_line_half_up" },
    ],
  );
  const q = await propose(f);
  assertContract("Order", q.order);
  assert.equal(q.order.subtotal_minor, 1000);
  assert.equal(q.order.tax_minor, 50);
  assert.equal(q.order.total_minor, 1050);
  const repeat = await ordering.requestQuote(ctx(f));
  assert.equal(repeat.order.id, q.order.id);
  assert.equal(repeat.confirmation_button, null);
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM app.confirmation_challenges WHERE order_id=$1",
        [q.order.id],
      )
    ).rowCount,
    1,
  );
  const nonce = q.confirmation_button!.split(":")[2]!;
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM app.confirmation_challenges WHERE nonce_hash=$1",
        [createHash("sha256").update(nonce).digest("hex")],
      )
    ).rowCount,
    1,
  );
  for (const table of ["audit_logs", "outbox_events", "idempotency_keys"])
    assert.equal(
      (
        await db.query(
          `SELECT 1 FROM app.${table} WHERE business_id=$1 AND row_to_json(${table})::text LIKE $2`,
          [f.tenant, "%" + nonce + "%"],
        )
      ).rowCount,
      0,
    );
});
test("cart mutating service idempotency does not add duplicate quantities", async () => {
  const f = await fixture(),
    key = randomUUID(),
    input = { product_id: f.product, option_ids: [], quantity: 1, notes: null };
  const a = await ordering.addToCart(ctx(f), key, input),
    b = await ordering.addToCart(ctx(f), key, input);
  assert.deepEqual(a, b);
  assert.equal(b.items[0].quantity, 1);
  await assert.rejects(
    () => ordering.addToCart(ctx(f), key, { ...input, quantity: 2 }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
});
test("quote blocks unavailable products, missing tax policy and invalid fulfillment", async () => {
  const f = await fixture();
  await db.query("UPDATE app.products SET available=false WHERE id=$1", [
    f.product,
  ]);
  await assert.rejects(() => propose(f), { code: "PRODUCT_UNAVAILABLE" });
  const g = await fixture();
  await db.query(
    "UPDATE app.business_settings SET tax_policy=NULL WHERE business_id=$1",
    [g.tenant],
  );
  await assert.rejects(() => propose(g), { code: "VALIDATION_ERROR" });
});
test("valid interactive challenge confirms once and creates pending cash payment; text cannot consent", async () => {
  const f = await fixture(),
    q = await propose(f);
  const text = await button(f, "sí", "text");
  await assert.rejects(() => ordering.confirmOrder(ctx(f), text.id), {
    code: "VALIDATION_ERROR",
  });
  const m = await button(f, q.confirmation_button!);
  const order = await ordering.confirmOrder(ctx(f), m.id);
  assert.equal(order.status, "confirmed");
  assert.equal(order.version, 2);
  await assert.rejects(() => ordering.confirmOrder(ctx(f), m.id), {
    code: "INVALID_ORDER_TRANSITION",
  });
  const payments = await http(f, "GET", `/orders/${order.id}/payments`);
  assertContract("PaymentPage", payments.json());
  assert.equal(payments.json().data[0].status, "pending");
});
for (const change of [
  "price",
  "unavailable",
  "version",
  "expired",
  "wrong_customer",
] as const)
  test(`confirmation rejects ${change}`, async () => {
    const f = await fixture(),
      q = await propose(f),
      m = await button(f, q.confirmation_button!);
    if (change === "price")
      await db.query("UPDATE app.products SET price_minor=800 WHERE id=$1", [
        f.product,
      ]);
    if (change === "unavailable")
      await db.query("UPDATE app.products SET available=false WHERE id=$1", [
        f.product,
      ]);
    if (change === "version")
      await db.query(
        "UPDATE app.orders SET quote_expires_at=quote_expires_at WHERE id=$1",
        [q.order.id],
      );
    if (change === "expired")
      await db.query(
        "UPDATE app.confirmation_challenges SET expires_at=now()-interval '1 minute' WHERE order_id=$1",
        [q.order.id],
      );
    if (change === "wrong_customer")
      await assert.rejects(
        () =>
          ordering.confirmOrder({ ...ctx(f), customer: randomUUID() }, m.id),
        { code: "FORBIDDEN" },
      );
    else
      await assert.rejects(() => ordering.confirmOrder(ctx(f), m.id), {
        code: change === "expired" ? "QUOTE_EXPIRED" : "QUOTE_CHANGED",
      });
    assert.equal(
      (
        await db.query("SELECT status FROM app.orders WHERE id=$1", [
          q.order.id,
        ])
      ).rows[0].status,
      change === "wrong_customer" ? "awaiting_confirmation" : "cancelled",
    );
    assert.equal(
      (
        await db.query(
          "SELECT consumed_at FROM app.confirmation_challenges WHERE order_id=$1",
          [q.order.id],
        )
      ).rows[0].consumed_at,
      null,
    );
  });
test("concurrent confirmation consumes one challenge and converts one cart", async () => {
  const f = await fixture(),
    q = await propose(f),
    m = await button(f, q.confirmation_button!);
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => ordering.confirmOrder(ctx(f), m.id)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (
      await db.query("SELECT 1 FROM app.payments WHERE order_id=$1", [
        q.order.id,
      ])
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await db.query("SELECT status FROM app.carts WHERE business_id=$1", [
        f.tenant,
      ])
    ).rows[0].status,
    "converted",
  );
});
test("delivery quote uses deterministic zone fees and refuses outside geometry", async () => {
  const f = await fixture();
  await insert("delivery_zones", {
    business_id: f.tenant,
    name: "Local",
    fee_minor: 200,
    polygon_geojson: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    },
  });
  const c = await ordering.addToCart(ctx(f), randomUUID(), {
    product_id: f.product,
    option_ids: [],
    quantity: 1,
    notes: null,
  });
  await ordering.setFulfillment(
    ctx(f),
    randomUUID(),
    "delivery",
    {
      address_text: "Synthetic",
      latitude: 1,
      longitude: 1,
      instructions: null,
    },
    c.version,
  );
  const q = await ordering.requestQuote(ctx(f));
  assert.equal(q.order.delivery_minor, 200);
  assert.equal(q.order.total_minor, 700);
});
test("pickup transitions preserve pending cash and reject wrong version/invalid dispatch", async () => {
  const f = await fixture();
  let order = await confirmed(f);
  for (const action of [
    "accept",
    "start_preparation",
    "mark_ready",
    "complete",
  ]) {
    const res = await http(f, "POST", `/orders/${order.id}/transitions`, {
      action,
      expected_version: order.version,
      reason: null,
    });
    assert.equal(res.statusCode, 200, res.body);
    assertContract("OrderResponse", res.json());
    order = res.json().data;
  }
  assert.equal(order.status, "delivered");
  assert.equal(
    (await http(f, "GET", `/orders/${order.id}/payments`)).json().data[0]
      .status,
    "pending",
  );
  assert.equal(
    (
      await http(f, "POST", `/orders/${order.id}/transitions`, {
        action: "cancel",
        expected_version: order.version,
        reason: "x",
      })
    ).json().error.code,
    "INVALID_ORDER_TRANSITION",
  );
});
test("concurrent order actions with different keys produce one transition and one version conflict", async () => {
  const f = await fixture(),
    order = await confirmed(f);
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      http(f, "POST", `/orders/${order.id}/transitions`, {
        action: "accept",
        expected_version: order.version,
        reason: null,
      }),
    ),
  );
  assert.equal(results.filter((r) => r.statusCode === 200).length, 1);
  assert.ok(
    results
      .filter((r) => r.statusCode === 409)
      .every((r) => r.json().error.code === "VERSION_CONFLICT"),
  );
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM app.order_transitions WHERE order_id=$1 AND trigger='accept'",
        [order.id],
      )
    ).rowCount,
    1,
  );
});
test("cash record enforces role/version/backend amount and replays safely", async () => {
  const f = await fixture(),
    order = await confirmed(f),
    path = `/orders/${order.id}/payments/cash-record`,
    key = randomUUID(),
    body = {
      expected_version: 1,
      paid_at: new Date().toISOString(),
      note: "Synthetic cash record",
    };
  assert.equal(
    (await http(f, "POST", path, body, randomUUID(), f.operator)).statusCode,
    403,
  );
  assert.equal(
    (await http(f, "POST", path, { ...body, expected_version: 99 })).json()
      .error.code,
    "VERSION_CONFLICT",
  );
  assert.equal(
    (await http(f, "POST", path, { ...body, amount_minor: 1 })).statusCode,
    422,
  );
  const a = await http(f, "POST", path, body, key),
    b = await http(f, "POST", path, body, key);
  assert.equal(a.statusCode, 200, a.body);
  assertContract("PaymentResponse", a.json());
  assert.equal(a.json().data.amount_minor, 1000);
  assert.equal(b.body, a.body);
  assert.equal(b.headers["idempotency-replayed"], "true");
});
test("operator may cancel confirmed orders; cash record cannot pay cancelled orders", async () => {
  const f = await fixture(),
    order = await confirmed(f);
  const cancel = await http(
    f,
    "POST",
    `/orders/${order.id}/transitions`,
    {
      action: "cancel",
      expected_version: order.version,
      reason: "Customer request",
    },
    randomUUID(),
    f.operator,
  );
  assert.equal(cancel.statusCode, 200, cancel.body);
  const p = (await http(f, "GET", `/orders/${order.id}/payments`)).json()
    .data[0];
  assert.equal(p.status, "cancelled");
  assert.equal(
    (
      await http(f, "POST", `/orders/${order.id}/payments/cash-record`, {
        expected_version: p.version,
        paid_at: new Date().toISOString(),
        note: "Rejected",
      })
    ).json().error.code,
    "INVALID_ORDER_TRANSITION",
  );
});
test("concurrent handoff creation occupies one slot; claim/resolve enforce assignment and epoch", async () => {
  const f = await fixture();
  const create = () =>
    http(f, "POST", `/conversations/${f.conversation}/handoffs`, {
      reason: "explicit_request",
      context: null,
      expected_conversation_version: 1,
    });
  const results = await Promise.all(Array.from({ length: 6 }, create));
  assert.equal(results.filter((r) => r.statusCode === 201).length, 1);
  assert.ok(results.every((r) => [200, 201].includes(r.statusCode)));
  let h = results[0]!.json().data;
  assertContract("HumanHandoff", h);
  assert.equal(
    (await http(f, "GET", `/conversations/${f.conversation}`)).json().data
      .automation_epoch,
    2,
  );
  assert.equal(
    (
      await http(
        f,
        "POST",
        `/handoffs/${h.id}/claim`,
        { assigned_user_id: f.owner, expected_version: h.version },
        randomUUID(),
        f.operator,
      )
    ).statusCode,
    403,
  );
  const claim = await http(f, "POST", `/handoffs/${h.id}/claim`, {
    assigned_user_id: f.operator,
    expected_version: h.version,
  });
  assert.equal(claim.statusCode, 200, claim.body);
  h = claim.json().data;
  const msg = await http(
    f,
    "POST",
    `/conversations/${f.conversation}/messages`,
    { text: "Synthetic human reply", expected_conversation_version: 3 },
    randomUUID(),
    f.operator,
  );
  assert.equal(msg.statusCode, 202, msg.body);
  assertContract("MessageReceiptResponse", msg.json());
  assert.equal(
    (
      await db.query(
        "SELECT delivery_status FROM app.messages WHERE outbox_id=$1",
        [msg.json().data.outbox_id],
      )
    ).rows[0].delivery_status,
    "pending",
  );
  const resolve = await http(
    f,
    "POST",
    `/handoffs/${h.id}/resolve`,
    {
      expected_version: h.version,
      action: "resume_bot",
      resolution: "Handled",
    },
    randomUUID(),
    f.operator,
  );
  assert.equal(resolve.statusCode, 200, resolve.body);
  const conv = (await http(f, "GET", `/conversations/${f.conversation}`)).json()
    .data;
  assert.equal(conv.status, "bot_active");
  assert.equal(conv.automation_epoch, 3);
});
test("human messages require assignment and a valid 24h window", async () => {
  const f = await fixture();
  const h = (
    await http(f, "POST", `/conversations/${f.conversation}/handoffs`, {
      reason: "explicit_request",
      context: null,
      expected_conversation_version: 1,
    })
  ).json().data;
  await http(f, "POST", `/handoffs/${h.id}/claim`, {
    assigned_user_id: f.owner,
    expected_version: 1,
  });
  assert.equal(
    (
      await http(
        f,
        "POST",
        `/conversations/${f.conversation}/messages`,
        { text: "Denied", expected_conversation_version: 3 },
        randomUUID(),
        f.operator,
      )
    ).statusCode,
    403,
  );
  await db.query(
    "UPDATE app.conversations SET last_customer_message_at=now()-interval '25 hours' WHERE id=$1",
    [f.conversation],
  );
  assert.equal(
    (
      await http(f, "POST", `/conversations/${f.conversation}/messages`, {
        text: "Too late",
        expected_conversation_version: 4,
      })
    ).json().error.code,
    "WINDOW_CLOSED",
  );
});
test("metrics use completion events independently of payment, half-open windows and 31 day limit", async () => {
  const f = await fixture();
  let order = await confirmed(f);
  for (const action of [
    "accept",
    "start_preparation",
    "mark_ready",
    "complete",
  ])
    order = (
      await http(f, "POST", `/orders/${order.id}/transitions`, {
        action,
        expected_version: order.version,
        reason: null,
      })
    ).json().data;
  const from = new Date(Date.now() - 60000).toISOString(),
    to = new Date(Date.now() + 60000).toISOString();
  const m = await http(f, "GET", `/metrics?from=${from}&to=${to}`);
  assert.equal(m.statusCode, 200, m.body);
  assertContract("MetricsResponse", m.json());
  assert.equal(m.json().data.sales_minor, 1000);
  assert.equal(m.json().data.orders_confirmed, 1);
  assert.equal(
    (
      await http(
        f,
        "GET",
        `/metrics?from=2026-01-01T00:00:00Z&to=2026-03-01T00:00:00Z`,
      )
    ).statusCode,
    422,
  );
});
for (const kind of ["text", "interactive", "location", "unsupported"])
  test(`worker persists ${kind} and deduplicates inbox`, async () => {
    const f = await fixture(),
      w = new InternalWorker(worker),
      raw =
        kind === "text"
          ? { text: "Hello", truncated: false }
          : kind === "interactive"
            ? { reply_id: "unsupported-button", title: "Button" }
            : kind === "location"
              ? { latitude: 1, longitude: 2 }
              : { provider_type: "image" };
    const e = await event(f, kind, raw);
    const lease = await w.claim(f.tenant, "inbox");
    assert.ok(lease);
    assert.ok(await w.process(lease));
    assert.equal(
      (
        await db.query("SELECT status FROM app.webhook_events WHERE id=$1", [
          e.id,
        ])
      ).rows[0].status,
      "processed",
    );
    assert.equal(
      (
        await db.query(
          "SELECT 1 FROM app.messages WHERE business_id=$1 AND provider_message_id=$2",
          [f.tenant, e.payload.provider_message_id],
        )
      ).rowCount,
      1,
    );
    await event(f, kind, raw, e.payload.provider_message_id + "-duplicate");
    const duplicate = (
      await db.query(
        "SELECT id FROM app.webhook_events WHERE business_id=$1 AND status='pending'",
        [f.tenant],
      )
    ).rows[0];
    await db.query("UPDATE app.webhook_events SET payload=$2 WHERE id=$1", [
      duplicate.id,
      e.payload,
    ]);
    assert.ok(await w.process((await w.claim(f.tenant, "inbox"))!));
    assert.equal(
      (
        await db.query("SELECT 1 FROM app.messages WHERE business_id=$1", [
          f.tenant,
        ])
      ).rowCount,
      1,
    );
  });
test("worker ignores unknown events without executing business", async () => {
  const f = await fixture(),
    w = new InternalWorker(worker);
  await event(f, "future_unknown", { arbitrary: "ignored" });
  assert.ok(await w.process((await w.claim(f.tenant, "inbox"))!));
  assert.equal(
    (
      await db.query("SELECT 1 FROM app.messages WHERE business_id=$1", [
        f.tenant,
      ])
    ).rowCount,
    0,
  );
});
test("worker lease/fencing rejects stale executors and SKIP LOCKED claims one job", async () => {
  const f = await fixture(),
    w = new InternalWorker(worker);
  const e = await event(f, "text", { text: "Lease" });
  const claims = await Promise.all(
    Array.from({ length: 8 }, () => w.claim(f.tenant, "inbox")),
  );
  assert.equal(claims.filter(Boolean).length, 1);
  const old = claims.find(Boolean)!;
  await db.query(
    "UPDATE app.webhook_events SET lease_until=now()-interval '1 second' WHERE id=$1",
    [e.id],
  );
  const next = (await w.claim(f.tenant, "inbox"))!;
  assert.notEqual(old.token, next.token);
  assert.equal(await w.process(old), false);
  assert.ok(await w.process(next));
});
test("worker retries safely with backoff then dead-letters invalid content", async () => {
  const f = await fixture(),
    w = new InternalWorker(worker, 2);
  const e = await event(f, "text", { text: "x".repeat(2001) });
  assert.equal(await w.process((await w.claim(f.tenant, "inbox"))!), false);
  const first = (
    await db.query("SELECT * FROM app.webhook_events WHERE id=$1", [e.id])
  ).rows[0];
  assert.equal(first.status, "pending");
  assert.ok(first.next_attempt_at > new Date());
  await db.query(
    "UPDATE app.webhook_events SET next_attempt_at=now() WHERE id=$1",
    [e.id],
  );
  assert.equal(await w.process((await w.claim(f.tenant, "inbox"))!), false);
  assert.equal(
    (
      await db.query("SELECT status FROM app.webhook_events WHERE id=$1", [
        e.id,
      ])
    ).rows[0].status,
    "dead_letter",
  );
  assert.equal(
    (
      await db.query("SELECT 1 FROM app.messages WHERE business_id=$1", [
        f.tenant,
      ])
    ).rowCount,
    0,
  );
});
test("internal outbox commits receipt once; Meta outbox is never claimed or falsely sent", async () => {
  const f = await fixture(),
    w = new InternalWorker(worker);
  await propose(f);
  const lease = (await w.claim(f.tenant, "outbox"))!;
  assert.ok(await w.process(lease));
  assert.equal(await w.process(lease), false);
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM app.internal_event_receipts WHERE outbox_id=$1",
        [lease.id],
      )
    ).rowCount,
    1,
  );
  await insert("outbox_events", {
    business_id: f.tenant,
    event_type: "whatsapp.message",
    aggregate_id: randomUUID(),
    aggregate_version: 1,
    causation_id: randomUUID(),
    dedupe_key: randomUUID(),
    payload: { resource_id: randomUUID(), resource_version: 1, text: "Queued" },
  });
  assert.equal(await w.claim(f.tenant, "outbox"), null);
  assert.equal(
    (
      await db.query(
        "SELECT status FROM app.outbox_events WHERE business_id=$1 AND event_type='whatsapp.message'",
        [f.tenant],
      )
    ).rows[0].status,
    "pending",
  );
});
test("full phase4 RLS hides cross-tenant rows and denies worker catalog writes", async () => {
  const a = await fixture(),
    b = await fixture();
  const client = await api.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.user_id',$1,true),set_config('app.business_id',$2,true)",
      [a.owner, b.tenant],
    );
    assert.equal(
      (await client.query("SELECT * FROM app.products")).rowCount,
      0,
    );
    assert.equal(
      (await client.query("SELECT * FROM app.handoff_assignees")).rowCount,
      0,
    );
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
  await assert.rejects(
    () => worker.query("UPDATE app.products SET price_minor=0"),
    { code: "42501" },
  );
});
test("business GET/PATCH validates authorization, timezone and public DTO", async () => {
  const f = await fixture();
  const get = await http(f, "GET", "");
  assertContract("BusinessResponse", get.json());
  assert.equal(
    (
      await http(f, "PATCH", "", {
        expected_version: 1,
        timezone: "Invalid/Timezone",
      })
    ).statusCode,
    422,
  );
  const patch = await http(f, "PATCH", "", {
    expected_version: 1,
    name: "Updated",
  });
  assert.equal(patch.statusCode, 200, patch.body);
  assertContract("BusinessResponse", patch.json());
  assert.equal(patch.json().data.business_id, f.tenant);
});
test("delivery zone CRUD validates coordinates, CAS and soft deletion", async () => {
  const f = await fixture(),
    body = {
      name: "Zone",
      fee_minor: 100,
      min_order_minor: 0,
      priority: 0,
      active: true,
      polygon_geojson: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 0],
          ],
        ],
      },
    };
  const z = await http(f, "POST", "/delivery-zones", body);
  assert.equal(z.statusCode, 201, z.body);
  assertContract("DeliveryZoneResponse", z.json());
  assertContract(
    "DeliveryZonePage",
    (await http(f, "GET", "/delivery-zones")).json(),
  );
  assert.equal(
    (
      await http(f, "PATCH", `/delivery-zones/${z.json().data.id}`, {
        expected_version: 1,
        polygon_geojson: {
          type: "Polygon",
          coordinates: [
            [
              [0, 91],
              [1, 0],
              [1, 1],
              [0, 91],
            ],
          ],
        },
      })
    ).statusCode,
    422,
  );
  const edit = await http(f, "PATCH", `/delivery-zones/${z.json().data.id}`, {
    expected_version: 1,
    fee_minor: 200,
  });
  assert.equal(edit.statusCode, 200, edit.body);
  assert.equal(
    (
      await http(
        f,
        "DELETE",
        `/delivery-zones/${z.json().data.id}?expected_version=2`,
      )
    ).statusCode,
    204,
  );
});
test("legacy options cannot change group policy without group CAS", async () => {
  const f = await fixture();
  const base = `/products/${f.product}/options`;
  const o = await http(f, "POST", base, {
    group_key: "Legacy Extras",
    name: "Cheese",
    price_delta_minor: 100,
    required: false,
    min_select: 0,
    max_select: 1,
    available: true,
  });
  assert.equal(o.statusCode, 201, o.body);
  assertContract("ProductOptionResponse", o.json());
  assert.equal(
    (
      await http(f, "PATCH", `${base}/${o.json().data.id}`, {
        expected_version: 1,
        max_select: 2,
      })
    ).statusCode,
    422,
  );
  const changed = await http(f, "PATCH", `${base}/${o.json().data.id}`, {
    expected_version: 1,
    name: "New cheese",
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(changed.json().data.group_key, o.json().data.group_key);
});
test("required modifier selections and wrong-product options are rejected; options contribute canonical prices", async () => {
  const f = await fixture();
  const g = (
    await http(f, "POST", `/products/${f.product}/modifier-groups`, {
      name: "Required",
      required: true,
      min_select: 1,
      max_select: 1,
      sort_order: 0,
      active: true,
    })
  ).json().data;
  const o = (
    await http(
      f,
      "POST",
      `/products/${f.product}/modifier-groups/${g.id}/options`,
      { name: "Extra", price_delta_minor: 100, available: true, sort_order: 0 },
    )
  ).json().data;
  await assert.rejects(
    () =>
      ordering.addToCart(ctx(f), randomUUID(), {
        product_id: f.product,
        option_ids: [],
        quantity: 1,
        notes: null,
      }),
    { code: "PRODUCT_UNAVAILABLE" },
  );
  const c = await ordering.addToCart(ctx(f), randomUUID(), {
    product_id: f.product,
    option_ids: [o.id],
    quantity: 2,
    notes: null,
  });
  assert.equal(c.subtotal_minor, 1200);
  await ordering.setFulfillment(
    ctx(f),
    randomUUID(),
    "pickup",
    null,
    c.version,
  );
  const q = await ordering.requestQuote(ctx(f));
  assert.equal(q.order.items[0].option_snapshots[0].price_delta_minor, 100);
  await http(
    f,
    "PATCH",
    `/products/${f.product}/modifier-groups/${g.id}/options/${o.id}`,
    { expected_version: 1, available: false },
  );
  const m = await button(f, q.confirmation_button!);
  await assert.rejects(() => ordering.confirmOrder(ctx(f), m.id), {
    code: "QUOTE_CHANGED",
  });
});
test("cart remove uses CAS and durable replay, while expired carts produce fresh active carts", async () => {
  const f = await fixture();
  const c = await ordering.addToCart(ctx(f), randomUUID(), {
    product_id: f.product,
    option_ids: [],
    quantity: 1,
    notes: null,
  });
  await assert.rejects(
    () =>
      ordering.removeFromCart(
        ctx(f),
        randomUUID(),
        c.items[0].id,
        c.version + 1,
      ),
    { code: "VERSION_CONFLICT" },
  );
  const key = randomUUID();
  const empty = await ordering.removeFromCart(
    ctx(f),
    key,
    c.items[0].id,
    c.version,
  );
  assert.equal(empty.items.length, 0);
  assert.deepEqual(
    await ordering.removeFromCart(ctx(f), key, c.items[0].id, c.version),
    empty,
  );
  await db.query(
    "UPDATE app.carts SET expires_at=now()-interval '1 second' WHERE id=$1",
    [c.id],
  );
  const fresh = await ordering.getCart(ctx(f));
  assert.notEqual(fresh.id, c.id);
  assert.equal(
    (await db.query("SELECT status FROM app.carts WHERE id=$1", [c.id])).rows[0]
      .status,
    "expired",
  );
});
test("concurrent quote requests create one proposal/challenge and disclose the opaque nonce only once", async () => {
  const f = await fixture();
  const c = await ordering.addToCart(ctx(f), randomUUID(), {
    product_id: f.product,
    option_ids: [],
    quantity: 1,
    notes: null,
  });
  await ordering.setFulfillment(
    ctx(f),
    randomUUID(),
    "pickup",
    null,
    c.version,
  );
  const results = await Promise.all(
    Array.from({ length: 8 }, () => ordering.requestQuote(ctx(f))),
  );
  assert.equal(new Set(results.map((q) => q.order.id)).size, 1);
  assert.equal(results.filter((q) => q.confirmation_button).length, 1);
});
test("signed confirmation ingress stores only hashes and worker confirms exactly once", async () => {
  const f = await fixture(),
    q = await propose(f),
    nonce = q.confirmation_button!.split(":")[2]!;
  const channel = (
    await db.query(
      "SELECT phone_number_id FROM app.whatsapp_channels WHERE id=$1",
      [f.channel],
    )
  ).rows[0];
  const customer = (
    await db.query("SELECT channel_user_id FROM app.customers WHERE id=$1", [
      f.customer,
    ])
  ).rows[0];
  const raw = JSON.stringify(
    envelope(
      [
        {
          id: "wamid." + randomUUID(),
          from: customer.channel_user_id,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "interactive",
          interactive: {
            type: "button_reply",
            button_reply: { id: q.confirmation_button, title: "Confirm" },
          },
        },
      ],
      [],
      channel.phone_number_id,
    ),
  );
  const normalized = normalizeEnvelope(JSON.parse(raw));
  assert.ok(!JSON.stringify(normalized).includes(nonce));
  const result = await app.inject({
    method: "POST",
    url: "/webhooks/whatsapp",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signature(raw),
    },
    payload: raw,
  });
  assert.equal(result.statusCode, 200, result.body);
  const w = new InternalWorker(worker);
  assert.ok(await w.process((await w.claim(f.tenant, "inbox"))!));
  assert.equal(
    (await db.query("SELECT status FROM app.orders WHERE id=$1", [q.order.id]))
      .rows[0].status,
    "confirmed",
  );
  for (const table of [
    "webhook_events",
    "messages",
    "audit_logs",
    "outbox_events",
    "idempotency_keys",
  ])
    assert.equal(
      (
        await db.query(
          `SELECT 1 FROM app.${table} WHERE business_id=$1 AND row_to_json(${table})::text LIKE $2`,
          [f.tenant, "%" + nonce + "%"],
        )
      ).rowCount,
      0,
    );
  assert.equal(
    confirmationEvidence(confirmationEvidence(q.confirmation_button!)),
    "confirmation.invalid",
  );
});
test("worker status processing is monotonic under reordered signed provider statuses", async () => {
  const f = await fixture(),
    w = new InternalWorker(worker),
    provider = "wamid." + randomUUID();
  const box = await insert("outbox_events", {
    business_id: f.tenant,
    conversation_id: f.conversation,
    event_type: "whatsapp.message",
    aggregate_id: randomUUID(),
    aggregate_version: 1,
    causation_id: randomUUID(),
    dedupe_key: randomUUID(),
    payload: { resource_id: randomUUID(), resource_version: 1 },
  });
  const message = await insert("messages", {
    business_id: f.tenant,
    conversation_id: f.conversation,
    direction: "outbound",
    actor_type: "human",
    kind: "text",
    content: { text: "Synthetic" },
    delivery_status: "sent",
    provider_message_id: provider,
    outbox_id: box.id,
  });
  for (const status of ["read", "delivered", "sent", "failed"]) {
    const e = await event(f, "status", { status, error_codes: [] });
    await db.query(
      "UPDATE app.webhook_events SET payload=jsonb_set(payload,'{provider_message_id}',to_jsonb($2::text)) WHERE id=$1",
      [e.id, provider],
    );
    assert.ok(await w.process((await w.claim(f.tenant, "inbox"))!));
  }
  assert.equal(
    (
      await db.query("SELECT delivery_status FROM app.messages WHERE id=$1", [
        message.id,
      ])
    ).rows[0].delivery_status,
    "read",
  );
});
test("worker creates customer/conversation from recognized inbound identity", async () => {
  const f = await fixture(),
    w = new InternalWorker(worker),
    sender = "synthetic-new-" + randomUUID();
  await event(f, "text", { text: "New customer" }, randomUUID(), sender);
  assert.ok(await w.process((await w.claim(f.tenant, "inbox"))!));
  const customer = (
    await db.query(
      "SELECT id FROM app.customers WHERE business_id=$1 AND channel_user_id=$2",
      [f.tenant, sender],
    )
  ).rows[0];
  assert.ok(customer);
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM app.conversations WHERE business_id=$1 AND customer_id=$2",
        [f.tenant, customer.id],
      )
    ).rowCount,
    1,
  );
});
test("revoked assignee cannot claim; manager can resolve attention after assignee revocation", async () => {
  const f = await fixture();
  const h = (
    await http(f, "POST", `/conversations/${f.conversation}/handoffs`, {
      reason: "explicit_request",
      context: null,
      expected_conversation_version: 1,
    })
  ).json().data;
  await db.query(
    "UPDATE app.business_memberships SET active=false WHERE business_id=$1 AND user_id=$2",
    [f.tenant, f.operator],
  );
  assert.equal(
    (
      await http(f, "POST", `/handoffs/${h.id}/claim`, {
        assigned_user_id: f.operator,
        expected_version: 1,
      })
    ).statusCode,
    422,
  );
  await db.query(
    "UPDATE app.business_memberships SET active=true WHERE business_id=$1 AND user_id=$2",
    [f.tenant, f.operator],
  );
  const active = (
    await http(f, "POST", `/handoffs/${h.id}/claim`, {
      assigned_user_id: f.operator,
      expected_version: 1,
    })
  ).json().data;
  await db.query(
    "UPDATE app.business_memberships SET active=false WHERE business_id=$1 AND user_id=$2",
    [f.tenant, f.operator],
  );
  const resolved = await http(f, "POST", `/handoffs/${h.id}/resolve`, {
    expected_version: active.version,
    action: "close",
    resolution: "Managed revocation",
  });
  assert.equal(resolved.statusCode, 200, resolved.body);
});
test("resource authorization is rechecked before replay when assigned attention ends", async () => {
  const f = await fixture();
  const h = (
    await http(f, "POST", `/conversations/${f.conversation}/handoffs`, {
      reason: "explicit_request",
      context: null,
      expected_conversation_version: 1,
    })
  ).json().data;
  const active = (
    await http(f, "POST", `/handoffs/${h.id}/claim`, {
      assigned_user_id: f.operator,
      expected_version: 1,
    })
  ).json().data;
  const key = randomUUID(),
    body = { text: "Queued", expected_conversation_version: 3 };
  assert.equal(
    (
      await http(
        f,
        "POST",
        `/conversations/${f.conversation}/messages`,
        body,
        key,
        f.operator,
      )
    ).statusCode,
    202,
  );
  await http(f, "POST", `/handoffs/${h.id}/resolve`, {
    expected_version: active.version,
    action: "close",
    resolution: "Finished",
  });
  assert.equal(
    (
      await http(
        f,
        "POST",
        `/conversations/${f.conversation}/messages`,
        body,
        key,
        f.operator,
      )
    ).statusCode,
    403,
  );
});
test("a role downgrade removes historical manager cancellation replay permission", async () => {
  const f = await fixture();
  let order = await confirmed(f);
  order = (
    await http(f, "POST", `/orders/${order.id}/transitions`, {
      action: "accept",
      expected_version: order.version,
      reason: null,
    })
  ).json().data;
  const body = {
      action: "cancel",
      expected_version: order.version,
      reason: "Manager exception",
    },
    key = randomUUID();
  assert.equal(
    (await http(f, "POST", `/orders/${order.id}/transitions`, body, key))
      .statusCode,
    200,
  );
  await db.query(
    "UPDATE app.business_memberships SET role='operator' WHERE business_id=$1 AND user_id=$2",
    [f.tenant, f.owner],
  );
  assert.equal(
    (await http(f, "POST", `/orders/${order.id}/transitions`, body, key))
      .statusCode,
    403,
  );
});
test("raw SQL order PATCH and payment reopening are blocked by domain guards", async () => {
  const f = await fixture(),
    order = await confirmed(f);
  const c = await api.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "SELECT set_config('app.user_id',$1,true),set_config('app.business_id',$2,true)",
      [f.owner, f.tenant],
    );
    await assert.rejects(
      () =>
        c.query("UPDATE app.orders SET status='accepted' WHERE id=$1", [
          order.id,
        ]),
      { code: "23514" },
    );
    await c.query("ROLLBACK");
  } finally {
    c.release();
  }
  const p = (
    await http(f, "POST", `/orders/${order.id}/payments/cash-record`, {
      expected_version: 1,
      paid_at: new Date().toISOString(),
      note: "Recorded",
    })
  ).json().data;
  await assert.rejects(
    () =>
      db.query(
        "UPDATE app.payments SET status='pending',paid_at=NULL WHERE id=$1",
        [p.id],
      ),
    { code: "23514" },
  );
});
test("missing command context and null tax fields fail closed in PostgreSQL", async () => {
  const f = await fixture(),
    order = await confirmed(f);
  const fresh = new pg.Pool({ connectionString: apiUrl.toString(), max: 1 });
  const c = await fresh.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "SELECT set_config('app.user_id',$1,true),set_config('app.business_id',$2,true)",
      [f.owner, f.tenant],
    );
    await assert.rejects(
      () =>
        c.query("UPDATE app.orders SET status='accepted' WHERE id=$1", [
          order.id,
        ]),
      { code: "23514" },
    );
    await c.query("ROLLBACK");
  } finally {
    c.release();
    await fresh.end();
  }
  await assert.rejects(
    () =>
      db.query(
        "UPDATE app.business_settings SET tax_policy=$2 WHERE business_id=$1",
        [f.tenant, { mode: null, rate_bps: 0, rounding: "per_line_half_up" }],
      ),
    { code: "23514" },
  );
  await assert.rejects(
    () =>
      db.query(
        "UPDATE app.business_settings SET tax_policy=$2 WHERE business_id=$1",
        [f.tenant, { mode: "none", rate_bps: 0, rounding: null }],
      ),
    { code: "23514" },
  );
  await assert.rejects(
    () =>
      db.query("UPDATE app.businesses SET currency='EUR' WHERE id=$1", [
        f.tenant,
      ]),
    { code: "23514" },
  );
});
test("DELETE replay preserves empty 204 body after soft deletion", async () => {
  const f = await fixture();
  const created = (
    await http(f, "POST", "/categories", {
      name: "Deletable",
      sort_order: 0,
      active: true,
    })
  ).json().data;
  const key = randomUUID(),
    path = `/categories/${created.id}?expected_version=1`;
  const first = await http(f, "DELETE", path, undefined, key),
    again = await http(f, "DELETE", path, undefined, key);
  assert.equal(first.statusCode, 204);
  assert.equal(again.statusCode, 204);
  assert.equal(again.body, "");
  assert.equal(again.headers["idempotency-replayed"], "true");
});
test("delivery lifecycle requires dispatch before completion and keeps cash pending", async () => {
  const f = await fixture();
  await insert("delivery_zones", {
    business_id: f.tenant,
    name: "Delivery",
    fee_minor: 200,
    polygon_geojson: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    },
  });
  const c = await ordering.addToCart(ctx(f), randomUUID(), {
    product_id: f.product,
    option_ids: [],
    quantity: 1,
    notes: null,
  });
  await ordering.setFulfillment(
    ctx(f),
    randomUUID(),
    "delivery",
    {
      address_text: "Synthetic delivery",
      latitude: 1,
      longitude: 1,
      instructions: null,
    },
    c.version,
  );
  const q = await ordering.requestQuote(ctx(f)),
    m = await button(f, q.confirmation_button!);
  let order = await ordering.confirmOrder(ctx(f), m.id);
  for (const action of [
    "accept",
    "start_preparation",
    "mark_ready",
    "dispatch",
    "complete",
  ]) {
    if (action === "dispatch")
      assert.equal(
        (
          await http(f, "POST", `/orders/${order.id}/transitions`, {
            action: "complete",
            expected_version: order.version,
            reason: null,
          })
        ).json().error.code,
        "INVALID_ORDER_TRANSITION",
      );
    const response = await http(f, "POST", `/orders/${order.id}/transitions`, {
      action,
      expected_version: order.version,
      reason: null,
    });
    assert.equal(response.statusCode, 200, response.body);
    order = response.json().data;
  }
  assert.equal(order.status, "delivered");
  assert.equal(order.total_minor, 700);
  assert.equal(
    (await http(f, "GET", `/orders/${order.id}/payments`)).json().data[0]
      .status,
    "pending",
  );
});
test("readiness rejects additional service_role membership even without elevated LOGIN flags", async () => {
  await db.query(
    "CREATE ROLE unsafe_services_test LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;GRANT app_api,service_role TO unsafe_services_test",
  );
  const url = new URL(apiUrl);
  url.username = "unsafe_services_test";
  const unsafe = new pg.Pool({ connectionString: url.toString() });
  try {
    await assert.rejects(() => checkDatabaseRole(unsafe, "api"));
  } finally {
    await unsafe.end();
  }
});
test("duplicate provider message leaves an expired session and cart untouched", async () => {
  const f = await fixture(),
    w = new InternalWorker(worker),
    first = await event(f, "text", { text: "Synthetic" });
  assert.ok(await w.process((await w.claim(f.tenant, "inbox"))!));
  await ordering.addToCart(ctx(f), randomUUID(), {
    product_id: f.product,
    option_ids: [],
    quantity: 1,
    notes: null,
  });
  await db.query(
    "UPDATE app.conversations SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [f.conversation],
  );
  const before = (
    await db.query("SELECT * FROM app.conversations WHERE id=$1", [
      f.conversation,
    ])
  ).rows[0];
  const audits = (
    await db.query(
      "SELECT count(*)::int n FROM app.audit_logs WHERE business_id=$1",
      [f.tenant],
    )
  ).rows[0].n;
  const duplicate = await event(f, "text", { text: "Synthetic" });
  await db.query(
    "UPDATE app.webhook_events SET payload=jsonb_set(payload,'{provider_message_id}',to_jsonb($2::text)) WHERE id=$1",
    [duplicate.id, first.payload.provider_message_id],
  );
  assert.ok(await w.process((await w.claim(f.tenant, "inbox"))!));
  assert.deepEqual(
    (
      await db.query("SELECT * FROM app.conversations WHERE id=$1", [
        f.conversation,
      ])
    ).rows[0],
    before,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM app.carts WHERE business_id=$1 AND status='active'",
        [f.tenant],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM app.audit_logs WHERE business_id=$1",
        [f.tenant],
      )
    ).rows[0].n,
    audits,
  );
});
test("new inbound message preserves human attention after session expiry", async () => {
  const f = await fixture(),
    w = new InternalWorker(worker);
  await http(f, "POST", `/conversations/${f.conversation}/handoffs`, {
    reason: "explicit_request",
    context: null,
    expected_conversation_version: 1,
  });
  await db.query(
    "UPDATE app.conversations SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [f.conversation],
  );
  const before = (
    await db.query("SELECT * FROM app.conversations WHERE id=$1", [
      f.conversation,
    ])
  ).rows[0];
  await event(f, "text", { text: "Still waiting" });
  assert.ok(await w.process((await w.claim(f.tenant, "inbox"))!));
  const after = (
    await db.query("SELECT * FROM app.conversations WHERE id=$1", [
      f.conversation,
    ])
  ).rows[0];
  assert.equal(after.status, "human_pending");
  assert.equal(after.automation_epoch, before.automation_epoch);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM app.conversations WHERE business_id=$1",
        [f.tenant],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT status FROM app.human_handoffs WHERE business_id=$1",
        [f.tenant],
      )
    ).rows[0].status,
    "pending",
  );
});
test("price edits and pending cash cancellation retain safe canonical audit amounts", async () => {
  const f = await fixture();
  assert.equal(
    (
      await http(f, "PATCH", `/products/${f.product}`, {
        expected_version: 1,
        price_minor: 650,
      })
    ).statusCode,
    200,
  );
  const price = (
    await db.query(
      "SELECT before_redacted,after_redacted FROM app.audit_logs WHERE business_id=$1 AND resource_id=$2 ORDER BY created_at DESC LIMIT 1",
      [f.tenant, f.product],
    )
  ).rows[0];
  assert.equal(price.before_redacted.total_minor, 500);
  assert.equal(price.after_redacted.total_minor, 650);
  assert.equal(price.after_redacted.action, "price_minor");
  const order = await confirmed(f);
  assert.equal(
    (
      await http(f, "POST", `/orders/${order.id}/transitions`, {
        action: "cancel",
        expected_version: order.version,
        reason: "Synthetic cancellation",
      })
    ).statusCode,
    200,
  );
  const payment = (
    await db.query(
      "SELECT before_redacted,after_redacted FROM app.audit_logs WHERE business_id=$1 AND action='payment.cancel'",
      [f.tenant],
    )
  ).rows[0];
  assert.equal(payment.before_redacted.status, "pending");
  assert.equal(payment.after_redacted.status, "cancelled");
  assert.equal(payment.after_redacted.total_minor, 1300);
  assert.equal(payment.after_redacted.currency, "USD");
  const logs = (
    await db.query(
      "SELECT before_redacted,after_redacted FROM app.audit_logs WHERE business_id=$1",
      [f.tenant],
    )
  ).rows;
  for (const log of logs)
    for (const record of [log.before_redacted, log.after_redacted])
      if (record)
        assert.ok(
          Object.keys(record).every((k) =>
            [
              "resource_id",
              "version",
              "status",
              "total_minor",
              "action",
              "currency",
            ].includes(k),
          ),
        );
  assert.ok(!JSON.stringify(logs).includes("+12025550123"));
});
