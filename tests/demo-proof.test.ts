import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../src/db/engine";
import { MemoryPager } from "../src/db/pager";
import { LC183_SEAMQL } from "../src/ui/snippets";

/**
 * The landing page ("Proof by problem") publishes LC183_SEAMQL and claims the
 * engine answers it with `customers = Grace, Linus`. This test executes the
 * exact exported constant, so the marketing copy cannot drift from the engine.
 */
test("the LeetCode 183 landing-page script runs and returns the documented rows", async () => {
  const db = await Database.open(new MemoryPager());
  const out = await db.exec(LC183_SEAMQL);
  const names = out[out.length - 1].rows.map((r) => r[0].v);
  assert.deepEqual(names, ["Grace", "Linus"]);
  await db.close();
});

test("the proof-section claims hold: index plan, unique main key, FK", async () => {
  const db = await Database.open(new MemoryPager());
  await db.exec(LC183_SEAMQL);

  // Index claim: an equality probe on the indexed column prints IndexPoint.
  await db.exec("add index ix_name on folks(name)");
  const spill = await db.exec("spill pull id from folks when name = 'Ada'");
  assert.match(String(spill[0].rows[0][0].v), /IndexPoint\(folks\.ix_name\)/);

  // Main-key claim: re-inserting id 1 is refused by storage.
  const dup = await db
    .exec("drop in folks { id: 1, name: 'Ada2' }")
    .then(() => "NO_THROW")
    .catch((e: { code?: string }) => e.code ?? "NOT_SEAM");
  assert.equal(dup, "E_UNIQUE");

  // FK claim: a run pointing at a missing customer is refused.
  const fk = await db
    .exec("drop in runs { rid: 9, folks_id: 404, amount: 1.00 }")
    .then(() => "NO_THROW")
    .catch((e: { code?: string }) => e.code ?? "NOT_SEAM");
  assert.equal(fk, "E_FK");
  await db.close();
});
