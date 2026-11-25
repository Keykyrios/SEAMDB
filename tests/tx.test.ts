import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../src/db/engine";
import { SeamError } from "../src/db/errors";
import { MemoryPager } from "../src/db/pager";

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as SeamError).code ?? "NOT_SEAM";
  }
  return "NO_THROW";
}

async function fresh(): Promise<Database> {
  const db = await Database.open(new MemoryPager());
  await db.exec(`spawn table t: id: whole number, main key, v: whole number, fallback 0`);
  await db.exec(`drop in t { id: 1, v: 10 }`);
  await db.exec(`drop in t { id: 2, v: 20 }`);
  return db;
}

function ids(r: { rows: { v: unknown }[][] }[]): bigint[] {
  return r[0].rows.map((row) => row[0].v as bigint).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

test("explicit transaction: commit makes writes durable, rollback discards them", async () => {
  const db = await fresh();
  await db.exec("start tx");
  await db.exec(`drop in t { id: 3, v: 30 }`);
  const inside = await db.exec("pull id from t when id = 3");
  assert.equal(inside[0].rows.length, 1); // own writes are visible inside the tx
  await db.exec("lock in");
  const after = await db.exec("pull id from t when id = 3");
  assert.equal(after[0].rows.length, 1);

  await db.exec("start tx");
  await db.exec(`drop in t { id: 4, v: 40 }`);
  await db.exec("dip");
  const gone = await db.exec("pull id from t when id = 4");
  assert.equal(gone[0].rows.length, 0);
  await db.close();
});

test("rollback restores the catalog too (DDL is transactional)", async () => {
  const db = await fresh();
  await db.exec("start tx");
  await db.exec(`spawn table scratch: id: whole number, main key`);
  assert.equal(await codeOf(() => db.exec(`drop in scratch { id: 1 }`)), "NO_THROW");
  await db.exec("dip");
  assert.equal(await codeOf(() => db.exec(`pull id from scratch`)), "E_UNKNOWN_NAME");
  // the writer lock must be released by the rollback
  await db.exec(`drop in t { id: 5, v: 55 }`);
  assert.equal((await db.exec("pull id from t when id = 5"))[0].rows.length, 1);
  await db.close();
});

test("snapshot isolation: a running transaction does not see later commits", async () => {
  const db = await fresh();
  const reader = db.connect({ user: "r", roles: ["owner"] });
  const writer = db.connect({ user: "w", roles: ["owner"] });
  await reader.exec("start tx");
  await writer.exec(`drop in t { id: 100, v: 1 }`);
  const seen = await reader.exec("pull id from t when id = 100");
  assert.equal(seen[0].rows.length, 0); // snapshot predates the commit
  await reader.exec("dip");
  const later = await db.exec("pull id from t when id = 100");
  assert.equal(later[0].rows.length, 1); // a fresh snapshot sees it
  await db.close();
});

test("write-write conflict is detected, not silently last-writer-wins", async () => {
  const db = await fresh();
  const a = db.connect({ user: "a", roles: ["owner"] });
  await a.exec("start tx");
  await a.exec("tweak t set v = 11 when id = 1");
  // second writer touches the same row before the first finishes
  const b = db.connect({ user: "b", roles: ["owner"] });
  assert.equal(await codeOf(() => b.exec("tweak t set v = 22 when id = 1")), "E_CONFLICT");
  await a.exec("lock in");
  const v = await db.exec("pull v from t when id = 1");
  assert.equal(v[0].rows[0][0].v, 11n);
  await db.close();
});

test("single-writer lock: a second writer is refused until the first finishes", async () => {
  const db = await fresh();
  const a = db.connect({ user: "a", roles: ["owner"] });
  const b = db.connect({ user: "b", roles: ["owner"] });
  await a.exec("start tx");
  await a.exec(`drop in t { id: 20, v: 1 }`); // a now holds the write lock
  assert.equal(await codeOf(() => b.exec(`drop in t { id: 21, v: 2 }`)), "E_CONFLICT");
  // but readers interleave freely
  const read = await b.exec("pull id from t");
  assert.equal(read[0].rows.length, 2); // the uncommitted row stays invisible
  await a.exec("dip"); // release
  await b.exec(`drop in t { id: 21, v: 2 }`);
  assert.equal((await db.exec("pull id from t when id = 21"))[0].rows.length, 1);
  await db.close();
});

test("a failing statement inside an explicit transaction aborts it", async () => {
  const db = await fresh();
  await db.exec("start tx");
  await db.exec(`drop in t { id: 30, v: 1 }`);
  assert.equal(await codeOf(() => db.exec(`drop in t { id: 30, v: 2 }`)), "E_UNIQUE"); // duplicate key aborts
  // the tx is gone; the next statement runs in a fresh auto transaction
  assert.equal(await codeOf(() => db.exec("lock in")), "E_TX_STATE");
  const check = await db.exec("pull id from t when id = 30");
  assert.equal(check[0].rows.length, 0); // the whole transaction rolled back
  await db.close();
});

test("transaction state errors", async () => {
  const db = await fresh();
  assert.equal(await codeOf(() => db.exec("lock in")), "E_TX_STATE");
  assert.equal(await codeOf(() => db.exec("dip")), "E_TX_STATE");
  await db.exec("start tx");
  assert.equal(await codeOf(() => db.exec("start tx")), "E_TX_STATE");
  await db.exec("dip");
  await db.close();
});

test("aborted writes vanish and indexes stay consistent", async () => {
  const db = await fresh();
  await db.exec("add index ix_v on t(v)");
  await db.exec("start tx");
  await db.exec(`drop in t { id: 40, v: 777 }`);
  await db.exec("dip");
  const viaIndex = await db.exec("pull id from t when v = 777");
  assert.equal(viaIndex[0].rows.length, 0);
  const viaHeap = await db.exec("pull id from t when v = 777");
  assert.deepEqual(viaIndex[0].rows, viaHeap[0].rows);
  const check = await db.exec("fah table t");
  assert.equal(check[0].rows[0][1].v, 0n); // no faults
  await db.close();
});
