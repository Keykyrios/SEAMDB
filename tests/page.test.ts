import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_HEADER, PAGE_SIZE, crc32 as crc32Of, putU32, putU64, utf8 } from "../src/db/codec";
import { SeamError } from "../src/db/errors";
import { PT_HEAP, decodePage, emptyPage, encodeSlots, freeSpace } from "../src/db/page";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as SeamError).code ?? "NOT_SEAM";
  }
  return "NO_THROW";
}

test("emptyPage decodes with the requested identity", () => {
  const raw = emptyPage(PT_HEAP, 7n, 42n, 3n);
  const p = decodePage(raw);
  assert.equal(p.type, PT_HEAP);
  assert.equal(p.pageId, 7n);
  assert.equal(p.objectId, 42n);
  assert.equal(p.generation, 3n);
  assert.equal(p.right, 0);
  assert.equal(p.slots.length, 0);
  assert.ok(freeSpace(raw) > PAGE_SIZE - 256);
});

test("slot round trip preserves bytes and sibling pointer", () => {
  const base = decodePage(emptyPage(PT_HEAP, 5n, 1n));
  const a = utf8("first row payload");
  const b = utf8("second row payload, longer");
  const raw = encodeSlots({ ...base, right: 99 }, [a, b], 123n);
  const p = decodePage(raw);
  assert.equal(p.right, 99);
  assert.equal(p.lsn, 123n);
  assert.equal(p.slots.length, 2);
  assert.deepEqual(p.slots[0], a);
  assert.deepEqual(p.slots[1], b);
});

test("hole slots (deleted rows) survive a re-encode", () => {
  const base = decodePage(emptyPage(PT_HEAP, 5n, 1n));
  const raw = encodeSlots(base, [utf8("keep"), new Uint8Array(0), utf8("also keep")], 1n);
  const p = decodePage(raw);
  assert.equal(p.slots.length, 3);
  assert.equal(p.slots[1].length, 0);
  assert.deepEqual(p.slots[0], utf8("keep"));
  assert.deepEqual(p.slots[2], utf8("also keep"));
});

test("bad magic, bad size and bad version are rejected", () => {
  const raw = emptyPage(PT_HEAP, 1n, 1n);
  raw[0] = 0x00; // magic checked before the checksum
  assert.equal(codeOf(() => decodePage(raw)), "E_CORRUPT");
  const raw2 = emptyPage(PT_HEAP, 1n, 1n);
  assert.equal(codeOf(() => decodePage(raw2.slice(0, 100))), "E_CORRUPT");
  const raw3 = emptyPage(PT_HEAP, 1n, 1n);
  raw3[4] = 9; // format version, checksum recomputed so the version rule is what fires
  putU32(raw3, 48, 0);
  putU32(raw3, 48, crc32Of(raw3));
  assert.equal(codeOf(() => decodePage(raw3)), "E_CORRUPT");
});

test("single-bit flips anywhere in the page are caught by the checksum", () => {
  const base = decodePage(emptyPage(PT_HEAP, 5n, 1n));
  const full = encodeSlots(base, [utf8("row"), utf8("row2")], 9n);
  const spots = [3, 7, 20, 30, 40, 47, 70, PAGE_HEADER + 4, PAGE_SIZE - 1];
  for (const pos of spots) {
    const bad = full.slice();
    bad[pos] ^= 0x01;
    // flips in the magic are reported as bad magic (checked first);
    // everywhere else the checksum catches them
    const expected = pos < 4 ? "E_CORRUPT" : "E_CHECKSUM";
    assert.equal(codeOf(() => decodePage(bad)), expected, `flip at ${pos}`);
  }
});

test("overlapping and out-of-bounds slots are rejected", () => {
  const base = decodePage(emptyPage(PT_HEAP, 5n, 1n));
  const full = encodeSlots(base, [utf8("aaaa"), utf8("bbbb")], 1n);
  const overlap = full.slice();
  // slot0: [off,len] at 72; slot1 at 76. Point slot1 at slot0's body.
  const view = new DataView(overlap.buffer);
  const off0 = view.getUint16(PAGE_HEADER, true);
  view.setUint16(PAGE_HEADER + 4, off0, true);
  assert.equal(codeOf(() => decodePage(overlap)), "E_CHECKSUM"); // crc must be recomputed to test structure checks

  const structurallyBad = full.slice();
  const v2 = new DataView(structurallyBad.buffer);
  v2.setUint16(PAGE_HEADER + 4, v2.getUint16(PAGE_HEADER, true), true);
  v2.setUint16(PAGE_HEADER + 6, v2.getUint16(PAGE_HEADER + 2, true), true);
  putU32(structurallyBad, 48, 0);
  putU32(structurallyBad, 48, crc32Of(structurallyBad));
  assert.equal(codeOf(() => decodePage(structurallyBad)), "E_CORRUPT"); // overlapping slots

  const oob = full.slice();
  const v3 = new DataView(oob.buffer);
  v3.setUint16(PAGE_HEADER, PAGE_SIZE - 1, true);
  putU32(oob, 48, 0);
  putU32(oob, 48, crc32Of(oob));
  assert.equal(codeOf(() => decodePage(oob)), "E_CORRUPT"); // slot out of bounds
});

test("slot directory that disagrees with lower bound is rejected", () => {
  const base = decodePage(emptyPage(PT_HEAP, 5n, 1n));
  const raw = encodeSlots(base, [utf8("data")], 1n);
  const bad = raw.slice();
  putU64(bad, 8, 1n); // rewrite page id, then fix crc — a valid header change must decode
  putU32(bad, 48, 0);
  putU32(bad, 48, crc32Of(bad));
  assert.equal(decodePage(bad).pageId, 1n);

  const bad2 = raw.slice();
  const v = new DataView(bad2.buffer);
  v.setUint16(42, PAGE_HEADER + 8, true); // lower no longer matches slotCount
  putU32(bad2, 48, 0);
  putU32(bad2, 48, crc32Of(bad2));
  assert.equal(codeOf(() => decodePage(bad2)), "E_CORRUPT");
});

test("reserved zero bytes in the header are enforced", () => {
  const base = decodePage(emptyPage(PT_HEAP, 5n, 1n));
  const raw = encodeSlots(base, [utf8("x")], 1n);
  const bad = raw.slice();
  bad[60] = 7; // inside the reserved nonce slot
  putU32(bad, 48, 0);
  putU32(bad, 48, crc32Of(bad));
  assert.equal(codeOf(() => decodePage(bad)), "E_CORRUPT");
});

test("encodeSlots refuses to overflow a full page", () => {
  const base = decodePage(emptyPage(PT_HEAP, 5n, 1n));
  const fat = new Uint8Array(PAGE_SIZE - PAGE_HEADER - 8);
  assert.throws(() => encodeSlots(base, [fat, fat], 1n), (e: unknown) => (e as SeamError).code === "E_LIMIT");
});

