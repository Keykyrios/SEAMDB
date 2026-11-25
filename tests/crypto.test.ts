import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_HEADER, utf8 } from "../src/db/codec";
import { unwrapPage, unwrapWal, wrapPage, wrapWalChunk } from "../src/db/crypto-pager";
import { Database } from "../src/db/engine";
import { SeamError } from "../src/db/errors";
import { DevKeyProvider, ProductionKeyProvider, assertKeyForMode } from "../src/db/keys";
import { MemoryPager } from "../src/db/pager";
import { PT_HEAP, decodePage, emptyPage, encodeSlots } from "../src/db/page";

const KEY_A = new Uint8Array(32).fill(7);
const KEY_B = new Uint8Array(32).fill(9);

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as SeamError).code ?? "NOT_SEAM";
  }
  return "NO_THROW";
}

async function codeOfAsync(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as SeamError).code ?? "NOT_SEAM";
  }
  return "NO_THROW";
}

function clonePager(other: MemoryPager): MemoryPager {
  const p = new MemoryPager();
  for (const [id, page] of other.pages) p.pages.set(id, page.slice());
  p.wal = other.wal.slice();
  return p;
}

test("page wrap/unwrap round trips and binds page identity as AAD", async () => {
  const raw = emptyPage(PT_HEAP, 3n, 44n, 2n);
  const wrapped = await wrapPage(raw, KEY_A);
  assert.equal(wrapped.length, raw.length);
  const back = await unwrapPage(wrapped, KEY_A);
  assert.deepEqual(back, raw);
  assert.equal(await codeOfAsync(() => unwrapPage(wrapped, KEY_B)), "E_KEY");

  // moving the ciphertext to a different page id must fail (AAD binds identity)
  const moved = wrapped.slice();
  moved[8] ^= 0x01; // pageId byte
  assert.equal(await codeOfAsync(() => unwrapPage(moved, KEY_A)), "E_KEY");
});

test("the ciphertext never contains the plaintext body", async () => {
  const raw = emptyPage(PT_HEAP, 1n, 1n);
  const marker = utf8("SECRET-ROW-VALUE-9f3a");
  raw.set(marker, PAGE_HEADER + 100);
  const wrapped = await wrapPage(raw, KEY_A);
  let hit = -1;
  for (let i = 0; i + marker.length <= wrapped.length; i++) {
    let same = true;
    for (let j = 0; j < marker.length; j++) {
      if (wrapped[i + j] !== marker[j]) {
        same = false;
        break;
      }
    }
    if (same) {
      hit = i;
      break;
    }
  }
  assert.equal(hit, -1, "plaintext marker must not appear in the wrapped page");
});

test("every distinct page write derives a fresh nonce; identical wraps are deterministic", async () => {
  const raw = emptyPage(PT_HEAP, 5n, 1n);
  const w1 = await wrapPage(raw, KEY_A);
  const wAgain = await wrapPage(raw, KEY_A); // identical content -> identical bytes (safe)
  assert.deepEqual(wAgain, w1);

  // a rewrite bumps the page generation, so the nonce changes
  const rewritten = encodeSlots(decodePage(raw), [utf8("row v2")], 2n);
  const w2 = await wrapPage(rewritten, KEY_A);
  const n1 = w1.subarray(52, 64);
  const n2 = w2.subarray(52, 64);
  let same = true;
  for (let i = 0; i < 12; i++) if (n1[i] !== n2[i]) same = false;
  assert.equal(same, false, "nonce must change when the page changes");
  // ...and both remain individually unwrap-able
  assert.deepEqual(await unwrapPage(w1, KEY_A), raw);
  assert.deepEqual(await unwrapPage(w2, KEY_A), rewritten);
});

test("tampered ciphertext and truncated wraps are rejected", async () => {
  const raw = emptyPage(PT_HEAP, 2n, 2n);
  const wrapped = await wrapPage(raw, KEY_A);
  const bad = wrapped.slice();
  bad[PAGE_HEADER + 5] ^= 0x80;
  assert.equal(await codeOfAsync(() => unwrapPage(bad, KEY_A)), "E_KEY");
  assert.equal(await codeOfAsync(() => unwrapPage(wrapped.slice(0, 200), KEY_A)), "E_CORRUPT");
});

test("WAL chunk wrap/unwrap round trips; tamper and wrong key fail closed", async () => {
  const rec = utf8(" WAL-record-payload ");
  const wrapped = await wrapWalChunk(rec, KEY_A);
  assert.deepEqual(await unwrapWal(wrapped, KEY_A), rec);
  assert.equal(await codeOfAsync(() => unwrapWal(wrapped, KEY_B)), "E_KEY");
  const bad = wrapped.slice();
  bad[bad.length - 1] ^= 0x01;
  assert.equal(await codeOfAsync(() => unwrapWal(bad, KEY_A)), "E_KEY");
  const truncated = wrapped.slice(0, wrapped.length - 5);
  assert.equal(await codeOfAsync(() => unwrapWal(truncated, KEY_A)), "E_WAL_CORRUPT");
});

test("end-to-end: encrypted database stores and reopens data", async () => {
  const pager = new MemoryPager();
  const db = await Database.open(pager, { key: new DevKeyProvider(KEY_A) });
  await db.exec(`spawn table secret: id: whole number, main key, note: text, needed`);
  await db.exec(`drop in secret { id: 1, note: 'hidden gem' }`);
  await db.close();

  // raw pages on disk are ciphertext
  const page1 = pager.pages.get(1);
  assert.ok(page1);
  const asText = new TextDecoder("latin1").decode(page1!);
  assert.ok(!asText.includes("hidden gem"), "row value must not be readable on disk");

  const reopened = await Database.open(clonePager(pager), {
    key: new DevKeyProvider(KEY_A),
  });
  const rows = await reopened.exec("pull note from secret when id = 1");
  assert.equal(rows[0].rows[0][0].v, "hidden gem");
  await reopened.close();

  await assert.rejects(
    () => Database.open(clonePager(pager), { key: new DevKeyProvider(KEY_B) }),
    (e: unknown) => (e as SeamError).code === "E_KEY",
  );
});

test("key lifecycle rules: dev keys are refused in production mode", () => {
  assert.equal(codeOf(() => assertKeyForMode(new DevKeyProvider(KEY_A), "production")), "E_KEY");
  assert.equal(codeOf(() => assertKeyForMode(new DevKeyProvider(KEY_A), "development")), "NO_THROW");
  assert.equal(codeOf(() => assertKeyForMode(new ProductionKeyProvider(KEY_A), "production")), "NO_THROW");
  assert.equal(codeOf(() => assertKeyForMode(null, "production")), "NO_THROW"); // no encryption requested
  assert.equal(codeOf(() => new ProductionKeyProvider(new Uint8Array(32))), "E_KEY"); // all-zero refused
  assert.equal(codeOf(() => new DevKeyProvider(new Uint8Array(31))), "E_KEY"); // wrong size refused
});

test("production mode with a dev provider refuses to open", async () => {
  await assert.rejects(
    () => Database.open(new MemoryPager(), { mode: "production", key: new DevKeyProvider(KEY_A) }),
    (e: unknown) => (e as SeamError).code === "E_KEY",
  );
});
