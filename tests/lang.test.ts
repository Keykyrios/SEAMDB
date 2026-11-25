import assert from "node:assert/strict";
import { test } from "node:test";
import { Database, type Identity, type QueryResult } from "../src/db/engine";
import { MemoryPager } from "../src/db/pager";
import type { SeamValue } from "../src/db/values";

const OWNER: Identity = { user: "root", roles: ["owner"] };

async function open(identity: Identity = OWNER): Promise<Database> {
  const db = await Database.open(new MemoryPager(), { identity });
  await db.exec(`spawn table customers:
    customer_id: whole number, main key,
    name: text, needed,
    region: text, fallback 'west'
`);
  await db.exec(`spawn table orders:
    order_id: whole number, main key,
    customer_id: whole number, needed, links to customers.customer_id,
    total: decimal(12, 2), needed, at least 0,
    status: text, fallback 'new'
`);
  await db.exec(`spawn table items:
    item_id: whole number, main key,
    order_id: whole number, needed, links to orders.order_id,
    price: decimal(8, 2), needed
`);
  for (const [cid, name, region] of [
    [1, "Ada", "west"],
    [2, "Grace", "east"],
    [3, "Linus", "east"],
  ] as [number, string, string][]) {
    await db.exec(`drop in customers { customer_id: ${cid}, name: '${name}', region: '${region}' }`);
  }
  for (const [oid, cid, total, status] of [
    [1, 1, 250.0, "complete"],
    [2, 2, 99.99, "new"],
    [3, 3, 149.5, "shipped"],
    [4, 1, 10.0, "new"],
  ] as [number, number, string, string][]) {
    await db.exec(`drop in orders { order_id: ${oid}, customer_id: ${cid}, total: ${total}, status: '${status}' }`);
  }
  for (const [iid, oid, price] of [
    [1, 1, 100.0],
    [2, 1, 150.0],
    [3, 2, 99.99],
    [4, 3, 80.0],
    [5, 3, 69.5],
  ] as [number, number, number][]) {
    await db.exec(`drop in items { item_id: ${iid}, order_id: ${oid}, price: ${price} }`);
  }
  return db;
}

function cell(r: QueryResult, row: number, name: string): SeamValue {
  const i = r.columns.indexOf(name);
  assert.ok(i >= 0, `column ${name} in [${r.columns.join(", ")}]`);
  return r.rows[row][i];
}

function nums(r: QueryResult, name: string): (bigint | number)[] {
  const i = r.columns.indexOf(name);
  return r.rows.map((row) => {
    const v = row[i];
    return v.t === "int" ? v.v : (v as { v: number }).v;
  });
}

test("bunch by with agg projections, stack (sum) and tally", async () => {
  const db = await open();
  const r = await db.exec(
    "pull customers.region, tally(*), stack(orders.total) from customers link orders on customers.customer_id = orders.customer_id bunch by customers.region",
  );
  const east = r[0].rows.find((row) => (row[r[0].columns.indexOf("region")] as { v: string }).v === "east");
  assert.ok(east);
  const tally = east[r[0].columns.indexOf("tally")] as { t: string; v: bigint };
  assert.equal(tally.v, 2n);
  await db.close();
});

test("having filters groups on a computed aggregate", async () => {
  const db = await open();
  const r = await db.exec(
    "pull customers.name, tally(*) as cnt from customers link orders on customers.customer_id = orders.customer_id bunch by customers.name having tally(*) > 1",
  );
  assert.equal(r[0].rows.length, 1);
  assert.equal((cell(r[0], 0, "name") as { v: string }).v, "Ada");
  assert.equal((cell(r[0], 0, "cnt") as { v: bigint }).v, 2n);
  await db.close();
});

test("having with case around an aggregate", async () => {
  const db = await open();
  const r = await db.exec(
    "pull customers.region from customers link orders on customers.customer_id = orders.customer_id bunch by customers.region having case when tally(*) >= 2 then yes else no end",
  );
  const regions = r[0].rows.map((row) => (row[0] as { v: string }).v).sort();
  assert.deepEqual(regions, ["east", "west"]);
  await db.close();
});

test("window: row_number, rank and running windows over one partition", async () => {
  const db = await open();
  const r = await db.exec(
    "pull order_id, row_number() over (partition by customer_id rank by total high to low) as rn from orders",
  );
  assert.equal(r[0].rows.length, 4);
  assert.equal((cell(r[0], 0, "rn") as { v: bigint }).v, 1n);
  const rankR = await db.exec(
    "pull order_id, rank() over (rank by total high to low) as rk from orders",
  );
  // totals 250, 149.5, 99.99, 10 => ranks 1,2,3,4 (all distinct)
  assert.deepEqual(nums(rankR[0], "rk").slice().sort((a, b) => Number(b) - Number(a)), [4n, 3n, 2n, 1n]);
  await db.close();
});

test("lead / lag walk the partition", async () => {
  const db = await open();
  const r = await db.exec(
    "pull order_id, lag(order_id) over (rank by order_id) as prev, lead(order_id) over (rank by order_id) as nxt from orders",
  );
  const rows = r[0].rows;
  assert.equal(rows.length, 4);
  const ci = r[0].columns.indexOf("prev");
  assert.deepEqual(
    rows.map((row) => (row[ci].t === "null" ? 0n : (row[ci] as { v: bigint }).v)),
    [0n, 1n, 2n, 3n],
  );
  const ci2 = r[0].columns.indexOf("nxt");
  assert.deepEqual(
    rows.map((row) => (row[ci2].t === "null" ? 0n : (row[ci2] as { v: bigint }).v)),
    [2n, 3n, 4n, 0n],
  );
  await db.close();
});

test("with (common table expressions) chain and reuse", async () => {
  const db = await open();
  const r = await db.exec(`
    with big as (pull order_id, total from orders when total > 100),
    north as (pull order_id from big when total > 140)
    pull order_id from north
  `);
  assert.deepEqual(nums(r[0], "order_id").sort(), [1n, 3n]);
  await db.close();
});

test("derived table in from clause", async () => {
  const db = await open();
  const r = await db.exec(`
    pull t.total from (pull order_id, total from orders when total > 100) as t
  `);
  assert.equal(r[0].rows.length, 2);
  await db.close();
});

test("create view, then pull from it; drop view removes it", async () => {
  const db = await open();
  await db.exec("create view big_orders as (pull order_id, total from orders when total >= 100)");
  const r = await db.exec("pull order_id from big_orders");
  assert.deepEqual(nums(r[0], "order_id").sort(), [1n, 3n]);
  await db.exec("drop view big_orders");
  assert.equal(
    await (async () => {
      try {
        await db.exec("pull order_id from big_orders");
        return false;
      } catch {
        return true;
      }
    })(),
    true,
  );
  await db.close();
});

test("union / union all / intersect / except", async () => {
  const db = await open();
  const west = "pull order_id from orders when customer_id = 1";
  const east = "pull order_id from orders when customer_id = 3";
  const dbl = "pull order_id from orders when customer_id = 1";
  const one = await db.exec(`${west} union ${east}`);
  assert.deepEqual(nums(one[0], "order_id").sort(), [1n, 3n, 4n]);
  const all = await db.exec(`${west} union all ${dbl}`);
  assert.equal(all[0].rows.length, 4); // duplicates kept
  const inter = await db.exec(`${west} intersect ${east}`);
  assert.equal(inter[0].rows.length, 0);
  const except = await db.exec(`${west} except ${east}`);
  assert.deepEqual(nums(except[0], "order_id").sort(), [1n, 4n]);
  await db.close();
});

test("scalar subquery inside a projection and a filter", async () => {
  const db = await open();
  const r = await db.exec(`
    pull name, (pull stack(total) from orders) as biggest from customers when name = 'Ada'
  `);
  assert.equal(String((cell(r[0], 0, "biggest") as { v: unknown }).v), "509.49");
  const r2 = await db.exec(`
    pull name from customers when customer_id = (pull customer_id from orders when order_id = 3)
  `);
  assert.equal(r2[0].rows.length, 1);
  assert.equal((cell(r2[0], 0, "name") as { v: string }).v, "Linus");
  await db.close();
});

test("exists and in (select …) with correlation", async () => {
  const db = await open();
  const r = await db.exec(`
    pull name from customers
    when exists (pull order_id from orders when orders.customer_id = customers.customer_id)
  `);
  assert.equal(r[0].rows.length, 3);
  const r2 = await db.exec(`
    pull name from customers
    when customer_id in (pull customer_id from orders when total > 200)
  `);
  const names = r2[0].rows.map((row) => (row[0] as { v: string }).v);
  assert.deepEqual(names, ["Ada"]);
  await db.close();
});

test("insert into .. select copies rows through checks and indexes", async () => {
  const db = await open();
  await db.exec("insert into items (item_id, order_id, price) (select item_id + 100, order_id, price from items when price < 100)");
  const r = await db.exec("pull tally(*) as total from items");
  assert.equal((cell(r[0], 0, "total") as { v: bigint }).v, 8n);
  // FK must hold even through insert-select (order_id 100 does not exist)
  assert.equal(
    await (async () => {
      try {
        await db.exec("insert into items (item_id, order_id, price) (select 999, 999, 5.0 from items cap 1)");
        return false;
      } catch {
        return true;
      }
    })(),
    true,
  );
  await db.close();
});

test("join kinds: inner, left, right, full, cross", async () => {
  const db = await open();
  const inner = await db.exec("pull customers.name, o.total from customers link orders as o on customers.customer_id = o.customer_id");
  assert.equal(inner[0].rows.length, 4);
  const left = await db.exec("pull customers.name as n, total from customers left link orders on customers.customer_id = orders.customer_id");
  assert.equal(left[0].rows.length, 4);
  const rights = await db.exec("pull customers.name, o.order_id from customers right link orders as o on customers.customer_id = o.customer_id");
  assert.equal(rights[0].rows.length, 4);
  const full = await db.exec("pull customers.name, o.order_id from customers full link orders as o on customers.customer_id = o.customer_id");
  assert.equal(full[0].rows.length, 4);
  const cross = await db.exec("pull customers.name, o.order_id from customers cross join orders as o");
  assert.equal(cross[0].rows.length, 12);
  await db.close();
});

test("distinct, cap and skip compose", async () => {
  const db = await open();
  const r = await db.exec("pull distinct region from customers");
  assert.equal(r[0].rows.length, 2);
  const pages = await db.exec("pull order_id from orders rank by order_id cap 2");
  assert.deepEqual(nums(pages[0], "order_id"), [1n, 2n]);
  const skip = await db.exec("pull order_id from orders rank by order_id cap 2 skip 2");
  assert.deepEqual(nums(skip[0], "order_id"), [3n, 4n]);
  await db.close();
});

test("SQL-skin aliases parse and run against the same engine", async () => {
  const db = await open();
  const r = await db.exec("select count(*) as cnt from orders where total >= 100");
  assert.equal((cell(r[0], 0, "cnt") as { v: bigint }).v, 2n);
  await db.close();
});

test("subquery cache never re-runs per row and nested views materialize", async () => {
  const db = await open();
  await db.exec("create view east_customers as (pull customer_id, name from customers when region = 'east')");
  const r = await db.exec(`
    pull name from east_customers
    when customer_id in (pull customer_id from orders when total > 100)
  `);
  const names = r[0].rows.map((row) => (row[0] as { v: string }).v);
  assert.deepEqual(names, ["Linus"]);
  await db.close();
});
