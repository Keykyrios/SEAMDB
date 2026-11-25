import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "../src/db/engine";
import { MemoryPager, type Pager } from "../src/db/pager";
import { PAGE_SIZE, crc32, putU32, u32 } from "../src/db/codec";
import { PT_BT_INT, PT_BT_LEAF, decodePage } from "../src/db/page";
import { SeamError } from "../src/db/errors";
import { displayValue, type SeamValue } from "../src/db/values";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (p.endsWith(".ts")) out.push(p);
    else if (!p.includes("node_modules") && !p.endsWith(".css") && !p.endsWith(".html")) {
      try {
        if (readdirSync(p)) out.push(...walk(p));
      } catch {
        // not a directory
      }
    }
  }
  return out;
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as SeamError).code ?? "NOT_SEAM";
  }
  return "NO_THROW";
}

/** Counts and measures every page write so tests can prove the storage path
 * is real: fixed-size pages, reached through the pager, not an array. */
class CountingPager implements Pager {
  private inner = new MemoryPager();
  writes = 0;
  reads = 0;
  sizes: number[] = [];
  get durable(): boolean {
    return this.inner.durable;
  }
  async read(id: number): Promise<Uint8Array | null> {
    this.reads++;
    return this.inner.read(id);
  }
  async write(id: number, page: Uint8Array): Promise<void> {
    this.writes++;
    this.sizes.push(page.length);
    return this.inner.write(id, page);
  }
  sync(): Promise<void> {
    return this.inner.sync();
  }
  walBytes(): Promise<Uint8Array> {
    return this.inner.walBytes();
  }
  walAppend(chunk: Uint8Array): Promise<void> {
    return this.inner.walAppend(chunk);
  }
  walTruncate(len: number): Promise<void> {
    return this.inner.walTruncate(len);
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

test("the database has zero runtime dependencies; the only library import is the vetted KEM", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json")), "utf8") as {
    dependencies?: Record<string, string>;
  };
  // The DB itself (src/db) imports nothing but our own modules. The evidence
  // plane's crypto uses WebCrypto plus EXACTLY ONE vetted external library
  // — @noble/post-quantum (referenced FIPS 203 implementation) — because
  // hand-rolling ML-KEM would be worse engineering, not a more real engine.
  // Anything beyond that set requires editing this test with a justification.
  const allowed = new Set(["@noble/post-quantum"]);
  const unknown = Object.keys(pkg.dependencies ?? {}).filter((d) => !allowed.has(d));
  assert.deepEqual(unknown, [], `unapproved runtime dependencies: ${unknown.join(", ")}`);
});

test("src/db imports nothing but itself; only src/engine may import the vetted KEM library", () => {
  const offenders: string[] = [];
  const allowed = /^@noble\/post-quantum\//;
  for (const file of walk(join(ROOT, "src"))) {
    const inDb = file.includes(join("src", "db"));
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/^\s*(?:import|export)[^"'\n]*from\s+"([^"]+)"/gm)) {
      const spec = m[1];
      if (spec.startsWith(".") || spec.startsWith("node:")) continue;
      if (!inDb && allowed.test(spec)) continue;
      offenders.push(`${file} → ${spec}`);
    }
    for (const m of src.matchAll(/^\s*import\s+"([^"]+)"/gm)) {
      const spec = m[1];
      if (spec.startsWith(".")) continue;
      if (!inDb && allowed.test(spec)) continue;
      offenders.push(`${file} → ${spec}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("no dynamic code execution and no bundled SQL engine", () => {
  const banned: Array<[RegExp, string]> = [
    [/\beval\s*\(/, "eval"],
    [/new\s+Function\s*\(/, "new Function"],
    [/\brequire\s*\(/, "require()"],
    [/\bWebAssembly\b/, "WebAssembly"],
  ];
  for (const file of walk(join(ROOT, "src/db")).concat(walk(join(ROOT, "src/engine")))) {
    const src = readFileSync(file, "utf8");
    for (const [re, label] of banned) {
      assert.equal(re.test(src), false, `${label} must not appear in ${file}`);
    }
  }
});

test("every write reaches the pager as a fixed-size page", async () => {
  const pager = new CountingPager();
  const db = await Database.open(pager);
  await db.exec("spawn table t: id: whole number, main key, v: whole number, fallback 0");
  for (let i = 0; i < 25; i++) await db.exec(`drop in t { id: ${i}, v: ${i} }`);
  await db.exec("tweak t set v = 99 when id = 3");
  await db.exec("yeet from t when id = 4");

  assert.ok(pager.writes > 10, `page writes: ${pager.writes}`);
  assert.ok(pager.reads > 0, "the executor reads pages back");
  assert.ok(
    pager.sizes.every((s) => s === PAGE_SIZE),
    `every write is one page: ${[...new Set(pager.sizes)].join(",")}`,
  );
  const rows = await db.exec("pull count(id) as n from t");
  assert.equal((rows[0].rows[0][0] as { v: bigint }).v, 24n);
  await db.close();
});

test("the write-ahead log is a checksummed record stream recovery replays", async () => {
  const store = new MemoryPager();
  const db = await Database.open(store);
  await db.exec("spawn table t: id: whole number, main key");
  await db.exec("drop in t { id: 1 }");
  await db.exec("drop in t { id: 2 }");

  const wal = await store.walBytes();
  assert.deepEqual([...wal.slice(0, 4)], [0x53, 0x45, 0x41, 0x57], "SEAW file header");

  let off = 16;
  let records = 0;
  const seen = new Set<string>();
  while (off + 38 <= wal.length) {
    assert.equal(u32(wal, off), 0x314c4157, `record ${records}: magic`);
    const len = u32(wal, off + 4);
    const rec = wal.slice(off, off + 38 + len);
    const copy = rec.slice();
    putU32(copy, 34, 0);
    assert.equal(crc32(copy), u32(rec, 34), `record ${records}: checksum`);
    seen.add(String(rec[8])); // record type byte
    off += 38 + len;
    records++;
  }
  assert.equal(off, wal.length, "no trailing garbage");
  assert.ok(records >= 8, `records: ${records}`);
  assert.ok(seen.has("1") && seen.has("8"), "begin and commit records present");

  // recovery is what makes the log meaningful: reopen and the rows are back
  await db.close();
  const reopened = await Database.open(store);
  const rows = await reopened.exec("pull id from t rank by id low to high");
  assert.deepEqual(rows[0].rows.map((r) => r[0].v), [1n, 2n]);
  await reopened.close();
});

test("the index is a real B+tree: it splits into leaves under an internal node", async () => {
  const store = new MemoryPager();
  const db = await Database.open(store);
  await db.exec("spawn table t: id: whole number, main key, v: text");
  await db.exec("add index ix_v on t(v)");
  // Fat ~100-byte index keys: 500 entries need over 50 KB of leaf space, so a
  // single 16 KiB leaf page cannot hold them and the tree must split.
  const fill = (i: number): string => ("row" + String(i).padStart(6, "0")).padEnd(100, "_");
  const stmts: string[] = [];
  for (let i = 0; i < 500; i++) stmts.push(`drop in t { id: ${i}, v: '${fill(i)}' }`);
  await db.exec(stmts.join("\n"));
  const probe = fill(250);

  // and the planner actually uses the tree instead of scanning the heap
  const spill = await db.exec(`spill pull id from t when v = '${probe}'`);
  assert.match(String(spill[0].plan), /IndexPoint\(t\.ix_v\)/);
  const viaIndex = await db.exec(`pull id, v from t when v = '${probe}'`);
  db.setOptimize(false);
  const viaHeap = await db.exec(`pull id, v from t when v = '${probe}'`);
  db.setOptimize(true);
  const key = (row: SeamValue[]): string => `${displayValue(row[0])}|${displayValue(row[1])}`;
  assert.deepEqual(
    viaIndex[0].rows.map(key).sort(),
    viaHeap[0].rows.map(key).sort(),
    "index scan and heap scan agree on the answer",
  );
  assert.ok(viaIndex[0].rows.length > 0);

  await db.close(); // checkpoint: commit flushes the B-tree pages to the pager
  let leaves = 0;
  let internals = 0;
  for (const [, raw] of store.pages) {
    const type = decodePage(raw).type;
    if (type === PT_BT_LEAF) leaves++;
    if (type === PT_BT_INT) internals++;
  }
  assert.ok(leaves > 1, `leaf pages: ${leaves}`);
  assert.ok(internals > 0, `internal pages: ${internals}`);

  const reopened = await Database.open(store);
  assert.equal((await reopened.exec(`pull id from t when v = '${probe}'`))[0].rows[0][0].v, 250n);
  await reopened.close();
});

test("numbers are exact: i64 and decimal, never IEEE floats", async () => {
  const db = await Database.open(new MemoryPager());
  await db.exec("spawn table t: id: whole number, main key");
  await db.exec("drop in t { id: 1 }");
  const r = await db.exec("pull 0.1 + 0.2 as s, 1 / 3 as q, 9223372036854775807 as big from t");
  const s = r[0].rows[0][0];
  assert.equal(s.t, "decimal");
  assert.equal(String((s as { v: { toString(): string } }).v), "0.3"); // a float prints 0.30000000000000004
  assert.equal(r[0].rows[0][1].v, 0n); // integer division truncates, it does not approximate
  assert.equal(r[0].rows[0][2].v, 9223372036854775807n);
  assert.equal(typeof r[0].rows[0][2].v, "bigint");
  await db.close();
});

test("the type surface is closed: float-like and host types do not exist", async () => {
  const db = await Database.open(new MemoryPager());
  for (const ty of ["float", "real", "double", "blob", "uuid", "json"]) {
    assert.equal(
      await codeOf(() => db.exec(`spawn table bad_${ty}: id: whole number, main key, v: ${ty}`)),
      "E_SYNTAX",
      `${ty} must not be a type`,
    );
  }
  // and the engine refuses to grow one at runtime
  const ok = await db.exec("spawn table t: id: whole number, main key");
  assert.equal(ok[0].evidence_state, "COMMITTED");
  await db.close();
});

test("pages carry checksums, so silent corruption cannot pass as data", async () => {
  const store = new MemoryPager();
  const db = await Database.open(store);
  await db.exec("spawn table t: id: whole number, main key");
  await db.exec("drop in t { id: 1 }");
  await db.close();
  const page = store.pages.get(1);
  assert.ok(page, "heap page exists");
  const before = decodePage(page!);
  page![100] ^= 0xff;
  assert.throws(() => decodePage(page!), (e: unknown) => (e as SeamError).code === "E_CHECKSUM");
  // the untouched copy still decodes: corruption was introduced by the test
  page![100] ^= 0xff;
  assert.equal(decodePage(page!).type, before.type);
});

test("typed values keep their storage type through a full round trip", async () => {
  const db = await Database.open(new MemoryPager());
  await db.exec(`spawn table t:
    i: whole number, main key,
    d: decimal(12, 3),
    s: text,
    b: yesno,
    ts: stamp,
    dy: day`);
  await db.exec(`drop in t { i: -7, d: 12.500, s: 'héllo 👋', b: yes, ts: now(), dy: today() }`);
  const r = await db.exec("pull i, d, s, b, ts, dy from t");
  const row: SeamValue[] = r[0].rows[0];
  assert.deepEqual(
    row.map((v) => v.t),
    ["int", "decimal", "text", "bool", "stamp", "day"],
  );
  assert.equal(String((row[1] as { v: { toString(): string } }).v), "12.500"); // scale preserved
  assert.equal(typeof row[0].v, "bigint");
  assert.equal(typeof row[4].v, "bigint"); // stamps are integer microseconds
  assert.ok((row[4].v as bigint) > 0n, "now() yields positive microseconds");
  const day = (row[5] as { v: number }).v;
  assert.ok(Number.isInteger(day) && day >= 20000, `today() yields an epoch day, got ${day}`);
  await db.close();
});
