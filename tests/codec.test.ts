import assert from "node:assert/strict";
import { test } from "node:test";
import { Decimal, boundLen, cmpBytes, crc32, orderI64, putU16, putU32, putU64, u16, u32, u64, utf8, utf8dec } from "../src/db/codec";
import { SeamError } from "../src/db/errors";

test("crc32 matches the standard known-answer vector", () => {
  // ISO 3309 / ITU-T V.42 CRC-32 of "123456789"
  const vector = crc32(utf8("123456789"));
  assert.equal(vector, 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("u16/u32/u64 round trip including boundaries", () => {
  const b = new Uint8Array(24);
  putU16(b, 0, 0xabcd);
  putU32(b, 4, 0xdeadbeef);
  putU64(b, 8, 0xfedcba9876543210n);
  putU64(b, 16, 18446744073709551615n);
  assert.equal(u16(b, 0), 0xabcd);
  assert.equal(u32(b, 4), 0xdeadbeef);
  assert.equal(u64(b, 8), 0xfedcba9876543210n);
  assert.equal(u64(b, 16), 18446744073709551615n);
});

test("orderI64 produces byte order that matches numeric order, negatives first", () => {
  const samples = [-9223372036854775808n, -2n, -1n, 0n, 1n, 255n, 256n, 9223372036854775807n];
  for (let i = 1; i < samples.length; i++) {
    assert.ok(cmpBytes(orderI64(samples[i - 1]), orderI64(samples[i])) < 0, `${samples[i - 1]} < ${samples[i]}`);
  }
  assert.equal(orderI64(0n).length, 8);
});

test("Decimal parses exactly and round trips", () => {
  assert.equal(Decimal.parse("12.50").toString(), "12.50");
  assert.equal(Decimal.parse("0.001", 10, 3).toString(), "0.001");
  assert.equal(Decimal.parse("-7").toString(), "-7");
  assert.equal(Decimal.parse("1.5").unscaled, 15n);
  assert.equal(Decimal.parse("1.5").scale, 1);
});

test("Decimal rescale expands scale and rejects overflow", () => {
  const d = Decimal.parse("1.5");
  assert.equal(d.rescaled(3, 10).unscaled, 1500n);
  assert.throws(() => d.rescaled(50, 10), (e: unknown) => (e as SeamError).code === "E_OVERFLOW");
  assert.throws(() => Decimal.parse("999.99", 4, 2), (e: unknown) => (e as SeamError).code === "E_OVERFLOW");
  assert.throws(() => Decimal.parse("abc"), (e: unknown) => (e as SeamError).code === "E_TYPE_MISMATCH");
});

test("utf8dec accepts valid UTF-8 and rejects invalid bytes", () => {
  assert.equal(utf8dec(utf8("héllo")), "héllo");
  assert.throws(() => utf8dec(new Uint8Array([0xc3, 0x28])), (e: unknown) => (e as SeamError).code === "E_BAD_UTF8");
});

test("cmpBytes is a total order with length tiebreak", () => {
  assert.ok(cmpBytes(utf8("a"), utf8("b")) < 0);
  assert.ok(cmpBytes(utf8("ab"), utf8("a")) > 0);
  assert.equal(cmpBytes(utf8("x"), utf8("x")), 0);
});

test("boundLen refuses oversized payloads", () => {
  assert.throws(() => boundLen(2 * 1024 * 1024, "text"), (e: unknown) => (e as SeamError).code === "E_TOKEN_LIMIT");
  assert.throws(() => boundLen(-1, "text"), (e: unknown) => (e as SeamError).code === "E_TOKEN_LIMIT");
  boundLen(1024, "text");
});
