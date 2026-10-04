import type { FastifyInstance } from "fastify";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { Role } from "@agente-ia/shared";
import type pg from "pg";
import type { AuthVerifier } from "../../../integrations/supabase/auth.js";
import contract from "../../../generated/contract.js";
import { unauthenticated } from "../../../platform/errors.js";
import { fail } from "../domain/rules.js";
import { canonicalJson } from "../../../platform/idempotency.js";
import { authorizeReplay } from "../application/authorization.js";
import { DomainTransactions } from "../application/transaction.js";
import { CatalogService } from "../application/catalog.js";
import { OperationsService } from "../application/operations.js";
import type { Row } from "../infrastructure/repository.js";
const rewrite = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(rewrite)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v).map(([k, x]) => [
            k,
            k === "$ref"
              ? (x as string).replace("#/components/schemas/", "#/$defs/")
              : rewrite(x),
          ]),
        )
      : v;
const ajv = new Ajv2020({
  strict: true,
  allErrors: false,
  coerceTypes: false,
  removeAdditional: false,
});
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
const defs = rewrite(contract.components.schemas);
const compile = (schema: unknown) =>
  ajv.compile({ ...(rewrite(schema) as object), $defs: defs });
export function registerDomainRoutes(
  app: FastifyInstance,
  auth: AuthVerifier,
  pool: pg.Pool,
) {
  const tx = new DomainTransactions(pool),
    catalog = new CatalogService(),
    operations = new OperationsService();
  for (const [path, item] of Object.entries(contract.paths)) {
    if (!path.startsWith("/v1/businesses/")) continue;
    for (const [method, untyped] of Object.entries(item)) {
      const op = untyped as Row;
      const paramsSchema: Row = {
        type: "object",
        additionalProperties: false,
        properties: {},
        required: [],
      };
      const querySchema: Row = {
        type: "object",
        additionalProperties: false,
        properties: {},
        required: [],
      };
      for (const p of op.parameters) {
        if (p.in === "path" || p.in === "query") {
          const s = p.in === "path" ? paramsSchema : querySchema;
          s.properties[p.name] = p.schema;
          if (p.required) s.required.push(p.name);
        }
      }
      const validParams = compile(paramsSchema),
        validQuery = compile(querySchema),
        validBody = op.requestBody
          ? compile(op.requestBody.content["application/json"].schema)
          : undefined;
      app.route({
        method: method.toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE",
        url: path.replace(/\{([^}]+)\}/g, ":$1"),
        handler: async (request, reply) => {
          const header = request.headers.authorization;
          if (
            !header ||
            header.length > 8192 ||
            !/^Bearer [A-Za-z0-9._-]+$/i.test(header)
          )
            throw unauthenticated();
          const identity = await auth.verify(header.slice(7));
          const params = request.params as Row;
          const query = { ...(request.query as Row) };
          for (const [k, schema] of Object.entries(querySchema.properties) as [
            string,
            Row,
          ][])
            if (k in query) {
              if (schema.type === "integer" && /^[0-9]+$/.test(query[k]))
                query[k] = Number(query[k]);
              if (
                schema.type === "boolean" &&
                ["true", "false"].includes(query[k])
              )
                query[k] = query[k] === "true";
            }
          if (
            !validParams(params) ||
            !validQuery(query) ||
            (validBody && !validBody(request.body)) ||
            (!validBody && request.body !== undefined)
          )
            fail("VALIDATION_ERROR", 422);
          const key = request.headers["idempotency-key"];
          if (
            method !== "get" &&
            (typeof key !== "string" ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                key,
              ))
          )
            fail("VALIDATION_ERROR", 422);
          const result = await tx.run(
            {
              user: identity.userId,
              tenant: params.business_id,
              roles: op["x-roles"] as Role[],
              operation: op.operationId,
              key: method === "get" ? undefined : (key as string),
              request: request.id,
              input: { path: params, query, body: request.body ?? null },
            },
            (r, role) => {
              const operation = {
                method,
                path,
                params,
                query,
                body: (request.body ?? {}) as Row,
                request: request.id,
              };
              const actor = {
                id: identity.userId,
                type: "human" as const,
                role,
              };
              return /^\/v1\/businesses\/\{business_id\}(?:$|\/(settings|categories|products|delivery-zones)(?:\/|$))/.test(
                path,
              )
                ? catalog.execute(r, actor, operation)
                : operations.execute(r, actor, operation);
            },
            (r, role, response) =>
              authorizeReplay(
                r,
                { id: identity.userId, type: "human", role },
                {
                  method,
                  path,
                  params,
                  query,
                  body: (request.body ?? {}) as Row,
                  request: request.id,
                },
                response,
              ),
          );
          if (result.replayed) reply.header("Idempotency-Replayed", "true");
          reply.code(result.status);
          return result.status === 204
            ? reply.send()
            : reply.type("application/json").send(canonicalJson(result.body));
        },
      });
    }
  }
}
