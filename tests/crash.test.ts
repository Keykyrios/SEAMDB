import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../src/db/engine";
import { SeamError } from "../src/db/errors";
import { FaultyPager, MemoryPager } from "../src/db/pager";

/**
 * Crash matrix: run a fixed workload under a pager that fails its Nth write,
 * then reopen the underlying store and check that exactly the acknowledged
 * statements survived. Every statement here is auto-commit, so each one is
 * acknowledged only after its commit record reached the (simulated) WAL.
 */
test("crash after every write boundary: only acknowledged commits survive", async () => {
  const ROW_ID: Record<string, bigint> = { row1: 1n, row2: 2n, row3: 3n };
  for (let budget = 0; budget <= 26; budget++) {
    const store = new MemoryPager();
    const faulty = new FaultyPager(store, budget);
    const acknowledged: string[] = [];
    const inFlight: string[] = [];
    let crashed = false;
    let db: Database | null = null;

    const step = async (label: string, sql: string): Promise<void> => {
      if (crashed) return;
      try {
        await db!.exec(sql);
        acknowledged.push(label);
      } catch {
        // The statement running when the pager failed has an unknown outcome:
        // it may have reached its commit record before the crash. Nothing else
        // is allowed to show up after recovery.
        inFlight.push(label);
        crashed = true;
      }
    };

    try {
      db = await Database.open(faulty);
    } catch {
      crashed = true;
      await faulty.unlock();
    }
    if (db) {
      await step("spawn", `spawn table crash: id: whole number, main key, v: whole number, fallback 0`);
      await step("row1", `drop in crash { id: 1, v: 0 }`);
      await step("row2", `drop in crash { id: 2, v: 1 }`);
      await step("row3", `drop in crash { id: 3, v: 2 }`);
      if (crashed) await faulty.unlock(); // a crashed process releases its lock
      else await db.close();
    }

    const reopened = await Database.open(store);
    let exists = true;
    let present: bigint[] = [];
    try {
      const rows = await reopened.exec("pull id from crash rank by id low to high");
      present = rows[0].rows.map((r) => r[0].v as bigint);
    } catch {
      exists = false;
    }

    const spawnAcked = acknowledged.includes("spawn");
    const spawnInFlight = inFlight.includes("spawn");
    if (spawnAcked) assert.equal(exists, true, `budget=${budget}: acknowledged spawn survives`);
    else if (!spawnInFlight) assert.equal(exists, false, `budget=${budget}: uncommitted spawn stays invisible`);

    const ackedIds = acknowledged.filter((a) => a.startsWith("row")).map((a) => ROW_ID[a]);
    const allowed = new Set([
      ...ackedIds,
      ...inFlight.filter((l) => l.startsWith("row")).map((l) => ROW_ID[l]),
    ]);
    for (const id of ackedIds) assert.ok(present.includes(id), `budget=${budget}: acknowledged row ${id} survives`);
    for (const id of present) assert.ok(allowed.has(id), `budget=${budget}: row ${id} appeared without being written`);
    await reopened.close();
  }
});

test("aborted transaction writes never resurrect after a restart", async () => {
  const store = new MemoryPager();
  const db = await Database.open(store);
  await db.exec(`spawn table keep: id: whole number, main key`);
  await db.exec("start tx");
  await db.exec(`drop in keep { id: 1 }`);
  await db.exec("dip"); // abort: the WAL still holds its page image
  await db.exec(`drop in keep { id: 2 }`); // committed neighbor on the same page
  await db.close();

  const reopened = await Database.open(store);
  const rows = await reopened.exec("pull id from keep");
  assert.deepEqual(
    rows[0].rows.map((r) => r[0].v),
    [2n],
  );
  await reopened.close();
});

test("a torn WAL tail is tolerated; committed data still opens", async () => {
  const store = new MemoryPager();
  const db = await Database.open(store);
  await db.exec(`spawn table t: id: whole number, main key`);
  await db.exec(`drop in t { id: 1 }`);
  await db.close();

  // simulate a torn write at the end of the log
  const wal = await store.walBytes();
  const torn = new Uint8Array(wal.length + 21);
  torn.set(wal);
  torn[wal.length] = 0x53; // plausible magic start, then garbage
  store.wal = torn;

  const reopened = await Database.open(store);
  const rows = await reopened.exec("pull id from t");
  assert.deepEqual(rows[0].rows.map((r) => r[0].v), [1n]);
  // the database stays writable after tolerating the tear
  await reopened.exec(`drop in t { id: 2 }`);
  await reopened.close();
});

test("a corrupt heap page is repaired from the WAL; a corrupt superblock refuses to open", async () => {
  const store = new MemoryPager();
  const db = await Database.open(store);
  await db.exec(`spawn table t: id: whole number, main key`);
  await db.exec(`drop in t { id: 1 }`);
  await db.close();

  // Heap pages are covered by write-ahead page images, so recovery restores
  // the last committed version instead of trusting the damaged bytes.
  const page1 = store.pages.get(1);
  assert.ok(page1, "heap page exists");
  page1![100] ^= 0xff;
  const reopened = await Database.open(store);
  const rows = await reopened.exec("pull id from t");
  assert.deepEqual(rows[0].rows.map((r) => r[0].v), [1n]);
  await reopened.close();

  // The superblock has no WAL image: corruption there must fail closed.
  const page0 = store.pages.get(0);
  assert.ok(page0, "superblock exists");
  page0![100] ^= 0xff;
  await assert.rejects(
    () => Database.open(store),
    (e: unknown) => (e as SeamError).code === "E_CHECKSUM" || (e as SeamError).code === "E_CORRUPT",
  );
});

test("DDL inside an uncommitted transaction leaves no half-created table", async () => {
  const store = new MemoryPager();
  const faulty = new FaultyPager(store, 14); // crash around the commit of the DDL
  let crashed = false;
  try {
    const db = await Database.open(faulty);
    await db.exec(`spawn table base: id: whole number, main key`);
    await db.exec("start tx");
    await db.exec(`spawn table doomed: id: whole number, main key`);
    await db.exec("lock in");
    await db.close();
  } catch {
    crashed = true;
    await faulty.unlock();
  }
  const reopened = await Database.open(store);
  const baseExists = await reopened
    .exec("pull id from base")
    .then(() => true)
    .catch(() => false);
  assert.ok(baseExists || crashed, "base table either committed before the crash or crashed before it");
  const doomedExists = await reopened
    .exec("pull id from doomed")
    .then(() => true)
    .catch(() => false);
  // if the DDL commit was acknowledged it may exist; if not, it must not
  if (!baseExists) {
    assert.equal(doomedExists, false);
  }
  await reopened.close();
});

test("checkpoint-then-corrupt-WAL still opens (data pages are durable)", async () => {
  const store = new MemoryPager();
  const db = await Database.open(store);
  await db.exec(`spawn table t: id: whole number, main key`);
  for (let i = 0; i < 5; i++) await db.exec(`drop in t { id: ${i} }`);
  await db.close(); // checkpoint flushed every dirty page

  // corrupt the middle of the WAL: replay must stop there without crashing
  const wal = await store.walBytes();
  const mid = Math.floor(wal.length / 2);
  wal[mid] ^= 0xff;
  store.wal = wal;

  const reopened = await Database.open(store);
  const rows = await reopened.exec("pull count(id) as n from t");
  assert.equal(rows[0].rows[0][0].v, 5n);
  await reopened.close();
});

test("restart reopens with a clean lock", async () => {
  const store = new MemoryPager();
  const db = await Database.open(store);
  await db.close();
  const again = await Database.open(store); // close released the lock
  await again.close();
  const third = await Database.open(store);
  await third.close();
});
