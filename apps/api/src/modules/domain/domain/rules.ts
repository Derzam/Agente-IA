import type {
  OrderAction,
  OrderStatus,
  Role,
  ErrorCode,
} from "@agente-ia/shared";
import { AppError } from "../../../platform/errors.js";

export function fail(code: ErrorCode, status = 409): never {
  throw new AppError(
    status,
    code,
    {
      VALIDATION_ERROR: "Solicitud inválida.",
      FORBIDDEN: "Operación no permitida.",
      NOT_FOUND: "Recurso no encontrado.",
      VERSION_CONFLICT: "El recurso cambió; actualiza antes de repetir.",
      REQUEST_IN_PROGRESS: "La solicitud sigue en ejecución.",
      IDEMPOTENCY_CONFLICT: "La clave corresponde a otra solicitud.",
    }[code as string] ?? "La operación no cumple las reglas del dominio.",
    code === "REQUEST_IN_PROGRESS",
  );
}
export function cas(row: Record<string, unknown>, expected: unknown) {
  if (row.version !== expected) fail("VERSION_CONFLICT");
}
export function nextOrder(
  status: OrderStatus,
  fulfillment: string,
  action: OrderAction,
  role: Role,
  reason: unknown,
): OrderStatus {
  if (action === "cancel") {
    if (
      ![
        "awaiting_confirmation",
        "confirmed",
        "accepted",
        "preparing",
        "ready",
        "out_for_delivery",
      ].includes(status)
    )
      fail("INVALID_ORDER_TRANSITION");
    if (
      !["awaiting_confirmation", "confirmed"].includes(status) &&
      role === "operator"
    )
      fail("FORBIDDEN", 403);
    if (typeof reason !== "string" || !reason.trim())
      fail("VALIDATION_ERROR", 422);
    return "cancelled";
  }
  const allowed: Partial<Record<OrderAction, [OrderStatus, OrderStatus]>> = {
    accept: ["confirmed", "accepted"],
    start_preparation: ["accepted", "preparing"],
    mark_ready: ["preparing", "ready"],
    ...(fulfillment === "delivery"
      ? {
          dispatch: ["ready", "out_for_delivery"] as [OrderStatus, OrderStatus],
          complete: ["out_for_delivery", "delivered"] as [
            OrderStatus,
            OrderStatus,
          ],
        }
      : { complete: ["ready", "delivered"] as [OrderStatus, OrderStatus] }),
  };
  const edge = allowed[action];
  if (!edge || edge[0] !== status) fail("INVALID_ORDER_TRANSITION");
  return edge[1];
}
export function minor(value: bigint | number | string): number {
  const n = BigInt(value);
  if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER))
    fail("VALIDATION_ERROR", 422);
  return Number(n);
}
export function openingValid(
  slots: { day: number; opens_at: string; closes_at: string }[],
): boolean {
  return slots.every(
    (a, i) =>
      a.opens_at < a.closes_at &&
      !slots.some(
        (b, j) =>
          j < i &&
          a.day === b.day &&
          a.opens_at < b.closes_at &&
          b.opens_at < a.closes_at,
      ),
  );
}
export function openNow(
  slots: { day: number; opens_at: string; closes_at: string }[],
  timezone: string,
  now: Date,
): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (key: string) => parts.find((p) => p.type === key)?.value;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    part("weekday")!,
  );
  const time = `${part("hour")}:${part("minute")}`;
  return slots.some(
    (s) => s.day === day && s.opens_at <= time && time < s.closes_at,
  );
}
export function inPolygon(
  lat: number,
  lon: number,
  polygon: { coordinates: number[][][] },
): boolean {
  const inside = (ring: number[][]) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!,
        b = ring[j]!;
      const cross =
        (lon - a[0]!) * (b[1]! - a[1]!) - (lat - a[1]!) * (b[0]! - a[0]!);
      if (
        Math.abs(cross) < 1e-10 &&
        lon >= Math.min(a[0]!, b[0]!) &&
        lon <= Math.max(a[0]!, b[0]!) &&
        lat >= Math.min(a[1]!, b[1]!) &&
        lat <= Math.max(a[1]!, b[1]!)
      )
        return true;
      if (
        a[1]! > lat !== b[1]! > lat &&
        lon < ((b[0]! - a[0]!) * (lat - a[1]!)) / (b[1]! - a[1]!) + a[0]!
      )
        hit = !hit;
    }
    return hit;
  };
  return (
    inside(polygon.coordinates[0]!) &&
    !polygon.coordinates.slice(1).some(inside)
  );
}
