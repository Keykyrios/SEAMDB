import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startServer } from "../src/server/tcp";
import { SeamDB } from "../src/client";

const run = promisify(execFile);

test("python driver round-trips a query over the native protocol", { skip: process.platform === "win32" && false ? "n/a" : false }, async () => {
  const server = await startServer({ dir: null, mode: "development", port: 0 });
  try {
    const seed = await SeamDB.connect({ port: server.port, user: "root", roles: ["owner"] });
    await seed.query(`spawn table t1:\n  k: whole number, main key,\n  label: text, needed\n`);
    await seed.query(`drop in t1 { k: 1, label: 'Ada' }`);
    await seed.query(`drop in t1 { k: 2, label: 'Grace' }`);
    await seed.close();

    const script = `
import sys
sys.path.insert(0, "drivers/python")
import seamdb
db = seamdb.connect(port=${server.port}, user="root", roles=["owner"])
res = db.query("pull label from t1 rank by k low to high")
assert res[0].columns == ["label"], res[0].columns
rows = res[0].rows
assert rows[0]["label"] == "Ada", rows
assert rows[1]["label"] == "Grace", rows
try:
    db.query("pull nope from t1")
    raise SystemExit("expected error")
except seamdb.SeamError as e:
    assert e.code == "E_UNKNOWN_NAME", e.code
db.close()
print("PY_OK")
`;
    const a = await run("python", ["-c", script], { timeout: 60_000, maxBuffer: 10_000_000 });
    assert.ok(a.stdout.includes("PY_OK"), `stdout: ${a.stdout}\nstderr: ${a.stderr}`);
  } finally {
    await server.close();
  }
});
