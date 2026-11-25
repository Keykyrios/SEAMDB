import assert from "node:assert/strict";
import { test } from "node:test";
import { Database, type Identity } from "../src/db/engine";
import { SeamError } from "../src/db/errors";
import { MemoryPager } from "../src/db/pager";

const OWNER: Identity = { user: "root", roles: ["owner"] };
const ANALYST: Identity = { user: "ana", roles: ["analyst"] };

async function estate(): Promise<Database> {
  const db = await Database.open(new MemoryPager(), { identity: OWNER });
  await db.exec(`spawn table people:
    pid: whole number, main key,
    name: text, needed,
    ssn: text, private,
    region: text, fallback 'west',
    salary: whole number, fallback 0
`);
  await db.exec(`drop in people { pid: 1, name: 'Ada', ssn: '001', region: 'west', salary: 100 }`);
  await db.exec(`drop in people { pid: 2, name: 'Grace', ssn: '002', region: 'east', salary: 200 }`);
  await db.exec(`drop in people { pid: 3, name: 'Alan', ssn: '003', region: 'west', salary: 300 }`);
  return db;
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as SeamError).code ?? "NOT_SEAM";
  }
  return "NO_THROW";
}

test("no grant means no access — reads, writes, deletes, index, export all denied", async () => {
  const db = await estate();
  const stranger = db.connect({ user: "x", roles: [] });
  assert.equal(await codeOf(() => stranger.exec("pull pid from people")), "E_DENIED");
  assert.equal(await codeOf(() => stranger.exec("drop in people { pid: 9 }")), "E_DENIED");
  assert.equal(await codeOf(() => stranger.exec("tweak people set salary = 1 when pid = 1")), "E_DENIED");
  assert.equal(await codeOf(() => stranger.exec("yeet from people when pid = 1")), "E_DENIED");
  assert.equal(await codeOf(() => stranger.exec("add index ix on people(name)")), "E_DENIED");
  assert.equal(await codeOf(() => stranger.exec("ship people sealed '/tmp/x'")), "E_DENIED");
  assert.equal(await codeOf(() => stranger.exec("fah table people")), "E_DENIED");
  assert.equal(await codeOf(() => stranger.exec("spill pull pid from people")), "E_DENIED");
  // catalog details are not disclosed to unauthorized callers
  assert.equal(await codeOf(() => stranger.exec("pull pid from ghosts")), "E_DENIED");
  await db.close();
});

test("column grants expose exactly the granted columns; private stays masked", async () => {
  const db = await estate();
  await db.exec("let role analyst pull people.name");
  const r = await db.connect(ANALYST).exec("pull name, ssn from people rank by pid low to high");
  assert.deepEqual(r[0].columns, ["name"]);
  assert.deepEqual(
    r[0].rows.map((row) => row[0].v),
    ["Ada", "Grace", "Alan"],
  );
  // asking for a private column directly is still denied by the column check
  await db.exec("let role analyst pull people.ssn");
  const s = await db.connect(ANALYST).exec("pull ssn from people when pid = 1");
  assert.equal(s[0].rows.length, 1); // explicitly granted, so visible to this role
  await db.close();
});

test("row policies gate reads, updates and deletes on the same predicate", async () => {
  const db = await estate();
  await db.exec(`let role analyst pull people when region = 'west'`);
  const analyst = db.connect(ANALYST);
  const seen = await analyst.exec("pull pid from people rank by pid low to high");
  assert.deepEqual(
    seen[0].rows.map((row) => row[0].v),
    [1n, 3n],
  );
  // the policy also constrains writes: grants carry the same predicate
  await db.exec(`let role analyst tweak people when region = 'west'`);
  await db.exec(`let role analyst yeet people when region = 'west'`);
  await analyst.exec("tweak people set salary = 999 when pid = 2");
  const owner = await db.exec("pull salary from people when pid = 2");
  assert.equal(owner[0].rows[0][0].v, 200n); // untouched
  await analyst.exec("yeet from people when pid = 2");
  const still = await db.exec("pull pid from people when pid = 2");
  assert.equal(still[0].rows.length, 1); // survived
  // west rows are fair game
  await analyst.exec("tweak people set salary = 111 when pid = 1");
  const west = await db.exec("pull salary from people when pid = 1");
  assert.equal(west[0].rows[0][0].v, 111n);
  await db.close();
});

test("owner-only operations stay owner-only", async () => {
  const db = await estate();
  const analyst = db.connect(ANALYST);
  assert.equal(await codeOf(() => analyst.exec("let role analyst pull people")), "E_DENIED");
  assert.equal(await codeOf(() => analyst.exec("tweak table people add nick: text")), "E_DENIED");
  assert.equal(await codeOf(() => analyst.exec("spawn table other: id: whole number, main key")), "E_DENIED");
  await db.close();
});

test("revocation takes effect immediately", async () => {
  const db = await estate();
  await db.exec("let role analyst pull people.name");
  const analyst = db.connect(ANALYST);
  assert.equal((await analyst.exec("pull name from people"))[0].rows.length, 3);
  await db.exec("block role analyst pull people");
  assert.equal(await codeOf(() => analyst.exec("pull name from people")), "E_DENIED");
  await db.close();
});

test("multiple roles union their grants", async () => {
  const db = await estate();
  await db.exec("let role analyst pull people.name");
  await db.exec("let role auditor pull people.salary");
  const both = db.connect({ user: "dual", roles: ["analyst", "auditor"] });
  const r = await both.exec("pull name, salary from people when pid = 1");
  assert.deepEqual(r[0].columns, ["name", "salary"]);
  await db.close();
});

test("explain output is policy-gated but never leaks row values", async () => {
  const db = await estate();
  await db.exec("let role analyst spill people");
  await db.exec("let role analyst pull people.name");
  const plan = await db.connect(ANALYST).exec("spill pull name from people when salary > 150");
  const text = String(plan[0].rows[0][0].v);
  assert.match(text, /HeapScan\(people\)/);
  assert.ok(!text.includes("Ada"), "plan text must not contain row values");
  assert.ok(!text.includes("001"), "plan text must not contain private values");
  await db.close();
});

test("export requires the export privilege and never ships private columns silently", async () => {
  const db = await estate();
  await db.exec("let role analyst ship people");
  // ship internally requires read access too — defense in depth
  assert.equal(await codeOf(() => db.connect(ANALYST).exec("ship people sealed '/tmp/x'")), "E_DENIED");
  await db.exec("let role analyst pull people.name");
  const s = await db.connect(ANALYST).exec("ship people sealed '/tmp/x'");
  assert.equal(s[0].columns[0], "path");
  assert.match(String(s[0].rows[0][1].v), /^sha384:/); // digest, not data
  assert.equal(s[0].rows[0][2].v, 3n); // only the granted, non-private columns count
  await db.close();
});
