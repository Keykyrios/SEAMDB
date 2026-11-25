import { PAGE_SIZE, putU32 } from "./codec";
import { err } from "./errors";

export interface Pager {
  readonly durable: boolean;
  read(id: number): Promise<Uint8Array | null>;
  write(id: number, page: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  walBytes(): Promise<Uint8Array>;
  walAppend(chunk: Uint8Array): Promise<void>;
  walTruncate(len: number): Promise<void>;
  walSync(): Promise<void>;
  tryLock(): Promise<boolean>;
  unlock(): Promise<void>;
}

export class MemoryPager implements Pager {
  readonly durable = false;
  pages = new Map<number, Uint8Array>();
  wal = new Uint8Array(0);
  locked = false;
  writes = 0;
  failAfter: number | null = null;

  private hit(): void {
    this.writes++;
    if (this.failAfter != null && this.writes > this.failAfter) {
      throw Object.assign(new Error("injected crash"), { code: "E_INJECTED_CRASH" });
    }
  }

  async read(id: number): Promise<Uint8Array | null> {
    const p = this.pages.get(id);
    return p ? p.slice() : null;
  }
  async write(id: number, page: Uint8Array): Promise<void> {
    if (page.length !== PAGE_SIZE) err("E_CORRUPT", "Refusing non-page write.");
    this.hit();
    this.pages.set(id, page.slice());
  }
  async sync(): Promise<void> {
    this.hit();
  }
  async walBytes(): Promise<Uint8Array> {
    return this.wal.slice();
  }
  async walAppend(chunk: Uint8Array): Promise<void> {
    this.hit();
    const n = new Uint8Array(this.wal.length + chunk.length);
    n.set(this.wal);
    n.set(chunk, this.wal.length);
    this.wal = n;
  }
  async walTruncate(len: number): Promise<void> {
    this.hit();
    this.wal = this.wal.slice(0, len);
  }
  async walSync(): Promise<void> {
    this.hit();
  }
  async tryLock(): Promise<boolean> {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }
  async unlock(): Promise<void> {
    this.locked = false;
  }

  clone(): MemoryPager {
    const p = new MemoryPager();
    for (const [id, page] of this.pages) p.pages.set(id, page.slice());
    p.wal = this.wal.slice();
    p.failAfter = this.failAfter;
    return p;
  }
}

export class FaultyPager implements Pager {
  constructor(
    readonly inner: Pager,
    public failAfter: number | null,
  ) {}
  writes = 0;
  get durable(): boolean {
    return this.inner.durable;
  }
  private hit(): void {
    this.writes++;
    if (this.failAfter != null && this.writes > this.failAfter) {
      throw Object.assign(new Error("injected crash"), { code: "E_INJECTED_CRASH" });
    }
  }
  read(id: number): Promise<Uint8Array | null> {
    return this.inner.read(id);
  }
  async write(id: number, page: Uint8Array): Promise<void> {
    this.hit();
    return this.inner.write(id, page);
  }
  async sync(): Promise<void> {
    this.hit();
    return this.inner.sync();
  }
  walBytes(): Promise<Uint8Array> {
    return this.inner.walBytes();
  }
  async walAppend(chunk: Uint8Array): Promise<void> {
    this.hit();
    return this.inner.walAppend(chunk);
  }
  async walTruncate(len: number): Promise<void> {
    this.hit();
    return this.inner.walTruncate(len);
  }
  async walSync(): Promise<void> {
    this.hit();
    return this.inner.walSync();
  }
  tryLock(): Promise<boolean> {
    return this.inner.tryLock();
  }
  unlock(): Promise<void> {
    return this.inner.unlock();
  }
}

export function frameQuery(id: string, seamql: string, timeoutMs = 30_000): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify({ id, seamql, timeout_ms: timeoutMs }));
  const out = new Uint8Array(5 + body.length);
  putU32(out, 0, body.length + 1);
  out[4] = 3;
  out.set(body, 5);
  return out;
}

export function parseFrame(buf: Uint8Array): { type: number; payload: Uint8Array } {
  if (buf.length < 5) err("E_CORRUPT", "Truncated frame.");
  const len = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
  if (len > 4 * 1024 * 1024 || len + 4 !== buf.length) err("E_LIMIT", "Frame length invalid.");
  return { type: buf[4], payload: buf.subarray(5) };
}
