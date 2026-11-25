import { PAGE_HEADER, PAGE_SIZE, buf, concat, putU16, putU32, putU64, u32 } from "./codec";
import { err } from "./errors";
import type { KeyProvider } from "./keys";
import type { Pager } from "./pager";

const WAL_WRAP_MAGIC = 0x57414553;
const GCM_TAG = 16;
// Ciphertext starts in the header's tag slot (tag first, then the encrypted
// body) so wrapping never grows the page or drops plaintext bytes. The header
// stays in the clear so page identity and the nonce remain readable.
const CIPHER_START = PAGE_HEADER - GCM_TAG;

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf(data)));
}

async function importAes(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", buf(key), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function pageNonce(dek: Uint8Array, pageId: bigint, generation: bigint): Promise<Uint8Array> {
  const buf = new Uint8Array(dek.length + 16);
  buf.set(dek);
  putU64(buf, dek.length, pageId);
  putU64(buf, dek.length + 8, generation);
  return (await sha256(buf)).subarray(0, 12);
}

function aad(pageId: bigint, objectId: bigint, generation: bigint, version: number): Uint8Array {
  const a = new Uint8Array(26);
  putU64(a, 0, pageId);
  putU64(a, 8, objectId);
  putU64(a, 16, generation);
  putU16(a, 24, version);
  return a;
}

export async function wrapPage(plain: Uint8Array, dek: Uint8Array): Promise<Uint8Array> {
  if (plain.length !== PAGE_SIZE) err("E_CORRUPT", "Cannot wrap a non-page.");
  const pageId = u64le(plain, 8);
  const objectId = u64le(plain, 16);
  const generation = u64le(plain, 24);
  const version = plain[4] | (plain[5] << 8);
  const nonce = await pageNonce(dek, pageId, generation);
  const key = await importAes(dek);
  const body = plain.subarray(PAGE_HEADER, PAGE_SIZE);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: buf(nonce), additionalData: buf(aad(pageId, objectId, generation, version)) },
      key,
      buf(body),
    ),
  );
  const out = plain.slice();
  out.set(nonce, 52);
  if (ct.length !== PAGE_SIZE - CIPHER_START) err("E_CORRUPT", "AES-GCM wrap length mismatch.");
  out.set(ct, CIPHER_START);
  return out;
}

export async function unwrapPage(enc: Uint8Array, dek: Uint8Array): Promise<Uint8Array> {
  if (enc.length !== PAGE_SIZE) err("E_CORRUPT", "Cannot unwrap a non-page.");
  const pageId = u64le(enc, 8);
  const objectId = u64le(enc, 16);
  const generation = u64le(enc, 24);
  const version = enc[4] | (enc[5] << 8);
  const nonce = enc.subarray(52, 64);
  const key = await importAes(dek);
  try {
    const pt = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: buf(nonce), additionalData: buf(aad(pageId, objectId, generation, version)) },
        key,
        buf(enc.subarray(CIPHER_START, PAGE_SIZE)),
      ),
    );
    if (pt.length !== PAGE_SIZE - PAGE_HEADER) err("E_CORRUPT", "AES-GCM unwrap length mismatch.");
    const out = enc.slice();
    for (let i = 52; i < 64; i++) out[i] = 0;
    for (let i = CIPHER_START; i < PAGE_HEADER; i++) out[i] = 0;
    out.set(pt, PAGE_HEADER);
    return out;
  } catch {
    err("E_KEY", "Page decrypt failed (wrong key or corrupt ciphertext).");
  }
}

function u64le(b: Uint8Array, o: number): bigint {
  const lo = BigInt(u32(b, o));
  const hi = BigInt(u32(b, o + 4));
  return lo + (hi << 32n);
}

export class EncryptedPager implements Pager {
  readonly durable: boolean;
  constructor(
    readonly inner: Pager,
    readonly provider: KeyProvider,
  ) {
    this.durable = inner.durable;
  }

  private dek(): Uint8Array {
    return this.provider.dek();
  }

  async read(id: number): Promise<Uint8Array | null> {
    const raw = await this.inner.read(id);
    if (!raw) return null;
    return unwrapPage(raw, this.dek());
  }
  async write(id: number, page: Uint8Array): Promise<void> {
    await this.inner.write(id, await wrapPage(page, this.dek()));
  }
  sync(): Promise<void> {
    return this.inner.sync();
  }
  async walBytes(): Promise<Uint8Array> {
    return unwrapWal(await this.inner.walBytes(), this.dek());
  }
  async walAppend(chunk: Uint8Array): Promise<void> {
    await this.inner.walAppend(await wrapWalChunk(chunk, this.dek()));
  }
  async walTruncate(len: number): Promise<void> {
    const plain = await unwrapWal(await this.inner.walBytes(), this.dek());
    const cut = plain.slice(0, len);
    const wrapped = await wrapWalFile(cut, this.dek());
    await this.inner.walTruncate(0);
    if (wrapped.length) await this.inner.walAppend(wrapped);
  }
  walSync(): Promise<void> {
    return this.inner.walSync();
  }
  tryLock(): Promise<boolean> {
    return this.inner.tryLock();
  }
  unlock(): Promise<void> {
    return this.inner.unlock();
  }
}

export async function wrapWalChunk(plain: Uint8Array, dek: Uint8Array): Promise<Uint8Array> {
  const nonce = (await sha256(concat(dek, plain))).subarray(0, 12);
  const key = await importAes(dek);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(nonce), additionalData: buf(utf8Aad("WAL")) }, key, buf(plain)),
  );
  const out = new Uint8Array(8 + 12 + ct.length);
  putU32(out, 0, WAL_WRAP_MAGIC);
  putU32(out, 4, ct.length);
  out.set(nonce, 8);
  out.set(ct, 20);
  return out;
}

async function wrapWalFile(plain: Uint8Array, dek: Uint8Array): Promise<Uint8Array> {
  if (plain.length === 0) return new Uint8Array(0);
  return wrapWalChunk(plain, dek);
}

export async function unwrapWal(enc: Uint8Array, dek: Uint8Array): Promise<Uint8Array> {
  if (enc.length === 0) return enc;
  const parts: Uint8Array[] = [];
  let off = 0;
  const key = await importAes(dek);
  while (off < enc.length) {
    if (off + 20 > enc.length) err("E_WAL_CORRUPT", "Encrypted WAL truncated.");
    const magic = u32(enc, off);
    if (magic !== WAL_WRAP_MAGIC) err("E_WAL_CORRUPT", "Encrypted WAL magic mismatch.");
    const clen = u32(enc, off + 4);
    if (clen > 2 * 1024 * 1024 || off + 20 + clen > enc.length) err("E_WAL_CORRUPT", "Encrypted WAL length.");
    const nonce = enc.subarray(off + 8, off + 20);
    const ct = enc.subarray(off + 20, off + 20 + clen);
    try {
      parts.push(
        new Uint8Array(
          await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(nonce), additionalData: buf(utf8Aad("WAL")) }, key, buf(ct)),
        ),
      );
    } catch {
      err("E_KEY", "WAL decrypt failed.");
    }
    off += 20 + clen;
  }
  return concat(...parts);
}

function utf8Aad(s: string): Uint8Array {
  return new TextEncoder().encode(`SEAMDB/WAL/V1/${s}`);
}
