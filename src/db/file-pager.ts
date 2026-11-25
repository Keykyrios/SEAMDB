import { closeSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { PAGE_SIZE } from "./codec";
import { err } from "./errors";
import type { Pager } from "./pager";

export class FilePager implements Pager {
  readonly durable = true;
  private dataFd = -1;
  private walFd = -1;
  private lockFd = -1;
  private walBuf: Uint8Array = new Uint8Array(0);

  constructor(readonly dir: string) {}

  async tryLock(): Promise<boolean> {
    mkdirSync(this.dir, { recursive: true });
    const lockPath = join(this.dir, "seam.lock");
    try {
      this.lockFd = openSync(lockPath, "wx");
    } catch {
      return false;
    }
    writeSync(this.lockFd, Buffer.from(String(process.pid)));
    this.dataFd = openSync(join(this.dir, "seam.data"), "a+");
    this.walFd = openSync(join(this.dir, "seam.wal"), "a+");
    this.walBuf = this.readAll(this.walFd);
    return true;
  }

  async unlock(): Promise<void> {
    this.closeFd("dataFd");
    this.closeFd("walFd");
    if (this.lockFd >= 0) {
      closeSync(this.lockFd);
      this.lockFd = -1;
      try {
        unlinkSync(join(this.dir, "seam.lock"));
      } catch {
        /* lock file may already be gone */
      }
    }
  }

  async read(id: number): Promise<Uint8Array | null> {
    const buf = Buffer.alloc(PAGE_SIZE);
    const n = readSync(this.dataFd, buf, 0, PAGE_SIZE, id * PAGE_SIZE);
    if (n === 0) return null;
    if (n !== PAGE_SIZE) err("E_CORRUPT", "Short data-page read.");
    const out = new Uint8Array(PAGE_SIZE);
    out.set(buf);
    return out;
  }

  async write(id: number, page: Uint8Array): Promise<void> {
    if (page.length !== PAGE_SIZE) err("E_CORRUPT", "Refusing non-page write.");
    const n = writeSync(this.dataFd, page, 0, PAGE_SIZE, id * PAGE_SIZE);
    if (n !== PAGE_SIZE) err("E_CORRUPT", "Short data-page write.");
  }

  async sync(): Promise<void> {
    fsyncSync(this.dataFd);
  }

  async walBytes(): Promise<Uint8Array> {
    return this.walBuf.slice();
  }

  async walAppend(chunk: Uint8Array): Promise<void> {
    writeSync(this.walFd, chunk);
    const n = new Uint8Array(this.walBuf.length + chunk.length);
    n.set(this.walBuf);
    n.set(chunk, this.walBuf.length);
    this.walBuf = n;
  }

  async walTruncate(len: number): Promise<void> {
    ftruncateSync(this.walFd, len);
    this.walBuf = this.walBuf.slice(0, len);
  }

  async walSync(): Promise<void> {
    fsyncSync(this.walFd);
  }

  private readAll(fd: number): Uint8Array {
    const chunks: Buffer[] = [];
    const buf = Buffer.alloc(64 * 1024);
    let pos = 0;
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n === 0) break;
      chunks.push(Buffer.from(buf.subarray(0, n)));
      pos += n;
    }
    return new Uint8Array(Buffer.concat(chunks));
  }

  private closeFd(field: "dataFd" | "walFd"): void {
    if (this[field] >= 0) {
      closeSync(this[field]);
      this[field] = -1;
    }
  }
}

export function filePagerExists(dir: string): boolean {
  return existsSync(join(dir, "seam.data"));
}
