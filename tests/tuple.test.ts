import assert from "node:assert/strict";
import { test } from "node:test";
import { Decimal, cmpBytes } from "../src/db/codec";
import { SeamError } from "../src/db/errors";
import { decodeTuple, encodeKey, encodeTuple } from "../src/db/tuple";
import type { SeamType, SeamValue } from "../src/db/values";

const TYPES: Array<{ ty: SeamType; v: SeamValue; name: string }> = [
  { name: "int", ty: { k: "int" }, v: { t: "int", v: -42n } },
  { name: "int min", ty: { k: "int" }, v: { t: "int", v: -9223372036854775808n } },
  { name: "int max", ty: { k: "int" }, v: { t: "int", v: 9223372036854775807n } },
  { name: "decimal", ty: { k: "decimal", precision: 12, scale: 2 }, v: { t: "decimal", v: new Decimal(-1234567890n, 2, 12) } },
  { name: "text", ty: { k: "text" }, v: { t: "text", v: "héllo wörld 👋" } },
  { name: "empty text", ty: { k: "text" }, v: { t: "text", v: "" } },
  { name: "bool true", ty: { k: "bool" }, v: { t: "bool", v: true } },
  { name: "bool false", ty: { k: "bool" }, v: { t: "bool", v: false } },
  { name: "stamp", ty: { k: "stamp" }, v: { t: "stamp", v: 1760000000123456n } },
  { name: "day", ty: { k: "day" }, v: { t: "day", v: 20000 } },
];

test("every column type round trips with its null bitmap position", () => {
  for (const { ty, v, name } of TYPES) {
    const t = { xmin: 9n, xmax: 0n, flags: 1, values: [{ t: "null" } as SeamValue, v] };
    const d = decodeTuple(encodeTuple(t), [{ k: "null" }, ty]);
    assert.equal(d.xmin, 9n, name);
    assert.equal(d.xmax, 0n, name);
    assert.equal(d.flags, 1, name);
    assert.equal(d.values[0].t, "null", name);
    assert.equal(d.values[1].t, v.t, name);
    if (v.t === "int" || v.t === "stamp") assert.equal(d.values[1].v, v.v, name);
    if (v.t === "text") assert.equal(d.values[1].v, v.v, name);
    if (v.t === "bool") assert.equal(d.values[1].v, v.v, name);
    if (v.t === "day") assert.equal(d.values[1].v, v.v, name);
    if (v.t === "decimal") assert.equal(d.values[1].v.unscaled, v.v.unscaled, name);
  }
});

test("all-null tuples round trip", () => {
  const t = {
    xmin: 1n,
    xmax: 2n,
    flags: 0,
    values: [{ t: "null" }, { t: "null" }, { t: "null" }] as SeamValue[],
  };
  const d = decodeTuple(encodeTuple(t), [{ k: "int" }, { k: "text" }, { k: "bool" }]);
  assert.deepEqual(
    d.values.map((v) => v.t),
    ["null", "null", "null"],
  );
  assert.equal(d.xmax, 2n);
});

test("column count mismatch, bad version and truncation are rejected", () => {
  const raw = encodeTuple({ xmin: 1n, xmax: 0n, flags: 0, values: [{ t: "int", v: 5n }] });
  const badVersion = raw.slice();
  badVersion[0] = 2;
  assert.throws(() => decodeTuple(badVersion, [{ k: "int" }]), (e: unknown) => (e as SeamError).code === "E_CORRUPT");
  // fewer stored columns than the catalog declares is a pre-alter tuple: the
  // trailing columns read as null instead of failing
  assert.deepEqual(
    decodeTuple(raw, [{ k: "int" }, { k: "int" }]).values.map((v) => v.t),
    ["int", "null"],
  );
  // more stored columns than the catalog knows about is corruption
  assert.throws(() => decodeTuple(raw, []), (e: unknown) => (e as SeamError).code === "E_CORRUPT");
  assert.throws(() => decodeTuple(raw.slice(0, 10), [{ k: "int" }]), (e: unknown) => (e as SeamError).code === "E_CORRUPT");
  const truncatedText = encodeTuple({ xmin: 1n, xmax: 0n, flags: 0, values: [{ t: "text", v: "hello" }] });
  const badText = truncatedText.slice(0, truncatedText.length - 2);
  assert.throws(() => decodeTuple(badText, [{ k: "text" }]), (e: unknown) => (e as SeamError).code === "E_CORRUPT");
});

test("index keys are byte-order comparable to numeric order", () => {
  const ints: bigint[] = [-1000n, -1n, 0n, 1n, 9n, 10n, 255n, 256n, 100000n];
  for (let i = 1; i < ints.length; i++) {
    const a = encodeKey([{ t: "int", v: ints[i - 1] }]);
    const b = encodeKey([{ t: "int", v: ints[i] }]);
    assert.ok(cmpBytes(a, b) < 0, `${ints[i - 1]} < ${ints[i]}`);
  }
  assert.ok(cmpBytes(encodeKey([{ t: "int", v: 5n }]), encodeKey([{ t: "int", v: 5n }])) === 0);
});

test("null keys sort before every non-null key", () => {
  const nul = encodeKey([{ t: "null" }]);
  const zero = encodeKey([{ t: "int", v: 0n }]);
  const text = encodeKey([{ t: "text", v: "" }]);
  const neg = encodeKey([{ t: "int", v: -999999n }]);
  assert.ok(cmpBytes(nul, neg) < 0);
  assert.ok(cmpBytes(nul, zero) < 0);
  assert.ok(cmpBytes(nul, text) < 0);
});

test("decimal keys compare numerically across equal-scale values", () => {
  const a = encodeKey([{ t: "decimal", v: new Decimal(150n, 2, 12) }]); // 1.50
  const b = encodeKey([{ t: "decimal", v: new Decimal(151n, 2, 12) }]); // 1.51
  const neg = encodeKey([{ t: "decimal", v: new Decimal(-1n, 2, 12) }]); // -0.01
  assert.ok(cmpBytes(neg, a) < 0);
  assert.ok(cmpBytes(a, b) < 0);
});

test("text keys compare in codepoint order", () => {
  const words = ["", "a", "ab", "b", "z", "é"]; // UTF-8 byte order equals codepoint order
  for (let i = 1; i < words.length; i++) {
    assert.ok(
      cmpBytes(encodeKey([{ t: "text", v: words[i - 1] }]), encodeKey([{ t: "text", v: words[i] }])) < 0,
      `${words[i - 1]} < ${words[i]}`,
    );
  }
});
