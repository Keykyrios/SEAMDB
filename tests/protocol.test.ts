import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_SIZE, utf8 } from "../src/db/codec";
import { Database } from "../src/db/engine";
import { MemoryPager } from "../src/db/pager";
import { MAX_FRAME, PROTO, ProtocolLoop, decodeFrame, encodeFrame, helloFrame } from "../src/db/protocol";

function json(frame: Uint8Array): Record<string, unknown> {
  const { payload } = decodeFrame(frame);
  return JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
}

function queryFrame(seamql: string, extra: Record<string, unknown> = {}): Uint8Array {
  return encodeFrame(3, utf8(JSON.stringify({ id: "q1", seamql, ...extra })));
}

async function freshLoop(mode: "development" | "production" = "development"): Promise<ProtocolLoop> {
  const db = await Database.open(new MemoryPager());
  await db.exec(`spawn table t: id: whole number, main key, v: whole number, fallback 0`);
  await db.exec(`drop in t { id: 1, v: 10 }`);
  return new ProtocolLoop(db, mode);
}

test("hello announces protocol, language, engine and page size", async () => {
  const loop = await freshLoop();
  const h = json(await loop.handle(encodeFrame(1, new Uint8Array(0))));
  assert.equal(h.proto, PROTO);
  assert.equal(h.page_size, PAGE_SIZE);
  assert.match(String(h.engine), /^seamdb-engine\//);
  assert.match(String(h.lang), /^seamql\//);
  await loop.db.close();
});

test("queries are refused before authentication", async () => {
  const loop = await freshLoop();
  const res = json(await loop.handle(queryFrame("pull id from t")));
  assert.equal(res.code, "E_DENIED");
  await loop.db.close();
});

test("authenticated queries execute and serialize typed results", async () => {
  const loop = await freshLoop();
  await loop.handle(encodeFrame(2, utf8(JSON.stringify({ user: "root", roles: ["owner"] }))));
  const res = json(await loop.handle(queryFrame("pull id, v from t")));
  assert.ok(Array.isArray(res.results));
  const first = (res.results as Array<Record<string, unknown>>)[0];
  assert.deepEqual(first.columns, ["id", "v"]);
  assert.deepEqual(first.rows, [["1", "10"]]);
  assert.equal(first.evidence_state, "none"); // reads never mint commit evidence
  await loop.db.close();
});

test("errors come back as typed error frames, never as crashes", async () => {
  const loop = await freshLoop();
  await loop.handle(encodeFrame(2, utf8(JSON.stringify({ user: "root", roles: ["owner"] }))));
  const res = json(await loop.handle(queryFrame("pull ghost from t")));
  assert.equal(res.code, "E_UNKNOWN_NAME");
  assert.match(String(res.message), /ghost/);
  const cancelled = json(await loop.handle(encodeFrame(6, new Uint8Array(0))));
  assert.equal(cancelled.cancelled, true);
  const unknown = json(await loop.handle(encodeFrame(4, new Uint8Array(0)))); // response type as request
  assert.equal(unknown.code, "E_FEATURE_NOT_SUPPORTED");
  const bad = json(await loop.handle(queryFrame("pull id from t", { timeout_ms: 0 })));
  assert.equal(bad.code, "E_LIMIT");
  await loop.db.close();
});

test("oversized and truncated frames are refused", () => {
  const huge = new Uint8Array(MAX_FRAME + 10);
  assert.throws(() => encodeFrame(3, huge), (e: unknown) => (e as { code?: string }).code === "E_LIMIT");
  const full = encodeFrame(3, utf8("a payload that gets cut off mid-flight"));
  const truncated = full.slice(0, full.length - 6);
  assert.throws(() => decodeFrame(truncated), (e: unknown) => (e as { code?: string }).code === "E_CORRUPT");
  const badLen = new Uint8Array(8);
  badLen[0] = 0x7f; // enormous declared length
  assert.throws(() => decodeFrame(badLen), (e: unknown) => (e as { code?: string }).code === "E_LIMIT");
});

test("idempotency keys dedupe successful work but not failures", async () => {
  const loop = await freshLoop();
  await loop.handle(encodeFrame(2, utf8(JSON.stringify({ user: "root", roles: ["owner"] }))));
  const ok1 = json(await loop.handle(queryFrame("drop in t { id: 5, v: 5 }", { idempotency_key: "k1" })));
  const ok2 = json(await loop.handle(queryFrame("drop in t { id: 5, v: 5 }", { idempotency_key: "k1" })));
  assert.equal((ok2 as Record<string, unknown>).duplicate, true);
  assert.ok(Array.isArray(ok1.results));
  // a failed attempt must not consume the key
  const failed = json(await loop.handle(queryFrame("pull ghost from t", { idempotency_key: "k2" })));
  assert.equal(failed.code, "E_UNKNOWN_NAME");
  const retried = json(await loop.handle(queryFrame("pull id from t", { idempotency_key: "k2" })));
  assert.ok(Array.isArray(retried.results), "retry after failure executes for real");
  await loop.db.close();
});

test("production mode refuses self-asserted owner elevation", async () => {
  const loop = await freshLoop("production");
  const res = json(await loop.handle(encodeFrame(2, utf8(JSON.stringify({ user: "mallory", roles: ["owner"] })))));
  assert.equal(res.code, "E_DENIED");
  // a plain role still authenticates
  const ok = json(await loop.handle(encodeFrame(2, utf8(JSON.stringify({ user: "analyst", roles: ["analyst"] })))));
  assert.equal(ok.authed, true);
  await loop.db.close();
});

test("cleartext TCP bind is refused in production", async () => {
  const loop = await freshLoop("production");
  assert.throws(
    () => loop.bindCleartextTcp(5432),
    (e: unknown) => (e as { code?: string }).code === "E_FEATURE_NOT_SUPPORTED",
  );
  await loop.db.close();
});

test("helloFrame matches the hello response shape", async () => {
  const direct = json(helloFrame());
  assert.equal(direct.proto, PROTO);
});
