import { err } from "./errors";

export const PAGE_SIZE = 16384;
/**
 * Header layout (bytes):
 *   0..4   magic  · 4..6 format version  · 6..8 page type
 *   8..16  page id  · 16..24 object id  · 24..32 generation
 *   32..40 page LSN  · 40..42 slot count  · 42..44 lower  · 44..46 upper
 *   46..48 flags  · 48..52 CRC32  · 52..64 nonce slot (zero at rest)
 *   64..72 right-sibling page id (0 = none; leaf chains only)
 *   72..88 AEAD tag slot (zero at rest; holds the GCM tag on encrypted pages)
 */
export const PAGE_HEADER = 88;
export const LANG = "seamql/0.1";
export const ENGINE = "seamdb-engine/0.1.0";
export const FORMAT = 1;
const MAX_TOKEN = 1024 * 1024;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, seed = 0xffffffff): number {
  let c = seed >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
export function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}
export function u64(b: Uint8Array, o: number): bigint {
  const lo = BigInt(u32(b, o));
  const hi = BigInt(u32(b, o + 4));
  return lo + (hi << 32n);
}
export function putU16(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
}
export function putU32(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
}
export function putU64(b: Uint8Array, o: number, v: bigint): void {
  const n = BigInt.asUintN(64, v);
  putU32(b, o, Number(n & 0xffffffffn));
  putU32(b, o + 4, Number(n >> 32n));
}

export function i64Bytes(n: bigint): Uint8Array {
  const u = BigInt.asUintN(64, n);
  const b = new Uint8Array(8);
  putU64(b, 0, u);
  return b;
}

export function readI64(b: Uint8Array, o: number): bigint {
  return BigInt.asIntN(64, u64(b, o));
}

/** Big-endian, sign-biased encoding so plain byte comparison preserves int64 order. */
export function orderI64(n: bigint): Uint8Array {
  let u = BigInt.asUintN(64, n) ^ 0x8000000000000000n;
  const b = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    b[i] = Number(u & 0xffn);
    u >>= 8n;
  }
  return b;
}

export class Decimal {
  constructor(
    readonly unscaled: bigint,
    readonly scale: number,
    readonly precision: number,
  ) {}

  static parse(text: string, precision = 38, scale?: number): Decimal {
    const m = text.match(/^(-)?(\d+)(?:\.(\d+))?$/);
    if (!m) err("E_TYPE_MISMATCH", `\`${text}\` is not a decimal.`);
    const sign = m[1] ? -1n : 1n;
    const frac = m[3] ?? "";
    const s = scale ?? frac.length;
    if (s < 0 || precision < 1 || precision > 38 || s > precision) err("E_TYPE_MISMATCH", "decimal(p,s) out of range.");
    let digits = m[2] + frac;
    if (frac.length < s) digits += "0".repeat(s - frac.length);
    else if (frac.length > s) digits = m[2] + frac.slice(0, s);
    digits = digits.replace(/^0+(?=\d)/, "");
    if (digits.replace("-", "").length > precision) err("E_OVERFLOW", `decimal ${text} exceeds precision ${precision}.`);
    const unscaled = sign * BigInt(digits.length ? digits : "0");
    return new Decimal(unscaled, s, precision);
  }

  rescaled(scale: number, precision: number): Decimal {
    if (scale === this.scale) {
      const d = this.unscaled.toString().replace("-", "").length;
      if (d > precision) err("E_OVERFLOW", "decimal exceeds precision.");
      return new Decimal(this.unscaled, scale, precision);
    }
    if (scale > this.scale) {
      const u = this.unscaled * 10n ** BigInt(scale - this.scale);
      if (u.toString().replace("-", "").length > precision) err("E_OVERFLOW", "decimal exceeds precision.");
      return new Decimal(u, scale, precision);
    }
    const q = this.unscaled / 10n ** BigInt(this.scale - scale);
    if (q.toString().replace("-", "").length > precision) err("E_OVERFLOW", "decimal exceeds precision.");
    return new Decimal(q, scale, precision);
  }

  toString(): string {
    const neg = this.unscaled < 0n;
    const s = (this.unscaled < 0n ? -this.unscaled : this.unscaled).toString().padStart(this.scale + 1, "0");
    const i = s.slice(0, s.length - this.scale) || "0";
    const f = this.scale ? s.slice(s.length - this.scale) : "";
    return `${neg ? "-" : ""}${i}${this.scale ? "." + f : ""}`;
  }
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Copy into a fresh ArrayBuffer-backed Uint8Array for WebCrypto BufferSource boundaries. */
export function buf(u: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(u.length);
  out.set(u);
  return out;
}
export function utf8dec(b: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    err("E_BAD_UTF8", "Invalid UTF-8.");
  }
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const o = new Uint8Array(n);
  let i = 0;
  for (const p of parts) {
    o.set(p, i);
    i += p.length;
  }
  return o;
}

export function cmpBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

export function boundLen(n: number, what: string): void {
  if (n < 0 || n > MAX_TOKEN) err("E_TOKEN_LIMIT", `${what} exceeds 1 MiB.`);
}
