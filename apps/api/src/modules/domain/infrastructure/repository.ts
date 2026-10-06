import type { PoolClient } from "pg";
import contract from "../../../generated/contract.js";
import { fail, minor } from "../domain/rules.js";
export type Row = Record<string, any>;
export type Table =
  | "businesses"
  | "business_settings"
  | "categories"
  | "products"
  | "modifier_groups"
  | "modifier_options"
  | "delivery_zones"
  | "customers"
  | "orders"
  | "order_items"
  | "payments"
  | "conversations"
  | "messages"
  | "human_handoffs"
  | "carts"
  | "cart_items"
  | "confirmation_challenges"
  | "conversation_turns"
  | "tool_executions";
// Internal runtime metadata remains outside public DTO projection.
export class Repository {
  constructor(
    readonly db: PoolClient,
    readonly tenant: string,
  ) {}
  async pricingBusiness(): Promise<Row> {
    const r = await this.db.query(
      "SELECT id,currency,timezone FROM app.businesses WHERE id=$1",
      [this.tenant],
    );
    if (!r.rows[0]) fail("NOT_FOUND", 404);
    return r.rows[0];
  }
  async one(table: Table, id: string, lock = false): Promise<Row> {
    const key = table === "business_settings" ? "business_id" : "id";
    const scope = table === "businesses" ? "id" : "business_id";
    const live = [
      "categories",
      "products",
      "modifier_groups",
      "modifier_options",
      "delivery_zones",
      "customers",
    ].includes(table)
      ? " AND deleted_at IS NULL"
      : "";
    const r = await this.db.query(
      `SELECT * FROM app.${table} WHERE ${scope}=$1 AND ${key}=$2${live}${lock ? " FOR UPDATE" : ""}`,
      [this.tenant, id],
    );
    if (!r.rows[0]) fail("NOT_FOUND", 404);
    return r.rows[0];
  }
  async insert(table: Table, data: Row): Promise<Row> {
    const cols = Object.keys(data);
    this.identifiers(cols);
    const r = await this.db.query(
      `INSERT INTO app.${table}(business_id,${cols.join(",")}) VALUES($1,${cols.map((_, i) => "$" + (i + 2)).join(",")}) RETURNING *`,
      [this.tenant, ...Object.values(data).map(this.value)],
    );
    return r.rows[0];
  }
  async update(table: Table, id: string, data: Row): Promise<Row> {
    const cols = Object.keys(data);
    this.identifiers(cols);
    const key = table === "business_settings" ? "business_id" : "id",
      scope = table === "businesses" ? "id" : "business_id";
    const r = await this.db.query(
      `UPDATE app.${table} SET ${cols.map((c, i) => c + "=$" + (i + 3)).join(",")} WHERE ${scope}=$1 AND ${key}=$2 RETURNING *`,
      [this.tenant, id, ...Object.values(data).map(this.value)],
    );
    if (!r.rows[0]) fail("NOT_FOUND", 404);
    return r.rows[0];
  }
  private identifiers(cols: string[]) {
    if (!cols.length || cols.some((c) => !/^[a-z_]+$/.test(c)))
      throw Error("Invalid internal columns");
  }
  private value(v: unknown) {
    return v !== null && typeof v === "object" && !(v instanceof Date)
      ? JSON.stringify(v)
      : v;
  }
  async dto(name: string, row: Row): Promise<Row> {
    const schema = (contract.components.schemas as Record<string, Row>)[name];
    const out: Row = {};
    for (const k of Object.keys(schema!.properties))
      if (k in row) {
        const v = row[k];
        out[k] =
          v instanceof Date
            ? v.toISOString()
            : typeof v === "string" &&
                (/_minor$/.test(k) || k === "automation_epoch")
              ? minor(v)
              : v;
      }
    if (name === "Business") out.business_id = row.id;
    if (name === "Customer")
      out.phone_masked = row.phone_e164
        ? `***${row.phone_e164.slice(-4)}`
        : null;
    if (name === "Message")
      out.text = row.kind === "text" ? (row.content?.text ?? null) : null;
    if (name === "Conversation") {
      const h = await this.db.query(
        "SELECT assigned_user_id FROM app.human_handoffs WHERE business_id=$1 AND conversation_id=$2 AND status='active'",
        [this.tenant, row.id],
      );
      out.assigned_user_id = h.rows[0]?.assigned_user_id ?? null;
    }
    if (name === "Order")
      out.items = (
        await this.db.query(
          "SELECT * FROM app.order_items WHERE business_id=$1 AND order_id=$2 ORDER BY created_at,id",
          [this.tenant, row.id],
        )
      ).rows.map((i) =>
        Object.fromEntries(
          Object.keys(
            (contract.components.schemas.OrderItem as Row).properties,
          ).map((k) => [k, /_minor$/.test(k) ? minor(i[k]) : i[k]]),
        ),
      );
    if (name === "Product") {
      const groups = (
        await this.db.query(
          "SELECT * FROM app.modifier_groups WHERE business_id=$1 AND product_id=$2 AND deleted_at IS NULL ORDER BY sort_order,id",
          [this.tenant, row.id],
        )
      ).rows;
      out.modifier_groups = [];
      out.options = [];
      const options = (
        await this.db.query(
          "SELECT o.* FROM app.modifier_options o JOIN app.modifier_groups g ON g.business_id=o.business_id AND g.id=o.modifier_group_id WHERE o.business_id=$1 AND g.product_id=$2 AND g.deleted_at IS NULL AND o.deleted_at IS NULL ORDER BY o.sort_order,o.id",
          [this.tenant, row.id],
        )
      ).rows;
      for (const g of groups) {
        const group = await this.dto("ModifierGroup", g);
        group.options = [];
        for (const o of options.filter((o) => o.modifier_group_id === g.id)) {
          group.options.push(await this.dto("ModifierOption", o));
          out.options.push(await this.legacyOption(o, g));
        }
        out.modifier_groups.push(group);
      }
    }
    return out;
  }
  async legacyOption(o: Row, g: Row): Promise<Row> {
    return this.dto("ProductOption", {
      ...o,
      product_id: g.product_id,
      group_key: g.id,
      required: g.required,
      min_select: g.min_select,
      max_select: g.max_select,
      available: o.available && g.active,
    });
  }
}
