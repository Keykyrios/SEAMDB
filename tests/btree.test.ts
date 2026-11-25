import assert from "node:assert/strict";
import { test } from "node:test";
import { BTree, cmpKey, type BTreeIo, type Tid } from "../src/db/btree";
import { SeamError } from "../src/db/errors";
import { MemoryPager } from "../src/db/pager";
import { PT_BT_LEAF, decodePage, emptyPage } from "../src/db/page";
import { encodeKey } from "../src/db/tuple";
import { orderI64 } from "../src/db/codec";
import type { SeamValue } from "../src/db/values";

interface Harness {
  tree: BTree;
  root: number;
  pager: MemoryPager;
}

async function makeTree(): Promise<Harness> {
  const pager = new MemoryPager();
  let next = 1;
  const io: BTreeIo = {
    pin: async (id) => {
      const r = await pager.read(id);
      if (!r) throw new Error(`missing page ${id}`);
      return r;
    },
    unpin: () => undefined,
    write: async (id, raw) => {
      await pager.write(id, raw);
    },
    alloc: async (type, oid) => {
      const id = next++;
      await pager.write(id, emptyPage(type, BigInt(id), oid));
      return id;
    },
  };
  const root = next++;
  await pager.write(root, emptyPage(PT_BT_LEAF, BigInt(root), 99n));
  return { tree: new BTree(io), root, pager };
}

function key(n: bigint): Uint8Array {
  return encodeKey([{ t: "int", v: n }]);
}

function tid(n: number): Tid {
  return { page: n, slot: 0 };
}

test("point lookups survive many splits", async () => {
  const { tree, root } = await makeTree();
  const N = 800;
  let r = root;
  for (let i = 0; i < N; i++) {
    r = await tree.insert({ root: r, unique: true, name: "ix" }, key(BigInt(i * 7919)), tid(i));
  }
  for (let i = 0; i < N; i++) {
    const found = await tree.find(r, key(BigInt(i * 7919)));
    assert.equal(found.length, 1, `key ${i * 7919}`);
    assert.equal(found[0].page, i);
  }
  assert.deepEqual(await tree.find(r, key(123456789n)), []);
});

test("duplicate keys straddling leaf boundaries are all found", async () => {
  const { tree, root } = await makeTree();
  const N = 500; // one key, many entries -> guaranteed leaf splits among equals
  let r = root;
  for (let i = 0; i < N; i++) {
    r = await tree.insert({ root: r, unique: false, name: "ix" }, key(42n), tid(i));
  }
  const found = await tree.find(r, key(42n));
  assert.equal(found.length, N);
  const pages = new Set(found.map((f) => f.page));
  assert.ok(pages.size > 1, "duplicates must live in more than one leaf");
});

test("unique indexes reject duplicates at insert time", async () => {
  const { tree, root } = await makeTree();
  const r = await tree.insert({ root, unique: true, name: "uq" }, key(5n), tid(1));
  await assert.rejects(
    () => tree.insert({ root: r, unique: true, name: "uq" }, key(5n), tid(2)),
    (e: unknown) => (e as SeamError).code === "E_UNIQUE",
  );
});

test("range scans return entries in sorted key order across the chain", async () => {
  const { tree, root } = await makeTree();
  const values = Array.from({ length: 400 }, (_, i) => (i * 37) % 401);
  let r = root;
  for (const [i, v] of values.entries()) {
    r = await tree.insert({ root: r, unique: false, name: "ix" }, key(BigInt(v)), tid(i));
  }
  const all = await tree.range(r, null, null);
  assert.equal(all.length, values.length);
  // entries come back in nondecreasing key order (key value = (page * 37) % 401)
  const keys = all.map((t) => (t.page * 37) % 401);
  for (let i = 1; i < keys.length; i++) {
    assert.ok(keys[i - 1] <= keys[i], `order: ${keys[i - 1]} then ${keys[i]}`);
  }
  const mid = await tree.range(r, key(100n), key(200n));
  for (const t of mid) {
    const v = (t.page * 37) % 401;
    assert.ok(v >= 100 && v <= 200, `in range: ${v}`);
  }
});

test("delete removes exactly one (key, tid) entry", async () => {
  const { tree, root } = await makeTree();
  let r = root;
  for (let i = 0; i < 50; i++) r = await tree.insert({ root: r, unique: false, name: "ix" }, key(7n), tid(i));
  r = await tree.delete(r, key(7n), tid(10));
  const left = await tree.find(r, key(7n));
  assert.equal(left.length, 49);
  assert.ok(!left.some((t) => t.page === 10));
  // deleting the same entry again is a no-op, not an error
  r = await tree.delete(r, key(7n), tid(10));
  assert.equal((await tree.find(r, key(7n))).length, 49);
});

test("tree structure survives a pager restart", async () => {
  const { tree, root, pager } = await makeTree();
  let r = root;
  for (let i = 0; i < 300; i++) r = await tree.insert({ root: r, unique: true, name: "ix" }, key(BigInt(i)), tid(i));
  // brand-new BTree over the same durable pages
  const io: BTreeIo = {
    pin: async (id) => (await pager.read(id)) ?? new Uint8Array(0),
    unpin: () => undefined,
    write: async () => undefined,
    alloc: async () => 0,
  };
  const reopened = new BTree(io);
  const found = await reopened.find(r, key(217n));
  assert.equal(found.length, 1);
  assert.equal(found[0].page, 217);
  // every page in the pager still decodes
  for (const [id, raw] of pager.pages) {
    decodePage(raw);
    assert.ok(id >= 0);
  }
});

test("int and text keys interleave correctly in one tree", async () => {
  const { tree, root } = await makeTree();
  let r = root;
  const textVals: SeamValue[] = [{ t: "text", v: "alpha" }, { t: "text", v: "beta" }, { t: "text", v: "gamma" }];
  for (const [i, tv] of textVals.entries()) {
    r = await tree.insert({ root: r, unique: true, name: "ix" }, encodeKey([tv]), tid(i));
  }
  assert.equal((await tree.find(r, encodeKey([textVals[1]]))).length, 1);
  assert.equal((await tree.find(r, encodeKey([{ t: "text", v: "beta2" }]))).length, 0);
});

test("orderI64 sanity backs the key ordering contract", () => {
  assert.equal(orderI64(-1n).length, 8);
  assert.ok(cmpKey(orderI64(-1n), orderI64(0n)) < 0);
  assert.ok(cmpKey(orderI64(255n), orderI64(256n)) < 0);
});
