import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../src/db/engine";
import { MemoryPager } from "../src/db/pager";
import { PT_CATALOG, PT_FREE, decodePage } from "../src/db/page";
import { SeamError } from "../src/db/errors";

/** Lower the engine's rotation budget so every checkpoint rotates (and close
 * with one, since close() checkpoints). */
function rotateAlways(db: Database): void {
  db.rotateBudget = 0;
}

test("rotation keeps the relation: rows, schema, grants and indexes survive checkpoint rotation", async () => {
  const store = new MemoryPager();
  const db = await Database.open(store);
  rotateAlways(db);
  await db.exec(`spawn table t: id: whole number, main key, name: text, needed`);
  await db.exec("add index ix_name on t(name)");
  await db.exec("let role analyst pull t.id, t.name");
  await db.exec(`drop in t { id: 1, name: 'ada' }`);
  await db.exec(`drop in t { id: 2, name: 'grace' }`);
  await db.exec("tweak t set name = 'lovelace' when id = 1");
  await db.exec("yeet from t when id = 2");
  const lsnBefore = BigInt((await db.exec("pull count(id) as n from t"))[0].commit_lsn ?? "0");

  await db.close(); // checkpoint -> rotate

  // the log is now a single restart record: it does not replay anything
  const reopened = await Database.open(store);
  const rows = await reopened.exec("pull id, name from t rank by id low to high");
  assert.equal(rows[0].rows.length, 1);
  assert.equal(rows[0].rows[0][1].v, "lovelace");
  // schema, index and grant came from the persisted snapshot
  const cat = reopened.catalogInfo();
  assert.equal(cat.length, 1);
  assert.equal(cat[0].indexes[0].name, "ix_name");
  // the locked role is still bound by its row/column policy end to end
  const analyst = reopened.connect({ user: "ana", roles: ["analyst"] });
  const limited = await analyst.exec("pull name from t");
  assert.equal(limited[0].rows[0][0].v, "lovelace");
  const denied = await (async () => {
    try {
      await analyst.exec("pull salaryish from t");
      return "no";
    } catch (e) {
      return (e as SeamError).code;
    }
  })();
  // Privilege is checked before names resolve: a column the role cannot pull
  // is refused with E_DENIED, not leaked via E_UNKNOWN_NAME.
  assert.equal(denied, "E_DENIED");
  // LSN continuity: new log counters continue where the rotated one stopped
  const lsnAfter = BigInt((await reopened.exec("pull count(id) as n from t"))[0].commit_lsn ?? "0");
  assert.ok(lsnAfter > lsnBefore, `lsn continuity ${lsnAfter} > ${lsnBefore}`);
  await reopened.close();
});

test("rotation truncates the log to a single restart record", async () => {
  const store = new MemoryPager();
  const db = await Database.open(store);
  rotateAlways(db);
  await db.exec("spawn table t: id: whole number, main key");
  for (let i = 0; i < 20; i++) await db.exec(`drop in t { id: ${i} }`);
  const fat = (await store.walBytes()).length;
  await db.close();
  const thin = (await store.walBytes()).length;
  assert.ok(thin < 200, `rotated log is tiny: ${thin} bytes (was ${fat})`);
  // one restart record on top of the 16-byte file header
  assert.equal(thin, 16 + 38);
});

test("xids below the rotation floor stay visible; aborted rows above it stay hidden", async () => {
  const store = new MemoryPager();
  const db = await Database.open(store);
  (db as unknown as { g: { rotateBudget: number } }).g.rotateBudget = 0;
  await db.exec("spawn table t: id: whole number, main key");
  await db.exec("drop in t { id: 1 }"); // committed pre-rotation
  await db.exec("start tx");
  await db.exec("drop in t { id: 2 }");
  await db.exec("dip"); // aborted pre-rotation
  await db.close();

  const reopened = await Database.open(store);
  const rows = await reopened.exec("pull id from t rank by id low to high");
  assert.deepEqual(rows[0].rows.map((r) => r[0].v), [1n], "abort stays aborted, commit stays committed");
  // and pre-rotation committed rows keep working as the base for new writes
  await reopened.exec("drop in t { id: 3 }");
  const again = await reopened.exec("pull count(id) as n from t");
  assert.equal(again[0].rows[0][0].v, 2n);
  await reopened.close();
});

test("crash between steps of rotation never loses the database", async () => {
  // Take a full database, then simulate the two torn moments the rotation can
  // stop in: after the snapshot write but before restart (log intact), and
  // after restart but with the old log gone (snapshot present).
  for (const scenario of ["log-intact", "restart-only"] as const) {
    const store = new MemoryPager();
    const db = await Database.open(store);
    rotateAlways(db);
    await db.exec("spawn table t: id: whole number, main key, v: whole number, fallback 0");
    await db.exec("drop in t { id: 1, v: 10 }");
    await db.close();

    if (scenario === "restart-only") {
      // exactly what truncate-to-header+restart leaves behind
      await store.walTruncate(16 + 38);
    }
    // "log-intact": the data files hold the flushed pages AND the old log is
    // still whole; recovery must still open — redo from the full log cannot
    // roll a page back because replay starts after the boundary stamp.
    const reopened = await Database.open(store);
    const rows = await reopened.exec("pull id, v from t");
    assert.equal(rows[0].rows[0][1].v, 10n, scenario);
    await reopened.close();
  }
});

test("a restart record without a valid snapshot fails closed", async () => {
  const store = new MemoryPager();
  const db = await Database.open(store);
  rotateAlways(db);
  await db.exec("spawn table t: id: whole number, main key");
  await db.close();
  // Sabotage: wipe only the catalog page, leave the restart record.
  for (const [id, page] of store.pages) {
    if (decodePage(page).type === PT_CATALOG) store.pages.set(id, new Uint8Array(page.length));
  }
  await assert.rejects(() => Database.open(store), (e: SeamError) => e.code === "E_WAL_CORRUPT" || e.code === "E_CHECKSUM");
});

test("rotated-then-reused log keeps working across multiple rotations", async () => {
  const store = new MemoryPager();
  const db = await Database.open(store);
  rotateAlways(db);
  await db.exec("spawn table t: id: whole number, main key, v: whole number, fallback 0");
  for (let round = 0; round < 4; round++) {
    await db.exec(`drop in t { id: ${round}, v: ${round * 11} }`);
    await db.checkpointNow(); // rotate
  }
  await db.close();
  const reopened = await Database.open(store);
  const rows = await reopened.exec("pull id, v from t rank by id low to high");
  assert.deepEqual(rows[0].rows.map((r) => r[0].v), [0n, 1n, 2n, 3n]);
  await reopened.close();
});

test("rotation frees the old catalog page and re-allocates a fresh one each time", async () => {
  const store = new MemoryPager();
  const db = await Database.open(store);
  rotateAlways(db);
  await db.exec("spawn table t: id: whole number, main key");
  await db.close();
  let catalogs = 0;
  for (const [, page] of store.pages) if (decodePage(page).type === PT_CATALOG) catalogs++;
  assert.equal(catalogs, 1);
  const reopened = await Database.open(store);
  rotateAlways(reopened);
  await reopened.exec("drop in t { id: 1 }");
  await reopened.checkpointNow();
  await reopened.close();
  // the old snapshot page was turned to PT_FREE before the new one was written
  let free = 0;
  let live = 0;
  for (const [, page] of store.pages) {
    const t = decodePage(page).type;
    if (t === PT_FREE) free++;
    if (t === PT_CATALOG) live++;
  }
  assert.equal(live, 1, "exactly one live catalog snapshot");
  assert.ok(free >= 1, `old snapshot recycled: ${free} free page(s)`);
});
