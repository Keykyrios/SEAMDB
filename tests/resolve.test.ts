import assert from "node:assert/strict";
import { test } from "node:test";
import { SeamError } from "../src/db/errors";
import { parse } from "../src/db/parser";
import { typecheck, type CatalogView } from "../src/db/resolve";
import type { SeamType } from "../src/db/values";

function view(isOwner = true): CatalogView {
  const tables: Record<string, { name: string; columns: { name: string; type: SeamType }[] }> = {
    customers: {
      name: "customers",
      columns: [
        { name: "customer_id", type: { k: "int" } },
        { name: "name", type: { k: "text" } },
      ],
    },
    orders: {
      name: "orders",
      columns: [
        { name: "order_id", type: { k: "int" } },
        { name: "customer_id", type: { k: "int" } },
        { name: "total", type: { k: "decimal", precision: 12, scale: 2 } },
        { name: "status", type: { k: "text" } },
      ],
    },
  };
  return { isOwner, table: (n) => tables[n] };
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as SeamError).code ?? "NOT_SEAM";
  }
  return "NO_THROW";
}

function tc(src: string, cat: CatalogView = view()): void {
  const [s] = parse(src);
  typecheck(s.k === "spill" ? s : s, cat);
}

test("valid statements typecheck", () => {
  tc("drop in orders { order_id: 1, customer_id: 2, total: 10.50, status: 'new' }");
  tc("pull customer_id, name from customers when customer_id >= 1");
  tc("pull name, total from customers link orders on customers.customer_id = orders.customer_id when total >= 100.00");
  tc("yeet from orders when status = 'new'");
  tc("tweak orders set total = 1.00 when order_id = 3");
  tc("add index by_status on orders(status)");
  tc("fah table orders");
  tc("ship orders sealed '/tmp/x'");
  tc("pull name, count(customer_id) as n from customers bunch by name");
});

test("unknown table and column names fail with position", () => {
  assert.equal(codeOf(() => tc("pull a from ghosts")), "E_UNKNOWN_NAME");
  assert.equal(codeOf(() => tc("drop in orders { ghost: 1 }")), "E_UNKNOWN_NAME");
  assert.equal(codeOf(() => tc("pull ghost from customers")), "E_UNKNOWN_NAME");
});

test("ambiguous column across a join fails", () => {
  assert.equal(
    codeOf(() => tc("pull customer_id from customers link orders on customers.customer_id = orders.customer_id")),
    "E_AMBIGUOUS",
  );
});

test("predicates must be yesno", () => {
  assert.equal(codeOf(() => tc("pull a from customers when name")), "E_TYPE_MISMATCH");
  assert.equal(codeOf(() => tc("yeet from customers when customer_id")), "E_TYPE_MISMATCH");
});

test("whole numbers widen exactly into decimals; the reverse is refused", () => {
  tc("drop in orders { total: 100 }"); // exact widening: stored as 100.00
  tc("tweak orders set total = 1");
  tc("drop in orders { total: cast(100 as decimal(12, 2)) }");
  // decimal -> whole number is lossy and stays an error
  assert.equal(codeOf(() => tc("drop in customers { customer_id: 1.5 }")), "E_TYPE_MISMATCH");
  assert.equal(codeOf(() => tc("drop in orders { order_id: 1.5 }")), "E_TYPE_MISMATCH");
  // text <-> numbers stay errors
  assert.equal(codeOf(() => tc("drop in orders { order_id: 'x' }")), "E_TYPE_MISMATCH");
});

test("unknown functions are rejected", () => {
  assert.equal(codeOf(() => tc("pull frobnicate(customer_id) from customers")), "E_UNKNOWN_NAME");
});

test("schema definitions: defaults and bounds must match the column type", () => {
  tc("spawn table t2: id: whole number, main key, status: text, fallback 'new'");
  assert.equal(codeOf(() => tc("spawn table t3: id: whole number, main key, status: text, fallback 7")), "E_TYPE_MISMATCH");
  assert.equal(codeOf(() => tc("spawn table t4: id: whole number, main key, age: whole number, at least 'x'")), "E_TYPE_MISMATCH");
  assert.equal(codeOf(() => tc("spawn table t5: id: whole number, main key, id: text")), "E_UNIQUE");
});

test("unauthorized callers learn nothing from names", () => {
  const asRole = view(false);
  assert.equal(codeOf(() => tc("pull a from ghosts", asRole)), "E_DENIED");
  assert.equal(codeOf(() => tc("drop in orders { ghost: 1 }", asRole)), "E_DENIED");
});

test("aggregate result types are pinned", () => {
  const [s] = parse("pull count(customer_id) as c, avg(customer_id) as a from customers");
  if (s.k !== "pull") return;
  typecheck(s, view());
  // count over a missing arg surface
  assert.equal(codeOf(() => tc("pull count(ghost) from customers")), "E_UNKNOWN_NAME");
});

test("spill typechecks its inner statement", () => {
  assert.equal(codeOf(() => tc("spill pull ghost from customers")), "E_UNKNOWN_NAME");
  tc("spill pull name from customers");
});
