import assert from "node:assert/strict";
import { test } from "node:test";
import { createBackup, decodeBackupFile, encodeBackupFile, restoreBackup } from "../src/db/backup";
import { PAGE_SIZE, crc32 } from "../src/db/codec";
import { Database } from "../src/db/engine";
import { SeamError } from "../src/db/errors";
import { MemoryPager } from "../src/db/pager";

async function seed(): Promise<MemoryPager> {
  const pager = new MemoryPager();
  const db = await Database.open(pager);
  await db.exec(`spawn table t: id: whole number, main key, v: text, needed`);
  for (let i = 0; i < 10; i++) await db.exec(`drop in t { id: ${i}, v: 'row-${i}' }`);
  await db.close();
  return pager;
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as SeamError).code ?? "NOT_SEAM";
  }
  return "NO_THROW";
}

test("backup captures every page and restores into a fresh store", async () => {
  const src = await seed();
  const bundle = await createBackup(src);
  assert.ok(bundle.pages.length >= 2);
  assert.equal(bundle.manifest.pages, bundle.pages.length);
  assert.equal(bundle.manifest.page_size, PAGE_SIZE);

  const dst = new MemoryPager();
  await restoreBackup(dst, bundle);
  const db = await Database.open(dst);
  const rows = await db.exec("pull v from t rank by id low to high");
  assert.equal(rows[0].rows.length, 10);
  assert.equal(rows[0].rows[9][0].v, "row-9");
  await db.close();
});

test("restore refuses a tampered page or WAL", async () => {
  const src = await seed();
  const bundle = await createBackup(src);

  const badPage = { ...bundle, pages: bundle.pages.map((p, i) => (i === 1 ? p.slice() : p)) };
  badPage.pages[1] = badPage.pages[1].slice();
  badPage.pages[1][200] ^= 0x01;
  assert.equal(await codeOf(() => restoreBackup(new MemoryPager(), badPage)), "E_CHECKSUM");

  const badWal = { ...bundle, wal: bundle.wal.slice() };
  if (badWal.wal.length > 0) {
    badWal.wal[0] ^= 0x01;
    assert.equal(await codeOf(() => restoreBackup(new MemoryPager(), badWal)), "E_CHECKSUM");
  }
});

test("restore refuses inconsistent manifests", async () => {
  const src = await seed();
  const bundle = await createBackup(src);
  const fewer = { ...bundle, pages: bundle.pages.slice(0, bundle.pages.length - 1) };
  assert.equal(await codeOf(() => restoreBackup(new MemoryPager(), fewer)), "E_CORRUPT");

  const wrongSize = { ...bundle, manifest: { ...bundle.manifest, page_size: 512 } };
  assert.equal(await codeOf(() => restoreBackup(new MemoryPager(), wrongSize)), "E_CORRUPT");
});

test("backup of an empty store is refused (no superblock)", async () => {
  assert.equal(await codeOf(() => createBackup(new MemoryPager())), "E_CORRUPT");
});

test("backup file encoding round trips", async () => {
  const src = await seed();
  const bundle = await createBackup(src);
  const file = encodeBackupFile(bundle);
  const back = decodeBackupFile(file);
  assert.deepEqual(back.manifest, bundle.manifest);
  assert.equal(back.pages.length, bundle.pages.length);
  assert.deepEqual(back.pages[0], bundle.pages[0]);
  assert.deepEqual(back.wal, bundle.wal);
  // manifest CRCs still validate after the file round trip
  assert.equal(crc32(back.pages[0]), back.manifest.page_crc[0]);

  const garbage = file.slice();
  garbage[0] = 0x00;
  assert.throws(() => decodeBackupFile(garbage), (e: unknown) => (e as SeamError).code === "E_CORRUPT");
});
