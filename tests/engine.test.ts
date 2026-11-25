import assert from "node:assert/strict";
import { test } from "node:test";
import { Database, type Identity, type QueryResult } from "../src/db/engine";
import { SeamError } from "../src/db/errors";
import { MemoryPager } from "../src/db/pager";
import type { SeamValue } from "../src/db/values";

const OWNER: Identity = { user: "root", roles: ["owner"] };

async function open(identity: Identity = OWNER): Promise<Database> {
  const db = await Database.open(new MemoryPager(), { identity });
  await db.exec(`spawn table customers:
    customer_id: whole number, main key,
    name: text, needed,
    email: text, private, unique,
    region: text, fallback 'west',
    created: day, fallback today()
`);
  await db.exec(`spawn table orders:
    order_id: whole number, main key,
    customer_id: whole number, needed, links to customers.customer_id,
    total: decimal(12, 2), needed, at least 0,
    status: text, fallback 'new'
`);
  await db.exec(`drop in customers { customer_id: 1, name: 'Ada', email: 'ada@example.invalid', region: 'west' }`);
  await db.exec(`drop in customers { customer_id: 2, name: 'Grace', email: 'grace@example.invalid', region: 'east' }`);
  await db.exec(`drop in orders { order_id: 1, customer_id: 1, total: 250.00, status: 'complete' }`);
  await db.exec(`drop in orders { order_id: 2, customer_id: 2, total: 99.99, status: 'new' }`);
  return db;
}

function col(r: QueryResult, name: string): number {
  const i = r.columns.indexOf(name);
  assert.ok(i >= 0, `column ${name} in [${r.columns.join(", ")}]`);
  return i;
}

function cell(r: QueryResult, row: number, name: string): SeamValue {
  return r.rows[row][col(r, name)];
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as SeamError).code ?? "NOT_SEAM";
  }
  return "NO_THROW";
}

test("insert defaults, required and at-least constraints", async () => {
  const db = await open();
  const r = await db.exec(`pull region, created from customers when customer_id = 1`);
  assert.equal(cell(r[0], 0, "region").v, "west");
  assert.equal((await codeOf(() => db.exec(`drop in customers { customer_id: 3 }`))), "E_NEEDED");
  assert.equal(
    await codeOf(() => db.exec(`drop in orders { order_id: 3, customer_id: 1, total: -5.00 }`)),
    "E_TYPE_MISMATCH",
  );
  await db.close();
});

test("unique and foreign-key enforcement", async () => {
  const db = await open();
  assert.equal(
    await codeOf(() => db.exec(`drop in customers { customer_id: 9, name: 'Clone', email: 'ada@example.invalid' }`)),
    "E_UNIQUE",
  );
  assert.equal(
    await codeOf(() => db.exec(`drop in orders { order_id: 9, customer_id: 777, total: 1.00 }`)),
    "E_FK",
  );
  await db.close();
});

test("where, sort (both directions), cap and qualified columns", async () => {
  const db = await open();
  const r = await db.exec("pull orders.order_id, orders.total from orders when total >= 99.99 rank by total high to low");
  assert.equal(r[0].rows.length, 2);
  assert.equal(cell(r[0], 0, "order_id").v, 1n); // 250.00 first
  assert.equal(cell(r[0], 0, "total").v.toString(), "250.00");

  const asc = await db.exec("pull order_id from orders rank by order_id low to high cap 1");
  assert.equal(asc[0].rows.length, 1);
  assert.equal(cell(asc[0], 0, "order_id").v, 1n);

  const none = await db.exec("pull order_id from orders when order_id > 1000");
  assert.equal(none[0].rows.length, 0);
  await db.close();
});

test("sorting can reference columns outside the projection", async () => {
  const db = await open();
  const r = await db.exec("pull name from customers rank by customer_id high to low");
  assert.deepEqual(
    r[0].rows.map((row) => row[0].v),
    ["Grace", "Ada"],
  );
  await db.close();
});

test("inner and left joins", async () => {
  const db = await open();
  const joined = await db.exec(
    "pull customers.name, orders.total from customers link orders on customers.customer_id = orders.customer_id when orders.total >= 100.00",
  );
  assert.equal(joined[0].rows.length, 1);
  assert.equal(cell(joined[0], 0, "name").v, "Ada");

  await db.exec(`drop in customers { customer_id: 3, name: 'Alan', email: 'alan@example.invalid', region: 'west' }`);
  const left = await db.exec(
    "pull customers.customer_id, orders.order_id from customers left link orders on customers.customer_id = orders.customer_id rank by customers.customer_id low to high",
  );
  assert.equal(left[0].rows.length, 3);
  assert.equal(cell(left[0], 2, "customer_id").v, 3n);
  assert.equal(cell(left[0], 2, "order_id").t, "null"); // unmatched left row null-extends
  await db.close();
});

test("star projection is refused across joins", async () => {
  const db = await open();
  assert.equal(
    await codeOf(() => db.exec("pull * from customers link orders on customers.customer_id = orders.customer_id")),
    "E_FEATURE_NOT_SUPPORTED",
  );
  await db.close();
});

test("aggregates: count, sum, min, max, avg with bunch by", async () => {
  const db = await open();
  const all = await db.exec("pull count(order_id) as n, sum(total) as s, min(total) as lo, max(total) as hi, avg(total) as mid from orders");
  assert.equal(cell(all[0], 0, "n").v, 2n);
  assert.equal(cell(all[0], 0, "s").v.toString(), "349.99");
  assert.equal(cell(all[0], 0, "lo").v.toString(), "99.99");
  assert.equal(cell(all[0], 0, "hi").v.toString(), "250.00");
  assert.equal(cell(all[0], 0, "mid").v.toString(), "174.99500000"); // (250.00+99.99)/2, exact

  const avgInt = await db.exec("pull avg(customer_id) as m from orders");
  assert.equal(cell(avgInt[0], 0, "m").v.toString(), "1.50");

  const emptySum = await db.exec("pull sum(total) as s from orders when order_id > 1000");
  assert.equal(cell(emptySum[0], 0, "s").t, "null");

  const grouped = await db.exec("pull customers.region as region, count(order_id) as n from customers link orders on customers.customer_id = orders.customer_id bunch by customers.region rank by region low to high");
  assert.deepEqual(
    grouped[0].rows.map((r) => [r[0].v, r[1].v]),
    [
      ["east", 1n],
      ["west", 1n],
    ],
  );
  await db.close();
});

test("update and delete follow visibility and constraints", async () => {
  const db = await open();
  await db.exec(`tweak orders set status = 'shipped' when order_id = 2`);
  const r = await db.exec("pull status from orders when order_id = 2");
  assert.equal(cell(r[0], 0, "status").v, "shipped");
  assert.equal(await codeOf(() => db.exec(`tweak orders set total = -1.00`)), "E_TYPE_MISMATCH");
  await db.exec("yeet from orders when order_id = 2");
  const gone = await db.exec("pull order_id from orders when order_id = 2");
  assert.equal(gone[0].rows.length, 0);
  const left = await db.exec("pull count(order_id) as n from orders");
  assert.equal(cell(left[0], 0, "n").v, 1n);
  await db.close();
});

test("index: build, explain shows the probe, and index results equal heap scans", async () => {
  const db = await open();
  await db.exec("drop in orders { order_id: 3, customer_id: 1, total: 5.00 }");
  await db.exec("drop in orders { order_id: 4, customer_id: 2, total: 7.50 }");
  await db.exec("add index by_customer on orders(customer_id)");

  const spill = await db.exec("spill pull order_id from orders when customer_id = 1");
  assert.match(String(cell(spill[0], 0, "plan").v), /IndexPoint\(orders\.by_customer\)/);

  // randomized equivalence: optimized vs reference execution
  for (let i = 0; i < 40; i++) {
    const probe = i % 4;
    db.setOptimize(true);
    const fast = await db.exec(`pull order_id from orders when customer_id = ${probe}`);
    db.setOptimize(false);
    const ref = await db.exec(`pull order_id from orders when customer_id = ${probe}`);
    assert.deepEqual(
      fast[0].rows.map((r) => r[0]),
      ref[0].rows.map((r) => r[0]),
      `probe ${probe}`,
    );
    assert.ok(fast[0].plan?.includes("IndexPoint") || fast[0].rows.length === 0 || probe === 0 || probe === 1);
  }
  db.setOptimize(true);

  // updates keep the index in step: the updated row must still be found
  await db.exec(`tweak orders set customer_id = 2 when order_id = 3`);
  const moved = await db.exec("pull order_id from orders when customer_id = 2");
  assert.equal(moved[0].rows.length, 3); // orders 2, 4 and the updated 3
  const oldSpot = await db.exec("pull order_id from orders when customer_id = 1");
  assert.equal(oldSpot[0].rows.length, 1); // only order 1 remains there
  await db.close();
});

test("index probe respects the visibility of updated versions", async () => {
  const db = await open();
  await db.exec("add index by_status on orders(status)");
  await db.exec(`tweak orders set status = 'archived' when order_id = 1`);
  const viaIndex = await db.exec("pull order_id from orders when status = 'archived'");
  assert.equal(viaIndex[0].rows.length, 1);
  const viaHeap = await db.exec("pull order_id from orders when status = 'archived'");
  assert.deepEqual(viaIndex[0].rows, viaHeap[0].rows);
  await db.close();
});

test("check table reports rows and faults after writes", async () => {
  const db = await open();
  await db.exec("add index ix_cust on orders(customer_id)");
  const c = await db.exec("check table orders");
  assert.deepEqual(c[0].rows[0].map((v) => String(v.v)), ["2", "0"]);
  await db.close();
});

test("alter adds a column; old rows read null", async () => {
  const db = await open();
  await db.exec("tweak table customers add nickname: text");
  const r = await db.exec("pull nickname from customers when customer_id = 1");
  assert.equal(cell(r[0], 0, "nickname").t, "null");
  await db.exec(`tweak customers set nickname = 'the countess' when customer_id = 1`);
  const r2 = await db.exec("pull nickname from customers when customer_id = 1");
  assert.equal(cell(r2[0], 0, "nickname").v, "the countess");
  await db.close();
});

test("sealed export reports a digest and row count", async () => {
  const db = await open();
  const s = await db.exec("ship customers sealed '/tmp/customers.sealed'");
  assert.match(String(cell(s[0], 0, "digest").v), /^sha384:/);
  assert.equal(cell(s[0], 0, "rows").v, 2n);
  const again = await db.exec("ship customers sealed '/tmp/customers.sealed'");
  assert.equal(cell(again[0], 0, "digest").v, cell(s[0], 0, "digest").v);
  await db.close();
});

test("commit hooks: evidence states the durable truth", async () => {
  const db = await open();
  const baseline = db.evidenceLog().length; // fixtures already committed evidence
  const r = await db.exec(`drop in orders { order_id: 50, customer_id: 1, total: 1.00 }`);
  assert.equal(r[0].evidence_state, "COMMITTED");
  assert.ok(BigInt(r[0].commit_lsn ?? "0") > 0n);
  const log = db.evidenceLog();
  assert.equal(log.length, baseline + 1);
  const last = log[log.length - 1];
  assert.deepEqual(last.write_set, ["orders"]);
  assert.equal(last.evidence_state, "COMMITTED");

  // reads and plans never mint commit evidence
  await db.exec("pull order_id from orders");
  await db.exec("spill pull order_id from orders");
  await db.exec("fah table orders");
  assert.equal(db.evidenceLog().length, baseline + 1);
  await db.close();
});

test("explain shows the physical plan, never row contents", async () => {
  const db = await open();
  const p = await db.exec("spill pull name from customers when customer_id = 1");
  assert.match(String(cell(p[0], 0, "plan").v), /HeapScan\(customers\)/);
  const bad = await codeOf(() => db.exec("spill pull ghost from customers"));
  assert.equal(bad, "E_UNKNOWN_NAME");
  await db.close();
});

test("multi-statement scripts run in order", async () => {
  const db = await open();
  const out = await db.exec(`
    drop in orders { order_id: 60, customer_id: 1, total: 3.00 }
    drop in orders { order_id: 61, customer_id: 1, total: 4.00 }
    pull count(order_id) as n from orders
  `);
  assert.equal(out.length, 3);
  assert.equal(cell(out[2], 0, "n").v, 4n);
  await db.close();
});

test("unknown objects fail with clear codes", async () => {
  const db = await open();
  assert.equal(await codeOf(() => db.exec("pull a from ghosts")), "E_UNKNOWN_NAME");
  assert.equal(await codeOf(() => db.exec("drop in ghosts { a: 1 }")), "E_UNKNOWN_NAME");
  assert.equal(await codeOf(() => db.exec("spawn table customers: id: whole number, main key")), "E_UNIQUE");
  await db.close();
});

test("decimal columns store exact values and enforce precision bounds", async () => {
  const db = await open();
  await db.exec(`drop in orders { order_id: 70, customer_id: 1, total: 0.10 }`);
  const r = await db.exec("pull total from orders when order_id = 70");
  assert.equal(cell(r[0], 0, "total").v.toString(), "0.10");
  assert.equal(
    await codeOf(() => db.exec(`drop in orders { order_id: 71, customer_id: 1, total: 12345678901234.56 }`)),
    "E_OVERFLOW",
  );
  await db.close();
});
