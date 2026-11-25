import { ENGINE, LANG, PAGE_SIZE, utf8 } from "./codec";
import { err, SeamError } from "./errors";
import type { Database, Identity, QueryResult } from "./engine";
import { displayValue } from "./values";

export const PROTO = 1;
export const MAX_FRAME = 4 * 1024 * 1024;

export type FrameType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export function encodeFrame(type: FrameType, payload: Uint8Array): Uint8Array {
  if (payload.length + 1 > MAX_FRAME) err("E_LIMIT", "Frame exceeds 4 MiB.");
  const out = new Uint8Array(4 + 1 + payload.length);
  putU32be(out, 0, payload.length + 1);
  out[4] = type;
  out.set(payload, 5);
  return out;
}

export function decodeFrame(buf: Uint8Array): { type: number; payload: Uint8Array } {
  if (buf.length < 5) err("E_CORRUPT", "Truncated frame.");
  const len = u32be(buf, 0);
  if (len > MAX_FRAME) err("E_LIMIT", "Frame length out of range.");
  if (len + 4 !== buf.length) err("E_CORRUPT", "Truncated frame.");
  return { type: buf[4], payload: buf.subarray(5) };
}

function putU32be(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 0xff;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
}
function u32be(b: Uint8Array, o: number): number {
  return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
}

export interface Session {
  authed: boolean;
  identity: Identity;
  seen: Set<string>;
}

export function helloFrame(): Uint8Array {
  return encodeFrame(1, utf8(JSON.stringify({ proto: PROTO, lang: LANG, engine: ENGINE, page_size: PAGE_SIZE })));
}

export class ProtocolLoop {
  readonly session: Session = { authed: false, identity: { user: "anon", roles: [] }, seen: new Set() };
  constructor(
    readonly db: Database,
    readonly mode: "development" | "production",
  ) {}

  async handle(raw: Uint8Array): Promise<Uint8Array> {
    const { type, payload } = decodeFrame(raw);
    try {
      if (type === 1) return helloFrame();
      if (type === 2) return this.auth(payload);
      if (type === 6) return encodeFrame(7, utf8(JSON.stringify({ cancelled: true })));
      if (type === 7) return encodeFrame(7, utf8(JSON.stringify({ proto: PROTO, authed: this.session.authed })));
      if (type === 8) return this.catalog();
      if (type === 3) return await this.query(payload);
      err("E_FEATURE_NOT_SUPPORTED", `Unknown frame type ${type}.`);
    } catch (e) {
      const se = e instanceof SeamError ? e : new SeamError("E_CORRUPT", e instanceof Error ? e.message : "protocol error");
      return encodeFrame(5, utf8(JSON.stringify({ code: se.code, message: se.message, line: se.line, column: se.column, hint: se.hint })));
    }
  }

  bindCleartextTcp(_port: number): never {
    if (this.mode === "production") err("E_FEATURE_NOT_SUPPORTED", "Cleartext TCP bind is refused in production. Use a reviewed TLS stack in front.");
    err("E_FEATURE_NOT_SUPPORTED", "TCP bind is not enabled in this build; use the in-process protocol loop.");
  }

  private auth(payload: Uint8Array): Uint8Array {
    const body = json(payload) as { user?: string; roles?: string[] };
    if (!body.user || typeof body.user !== "string") err("E_DENIED", "AUTH requires user.");
    const roles = Array.isArray(body.roles) ? body.roles.map(String) : [];
    // This in-process loop trusts its caller for development. A production
    // deployment authenticates at the transport boundary, so self-asserted
    // owner elevation is refused here rather than silently accepted.
    if (this.mode === "production" && roles.includes("owner")) {
      err("E_DENIED", "Owner role cannot be self-asserted over the protocol.");
    }
    this.session.identity = { user: body.user, roles };
    this.session.authed = true;
    return encodeFrame(7, utf8(JSON.stringify({ authed: true, user: body.user })));
  }

  /** Frame 8: schema introspection for clients (IDE explorer). Owner or any
   * authenticated session receives the tables/views the identity can see.
   * Introspection must run through a session opened with the *authed*
   * identity — the loop's base handle is an anonymous connect made before
   * AUTH, so using `this.db` directly would report anon and an empty catalog. */
  private catalog(): Uint8Array {
    if (!this.session.authed) err("E_DENIED", "AUTH before CATALOG.");
    const sess = this.db.connect(this.session.identity);
    const tables = sess.catalogInfo();
    const views = sess.viewInfo();
    return encodeFrame(7, utf8(JSON.stringify({ kind: "catalog", tables, views, roles: sess.whoami() })));
  }

  private async query(payload: Uint8Array): Promise<Uint8Array> {
    if (!this.session.authed) err("E_DENIED", "AUTH before QUERY.");
    const body = json(payload) as { id?: string; seamql?: string; timeout_ms?: number; idempotency_key?: string };
    if (!body.id || !body.seamql) err("E_SYNTAX", "QUERY requires id and seamql.");
    if (body.seamql.length > 1024 * 1024) err("E_TOKEN_LIMIT", "Statement exceeds 1 MiB.");
    const timeout = body.timeout_ms ?? 30_000;
    if (timeout < 1 || timeout > 120_000) err("E_LIMIT", "timeout_ms out of range.");
    if (body.idempotency_key && this.session.seen.has(body.idempotency_key)) {
      return encodeFrame(4, utf8(JSON.stringify({ id: body.id, duplicate: true, columns: [], rows: [], xid: "0", commit_lsn: null, evidence_state: "none" })));
    }
    const sess = this.db.connect(this.session.identity);
    const results = await withTimeout(sess.exec(body.seamql), timeout);
    if (body.idempotency_key) this.session.seen.add(body.idempotency_key);
    const wire = results.map((r) => serializeResult(body.id!, r));
    return encodeFrame(4, utf8(JSON.stringify({ id: body.id, results: wire })));
  }
}

function serializeResult(id: string, r: QueryResult): object {
  return {
    id,
    columns: r.columns,
    rows: r.rows.map((row) => row.map(displayValue)),
    xid: r.xid,
    commit_lsn: r.commit_lsn,
    evidence_state: r.evidence_state,
    plan: r.plan,
  };
}

function json(p: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(p));
  } catch {
    err("E_CORRUPT", "Frame JSON is not valid UTF-8 JSON.");
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new SeamError("E_LIMIT", "Query timeout.")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
