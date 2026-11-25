import assert from "node:assert/strict";
import { test } from "node:test";
import { Decimal } from "../src/db/codec";
import { SeamError } from "../src/db/errors";
import { cast, compareValues, evalExpr, predTrue } from "../src/db/eval";
import { parse, type Expr } from "../src/db/parser";
import type { EvalCtx } from "../src/db/eval";
import type { SeamValue } from "../src/db/values";

function expr(src: string): Expr {
  const s = parse(`drop in t { x: ${src} }`)[0];
  if (s.k !== "dropin") throw new Error("bad test fixture");
  return s.fields[0].expr;
}

function ctx(row: Record<string, SeamValue> = {}): EvalCtx {
  return { row, now: 1760000000000000n, today: 20600 };
}

function v(src: string, row: Record<string, SeamValue> = {}): SeamValue {
  return evalExpr(expr(src), ctx(row));
}

function throwsCode(src: string, row: Record<string, SeamValue> = {}): string {
  try {
    v(src, row);
  } catch (e) {
    return (e as SeamError).code ?? "NOT_SEAM";
  }
  return "NO_THROW";
}

test("three-valued logic truth tables", () => {
  const T: SeamValue = { t: "bool", v: true };
  const F: SeamValue = { t: "bool", v: false };
  const N: SeamValue = { t: "null" };
  const row = { a: T, b: F, c: N };
  const cases: Array<[string, SeamValue]> = [
    ["a and b", F],
    ["a and a", T],
    ["a and c", N],
    ["b and c", F],
    ["a or c", T],
    ["b or c", N],
    ["b or b", F],
    ["not c", N],
    ["not a", F],
  ];
  for (const [src, want] of cases) {
    assert.deepEqual(v(src, row), want, src);
  }
});

test("comparisons against null are null, never true", () => {
  const row = { n: { t: "null" } as SeamValue, i: { t: "int", v: 5n } as SeamValue };
  assert.deepEqual(v("n = 1", row), { t: "null" });
  assert.deepEqual(v("n < 5", row), { t: "null" });
  assert.equal(predTrue(expr("n = 1"), ctx(row)), false);
  assert.deepEqual(v("n is null", row), { t: "bool", v: true });
  assert.deepEqual(v("n is not null", row), { t: "bool", v: false });
  assert.deepEqual(v("i is 5", row), { t: "bool", v: true });
});

test("integer arithmetic, truncation and errors", () => {
  assert.deepEqual(v("7 + 3"), { t: "int", v: 10n });
  assert.deepEqual(v("7 - 9"), { t: "int", v: -2n });
  assert.deepEqual(v("6 * 7"), { t: "int", v: 42n });
  assert.deepEqual(v("7 / 2"), { t: "int", v: 3n });
  assert.deepEqual(v("- -5"), { t: "int", v: 5n });
  assert.equal(throwsCode("1 / 0"), "E_DIV_ZERO");
  assert.equal(throwsCode("9223372036854775807 + 1"), "E_OVERFLOW");
  assert.equal(throwsCode("-9223372036854775807 - 2"), "E_OVERFLOW");
});

test("decimal arithmetic keeps exact scale", () => {
  assert.equal(v("1.50 + 2.25").t, "decimal");
  assert.equal((v("1.50 + 2.25") as { v: Decimal }).v.toString(), "3.75");
  assert.equal((v("1.50 - 0.50") as { v: Decimal }).v.toString(), "1.00");
  assert.equal((v("0.10 * 3") as { v: Decimal }).v.toString(), "0.30");
  assert.equal(throwsCode("1.00 / 0.00"), "E_DIV_ZERO");
  const q = v("5.00 / 2.00") as { v: Decimal };
  assert.equal(q.v.scale, 6);
  assert.equal(q.v.toString(), "2.500000");
});

test("mixed int/decimal arithmetic lifts the whole number exactly", () => {
  assert.equal((v("1.50 + 1") as { v: Decimal }).v.toString(), "2.50");
  assert.equal((v("1 - 0.5") as { v: Decimal }).v.toString(), "0.5");
  assert.equal(throwsCode("1 + 'a'"), "E_TYPE_MISMATCH");
  assert.equal(throwsCode("1.5 * 'a'"), "E_TYPE_MISMATCH");
});

test("comparisons require compatible types", () => {
  assert.deepEqual(v("1 < 2"), { t: "bool", v: true });
  assert.deepEqual(v("'a' < 'b'"), { t: "bool", v: true });
  assert.equal(throwsCode("1 < 'a'"), "E_TYPE_MISMATCH");
  assert.equal(throwsCode("yes < no"), "NO_THROW");
  assert.deepEqual(v("yes > no"), { t: "bool", v: true });
});

test("predicates must be yesno at runtime too", () => {
  assert.equal(throwsCode("1 + 1"), "NO_THROW"); // expressions are fine as values
  const row = { i: { t: "int", v: 1n } as SeamValue };
  try {
    predTrue(expr("i"), ctx(row));
    assert.fail("expected throw");
  } catch (e) {
    assert.equal((e as SeamError).code, "E_TYPE_MISMATCH");
  }
});

test("casts", () => {
  assert.deepEqual(cast({ t: "int", v: 5n }, { k: "decimal", precision: 10, scale: 2 }), {
    t: "decimal",
    v: new Decimal(500n, 2, 10),
  });
  assert.deepEqual(cast({ t: "decimal", v: new Decimal(599n, 2, 10) }, { k: "int" }), { t: "int", v: 5n });
  assert.deepEqual(cast({ t: "null" }, { k: "text" }), { t: "null" });
  assert.equal(cast({ t: "int", v: 9n }, { k: "text" }).v, "9");
  try {
    cast({ t: "text", v: "x" }, { k: "int" });
    assert.fail("expected throw");
  } catch (e) {
    assert.equal((e as SeamError).code, "E_TYPE_MISMATCH");
  }
});

test("now() and today() come from the context clock", () => {
  assert.deepEqual(v("now()"), { t: "stamp", v: 1760000000000000n });
  assert.deepEqual(v("today()"), { t: "day", v: 20600 });
});

test("aggregates cannot be evaluated row-wise", () => {
  assert.equal(throwsCode("count(a)"), "E_SYNTAX");
  assert.equal(throwsCode("sum(a)"), "E_SYNTAX");
});

test("compareValues orders nulls first and matches numeric order", () => {
  assert.ok(compareValues({ t: "null" }, { t: "int", v: 0n }) < 0);
  assert.ok(compareValues({ t: "int", v: 1n }, { t: "null" }) > 0);
  assert.equal(compareValues({ t: "null" }, { t: "null" }), 0);
  assert.ok(compareValues({ t: "int", v: -1n }, { t: "int", v: 1n }) < 0);
  const d15: SeamValue = { t: "decimal", v: new Decimal(15n, 1, 10) };
  const d150: SeamValue = { t: "decimal", v: new Decimal(150n, 2, 10) };
  assert.equal(compareValues(d15, d150), 0);
});

test("column references resolve qualified and unqualified", () => {
  const row: Record<string, SeamValue> = {
    total: { t: "int", v: 3n },
    "orders.total": { t: "int", v: 7n },
  };
  assert.deepEqual(v("total", row), { t: "int", v: 3n });
  assert.deepEqual(v("orders.total", row), { t: "int", v: 7n });
  assert.equal(throwsCode("missing_col"), "E_UNKNOWN_NAME");
});
