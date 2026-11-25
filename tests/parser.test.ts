import assert from "node:assert/strict";
import { test } from "node:test";
import { Decimal } from "../src/db/codec";
import { SeamError } from "../src/db/errors";
import { parse, pretty } from "../src/db/parser";
import type { Statement } from "../src/db/parser";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as SeamError).code ?? "NOT_SEAM";
  }
  return "NO_THROW";
}

test("spawn table with every column modifier", () => {
  const s = parse(`spawn table people:
    id: whole number, main key,
    name: text, needed,
    email: text, private, unique,
    age: whole number, at least 0,
    status: text, fallback 'new',
    ref: whole number, links to bosses.id
`)[0];
  assert.equal(s.k, "spawn");
  if (s.k !== "spawn") return;
  assert.equal(s.name, "people");
  assert.equal(s.columns.length, 6);
  assert.ok(s.columns[0].modifiers.some((m) => m.k === "pk"));
  assert.ok(s.columns[1].modifiers.some((m) => m.k === "needed"));
  assert.ok(s.columns[2].modifiers.some((m) => m.k === "private"));
  assert.ok(s.columns[2].modifiers.some((m) => m.k === "unique"));
  assert.ok(s.columns[3].modifiers.some((m) => m.k === "at_least"));
  assert.ok(s.columns[4].modifiers.some((m) => m.k === "fallback"));
  const fk = s.columns[5].modifiers.find((m) => m.k === "fk");
  assert.ok(fk && fk.k === "fk" && fk.table === "bosses" && fk.column === "id");
});

test("alias surfaces parse to identical ASTs", () => {
  const pairs: Array<[string, string]> = [
    ["spawn table t: id: whole number, main key", "make table t: id: whole number, primary key"],
    ["drop in t { id: 1 }", "add to t { id: 1 }"],
    ["tweak t set a = 1 when a > 0", "change t set a = 1 where a > 0"],
    ["yeet from t when a = 1", "remove from t where a = 1"],
    ["pull a from t", "read a from t"],
    ["pull a from t link u on t.id = u.id", "read a from t join u on t.id = u.id"],
    ["pull a from t when a = 1", "read a from t where a = 1"],
    ["pull x as b from t bunch by a", "read x as b from t group by a"],
    ["pull a from t rank by a high to low", "read a from t sort by a descending"],
    ["pull a from t cap 5", "read a from t take 5"],
    ["start tx", "begin transaction"],
    ["lock in", "commit"],
    ["dip", "cancel transaction"],
    ["spill pull a from t", "explain read a from t"],
    ["check table t", "verify table t"],
    ["check table t", "fah table t"],
    ["let role x pull t.a", "allow role x to read t.a"],
    ["block role x pull t", "deny role x to read t"],
  ];
  const strip = (s: Statement[]) => JSON.parse(JSON.stringify(s, (k, v) => (k === "span" ? 0 : typeof v === "bigint" ? v.toString() : v)));
  for (const [genz, classic] of pairs) {
    assert.deepEqual(strip(parse(genz)), strip(parse(classic)), `${genz} != ${classic}`);
  }
});

test("pull composes joins, filters, bunch, rank and cap", () => {
  const s = parse(
    "pull customers.name, orders.total from customers link orders on customers.customer_id = orders.customer_id when orders.total >= 100 bunch by customers.name rank by orders.total high to low cap 50",
  )[0];
  assert.equal(s.k, "pull");
  if (s.k !== "pull") return;
  assert.equal(s.proj.length, 2);
  assert.equal(s.joins.length, 1);
  assert.equal(s.joins[0].kind, "inner");
  assert.ok(s.filter);
  assert.equal(s.group.length, 1);
  assert.equal(s.order.length, 1);
  assert.equal(s.order[0].desc, true);
  assert.equal(s.cap, 50);
});

test("left link flag", () => {
  const s = parse("pull a from t left link u on t.id = u.id")[0];
  if (s.k !== "pull") return;
  assert.equal(s.joins[0].kind, "left");
});

test("star projections", () => {
  const s = parse("pull * from t")[0];
  if (s.k !== "pull") return;
  assert.equal(s.proj[0].op, "star");
  const s2 = parse("pull t.* from t")[0];
  if (s2.k !== "pull") return;
  assert.equal(s2.proj[0].op, "star");
});

test("transaction + index + grant + ship + alter statements", () => {
  assert.equal(parse("add index by_age on people(age)")[0].k, "index");
  assert.equal(parse("index by_age on people(age)")[0].k, "index");
  assert.equal(parse("let role analyst pull people.name, people.age when age >= 18")[0].k, "let");
  assert.equal(parse("block role analyst pull people")[0].k, "block");
  assert.equal(parse("ship people sealed '/tmp/x.sealed'")[0].k, "ship");
  assert.equal(parse("export people to sealed file '/tmp/x.sealed'")[0].k, "ship");
  assert.equal(parse("tweak table people add fav: text")[0].k, "alter");
  assert.equal(parse("change table people add fav: text")[0].k, "alter");
  assert.equal(parse("fah table people")[0].k, "check");
  assert.equal(parse("faah table people")[0].k, "check");
});

test("operator precedence: not < compare < add < mul < and < or", () => {
  const s = parse("pull a from t when not a + 2 * 3 >= 7 and a = 1 or a = 2")[0];
  if (s.k !== "pull" || !s.filter) return assert.fail("expected filter");
  const f = s.filter;
  assert.equal(f.op, "bin");
  if (f.op !== "bin") return;
  assert.equal(f.kind, "or"); // weakest
  assert.equal(f.left.op, "bin");
  if (f.left.op !== "bin") return;
  assert.equal(f.left.kind, "and");
});

test("pretty-print round trip preserves AST semantics", () => {
  const sources = [
    "spawn table t: id: whole number, main key, label: text, needed",
    "pull a, b as c from t when a > 1 and b < 2 rank by a low to high cap 3",
    "tweak t set a = a + 1 when b is not null",
    "yeet from t when a <= 0",
    "drop in t { a: 1, b: 'x', c: null }",
    "let role r pull t.a when a >= 18",
    "check table t",
    "fah table t",
    "add index ix on t(a, b)",
  ];
  const strip = (s: Statement[]) => JSON.parse(JSON.stringify(s, (k, v) => (k === "span" ? 0 : typeof v === "bigint" ? v.toString() : v)));
  for (const src of sources) {
    const ast: Statement[] = parse(src);
    const printed = pretty(ast[0]);
    const again: Statement[] = parse(printed);
    assert.deepEqual(strip(again), strip(ast), `round trip: ${src} -> ${printed}`);
  }
});

test("decimal literals keep exact scale and reject oversized literals", () => {
  const s = parse("drop in t { a: 12.50 }")[0];
  if (s.k !== "dropin") return;
  const e = s.fields[0].expr;
  assert.equal(e.op, "lit");
  if (e.op !== "lit" || e.value.t !== "decimal") return;
  assert.equal(e.value.v.unscaled, 1250n);
  assert.equal(e.value.v.scale, 2);
  assert.equal(codeOf(() => parse("drop in t { a: " + "9".repeat(40) + ".5 }")), "E_OVERFLOW");
});

test("malformed statements fail with E_SYNTAX and a hint, never parse partially", () => {
  const bad = ["pull from t", "spawn table", "drop in t { a }", "tweak t a = 1", "yeet t when a", "let role", "spill", "spill spawn table t: a: whole number, main key", "check t", "pull a from t rank", "totally unknown statement"];
  for (const src of bad) {
    assert.equal(codeOf(() => parse(src)), "E_SYNTAX", src);
  }
});

test("trailing garbage is rejected", () => {
  assert.equal(codeOf(() => parse("pull a from t ;;; garbage")), "E_SYNTAX");
  assert.equal(codeOf(() => parse("pull a from t ]")), "E_SYNTAX");
});

test("reserved words cannot be bare names but quoted ones can", () => {
  assert.equal(codeOf(() => parse("pull from from t")), "E_SYNTAX");
  const s = parse('pull "from" from t')[0];
  if (s.k !== "pull") return;
  assert.equal(s.from, "t");
});

test("literal kinds", () => {
  const s = parse("drop in t { a: yes, b: no, c: true, d: false, e: null, f: -3 }")[0];
  if (s.k !== "dropin") return;
  const kinds = s.fields.map((f) => (f.expr.op === "lit" ? f.expr.value.t : f.expr.op));
  assert.deepEqual(kinds, ["bool", "bool", "bool", "bool", "null", "int"]);
});

test("cast expressions parse with type specs", () => {
  const s = parse("drop in t { a: cast(x as decimal(12, 2)) }")[0];
  if (s.k !== "dropin") return;
  const e = s.fields[0].expr;
  assert.equal(e.op, "cast");
  if (e.op !== "cast") return;
  assert.equal(e.type.k, "decimal");
});

test("decimal(p,s) bounds are enforced in type specs", () => {
  assert.equal(codeOf(() => parse("spawn table t: a: decimal(0, 0), main key")), "E_TYPE_MISMATCH");
  assert.equal(codeOf(() => parse("spawn table t: a: decimal(5, 9), main key")), "E_TYPE_MISMATCH");
  Decimal.parse("1.0", 2, 1); // sanity: valid spec parses
});

test("statement spans start at the first token", () => {
  const s = parse("\n\n  pull a from t")[0];
  assert.equal(s.span.line, 3);
  assert.equal(s.span.column, 3);
});
