import { putU16, putU64, u16, u64 } from "./codec";
import { err } from "./errors";
import { PT_BT_INT, PT_BT_LEAF, decodePage, encodeSlots, freeSpace, type Page } from "./page";

export interface Tid {
  page: number;
  slot: number;
}

export interface BTreeIo {
  pin(id: number): Promise<Uint8Array>;
  unpin(id: number): void;
  write(id: number, raw: Uint8Array): Promise<void>;
  alloc(type: 3 | 4, oid: bigint): Promise<number>;
}

export function packLeaf(key: Uint8Array, tid: Tid): Uint8Array {
  const b = new Uint8Array(2 + key.length + 8 + 2);
  putU16(b, 0, key.length);
  b.set(key, 2);
  putU64(b, 2 + key.length, BigInt(tid.page));
  putU16(b, 2 + key.length + 8, tid.slot);
  return b;
}

export function unpackLeaf(b: Uint8Array): { key: Uint8Array; tid: Tid } {
  const n = u16(b, 0);
  return { key: b.subarray(2, 2 + n), tid: { page: Number(u64(b, 2 + n)), slot: u16(b, 2 + n + 8) } };
}

export function packInternal(key: Uint8Array, child: number): Uint8Array {
  const b = new Uint8Array(2 + key.length + 8);
  putU16(b, 0, key.length);
  b.set(key, 2);
  putU64(b, 2 + key.length, BigInt(child));
  return b;
}

export function unpackInternal(b: Uint8Array): { key: Uint8Array; child: number } {
  const n = u16(b, 0);
  return { key: b.subarray(2, 2 + n), child: Number(u64(b, 2 + n)) };
}

export function cmpKey(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

export function keysEq(a: Uint8Array, b: Uint8Array): boolean {
  return cmpKey(a, b) === 0;
}

function cmpEntries(a: Uint8Array, b: Uint8Array): number {
  const ua = unpackLeaf(a);
  const ub = unpackLeaf(b);
  const c = cmpKey(ua.key, ub.key);
  if (c) return c;
  if (ua.tid.page !== ub.tid.page) return ua.tid.page - ub.tid.page;
  return ua.tid.slot - ub.tid.slot;
}

function sortLeaves(slots: Uint8Array[]): void {
  slots.sort(cmpEntries);
}

function sortInternals(slots: Uint8Array[]): void {
  slots.sort((a, b) => {
    const ka = unpackInternal(a).key;
    const kb = unpackInternal(b).key;
    if (ka.length === 0) return -1;
    if (kb.length === 0) return 1;
    return cmpKey(ka, kb);
  });
}

export class BTree {
  constructor(private readonly io: BTreeIo) {}

  async path(root: number, key: Uint8Array): Promise<number[]> {
    const path: number[] = [];
    let pid = root;
    for (let depth = 0; depth < 32; depth++) {
      path.push(pid);
      const raw = await this.io.pin(pid);
      const d = decodePage(raw);
      this.io.unpin(pid);
      if (d.type === PT_BT_LEAF) return path;
      if (d.type !== PT_BT_INT || d.slots.length === 0) err("E_CORRUPT", "Broken B+tree internal page.");
      let child = unpackInternal(d.slots[0]).child;
      for (const s of d.slots) {
        const u = unpackInternal(s);
        if (u.key.length === 0 || cmpKey(key, u.key) >= 0) child = u.child;
      }
      pid = child;
    }
    err("E_CORRUPT", "B+tree too deep.");
  }

  /**
   * Equality lookup. Duplicate keys can straddle a leaf split, so after the
   * descended leaf the scan continues along the right-sibling chain for as
   * long as each sibling's smallest key is still <= the target.
   */
  async find(root: number, key: Uint8Array): Promise<Tid[]> {
    let pid: number | null = (await this.path(root, key)).at(-1)!;
    const out: Tid[] = [];
    while (pid != null) {
      const raw = await this.io.pin(pid);
      const d = decodePage(raw);
      this.io.unpin(pid);
      if (d.slots.length === 0) {
        pid = d.right || null;
        continue;
      }
      const first = unpackLeaf(d.slots[0]).key;
      if (cmpKey(first, key) > 0) break;
      for (const s of d.slots) {
        const u = unpackLeaf(s);
        if (keysEq(u.key, key)) out.push(u.tid);
      }
      pid = d.right || null;
    }
    return out;
  }

  /** Ordered scan across the leaf chain between two inclusive key bounds. */
  async range(root: number, lo: Uint8Array | null, hi: Uint8Array | null): Promise<Tid[]> {
    const startKey = lo ?? new Uint8Array();
    let pid: number | null = (await this.path(root, startKey)).at(-1)!;
    const out: Tid[] = [];
    while (pid != null) {
      const raw = await this.io.pin(pid);
      const d = decodePage(raw);
      this.io.unpin(pid);
      let past = false;
      for (const s of d.slots) {
        const u = unpackLeaf(s);
        if (lo && cmpKey(u.key, lo) < 0) continue;
        if (hi && cmpKey(u.key, hi) > 0) {
          past = true;
          break;
        }
        out.push(u.tid);
      }
      if (past) break;
      pid = d.right || null;
    }
    return out;
  }

  async insert(idx: { root: number; unique: boolean; name: string }, key: Uint8Array, tid: Tid): Promise<number> {
    if (idx.unique) {
      const found = await this.find(idx.root, key);
      if (found.length) err("E_UNIQUE", `Index \`${idx.name}\` unique clash.`);
    }
    const path = await this.path(idx.root, key);
    const split = await this.insertLeaf(path[path.length - 1], key, tid);
    if (!split) return idx.root;
    let sep = split.sep;
    let right = split.right;
    let oid = split.oid;
    for (let i = path.length - 2; i >= 0; i--) {
      const up = await this.insertInternal(path[i], sep, right);
      if (!up) return idx.root;
      sep = up.sep;
      right = up.right;
      oid = up.oid;
    }
    const root = await this.io.alloc(PT_BT_INT, oid);
    const raw = await this.io.pin(root);
    const d = decodePage(raw);
    await this.io.write(
      root,
      encodeSlots({ ...d, type: PT_BT_INT }, [packInternal(new Uint8Array(), path[0]), packInternal(sep, right)], d.lsn),
    );
    this.io.unpin(root);
    return root;
  }

  /**
   * Remove one (key, tid) entry from its leaf. v0 keeps the leaf chain intact:
   * an emptied leaf stays linked so sibling traversal and separators remain
   * valid (its space is reclaimed only by rebuilding the index).
   */
  async delete(root: number, key: Uint8Array, tid: Tid): Promise<number> {
    const path = await this.path(root, key);
    const leafId = path[path.length - 1];
    const raw = await this.io.pin(leafId);
    const d = decodePage(raw);
    const slots = d.slots.filter((s) => {
      const u = unpackLeaf(s);
      return !(keysEq(u.key, key) && u.tid.page === tid.page && u.tid.slot === tid.slot);
    });
    await this.io.write(leafId, encodeSlots(d, slots, d.lsn));
    this.io.unpin(leafId);
    return root;
  }

  private async insertLeaf(leafId: number, key: Uint8Array, tid: Tid): Promise<{ sep: Uint8Array; right: number; oid: bigint } | null> {
    const raw = await this.io.pin(leafId);
    const d = decodePage(raw);
    const slots = d.slots.slice();
    slots.push(packLeaf(key, tid));
    sortLeaves(slots);
    if (fits(d, slots)) {
      await this.io.write(leafId, encodeSlots(d, slots, d.lsn));
      this.io.unpin(leafId);
      return null;
    }
    const mid = Math.max(1, Math.floor(slots.length / 2));
    const left = slots.slice(0, mid);
    const rightSlots = slots.slice(mid);
    const oldRight = d.right;
    const newId = await this.io.alloc(PT_BT_LEAF, d.objectId);
    await this.io.write(leafId, encodeSlots({ ...d, right: newId }, left, d.lsn));
    const nr = decodePage(await this.io.pin(newId));
    this.io.unpin(newId);
    await this.io.write(newId, encodeSlots({ ...nr, right: oldRight }, rightSlots, d.lsn));
    this.io.unpin(leafId);
    return { sep: unpackLeaf(rightSlots[0]).key.slice(), right: newId, oid: d.objectId };
  }

  private async insertInternal(pid: number, sep: Uint8Array, child: number): Promise<{ sep: Uint8Array; right: number; oid: bigint } | null> {
    const raw = await this.io.pin(pid);
    const d = decodePage(raw);
    const slots = d.slots.slice();
    slots.push(packInternal(sep, child));
    sortInternals(slots);
    if (fits(d, slots)) {
      await this.io.write(pid, encodeSlots(d, slots, d.lsn));
      this.io.unpin(pid);
      return null;
    }
    const mid = Math.max(1, Math.floor(slots.length / 2));
    const promote = unpackInternal(slots[mid]);
    const left = slots.slice(0, mid);
    const rightSlots = slots.slice(mid);
    rightSlots[0] = packInternal(new Uint8Array(), unpackInternal(rightSlots[0]).child);
    const newId = await this.io.alloc(PT_BT_INT, d.objectId);
    await this.io.write(pid, encodeSlots(d, left, d.lsn));
    const nr = decodePage(await this.io.pin(newId));
    this.io.unpin(newId);
    await this.io.write(newId, encodeSlots({ ...nr, type: PT_BT_INT }, rightSlots, d.lsn));
    this.io.unpin(pid);
    return { sep: promote.key.slice(), right: newId, oid: d.objectId };
  }
}

function fits(page: Page, slots: Uint8Array[]): boolean {
  const raw = encodeTry(page, slots);
  return raw != null && freeSpace(raw) >= 0;
}

function encodeTry(page: Page, slots: Uint8Array[]): Uint8Array | null {
  try {
    return encodeSlots(page, slots, page.lsn);
  } catch {
    return null;
  }
}


