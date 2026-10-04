import { cursorCodec } from "../../../platform/cursor.js";
import type { Repository, Row, Table } from "../infrastructure/repository.js";
import { cas, fail, openingValid } from "../domain/rules.js";
import { audit, type Actor } from "./evidence.js";
import { digest } from "../../../platform/idempotency.js";
const catalog: Record<
  string,
  { table: Table; schema: string; id: string; fields: string[] }
> = {
  categories: {
    table: "categories",
    schema: "Category",
    id: "category_id",
    fields: ["name", "sort_order", "active"],
  },
  products: {
    table: "products",
    schema: "Product",
    id: "product_id",
    fields: [
      "category_id",
      "name",
      "description",
      "price_minor",
      "currency",
      "available",
      "image_url",
    ],
  },
  "modifier-groups": {
    table: "modifier_groups",
    schema: "ModifierGroup",
    id: "group_id",
    fields: [
      "name",
      "required",
      "min_select",
      "max_select",
      "sort_order",
      "active",
    ],
  },
  options: {
    table: "modifier_options",
    schema: "ModifierOption",
    id: "option_id",
    fields: ["name", "price_delta_minor", "available", "sort_order"],
  },
  "delivery-zones": {
    table: "delivery_zones",
    schema: "DeliveryZone",
    id: "zone_id",
    fields: [
      "name",
      "polygon_geojson",
      "fee_minor",
      "min_order_minor",
      "priority",
      "active",
    ],
  },
};
export interface Operation {
  method: string;
  path: string;
  params: Row;
  query: Row;
  body: Row;
  request: string;
}
export function collection(op: Operation): string {
  const parts = op.path.split("/");
  return parts.at(-1)!.startsWith("{") ? parts.at(-2)! : parts.at(-1)!;
}
export async function page(
  r: Repository,
  table: Table,
  schema: string,
  query: Row,
  request: string,
  filters: Row = {},
  sorted = false,
) {
  const limit = query.limit ?? 20;
  const where = ["business_id=$1"];
  const values: unknown[] = [r.tenant];
  if (
    [
      "categories",
      "products",
      "modifier_groups",
      "modifier_options",
      "delivery_zones",
      "customers",
    ].includes(table)
  )
    where.push("deleted_at IS NULL");
  for (const [field, value] of Object.entries(filters)) {
    if (!/^[a-z_]+$/.test(field)) throw Error("Invalid internal filter");
    values.push(value);
    where.push(`${field}=$${values.length}`);
  }
  const scope = digest([r.tenant, table, filters, sorted, limit]);
  if (query.cursor) {
    try {
      const data = cursorCodec().verify(query.cursor);
      const parsed = JSON.parse(Buffer.from(data, "base64url").toString());
      if (
        parsed.scope !== scope ||
        typeof parsed.id !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(parsed.id)
      )
        throw Error();
      if (
        sorted
          ? !Number.isInteger(parsed.value)
          : !Number.isFinite(Date.parse(parsed.value))
      )
        throw Error();
      values.push(parsed.value, parsed.id);
      where.push(
        `(${sorted ? "sort_order" : "created_at"},id) ${sorted ? ">" : "<"} ($${values.length - 1},$${values.length})`,
      );
    } catch {
      fail("VALIDATION_ERROR", 422);
    }
  }
  values.push(limit + 1);
  const rows = (
    await r.db.query(
      `SELECT * FROM app.${table} WHERE ${where.join(" AND ")} ORDER BY ${sorted ? "sort_order ASC,id ASC" : "created_at DESC,id DESC"} LIMIT $${values.length}`,
      values,
    )
  ).rows;
  const more = rows.length > limit;
  const selected = rows.slice(0, limit);
  const last = selected.at(-1);
  let cursor: string | null = null;
  if (more && last) {
    const data = Buffer.from(
      JSON.stringify({
        scope,
        id: last.id,
        value: sorted ? last.sort_order : last.created_at.toISOString(),
      }),
    ).toString("base64url");
    cursor = cursorCodec().sign(data);
  }
  return {
    status: 200,
    body: {
      data: await Promise.all(selected.map((row) => r.dto(schema, row))),
      meta: { request_id: request },
      pagination: { next_cursor: cursor, has_more: more, limit },
    },
  };
}
export class CatalogService {
  async execute(r: Repository, actor: Actor, op: Operation) {
    const name = collection(op);
    if (name === "settings" || op.path === "/v1/businesses/{business_id}")
      return this.settings(r, actor, op, name === "settings");
    const spec = catalog[name];
    if (!spec) throw Error("Unmapped catalog operation");
    const legacy = name === "options" && !op.params.group_id;
    // Parent-first locks serialize delete/create and bind every nested resource to its URL parent.
    if (op.params.product_id && name !== "products")
      await r.one("products", op.params.product_id, op.method !== "get");
    let group: Row | undefined;
    if (op.params.group_id) {
      group = await r.one(
        "modifier_groups",
        op.params.group_id,
        op.method !== "get",
      );
      if (group.product_id !== op.params.product_id) fail("NOT_FOUND", 404);
    }
    const id = op.params[spec.id];
    let row: Row | undefined;
    if (id) {
      row = await r.one(spec.table, id, op.method !== "get");
      if (name === "modifier-groups" && row.product_id !== op.params.product_id)
        fail("NOT_FOUND", 404);
      if (name === "options") {
        group ??= await r.one(
          "modifier_groups",
          row.modifier_group_id,
          op.method !== "get",
        );
        if (
          group.product_id !== op.params.product_id ||
          (op.params.group_id && row.modifier_group_id !== op.params.group_id)
        )
          fail("NOT_FOUND", 404);
      }
    }
    if (op.method === "get") {
      if (row)
        return {
          status: 200,
          body: {
            data: await r.dto(spec.schema, row),
            meta: { request_id: op.request },
          },
        };
      const filters: Row = {};
      for (const field of ["category_id", "available"])
        if (op.query[field] !== undefined) filters[field] = op.query[field];
      if (name === "modifier-groups") filters.product_id = op.params.product_id;
      if (name === "options") filters.modifier_group_id = op.params.group_id;
      return page(
        r,
        spec.table,
        spec.schema,
        op.query,
        op.request,
        filters,
        name === "categories",
      );
    }
    if (row)
      cas(
        row,
        op.method === "delete"
          ? op.query.expected_version
          : op.body.expected_version,
      );
    const before = row;
    if (op.method === "delete") {
      if (
        name === "categories" &&
        (
          await r.db.query(
            "SELECT 1 FROM app.products WHERE business_id=$1 AND category_id=$2 AND deleted_at IS NULL LIMIT 1",
            [r.tenant, id],
          )
        ).rowCount
      )
        fail("VERSION_CONFLICT");
      row = await r.update(spec.table, id, {
        deleted_at: new Date(),
        updated_by: actor.id,
      });
    } else {
      let input = Object.fromEntries(
        spec.fields.filter((k) => k in op.body).map((k) => [k, op.body[k]]),
      );
      if (legacy) {
        group = await this.legacyGroup(r, actor, op, group);
        input = Object.fromEntries(
          ["name", "price_delta_minor", "available"]
            .filter((k) => k in op.body)
            .map((k) => [k, op.body[k]]),
        );
      }
      const candidate = { ...row, ...input };
      if ("name" in input && !input.name.trim()) fail("VALIDATION_ERROR", 422);
      if (
        name === "modifier-groups" &&
        !(
          candidate.min_select >= 0 &&
          candidate.min_select <= candidate.max_select &&
          candidate.max_select <= 99 &&
          (!candidate.required || candidate.min_select >= 1)
        )
      )
        fail("VALIDATION_ERROR", 422);
      if (name === "products") {
        const cat = await r.one("categories", candidate.category_id, true);
        if (!cat.active) fail("VALIDATION_ERROR", 422);
        if (input.currency) {
          const business = await r.one("businesses", r.tenant);
          if (input.currency !== business.currency)
            fail("VALIDATION_ERROR", 422);
          if (row && input.currency !== row.currency)
            fail("VALIDATION_ERROR", 422);
          delete input.currency;
          if (!row) input.currency = business.currency;
        }
        if (input.image_url) {
          const url = new URL(input.image_url);
          const allowed = (process.env.PRODUCT_IMAGE_ALLOWED_HOSTS ?? "")
            .split(",")
            .filter(Boolean);
          if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            !allowed.includes(url.hostname)
          )
            fail("VALIDATION_ERROR", 422);
        }
      }
      if (row)
        row = await r.update(spec.table, id, {
          ...input,
          updated_by: actor.id,
        });
      else {
        if (name === "modifier-groups") input.product_id = op.params.product_id;
        if (name === "options") {
          input.modifier_group_id = group!.id;
          input.sort_order ??= 0;
        }
        row = await r.insert(spec.table, { ...input, created_by: actor.id });
      }
    }
    await audit(
      r,
      actor,
      op.request,
      `${name}.${op.method}`,
      name,
      row!,
      before,
    );
    return {
      status: op.method === "delete" ? 204 : op.method === "post" ? 201 : 200,
      body:
        op.method === "delete"
          ? null
          : {
              data: legacy
                ? await r.legacyOption(row!, group!)
                : await r.dto(spec.schema, row!),
              meta: { request_id: op.request },
            },
    };
  }
  private async legacyGroup(
    r: Repository,
    actor: Actor,
    op: Operation,
    group?: Row,
  ): Promise<Row> {
    if (!group) {
      if (/^[0-9a-f-]{36}$/i.test(op.body.group_key)) {
        group = await r.one("modifier_groups", op.body.group_key, true);
        if (group.product_id !== op.params.product_id) fail("NOT_FOUND", 404);
      } else {
        group = (
          await r.db.query(
            "SELECT * FROM app.modifier_groups WHERE business_id=$1 AND product_id=$2 AND lower(btrim(name))=lower(btrim($3)) AND deleted_at IS NULL FOR UPDATE",
            [r.tenant, op.params.product_id, op.body.group_key],
          )
        ).rows[0];
        if (!group) {
          group = await r.insert("modifier_groups", {
            product_id: op.params.product_id,
            name: op.body.group_key,
            required: op.body.required,
            min_select: op.body.min_select,
            max_select: op.body.max_select,
            created_by: actor.id,
          });
          await audit(
            r,
            actor,
            op.request,
            "modifier-groups.post",
            "modifier-groups",
            group,
          );
        }
      }
    }
    for (const k of ["required", "min_select", "max_select"])
      if (k in op.body && op.body[k] !== group[k])
        fail("VALIDATION_ERROR", 422);
    if (
      op.body.group_key &&
      op.body.group_key !== group.id &&
      op.body.group_key !== group.name
    )
      fail("VALIDATION_ERROR", 422);
    return group;
  }
  private async settings(
    r: Repository,
    actor: Actor,
    op: Operation,
    settings: boolean,
  ) {
    const table = settings ? "business_settings" : "businesses";
    let row = await r.one(table, r.tenant, op.method !== "get");
    if (op.method === "patch") {
      cas(row, op.body.expected_version);
      const { expected_version, ...input } = op.body;
      if (input.opening_hours && !openingValid(input.opening_hours))
        fail("VALIDATION_ERROR", 422);
      if (
        input.tax_policy &&
        input.tax_policy.mode === "none" &&
        input.tax_policy.rate_bps !== 0
      )
        fail("VALIDATION_ERROR", 422);
      if (input.name && !input.name.trim()) fail("VALIDATION_ERROR", 422);
      if (input.timezone)
        try {
          new Intl.DateTimeFormat("en", { timeZone: input.timezone });
        } catch {
          fail("VALIDATION_ERROR", 422);
        }
      const before = row;
      row = await r.update(table, r.tenant, { ...input, updated_by: actor.id });
      await audit(
        r,
        actor,
        op.request,
        `${settings ? "settings" : "business"}.patch`,
        table,
        row,
        before,
      );
    }
    return {
      status: 200,
      body: {
        data: await r.dto(settings ? "BusinessSettings" : "Business", row),
        meta: { request_id: op.request },
      },
    };
  }
}
