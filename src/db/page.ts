import {
  PAGE_HEADER,
  PAGE_SIZE,
  crc32,
  putU16,
  putU32,
  putU64,
  u16,
  u32,
  u64,
} from "./codec";
import { err } from "./errors";

export type PageType = 1 | 2 | 3 | 4 | 5 | 6;
export const PT_SUPER = 1;
export const PT_HEAP = 2;
export const PT_BT_INT = 3;
export const PT_BT_LEAF = 4;
export const PT_CATALOG = 5;
export const PT_FREE = 6;

const MAGIC = [0x53, 0x45, 0x4d, 0x50];

export interface Page {
  type: PageType;
  pageId: bigint;
  objectId: bigint;
  generation: bigint;
  lsn: bigint;
  flags: number;
  /** Right sibling in a leaf chain; 0 when absent. Only leaf pages use it. */
  right: number;
  slots: Uint8Array[];
  raw: Uint8Array;
}

export function emptyPage(type: PageType, pageId: bigint, objectId: bigint, generation = 1n): Uint8Array {
  const raw = new Uint8Array(PAGE_SIZE);
  raw[0] = MAGIC[0];
  raw[1] = MAGIC[1];
  raw[2] = MAGIC[2];
  raw[3] = MAGIC[3];
  putU16(raw, 4, 1);
  putU16(raw, 6, type);
  putU64(raw, 8, pageId);
  putU64(raw, 16, objectId);
  putU64(raw, 24, generation);
  putU64(raw, 32, 0n);
  putU16(raw, 40, 0);
  putU16(raw, 42, PAGE_HEADER);
  putU16(raw, 44, PAGE_SIZE);
  putU16(raw, 46, 0);
  putU64(raw, 64, 0n);
  writeCrc(raw);
  return raw;
}

export function writeCrc(raw: Uint8Array): void {
  putU32(raw, 48, 0);
  putU32(raw, 48, crc32(raw));
}

export function decodePage(raw: Uint8Array): Page {
  if (raw.length !== PAGE_SIZE) err("E_CORRUPT", "Page size is not 16384.");
  if (raw[0] !== MAGIC[0] || raw[1] !== MAGIC[1] || raw[2] !== MAGIC[2] || raw[3] !== MAGIC[3]) {
    err("E_CORRUPT", "Bad page magic.");
  }
  const copy = raw.slice();
  const stored = u32(copy, 48);
  putU32(copy, 48, 0);
  if (crc32(copy) !== stored) err("E_CHECKSUM", "Page CRC mismatch.");
  const version = u16(raw, 4);
  if (version !== 1) err("E_CORRUPT", `Unsupported page version ${version}.`);
  const type = u16(raw, 6) as PageType;
  if (type < 1 || type > 6) err("E_CORRUPT", `Invalid page type ${type}.`);
  for (let i = 52; i < 64; i++) if (raw[i] !== 0) err("E_CORRUPT", "Reserved header bytes must be zero.");
  for (let i = 72; i < 88; i++) if (raw[i] !== 0) err("E_CORRUPT", "Reserved tag-slot bytes must be zero.");
  const slotCount = u16(raw, 40);
  const lower = u16(raw, 42);
  const upper = u16(raw, 44);
  if (lower < PAGE_HEADER || upper > PAGE_SIZE || lower > upper) err("E_CORRUPT", "Invalid page bounds.");
  if (PAGE_HEADER + slotCount * 4 !== lower) err("E_CORRUPT", "Slot directory does not match lower.");
  const right = Number(u64(raw, 64));
  if (!Number.isSafeInteger(right) || right < 0) err("E_CORRUPT", "Invalid sibling pointer.");
  const slots: Uint8Array[] = [];
  const used: Array<[number, number]> = [];
  for (let s = 0; s < slotCount; s++) {
    const off = u16(raw, PAGE_HEADER + s * 4);
    const len = u16(raw, PAGE_HEADER + s * 4 + 2);
    if (len === 0) {
      slots.push(new Uint8Array(0));
      continue;
    }
    if (off < upper || off + len > PAGE_SIZE) err("E_CORRUPT", "Slot out of bounds.");
    for (const [a, b] of used) {
      if (!(off + len <= a || b <= off)) err("E_CORRUPT", "Overlapping slots.");
    }
    used.push([off, off + len]);
    slots.push(raw.slice(off, off + len));
  }
  return {
    type,
    pageId: u64(raw, 8),
    objectId: u64(raw, 16),
    generation: u64(raw, 24),
    lsn: u64(raw, 32),
    flags: u16(raw, 46),
    right,
    slots,
    raw: raw.slice(),
  };
}

export function encodeSlots(base: Page, slots: Uint8Array[], lsn: bigint): Uint8Array {
  // The generation increments on every write. Encryption derives each page's
  // nonce from (page id, generation), so a fresh generation guarantees a
  // fresh nonce even when the same page is rewritten under one key.
  const raw = emptyPage(base.type, base.pageId, base.objectId, base.generation + 1n);
  putU64(raw, 32, lsn);
  putU64(raw, 64, BigInt(base.right));
  let upper = PAGE_SIZE;
  const ptrs: Array<{ off: number; len: number }> = [];
  for (const slot of slots) {
    if (slot.length === 0) {
      ptrs.push({ off: 0, len: 0 });
      continue;
    }
    upper -= slot.length;
    const lower = PAGE_HEADER + (ptrs.length + 1) * 4;
    if (lower > upper) err("E_LIMIT", "Heap page is full.");
    raw.set(slot, upper);
    ptrs.push({ off: upper, len: slot.length });
  }
  putU16(raw, 40, ptrs.length);
  putU16(raw, 42, PAGE_HEADER + ptrs.length * 4);
  putU16(raw, 44, upper);
  for (let i = 0; i < ptrs.length; i++) {
    putU16(raw, PAGE_HEADER + i * 4, ptrs[i].off);
    putU16(raw, PAGE_HEADER + i * 4 + 2, ptrs[i].len);
  }
  writeCrc(raw);
  return raw;
}

export function freeSpace(raw: Uint8Array): number {
  const lower = u16(raw, 42);
  const upper = u16(raw, 44);
  return Math.max(0, upper - lower - 4);
}
