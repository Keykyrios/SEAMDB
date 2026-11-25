import assert from "node:assert/strict";
import { test } from "node:test";

test("runner executes typescript tests", () => {
  const n: number = 1 + 1;
  assert.equal(n, 2);
});
