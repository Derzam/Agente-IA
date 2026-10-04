import test from "node:test";
import assert from "node:assert/strict";
import type { OrderAction, OrderStatus } from "@agente-ia/shared";
import {
  nextOrder,
  minor,
  inPolygon,
  openingValid,
  openNow,
} from "../src/modules/domain/domain/rules.js";
const states: OrderStatus[] = [
  "awaiting_confirmation",
  "confirmed",
  "accepted",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
  "cancelled",
];
const actions: OrderAction[] = [
  "accept",
  "start_preparation",
  "mark_ready",
  "dispatch",
  "complete",
  "cancel",
];
for (const fulfillment of ["pickup", "delivery"])
  for (const state of states)
    for (const action of actions) {
      test(`order matrix ${fulfillment} ${state} ${action}`, () => {
        const edges: Record<string, string> = {
          confirmed_accept: "accepted",
          accepted_start_preparation: "preparing",
          preparing_mark_ready: "ready",
          ...(fulfillment === "pickup"
            ? { ready_complete: "delivered" }
            : {
                ready_dispatch: "out_for_delivery",
                out_for_delivery_complete: "delivered",
              }),
        };
        const expected =
          action === "cancel" && !["delivered", "cancelled"].includes(state)
            ? "cancelled"
            : edges[`${state}_${action}`];
        if (expected)
          assert.equal(
            nextOrder(state, fulfillment, action, "owner", "Razón sintética"),
            expected,
          );
        else
          assert.throws(
            () => nextOrder(state, fulfillment, action, "owner", null),
            { code: "INVALID_ORDER_TRANSITION" },
          );
      });
    }
for (const role of ["owner", "manager", "operator"] as const)
  for (const state of states)
    test(`cancel role ${role} ${state}`, () => {
      if (["delivered", "cancelled"].includes(state))
        assert.throws(() => nextOrder(state, "delivery", "cancel", role, "x"), {
          code: "INVALID_ORDER_TRANSITION",
        });
      else if (
        role === "operator" &&
        !["awaiting_confirmation", "confirmed"].includes(state)
      )
        assert.throws(() => nextOrder(state, "delivery", "cancel", role, "x"), {
          code: "FORBIDDEN",
        });
      else
        assert.equal(
          nextOrder(state, "delivery", "cancel", role, "x"),
          "cancelled",
        );
    });
test("cancel requires a nonblank reason", () =>
  assert.throws(
    () => nextOrder("confirmed", "pickup", "cancel", "owner", " "),
    { code: "VALIDATION_ERROR" },
  ));
test("money arithmetic rejects overflow and negative values", () => {
  assert.equal(minor(9007199254740991n), Number.MAX_SAFE_INTEGER);
  assert.throws(() => minor(9007199254740992n));
  assert.throws(() => minor(-1n));
});
test("opening intervals reject overlap and midnight crossing; Sunday and timezone are respected", () => {
  assert.equal(
    openingValid([{ day: 0, opens_at: "23:00", closes_at: "01:00" }]),
    false,
  );
  assert.equal(
    openingValid([
      { day: 1, opens_at: "09:00", closes_at: "11:00" },
      { day: 1, opens_at: "10:00", closes_at: "12:00" },
    ]),
    false,
  );
  assert.equal(
    openNow(
      [{ day: 0, opens_at: "09:00", closes_at: "10:00" }],
      "America/Guayaquil",
      new Date("2026-10-04T14:30:00Z"),
    ),
    true,
  );
  assert.equal(
    openNow(
      [{ day: 0, opens_at: "09:00", closes_at: "10:00" }],
      "America/Guayaquil",
      new Date("2026-10-04T15:00:00Z"),
    ),
    false,
  );
});
test("GeoJSON containment uses longitude/latitude, closed boundaries and excludes holes", () => {
  const poly = {
    coordinates: [
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
        [0, 0],
      ],
      [
        [1, 1],
        [2, 1],
        [2, 2],
        [1, 2],
        [1, 1],
      ],
    ],
  };
  assert.ok(inPolygon(3, 3, poly));
  assert.ok(inPolygon(0, 0, poly));
  assert.equal(inPolygon(1.5, 1.5, poly), false);
  assert.equal(inPolygon(10, 10, poly), false);
});
