import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { startServer } from "../src/server/tcp";
import { SeamDB } from "../src/client";

const IN_MEMORY = { dir: null as string | null, mode: "development" as const };

const servers: Array<{ close(): Promise<void> }> = [];
const clients: SeamDB[] = [];

afterEach(async () => {
  while (clients.length) await clients.pop()?.close();
  while (servers.length) await servers.pop()?.close();
});

async function spinUp(): Promise<{ port: number }> {
  const server = await startServer({ ...IN_MEMORY, port: 0 });
  servers.push(server);
  return { port: server.port };
}

async function seed(db: SeamDB): Promise<void> {
  await db.query(`spawn table customers:
    customer_id: whole number, main key,
    name: text, needed,
    region: text, fallback 'west'
`);
  await db.query(`drop in customers { customer_id: 1, name: 'Ada', region: 'west' }`);
  await db.query(`drop in customers { customer_id: 2, name: 'Grace', region: 'east' }`);
}

test("driver connects, auths and round-trips a query over TCP", async () => {
  const { port } = await spinUp();
  const db = await SeamDB.connect({ port, user: "root", roles: ["owner"] });
  clients.push(db);
  await seed(db);
  const res = await db.query("pull name, region from customers rank by customer_id");
  assert.equal(res.length, 1);
  assert.deepEqual(res[0].columns, ["name", "region"]);
  assert.equal(res[0].rows[0][0], "Ada");
  assert.equal(res[0].rows[1][1], "east");
  assert.ok(BigInt(res[0].xid) > 0n, "xid is a positive string");
});

test("driver surfaces server errors with code/line/column", async () => {
  const { port } = await spinUp();
  const db = await SeamDB.connect({ port, user: "root", roles: ["owner"] });
  clients.push(db);
  await seed(db);
  await assert.rejects(db.query("pull missing_col from customers"), (e: { code?: string }) => e.code === "E_UNKNOWN_NAME");
});

test("two client connections are isolated sessions", async () => {
  const { port } = await spinUp();
  const a = await SeamDB.connect({ port, user: "root", roles: ["owner"] });
  const b = await SeamDB.connect({ port, user: "mallory", roles: [] });
  clients.push(a, b);
  await seed(a);
  await assert.rejects(b.query("pull * from customers"), (e: { code?: string }) => e.code === "E_DENIED");
});

test("idempotency key suppresses a duplicate insert", async () => {
  const { port } = await spinUp();
  const db = await SeamDB.connect({ port, user: "root", roles: ["owner"] });
  clients.push(db);
  await seed(db);
  const key = "drop-once-1";
  await db.query(`drop in customers { customer_id: 7, name: 'Once' }`, { idempotencyKey: key });
  const again = await db.query(`drop in customers { customer_id: 7, name: 'Once' }`, { idempotencyKey: key });
  assert.equal(again.length, 0, "duplicate returns empty results");
  const r = await db.query("pull tally(*) as n from customers");
  assert.equal(r[0].rows[0][0], "3");
});
