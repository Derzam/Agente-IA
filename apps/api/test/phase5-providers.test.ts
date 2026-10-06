import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  ResponsesProvider,
  ProviderFailure,
} from "../src/modules/ai/provider.js";
import { CloudMetaProvider } from "../src/providers/meta/provider.js";
import { ChallengeCipher } from "../src/providers/meta/challenge-cipher.js";
import { CursorCodec } from "../src/platform/cursor.js";
import { loadApiRuntime, loadRuntime } from "../src/config/runtime.js";
import { loadConfig } from "../src/config/env.js";
import {
  validateTool,
  toolRegistry,
  minimize,
} from "../src/modules/ai/tools.js";
import { minimizedText } from "../src/modules/ai/context.js";
const fetcher = (
  fn: (url: string, options: RequestInit) => Promise<Response>,
) => ((url: any, options: any) => fn(String(url), options)) as typeof fetch;
const syntheticResponse = {
  id: "resp_synthetic",
  object: "response",
  status: "completed",
  output: [
    {
      type: "message",
      id: "msg_synthetic",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: "Hola", annotations: [] }],
    },
  ],
  usage: {
    input_tokens: 10,
    output_tokens: 3,
    total_tokens: 13,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  },
};
test("official SDK uses only POST Responses, configured model, store=false and strict function tools", async () => {
  let calls = 0;
  const provider = new ResponsesProvider(
    {
      apiKey: "synthetic-only",
      model: "synthetic-model",
      maxOutput: 64,
      timeout: 500,
    },
    fetcher(async (url, options) => {
      calls++;
      assert.equal(new URL(url).pathname, "/v1/responses");
      assert.equal(options.method, "POST");
      const body = JSON.parse(String(options.body));
      assert.equal(body.model, "synthetic-model");
      assert.equal(body.store, false);
      assert.equal(body.parallel_tool_calls, false);
      assert.equal(body.max_output_tokens, 64);
      assert.ok(
        body.tools.every(
          (t: any) =>
            t.type === "function" &&
            t.strict &&
            t.parameters.additionalProperties === false,
        ),
      );
      assert.equal(body.previous_response_id, undefined);
      return Response.json(syntheticResponse);
    }),
  );
  const reply = await provider.respond(
    [{ role: "user", content: "Synthetic" }],
    toolRegistry,
  );
  assert.equal(calls, 1);
  assert.equal(reply.input, 10);
  assert.equal(reply.text, "Hola");
});
for (const [status, code] of [
  [429, "AI_RATE_LIMITED"],
  [500, "AI_PROVIDER_ERROR"],
  [401, "AI_PROVIDER_ERROR"],
] as const)
  test(`OpenAI ${status} is classified without raw errors and SDK automatic retry`, async () => {
    let calls = 0;
    const p = new ResponsesProvider(
      {
        apiKey: "synthetic-only",
        model: "synthetic-model",
        maxOutput: 64,
        timeout: 500,
      },
      fetcher(async () => {
        calls++;
        return Response.json(
          {
            error: {
              message: "Sensitive raw provider value",
              type: "synthetic",
              code: "synthetic",
            },
          },
          { status },
        );
      }),
    );
    await assert.rejects(
      () => p.respond([], toolRegistry),
      (e: any) =>
        e instanceof ProviderFailure &&
        e.code === code &&
        !e.message.includes("Sensitive"),
    );
    assert.equal(calls, 1);
  });
test("OpenAI timeout aborts the official SDK request", async () => {
  const p = new ResponsesProvider(
    {
      apiKey: "synthetic-only",
      model: "synthetic-model",
      maxOutput: 64,
      timeout: 30,
    },
    fetcher(
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal!.addEventListener("abort", () =>
            reject(new DOMException("Synthetic timeout", "AbortError")),
          );
        }),
    ),
  );
  await assert.rejects(
    () => p.respond([], toolRegistry),
    (e: any) => e.code === "AI_TIMEOUT",
  );
});
test("incomplete OpenAI result cannot create a reply", async () => {
  const p = new ResponsesProvider(
    {
      apiKey: "synthetic-only",
      model: "synthetic-model",
      maxOutput: 64,
      timeout: 100,
    },
    fetcher(async () =>
      Response.json({ ...syntheticResponse, status: "incomplete" }),
    ),
  );
  await assert.rejects(
    () => p.respond([], toolRegistry),
    (e: any) => e.code === "AI_INCOMPLETE",
  );
});
test("OpenAI rejects output requesting built-in tools beyond the function whitelist", async () => {
  const p = new ResponsesProvider(
    {
      apiKey: "synthetic-only",
      model: "synthetic-model",
      maxOutput: 64,
      timeout: 100,
    },
    fetcher(async () =>
      Response.json({
        ...syntheticResponse,
        output: [
          { type: "web_search_call", id: "synthetic", status: "completed" },
        ],
      }),
    ),
  );
  await assert.rejects(
    () => p.respond([], toolRegistry),
    (e: any) => e.code === "AI_INVALID_OUTPUT",
  );
});
const metaConfig = {
  token: "synthetic-only",
  phone: "123456789",
  version: "v999.0",
  timeout: 100,
};
test("Meta Cloud API uses fixed Graph origin, env version, callback UUID and interactive reply", async () => {
  const button =
    "confirm:11111111-1111-4111-8111-111111111111:" +
    randomBytes(32).toString("base64url");
  const p = new CloudMetaProvider(
    metaConfig,
    fetcher(async (url, options) => {
      assert.equal(url, "https://graph.facebook.com/v999.0/123456789/messages");
      assert.equal(options.redirect, "error");
      const body = JSON.parse(String(options.body));
      assert.equal(body.type, "interactive");
      assert.equal(body.interactive.action.buttons[0].reply.id, button);
      assert.equal(
        body.biz_opaque_callback_data,
        "11111111-1111-4111-8111-111111111111",
      );
      return Response.json({
        messaging_product: "whatsapp",
        messages: [{ id: "wamid.synthetic" }],
      });
    }),
  );
  assert.deepEqual(
    await p.send({
      recipient: "12025550123",
      text: "Canonical quote",
      button,
      callback: "11111111-1111-4111-8111-111111111111",
    }),
    { kind: "accepted", id: "wamid.synthetic" },
  );
});
for (const [status, data, kind] of [
  [200, {}, "unknown"],
  [
    200,
    { messaging_product: "whatsapp", messages: [{ id: "bad-id" }] },
    "unknown",
  ],
  [500, { error: { code: 1 } }, "unknown"],
  [429, { error: { code: 130429 } }, "retry"],
  [401, { error: { code: 190 } }, "rejected"],
] as const)
  test(`Meta ${status}/${kind} never falsely marks sent`, async () => {
    const p = new CloudMetaProvider(
      metaConfig,
      fetcher(async () => Response.json(data, { status })),
    );
    assert.equal(
      (
        await p.send({
          recipient: "12025550123",
          text: "Synthetic",
          callback: "11111111-1111-4111-8111-111111111111",
        })
      ).kind,
      kind,
    );
  });
test("Meta network timeout is ambiguous and receives no automatic retry", async () => {
  let calls = 0;
  const p = new CloudMetaProvider(
    metaConfig,
    fetcher(async () => {
      calls++;
      throw new DOMException("Synthetic timeout", "AbortError");
    }),
  );
  assert.equal(
    (
      await p.send({
        recipient: "12025550123",
        text: "Synthetic",
        callback: "11111111-1111-4111-8111-111111111111",
      })
    ).kind,
    "unknown",
  );
  assert.equal(calls, 1);
});
test("Meta malformed recipient and unsupported payload never reach HTTP", async () => {
  let calls = 0;
  const p = new CloudMetaProvider(
    metaConfig,
    fetcher(async () => {
      calls++;
      return Response.json({});
    }),
  );
  assert.equal(
    (
      await p.send({
        recipient: "arbitrary",
        text: "Synthetic",
        callback: "synthetic",
      })
    ).kind,
    "rejected",
  );
  assert.equal(calls, 0);
});
test("AES-GCM roundtrip binds tenant/customer/order/version and IVs are unique", () => {
  const c = new ChallengeCipher("one", {
    one: randomBytes(32).toString("hex"),
  });
  const values = Array.from({ length: 100 }, () =>
    c.seal("synthetic-bound-context", "synthetic-secret"),
  );
  assert.equal(new Set(values.map((v) => v.iv)).size, 100);
  assert.equal(
    c.open("synthetic-bound-context", values[0]!),
    "synthetic-secret",
  );
  assert.throws(() => c.open("another-tenant", values[0]!));
});
for (const changed of ["key_version", "iv", "tag", "ciphertext"] as const)
  test(`AES-GCM rejects tampered ${changed}`, () => {
    const c = new ChallengeCipher("one", {
      one: randomBytes(32).toString("hex"),
    });
    const value = c.seal("binding", "synthetic-secret");
    value[changed] = "invalid";
    assert.throws(
      () => c.open("binding", value),
      /CHALLENGE_TRANSPORT_INVALID/,
    );
  });
test("challenge key rotation decrypts old versions without writing a plaintext secret", () => {
  const old = randomBytes(32).toString("hex"),
    fresh = randomBytes(32).toString("hex");
  const sealed = new ChallengeCipher("old", { old }).seal(
    "binding",
    "synthetic-secret",
  );
  const rotated = new ChallengeCipher("new", { old, new: fresh });
  assert.equal(rotated.open("binding", sealed), "synthetic-secret");
  assert.equal(rotated.seal("binding", "synthetic-secret").key_version, "new");
  assert.throws(() =>
    new ChallengeCipher("new", { new: fresh }).open("binding", sealed),
  );
  assert.ok(!JSON.stringify(sealed).includes("synthetic-secret"));
});
test("cursor keys shared across instances survive restart and bounded rotation", () => {
  const old = randomBytes(32).toString("hex"),
    fresh = randomBytes(32).toString("hex");
  const one = new CursorCodec(old),
    two = new CursorCodec(old),
    cursor = one.sign("synthetic-data");
  assert.equal(two.verify(cursor), "synthetic-data");
  assert.equal(new CursorCodec(fresh, old).verify(cursor), "synthetic-data");
  assert.throws(() => new CursorCodec(fresh).verify(cursor));
  assert.throws(() => two.verify(cursor + "tampered"));
});
test("runtime flags fail closed independently from business ai_enabled", () => {
  const env = {
    WORKER_DATABASE_URL: "postgres://worker_test@127.0.0.1/agente_ia_test",
    CURSOR_HMAC_KEY: randomBytes(32).toString("hex"),
  };
  const cfg = loadRuntime(env);
  assert.equal(cfg.aiEnabled, false);
  assert.equal(cfg.metaEnabled, false);
  assert.throws(
    () => loadRuntime({ ...env, AI_RUNTIME_ENABLED: "true" }),
    /OPENAI_API_KEY/,
  );
  assert.throws(
    () => loadRuntime({ ...env, META_OUTBOUND_ENABLED: "true" }),
    /META_ACCESS_TOKEN/,
  );
  assert.throws(
    () => loadApiRuntime({ CURSOR_HMAC_KEY: "secret-invalid-value" }),
    (e) => /CURSOR_HMAC_KEY/.test(String(e)) && !String(e).includes("secret-invalid-value"),
  );
  assert.throws(() =>
    loadRuntime({
      ...env,
      WORKER_DATABASE_URL: "postgres://service_role@127.0.0.1/agente_ia_test",
    }),
  );
});
test("API bootstrap configuration works without worker or provider credentials", () => {
  const env = {
    NODE_ENV: "test",
    DATABASE_URL: "postgres://api_test@127.0.0.1/agente_ia_test",
    WEBHOOK_DATABASE_URL: "postgres://ingress_test@127.0.0.1/agente_ia_test",
    SUPABASE_URL: "https://pqffgbpbreuhivxxctvr.supabase.co",
    META_VERIFY_TOKEN: "synthetic-verify-only",
    META_APP_SECRET: "synthetic-secret-only",
    ADMIN_ALLOWED_ORIGINS: "http://localhost:5173",
    CURSOR_HMAC_KEY: randomBytes(32).toString("hex"),
    AI_RUNTIME_ENABLED: "true",
    META_OUTBOUND_ENABLED: "true",
    RUNTIME_ENV: "staging",
  };
  const api = loadConfig(env);
  assert.equal(api.databaseUrl, env.DATABASE_URL);
  assert.equal(api.webhookDatabaseUrl, env.WEBHOOK_DATABASE_URL);
  const forbidden = /^(WORKER_DATABASE_URL|OPENAI_|CONFIRMATION_|META_ACCESS_TOKEN|META_PHONE_NUMBER_ID|META_SANDBOX_RECIPIENTS)/;
  const isolated = new Proxy(env, {
    get(target, property, receiver) {
      assert.ok(!forbidden.test(String(property)), `API read worker field ${String(property)}`);
      return Reflect.get(target, property, receiver);
    },
  });
  assert.deepEqual(loadApiRuntime(isolated), {
    cursorKey: env.CURSOR_HMAC_KEY,
    cursorPreviousKey: undefined,
  });
});
test("worker validates enabled providers without API, ingress or cursor secrets", () => {
  const env = {
    WORKER_DATABASE_URL: "postgres://worker_test@127.0.0.1/agente_ia_test",
    AI_RUNTIME_ENABLED: "true",
    META_OUTBOUND_ENABLED: "true",
    OPENAI_API_KEY: "synthetic-only",
    OPENAI_MODEL: "synthetic-model",
    META_ACCESS_TOKEN: "synthetic-only",
    META_PHONE_NUMBER_ID: "123456789",
    META_GRAPH_API_VERSION: "v999.0",
    META_SANDBOX_RECIPIENTS: "12025550123",
    CONFIRMATION_ACTIVE_KEY_VERSION: "v1",
    CONFIRMATION_TRANSPORT_KEYS: JSON.stringify({ v1: randomBytes(32).toString("hex") }),
  };
  const isolated = new Proxy(env, {
    get(target, property, receiver) {
      assert.ok(!["DATABASE_URL", "WEBHOOK_DATABASE_URL", "CURSOR_HMAC_KEY", "CURSOR_HMAC_PREVIOUS_KEY", "META_APP_SECRET", "META_VERIFY_TOKEN"].includes(String(property)));
      return Reflect.get(target, property, receiver);
    },
  });
  const cfg = loadRuntime(isolated);
  assert.equal(cfg.aiEnabled, true);
  assert.equal(cfg.metaEnabled, true);
  assert.equal(cfg.workerUrl, env.WORKER_DATABASE_URL);
  assert.throws(() => loadRuntime({ ...env, OPENAI_API_KEY: "" }), /OPENAI_API_KEY/);
  assert.throws(() => loadRuntime({ ...env, META_ACCESS_TOKEN: "" }), /META_ACCESS_TOKEN/);
});
test("separate runtime loaders preserve cursor rotation and staging restrictions", () => {
  assert.throws(() => loadApiRuntime({}), /CURSOR_HMAC_KEY/);
  const cursor = { CURSOR_HMAC_KEY: randomBytes(32).toString("hex") };
  assert.throws(() => loadApiRuntime({ ...cursor, CURSOR_HMAC_PREVIOUS_KEY: "invalid" }), /CURSOR_HMAC_PREVIOUS_KEY/);
  for (const load of [loadApiRuntime, loadRuntime]) {
    assert.throws(() => load({ ...cursor, WORKER_DATABASE_URL: "postgres://worker_test@127.0.0.1/agente_ia_test", RUNTIME_ENV: "staging", SUPABASE_URL: "https://unapproved.example" }), /SUPABASE_URL/);
  }
});
test("AI tool schemas reject tenant, price, payment status and arbitrary order status", () => {
  for (const extra of [
    { business_id: "11111111-1111-4111-8111-111111111111" },
    { price: 0 },
    { payment_status: "paid" },
    { order_status: "delivered" },
  ])
    assert.throws(() => validateTool("get_cart", JSON.stringify(extra)));
  assert.equal(toolRegistry.length, 9);
  assert.throws(() => validateTool("execute_sql", "{}"));
});
test("sensitive fields and opaque confirmation material never enter provider context", () => {
  const value = minimize({
    id: "internal",
    confirmation_button: "opaque",
    address_snapshot: { address_text: "full address" },
    channel_user_id: "phone",
    notes: "sensitive",
    nested: { phone_e164: "full phone", nonce_hash: "hash" },
  });
  assert.deepEqual(value, { id: "internal", nested: {} });
  const context = minimizedText(
    "Bearer synthetic.jwt +12025550123 confirm:11111111-1111-4111-8111-111111111111:" +
      randomBytes(32).toString("base64url"),
  );
  assert.ok(!context.includes("synthetic.jwt"));
  assert.ok(!context.includes("12025550123"));
  assert.ok(!context.includes("confirm:"));
});
