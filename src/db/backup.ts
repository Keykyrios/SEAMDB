import { PAGE_SIZE, crc32, putU32, u32, utf8 } from "./codec";
import { err } from "./errors";
import { decodePage } from "./page";
import type { Pager } from "./pager";

export interface BackupManifest {
  spec: "seamdb.backup/v1";
  format: 1;
  page_size: number;
  pages: number;
  wal_bytes: number;
  page_crc: number[];
  wal_crc: number;
}

export async function createBackup(pager: Pager): Promise<{ manifest: BackupManifest; pages: Uint8Array[]; wal: Uint8Array }> {
  const pages: Uint8Array[] = [];
  const page_crc: number[] = [];
  for (let i = 0; i < 1_000_000; i++) {
    const p = await pager.read(i);
    if (!p) {
      if (i === 0) err("E_CORRUPT", "Backup refused: missing superblock.");
      break;
    }
    decodePage(p);
    pages.push(p.slice());
    page_crc.push(crc32(p));
  }
  const wal = await pager.walBytes();
  const manifest: BackupManifest = {
    spec: "seamdb.backup/v1",
    format: 1,
    page_size: PAGE_SIZE,
    pages: pages.length,
    wal_bytes: wal.length,
    page_crc,
    wal_crc: crc32(wal),
  };
  return { manifest, pages, wal };
}

export async function restoreBackup(
  pager: Pager,
  bundle: { manifest: BackupManifest; pages: Uint8Array[]; wal: Uint8Array },
): Promise<void> {
  const m = bundle.manifest;
  if (m.spec !== "seamdb.backup/v1" || m.format !== 1) err("E_CORRUPT", "Unknown backup format.");
  if (m.page_size !== PAGE_SIZE) err("E_CORRUPT", "Backup page size is not 16384.");
  if (m.pages !== bundle.pages.length) err("E_CORRUPT", "Backup page inventory mismatch.");
  if (crc32(bundle.wal) !== m.wal_crc) err("E_CHECKSUM", "Backup WAL checksum failed.");
  if (bundle.wal.length !== m.wal_bytes) err("E_CORRUPT", "Backup WAL length mismatch.");
  for (let i = 0; i < bundle.pages.length; i++) {
    const p = bundle.pages[i];
    if (p.length !== PAGE_SIZE) err("E_CORRUPT", `Backup page ${i} size.`);
    if (crc32(p) !== m.page_crc[i]) err("E_CHECKSUM", `Backup page ${i} checksum failed.`);
    decodePage(p);
  }
  for (let i = 0; i < bundle.pages.length; i++) await pager.write(i, bundle.pages[i]);
  await pager.walTruncate(0);
  if (bundle.wal.length) await pager.walAppend(bundle.wal);
  await pager.walSync();
  await pager.sync();
}

export function encodeBackupFile(bundle: { manifest: BackupManifest; pages: Uint8Array[]; wal: Uint8Array }): Uint8Array {
  const man = utf8(JSON.stringify(bundle.manifest));
  const out = new Uint8Array(16 + man.length + bundle.pages.length * PAGE_SIZE + bundle.wal.length);
  out[0] = 0x53;
  out[1] = 0x42;
  out[2] = 0x4b;
  out[3] = 0x31;
  putU32(out, 4, man.length);
  putU32(out, 8, bundle.pages.length);
  putU32(out, 12, bundle.wal.length);
  out.set(man, 16);
  let o = 16 + man.length;
  for (const p of bundle.pages) {
    out.set(p, o);
    o += PAGE_SIZE;
  }
  out.set(bundle.wal, o);
  return out;
}

export function decodeBackupFile(raw: Uint8Array): { manifest: BackupManifest; pages: Uint8Array[]; wal: Uint8Array } {
  if (raw.length < 16 || raw[0] !== 0x53 || raw[1] !== 0x42 || raw[2] !== 0x4b || raw[3] !== 0x31) {
    err("E_CORRUPT", "Not a SEAMDB backup.");
  }
  const manLen = u32(raw, 4);
  const n = u32(raw, 8);
  const walLen = u32(raw, 12);
  const man = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw.subarray(16, 16 + manLen))) as BackupManifest;
  const pages: Uint8Array[] = [];
  let o = 16 + manLen;
  for (let i = 0; i < n; i++) {
    pages.push(raw.slice(o, o + PAGE_SIZE));
    o += PAGE_SIZE;
  }
  const wal = raw.slice(o, o + walLen);
  return { manifest: man, pages, wal };
}
