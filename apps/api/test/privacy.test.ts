import test from "node:test";
import assert from "node:assert/strict";
import { testApp } from "./helpers.js";
import { contract } from "./schema.js";

test("privacy is public HTML even when DB and authenticated services are unavailable", async t => {
  const unexpected = async (): Promise<never> => { throw new Error("must not access private service"); };
  const app = await testApp({
    readiness: unexpected,
    auth: { verify: unexpected },
    identities: { getMe: unexpected, getBusiness: unexpected },
    inbox: { ingest: unexpected },
  });
  t.after(() => app.close());
  const response = await app.inject("/privacy");
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"]!, /^text\/html; charset=utf-8$/);
  assert.match(response.body, /<html lang="es">/);
  assert.match(response.body, /<h1>Política de privacidad<\/h1>/);
  assert.match(response.body, /Derly Zambrano/);
  assert.match(response.body, /mailto:derlymoreira192@gmail.com/);
  assert.match(response.body, /Eliminar mis datos de Agente-IA/);
  assert.equal(contract.paths["/privacy"].get.security.length, 0);
  assert.ok(contract.paths["/privacy"].get.responses["200"].content["text/html"]);
});

test("privacy cannot reflect query content or set cookies and retains security headers and rate limits", async t => {
  const app = await testApp({ rateLimitMax: 2 });
  t.after(() => app.close());
  const plain = await app.inject("/privacy");
  const query = await app.inject("/privacy?contact=injected-private-marker&text=%3Cscript%3E");
  assert.equal(query.body, plain.body);
  assert.equal(query.headers["set-cookie"], undefined);
  assert.equal(query.headers["cache-control"], "no-cache");
  assert.equal(query.headers["x-content-type-options"], "nosniff");
  assert.match(query.headers["content-security-policy"]!, /default-src 'none'/);
  assert.match(query.headers["content-security-policy"]!, /frame-ancestors 'none'/);
  assert.doesNotMatch(query.body, /<script|<iframe|<form|<img|injected-private-marker/i);
  assert.equal((await app.inject("/privacy")).statusCode, 429);
  assert.equal((await app.inject({ method: "POST", url: "/privacy" })).statusCode, 404);
});
