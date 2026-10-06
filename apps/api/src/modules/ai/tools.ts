import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { FunctionTool } from "openai/resources/responses/responses.js";
import type {
  OrderingService,
  CustomerContext,
} from "../domain/application/ordering.js";
import { ProviderFailure } from "./provider.js";
const uuid = { type: "string", format: "uuid" },
  version = { type: "integer", minimum: 1, maximum: 2147483647 },
  text = (max: number) => ({ type: "string", maxLength: max });
const nullable = (s: object) => ({ anyOf: [s, { type: "null" }] });
const schema = (p: Record<string, object>) => ({
  type: "object",
  properties: p,
  required: Object.keys(p),
  additionalProperties: false,
});
const address = schema({
  address_text: { ...text(1000), minLength: 1 },
  latitude: nullable({ type: "number", minimum: -90, maximum: 90 }),
  longitude: nullable({ type: "number", minimum: -180, maximum: 180 }),
  instructions: nullable(text(1000)),
});
const defs: Record<string, object> = {
  search_menu: schema({ query: text(120) }),
  get_product: schema({ product_id: uuid }),
  get_cart: schema({}),
  add_to_cart: schema({
    product_id: uuid,
    option_ids: { type: "array", items: uuid, maxItems: 20, uniqueItems: true },
    quantity: { type: "integer", minimum: 1, maximum: 99 },
    notes: nullable(text(1000)),
  }),
  remove_from_cart: schema({ item_id: uuid, expected_version: version }),
  set_fulfillment: schema({
    fulfillment: { type: "string", enum: ["pickup", "delivery"] },
    address: nullable(address),
    expected_version: version,
  }),
  request_quote: schema({}),
  confirm_order: schema({}),
  request_human: schema({
    reason: {
      type: "string",
      enum: [
        "explicit_request",
        "misunderstanding",
        "complaint",
        "payment_issue",
        "system_failure",
      ],
    },
  }),
};
export const toolRegistry: FunctionTool[] = Object.entries(defs).map(
  ([name, parameters]) => ({
    type: "function",
    name,
    description:
      name === "confirm_order"
        ? "Consume only the verified current inbound interactive. Free text cannot consent."
        : name === "request_quote"
          ? "Calculate and enqueue canonical quote and interactive confirmation."
          : name.replaceAll("_", " "),
    strict: true,
    parameters: parameters as Record<string, unknown>,
  }),
);
const ajv = new Ajv2020({ strict: true });
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
const validators = Object.fromEntries(
  Object.entries(defs).map(([n, s]) => [n, ajv.compile(s)]),
);
export function validateTool(name: string, raw: string): Record<string, any> {
  if (!validators[name]) throw new ProviderFailure("AI_INVALID_TOOL");
  try {
    if (raw.length > 8192) throw Error();
    const args = JSON.parse(raw);
    if (!validators[name]!(args)) throw Error();
    return args as Record<string, any>;
  } catch {
    throw new ProviderFailure("AI_INVALID_TOOL_SCHEMA");
  }
}
export function minimize(value: unknown): any {
  if (Array.isArray(value)) return value.map(minimize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) =>
            ![
              "confirmation_button",
              "nonce_hash",
              "transport_cipher",
              "address_snapshot",
              "address_text",
              "instructions",
              "phone_e164",
              "channel_user_id",
              "display_name",
              "notes",
              "summary",
              "content",
            ].includes(k),
        )
        .map(([k, v]) => [k, minimize(v)]),
    );
  return value;
}
export class ToolExecutor {
  constructor(private service: OrderingService) {}
  async execute(
    name: string,
    a: Record<string, any>,
    ctx: CustomerContext,
    key: string,
    inbound: string,
  ) {
    switch (name) {
      case "search_menu":
        return minimize(await this.service.searchMenu(ctx, a.query));
      case "get_product":
        return minimize(await this.service.getProduct(ctx, a.product_id));
      case "get_cart":
        return minimize(await this.service.getCart(ctx));
      case "add_to_cart":
        return minimize(await this.service.addToCart(ctx, key, a as any));
      case "remove_from_cart":
        return minimize(
          await this.service.removeFromCart(
            ctx,
            key,
            a.item_id,
            a.expected_version,
          ),
        );
      case "set_fulfillment":
        return minimize(
          await this.service.setFulfillment(
            ctx,
            key,
            a.fulfillment,
            a.address,
            a.expected_version,
          ),
        );
      case "request_quote":
        return minimize(await this.service.requestQuote(ctx));
      case "confirm_order":
        return minimize(await this.service.confirmOrder(ctx, inbound));
      case "request_human":
        return minimize(await this.service.requestHuman(ctx, key, a.reason));
      default:
        throw new ProviderFailure("AI_INVALID_TOOL");
    }
  }
}
