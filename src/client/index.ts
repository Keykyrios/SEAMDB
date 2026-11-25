import { connect, Socket } from "node:net";
import { encodeFrame, decodeFrame, helloFrame, MAX_FRAME, PROTO } from "../db/protocol";
import { utf8 } from "../db/codec";

/**
 * The official TypeScript driver for SEAMDB. Speaks the engine's own
 * frame protocol — 4-byte big-endian frame length, one type byte, payload —
 * identical to what src/server/tcp.ts accepts. This is *not* a PostgreSQL
 * shim: the server has one protocol and every language binds to it.
 *
 *   const db = await SeamDB.connect({ user: "root", roles: ["owner"] });
 *   const r = await db.query("pull name from customers when region = 'west'");
 *   r[0].rows[0][0]  // => string
 *   await db.close();
 */

export interface ConnectOptions {
  host?: string;
  port?: number;
  user: string;
  roles?: string[];
  timeoutMs?: number;
}

export interface WireResult {
  columns: string[];
  rows: Cell[][];
  xid: string;
  commitLsn: string | null;
  evidenceState: string;
  plan: unknown;
}

export interface WireError extends Error {
  code: string;
  line?: number;
  column?: number;
  hint?: string;
}

/** On the wire every cell is display text; the driver decodes JSON-quoted text. */
export type Cell = string | null;

export interface CatalogTable {
  name: string;
  oid: string;
  indexes: Array<{ name: string; columns: string[]; unique: boolean }>;
  columns: Array<{
    name: string; type: string; mainKey: boolean; unique: boolean;
    needed: boolean; private: boolean; fallback: string | null;
    atLeast: string | null; references: string | null;
  }>;
}

function decodeCell(s: string | null): Cell {
  if (s === null || s === "null") return null;
  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s;
    }
  }
  return s;
}

export function wireError(e: unknown): WireError {
  if (e instanceof Error && "code" in e) return e as WireError;
  return newError("E_CONN", e instanceof Error ? e.message : String(e));
}

function newError(code: string, message: string): WireError {
  const e = new Error(message) as WireError;
  e.code = code;
  return e;
}

export class SeamDB {
  private sock: Socket | null = null;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: WireError) => void }>();
  private pusher = recvFrames((raw) => this.deliver(raw));
  private nextId = 0;
  private closed = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private constructor(private o: { host: string; port: number; user: string; roles: string[]; timeoutMs: number }) {}

  static async connect(opts: ConnectOptions): Promise<SeamDB> {
    const o = {
      host: opts.host ?? "127.0.0.1",
      port: opts.port ?? 7301,
      user: opts.user,
      roles: opts.roles ?? [],
      timeoutMs: opts.timeoutMs ?? 30_000,
    };
    const cli = new SeamDB(o);
    cli.sock = await tcpConnect(o.host, o.port, o.timeoutMs);
    cli.sock.on("data", (chunk: Buffer) => {
      try {
        cli.pusher.push(chunk);
      } catch {
        cli.failAll(newError("E_CORRUPT", "Broken frame from server."));
      }
    });
    cli.sock.on("end", () => cli.failAll(newError("E_CONN_CLOSED", "Server closed the connection.")));
    cli.sock.on("error", (e) => cli.failAll(newError("E_CONN", `Socket error: ${e.message}`)));
    const hello = (await cli.exchange(helloFrame())) as { proto?: number };
    if (hello.proto !== PROTO) throw newError("E_PROTO", `Server protocol ${hello.proto} != driver ${PROTO}.`);
    await cli.exchange(encodeFrame(2, utf8(JSON.stringify({ user: o.user, roles: o.roles }))));
    return cli;
  }

  /** Run every statement in `seamql`; resolves to one result per statement. */
  async query(
    seamql: string,
    opts?: { timeoutMs?: number; idempotencyKey?: string },
  ): Promise<WireResult[]> {
    if (this.closed) throw newError("E_CONN_CLOSED", "Connection is closed.");
    const id = `q${++this.nextId}`;
    const body = JSON.stringify({
      id,
      seamql,
      timeout_ms: opts?.timeoutMs ?? this.o.timeoutMs,
      ...(opts?.idempotencyKey ? { idempotency_key: opts.idempotencyKey } : {}),
    });
    const out = (await this.exchange(encodeFrame(3, utf8(body)), id)) as {
      results?: Array<{ columns: string[]; rows: (string | null)[][]; xid: string; commit_lsn: string | null; evidence_state: string; plan: unknown }>;
      duplicate?: boolean;
    };
    if (out.duplicate) return [];
    return (out.results ?? []).map((r) => ({
      columns: r.columns,
      rows: r.rows.map((row) => row.map(decodeCell)),
      xid: r.xid,
      commitLsn: r.commit_lsn,
      evidenceState: r.evidence_state,
      plan: r.plan,
    }));
  }

  /** Schema introspection (frame 8): visible tables, views and identity. */
  async catalog(): Promise<{ tables: CatalogTable[]; views: Array<{ name: string }>; roles: { user: string; roles: string[]; owner: boolean } }> {
    const out = (await this.exchange(encodeFrame(8, new Uint8Array()))) as {
      kind?: string; tables?: CatalogTable[]; views?: Array<{ name: string }>;
      roles?: { user: string; roles: string[]; owner: boolean };
    };
    return { tables: out.tables ?? [], views: out.views ?? [], roles: out.roles ?? { user: "?", roles: [], owner: false } };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.failAll(newError("E_CONN_CLOSED", "Client closed."));
    this.sock?.end();
    this.sock = null;
  }

  /* ---- internals ---- */

  private send(frame: Uint8Array): void {
    this.sock?.write(Buffer.from(frame));
  }

  private async exchange(frame: Uint8Array, id = "ctl"): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send(frame);
    });
  }

  private deliver(raw: Uint8Array): void {
    const { type, payload } = decodeFrame(raw);
    const text = new TextDecoder().decode(payload);
    if (type === 5) {
      const e = JSON.parse(text) as { code: string; message: string; line?: number; column?: number; hint?: string };
      const err = newError(e.code, e.message);
      err.line = e.line;
      err.column = e.column;
      err.hint = e.hint;
      // Errors from a statement reject its frame by id; ctl errors reject all.
      const first = [...this.pending.values()][0];
      if (first) {
        first.reject(err);
      }
      return;
    }
    const body = JSON.parse(text) as { id?: string } & object;
    const id = body.id ?? "ctl";
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    p.resolve(body);
  }

  private failAll(e: WireError): void {
    for (const [, p] of this.pending) p.reject(e);
    this.pending.clear();
  }
}

/** Frame splitter for received bytes: complete frames go to `out` in order. */
function recvFrames(out: (raw: Uint8Array) => void): { push(chunk: Buffer): void } {
  let buf = Buffer.alloc(0);
  return {
    push(chunk: Buffer): void {
      buf = buf.length === 0 ? Buffer.from(chunk) : Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 4) return;
        const len = buf.readUInt32BE(0);
        if (len < 1 || len > MAX_FRAME) throw new Error(`Frame length ${len} out of range.`);
        if (buf.length < 4 + len) return;
        out(buf.subarray(0, 4 + len));
        buf = buf.subarray(4 + len);
      }
    },
  };
}

function tcpConnect(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect({ host, port });
    const t = setTimeout(() => {
      s.destroy();
      reject(newError("E_TIMEOUT", `Connect to ${host}:${port} timed out.`));
    }, timeoutMs);
    s.once("connect", () => {
      clearTimeout(t);
      resolve(s);
    });
    s.once("error", (e) => {
      clearTimeout(t);
      reject(newError("E_CONN", e.message));
    });
  });
}
