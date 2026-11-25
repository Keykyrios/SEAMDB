import { Decimal, boundLen, orderI64, putU16, putU32, putU64, readI64, u16, u32, u64 } from "./codec";
import { err } from "./errors";
import type { SeamType, SeamValue } from "./values";

export interface HeapTuple {
  xmin: bigint;
  xmax: bigint;
  flags: number;
  values: SeamValue[];
}

export function encodeTuple(t: HeapTuple): Uint8Array {
  const n = t.values.length;
  const bitmap = new Uint8Array(Math.ceil(n / 8) || 1);
  const chunks: Uint8Array[] = [];
  t.values.forEach((v, i) => {
    if (v.t === "null") {
      bitmap[i >> 3] |= 1 << (i & 7);
      return;
    }
    chunks.push(encodeValue(v));
  });
  const body = concat(chunks);
  const out = new Uint8Array(20 + bitmap.length + body.length);
  out[0] = 1;
  out[1] = t.flags;
  putU64(out, 2, t.xmin);
  putU64(out, 10, t.xmax);
  putU16(out, 18, n);
  out.set(bitmap, 20);
  out.set(body, 20 + bitmap.length);
  return out;
}

export function decodeTuple(raw: Uint8Array, types: SeamType[]): HeapTuple {
  if (raw.length < 20) err("E_CORRUPT", "Tuple too small.");
  if (raw[0] !== 1) err("E_CORRUPT", "Bad tuple version.");
  const n = u16(raw, 18);
  // Tuples written before a schema addition carry fewer columns than the
  // catalog now declares; those trailing columns read as null. More columns
  // than the catalog knows about means the tuple or the catalog is corrupt.
  if (n > types.length) err("E_CORRUPT", "Tuple column count exceeds catalog.");
  const bl = Math.ceil(n / 8) || 1;
  if (raw.length < 20 + bl) err("E_CORRUPT", "Tuple truncated.");
  const bitmap = raw.subarray(20, 20 + bl);
  let o = 20 + bl;
  const values: SeamValue[] = [];
  for (let i = 0; i < n; i++) {
    if (bitmap[i >> 3] & (1 << (i & 7))) {
      values.push({ t: "null" });
      continue;
    }
    const [v, next] = decodeValue(raw, o, types[i]);
    values.push(v);
    o = next;
  }
  while (values.length < types.length) values.push({ t: "null" });
  return { xmin: u64(raw, 2), xmax: u64(raw, 10), flags: raw[1], values };
}

function encodeValue(v: SeamValue): Uint8Array {
  switch (v.t) {
    case "null":
      return new Uint8Array(0);
    case "int":
    case "stamp": {
      const b = new Uint8Array(8);
      putU64(b, 0, BigInt.asUintN(64, v.v));
      return b;
    }
    case "decimal": {
      const b = new Uint8Array(16);
      const u = v.v.unscaled;
      putU64(b, 0, BigInt.asUintN(64, u >> 64n));
      putU64(b, 8, BigInt.asUintN(64, u));
      return b;
    }
    case "bool":
      return new Uint8Array([v.v ? 1 : 0]);
    case "day": {
      const b = new Uint8Array(4);
      putU32(b, 0, v.v >>> 0);
      return b;
    }
    case "text": {
      const u = new TextEncoder().encode(v.v);
      boundLen(u.length, "text");
      const b = new Uint8Array(4 + u.length);
      putU32(b, 0, u.length);
      b.set(u, 4);
      return b;
    }
  }
}

function decodeValue(raw: Uint8Array, o: number, ty: SeamType): [SeamValue, number] {
  switch (ty.k) {
    case "int":
      return [{ t: "int", v: readI64(raw, o) }, o + 8];
    case "stamp":
      return [{ t: "stamp", v: readI64(raw, o) }, o + 8];
    case "decimal": {
      const hi = BigInt.asIntN(64, u64(raw, o));
      const lo = u64(raw, o + 8);
      const unscaled = (hi << 64n) | lo;
      return [{ t: "decimal", v: new Decimal(unscaled, ty.scale, ty.precision) }, o + 16];
    }
    case "bool":
      return [{ t: "bool", v: raw[o] !== 0 }, o + 1];
    case "day":
      return [{ t: "day", v: u32(raw, o) | 0 }, o + 4];
    case "text": {
      const n = u32(raw, o);
      boundLen(n, "text");
      if (o + 4 + n > raw.length) err("E_CORRUPT", "Text truncated.");
      const s = new TextDecoder("utf-8", { fatal: true }).decode(raw.subarray(o + 4, o + 4 + n));
      return [{ t: "text", v: s }, o + 4 + n];
    }
    case "null":
      return [{ t: "null" }, o];
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const o = new Uint8Array(n);
  let i = 0;
  for (const p of parts) {
    o.set(p, i);
    i += p.length;
  }
  return o;
}

/**
 * Index key encoding. Byte-lexicographic order of the encoded form must match
 * the engine's value ordering so B+tree range scans stay sorted:
 *   null sorts before every value (tag 0x00 vs 0x01)
 *   int/stamp  — 8 bytes big-endian with the sign bit flipped
 *   decimal    — 16 bytes big-endian two's-complement of the unscaled value,
 *                offset by 2^127 (callers must rescale to the column scale first,
 *                because 1.50 and 1.5 encode differently)
 *   day        — 4 bytes big-endian over the unsigned epoch-day
 *   bool       — 1 byte 0/1   ·   text — UTF-8 bytes (codepoint order)
 */
export function encodeKey(values: SeamValue[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const v of values) {
    if (v.t === "null") {
      parts.push(new Uint8Array([0]));
      continue;
    }
    parts.push(new Uint8Array([1]));
    parts.push(encodeOrderable(v));
  }
  return concat(parts);
}

function encodeOrderable(v: SeamValue): Uint8Array {
  switch (v.t) {
    case "int":
    case "stamp":
      return orderI64(v.v);
    case "decimal": {
      // sign-flipped unscaled value, big-endian, so byte order equals numeric order
      let shifted = BigInt.asUintN(128, v.v.unscaled + (1n << 127n));
      const b = new Uint8Array(16);
      for (let i = 15; i >= 0; i--) {
        b[i] = Number(shifted & 0xffn);
        shifted >>= 8n;
      }
      return b;
    }
    case "bool":
      return new Uint8Array([v.v ? 1 : 0]);
    case "day": {
      const u = v.v >>> 0;
      return new Uint8Array([(u >>> 24) & 0xff, (u >>> 16) & 0xff, (u >>> 8) & 0xff, u & 0xff]);
    }
    case "text":
      return new TextEncoder().encode(v.v);
    case "null":
      return new Uint8Array(0);
  }
}
