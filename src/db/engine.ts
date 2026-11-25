import { canonicalize } from "../engine/canonical";
import { sha384Hex } from "../engine/hash";
import { BTree, type Tid } from "./btree";
import { Decimal, LANG, PAGE_SIZE, crc32, putU16, putU32, putU64, u32, u64, utf8 } from "./codec";import { EncryptedPager } from "./crypto-pager";
import { err } from "./errors";
import { compareValues, evalExpr, predTrue, type EvalCtx } from "./eval";
import { assertKeyForMode, type KeyProvider } from "./keys";
import { parse, pretty, prettyExpr, type ColDef, type Expr, type Statement, type TypeSpec } from "./parser";
import { MemoryPager, type Pager } from "./pager";
import { PT_BT_LEAF, PT_CATALOG, PT_FREE, PT_HEAP, PT_SUPER, decodePage, emptyPage, encodeSlots, freeSpace } from "./page";
import { planPull, planText as renderPhysical } from "./plan";
import { selectOutputCols, typecheck } from "./resolve";
import { decodeTuple, encodeKey, encodeTuple, type HeapTuple } from "./tuple";
import { checkInt, displayValue, typeName, valueType, type SeamType, type SeamValue } from "./values";
import { collectWfns, computeWindows, plainEval, walkExpr } from "./window";
void plainEval;
void computeWindows;
void collectWfns;
void walkExpr;

const WMAGIC = 0x314c4157;
const W_BEGIN = 1,
  W_PAGE = 2,
  W_COMMIT = 8,
  W_ABORT = 9,
  W_CKPT = 10,
  W_EVIDENCE = 11,
  W_CAT = 12,
  W_SUPER = 13,
  /** Marks the single record a rotated log starts with; not replayed. */
  W_RESTART = 14;

/** Superblock slot fields after the header block (fixed offsets). */
const SB_CATALOG_PAGE = 40;
const SB_XID_FLOOR = 44;
const SB_CATALOG_PAGE_NEW = 52;
const SB_SLOT_LEN = 60;
/**
 * WAL retention: rotate only when the log has grown past ROTATE_MAX_BYTES
 * since the last rotation (floor of ROTATE_MIN_BYTES, settable per pager via
 * `seamdb.wal_rotate_bytes` in tests). Small logs are cheaper to keep than to
 * rebuild, and rotating on every checkpoint would punch holes in the evidence
 * trail for no space win.
 */
const ROTATE_MAX_BYTES = 4 * 1024 * 1024;

export interface Column {
  name: string;
  type: SeamType;
  pk: boolean;
  unique: boolean;
  needed: boolean;
  private: boolean;
  fallback: Expr | null;
  fk: { table: string; column: string } | null;
  atLeast: Expr | null;
}

export interface Table {
  oid: bigint;
  name: string;
  columns: Column[];
  heapPages: number[];
  indexes: IndexDef[];
}

export interface IndexDef {
  name: string;
  columns: string[];
  unique: boolean;
  root: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  declared: SeamType;
  mainKey: boolean;
  unique: boolean;
  needed: boolean;
  private: boolean;
  fallback: string | null;
  atLeast: string | null;
  references: string | null;
}

export interface TableInfo {
  name: string;
  oid: string;
  columns: ColumnInfo[];
  indexes: Array<{ name: string; columns: string[]; unique: boolean }>;
}

export interface Grant {
  role: string;
  priv: string;
  table: string;
  columns: string[] | "*";
  row: Expr | null;
}

export interface Identity {
  user: string;
  roles: string[];
}

/** A named view: a saved pierce select that re-runs whenever queried. */
export interface ViewDef {
  name: string;
  select: Statement | null;
}

export interface QueryResult {
  columns: string[];
  rows: SeamValue[][];
  xid: string;
  commit_lsn: string | null;
  evidence_state: "none" | "COMMITTED" | "COMMITTED_EVIDENCE_PENDING";
  plan?: string;
}

interface Snapshot {
  xmax: bigint;
  active: Set<bigint>;
}

interface Tx {
  xid: bigint;
  snap: Snapshot;
  explicit: boolean;
  dirtyPages: Set<number>;
  status: "active" | "committed" | "aborted";
  writer: boolean;
  writes: Set<string>;
  catalogBackup: string;
}

interface EvidenceEvent {
  engine: string;
  lang: string;
  xid: string;
  commit_lsn: string;
  catalog_version: number;
  statement_fp: string;
  plan_fp: string;
  write_set: string[];
  policy_version: number;
  ts_us: string;
  clock: "host-local";
  evidence_state: "COMMITTED";
}

interface Shared {
  pager: Pager;
  cache: Map<number, { raw: Uint8Array; pin: number; dirty: boolean; active: boolean }>;
  nextPage: number;
  nextXid: bigint;
  nextOid: bigint;
  /** Transactions below this floor are committed by definition after rotation. */
  xidFloor: bigint;
  lsn: bigint;
  prevLsn: bigint;
  clog: Map<bigint, "c" | "a">;
  tables: Map<string, Table>;
  roles: Set<string>;
  grants: Grant[];
  /** Named views: saved pierce select statements expanded on every read. */
  views: Map<string, ViewDef>;
  catalogVersion: number;
  policyVersion: number;
  catalogPage: number;
  /** New catalog page allocated during a rotation, valid after that rotation. */
  catalogPageNew: number;
  /** Evidence events durable in a persisted catalog snapshot (rotation baseline). */
  evidenceAccepted: number;
  evidence: EvidenceEvent[];
  closed: boolean;
  durable: boolean;
  mode: "development" | "production";
  optimize: boolean;
  active: Map<bigint, Tx>;
  chain: Promise<void>;
}

export class Database {
  private tx: Tx | null = null;
  readonly durable: boolean;
  readonly pager: Pager;
  readonly mode: "development" | "production";
  private readonly tree: BTree;
  /** Log bytes appended since open; drives the retention check. */
  private rotationMeter: number = 0;
  /** Rotation budget in bytes; tests lower it, operations keep the default. */
  rotateBudget: number = ROTATE_MAX_BYTES;
  /** CTE / derived tables materialized for the statement in flight. */
  private temps = new Map<string, { cols: Column[]; rows: Record<string, SeamValue>[] }>();
  /** Materialized subquery results for the statement in flight, keyed by prettyExpr. */
  private subCache = new Map<string, { rows: SeamValue[][] }>();
  /** Window function outputs for the row batch in flight, keyed by prettyExpr. */
  private winVals = new Map<string, SeamValue[]>();
  /** Row index during window-aware projection; -1 when windows are not active. */
  private winRow = -1;
  /** The row whose context in/subquery hooks resolve against. */
  private curRow: Record<string, SeamValue> | null = null;
  /** View materialization depth guard (nested views). */
  private viewDepth = 0;

  private constructor(
    private readonly g: Shared,
    readonly identity: Identity,
  ) {
    this.durable = g.durable;
    this.pager = g.pager;
    this.mode = g.mode;
    this.tree = new BTree({
      pin: async (id) => (await this.pin(id)).raw,
      unpin: (id) => this.unpin(id),
      write: (id, raw) => this.writePage(id, raw),
      alloc: (type, oid) => this.allocPage(type, oid),
    });
  }

  connect(identity: Identity): Database {
    return new Database(this.g, identity);
  }

  setOptimize(on: boolean): void {
    this.g.optimize = on;
  }

  static async open(
    pager: Pager = new MemoryPager(),
    opts?: { identity?: Identity; mode?: "development" | "production"; key?: KeyProvider; optimize?: boolean },
  ): Promise<Database> {
    const mode = opts?.mode ?? "development";
    assertKeyForMode(opts?.key ?? null, mode);
    let store = pager;
    if (opts?.key) store = new EncryptedPager(store, opts.key);
    const g: Shared = {
      pager: store,
      cache: new Map(),
      nextPage: 1,
      nextXid: 1n,
      nextOid: 100n,
      lsn: 0n,
      prevLsn: 0n,
      clog: new Map(),
      tables: new Map(),
      views: new Map(),
      roles: new Set(["owner"]),
      grants: [],
      catalogVersion: 1,
      policyVersion: 1,
      catalogPage: 0,
      catalogPageNew: 0,
      evidence: [],
      evidenceAccepted: 0,
      xidFloor: 0n,
      closed: false,
      durable: store.durable,
      mode,
      optimize: opts?.optimize !== false,
      active: new Map(),
      chain: Promise.resolve(),
    };
    const db = new Database(g, opts?.identity ?? { user: "owner", roles: ["owner"] });
    if (!(await store.tryLock())) err("E_LOCK", "Another process owns this database directory.");
    const superRaw = await store.read(0);
    if (!superRaw) await db.initFresh();
    else {
      db.loadSuper(superRaw);
      await db.recover(await store.walBytes());
    }
    return db;
  }

  async close(): Promise<void> {
    if (this.g.closed) return;
    await this.checkpoint();
    await this.g.pager.unlock();
    this.g.closed = true;
  }

  async exec(source: string): Promise<QueryResult[]> {
    return this.serialize(async () => {
      const stmts = parse(source);
      const out: QueryResult[] = [];
      for (const s of stmts) {
        const view = {
          isOwner: this.isOwner(),
          table: (name: string) => {
            const t = this.g.tables.get(name);
            return t ? { name: t.name, columns: t.columns.map((c) => ({ name: c.name, type: c.type })) } : undefined;
          },
          view: (name: string) => {
            const v = this.g.views.get(name);
            if (!v) return undefined;
            return { name: v.name, columns: selectOutputCols(v.select as unknown as Statement, view) };
          },
        };
        if (s.k === "spill") typecheck(s.inner, view);
        else if (s.k !== "start" && s.k !== "lockin" && s.k !== "dip") typecheck(s, view);
        out.push(await this.run(s, source));
      }
      return out;
    });
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.g.chain.then(fn, fn);
    this.g.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  evidenceLog(): EvidenceEvent[] {
    return this.g.evidence.map((e) => ({ ...e }));
  }

  /**
   * Load the persisted catalog snapshot (catalog page + superblock fields).
   * Returns false when no snapshot exists; this is not an error by itself —
   * a restart record with no valid snapshot is, and recovery rejects that
   * combination explicitly (fail closed).
   */
  private async loadPersistedCatalog(): Promise<boolean> {
    if (!this.g.catalogPageNew) return false;
    const raw = await this.g.pager.read(this.g.catalogPageNew);
    if (!raw) return false;
    let p: ReturnType<typeof decodePage>;
    try {
      p = decodePage(raw);
    } catch {
      return false; // recover() turns this into E_WAL_CORRUPT: fail closed
    }
    if (p.type !== PT_CATALOG || p.slots.length !== 1) return false;
    let snap: CatSnap;
    try {
      snap = JSON.parse(new TextDecoder().decode(p.slots[0])) as CatSnap;
    } catch {
      return false;
    }
    this.applyCatalog(snap);
    this.g.catalogPage = this.g.catalogPageNew;
    this.g.xidFloor = BigInt(snap.xid_floor ?? "0");
    this.g.evidenceAccepted = snap.evidence_accepted ?? 0;
    return true;
  }

  /**
   * Catalog as the calling identity sees it. Owners see every table; other
   * identities see only the tables one of their roles holds any grant on, so
   * the browser-side schema tree cannot become a name oracle.
   */
  /** Current session's transaction state, or null when nothing is running. */
  txInfo(): { open: boolean; explicit: boolean; xid: string | null } {
    return { open: this.tx !== null, explicit: this.tx?.explicit ?? false, xid: this.tx ? this.tx.xid.toString() : null };
  }

  whoami(): { user: string; roles: string[]; owner: boolean } {
    return { user: this.identity.user, roles: [...this.identity.roles], owner: this.isOwner() };
  }

  catalogInfo(): TableInfo[] {
    const visible = (name: string): boolean =>
      this.isOwner() || this.g.grants.some((g) => g.table === name && this.identity.roles.includes(g.role));
    return [...this.g.tables.values()]
      .filter((t) => visible(t.name))
      .map((t) => ({
        name: t.name,
        oid: t.oid.toString(),
        indexes: t.indexes.map((i) => ({ name: i.name, columns: [...i.columns], unique: i.unique })),
        columns: t.columns.map((c) => ({
          name: c.name,
          type: typeName(c.type),
          declared: c.type,
          mainKey: c.pk,
          unique: c.unique,
          needed: c.needed,
          private: c.private,
          fallback: c.fallback ? prettyExpr(c.fallback) : null,
          atLeast: c.atLeast ? prettyExpr(c.atLeast) : null,
          references: c.fk ? `${c.fk.table}.${c.fk.column}` : null,
        })),
      }));
  }

  /** Registered views (create view …), for client introspection. */
  viewInfo(): Array<{ name: string }> {
    const visible = (name: string): boolean =>
      this.isOwner() || this.g.grants.some((g) => g.table === name && this.identity.roles.includes(g.role));
    return [...this.g.views.values()].filter((v) => visible(v.name)).map((v) => ({ name: v.name }));
  }

  private async initFresh(): Promise<void> {
    const raw = emptyPage(PT_SUPER, 0n, 0n, 1n);
    this.writeSuperInto(raw);
    await this.g.pager.write(0, raw);
    await this.g.pager.sync();
    const hdr = walHeader();
    await this.g.pager.walAppend(hdr);
    await this.g.pager.walSync();
  }

  private loadSuper(raw: Uint8Array): void {
    const p = decodePage(raw);
    if (p.type !== PT_SUPER || p.slots.length < 1) err("E_CORRUPT", "Superblock missing.");
    const s = p.slots[0];
    this.g.nextPage = Number(u64(s, 0));
    this.g.nextXid = u64(s, 8);
    this.g.nextOid = u64(s, 16);
    this.g.lsn = u64(s, 24);
    this.g.catalogVersion = Number(u32(s, 32));
    this.g.policyVersion = Number(u32(s, 36));
    if (s.length >= 44) this.g.catalogPage = Number(u32(s, SB_CATALOG_PAGE));
    if (s.length >= 52) this.g.xidFloor = u64(s, SB_XID_FLOOR);
    if (s.length >= 60) this.g.catalogPageNew = Number(u32(s, SB_CATALOG_PAGE_NEW));
  }

  private writeSuperInto(raw: Uint8Array): void {
    const s = new Uint8Array(SB_SLOT_LEN);
    putU64(s, 0, BigInt(this.g.nextPage));
    putU64(s, 8, this.g.nextXid);
    putU64(s, 16, this.g.nextOid);
    putU64(s, 24, this.g.lsn);
    putU32(s, 32, this.g.catalogVersion);
    putU32(s, 36, this.g.policyVersion);
    putU32(s, SB_CATALOG_PAGE, this.g.catalogPage);
    putU64(s, SB_XID_FLOOR, this.g.xidFloor);
    putU32(s, SB_CATALOG_PAGE_NEW, this.g.catalogPageNew);
    const page = decodePage(raw);
    const encoded = encodeSlots({ ...page, type: PT_SUPER }, [s], this.g.lsn);
    raw.set(encoded);
  }

  private async recover(wal: Uint8Array): Promise<void> {
    const recs = scanWal(wal);
    // A rotated log contains exactly one W_RESTART record: everything older
    // already lives in the data files plus the catalog snapshot the restart
    // record stamps as valid. Replay also starts from this point in a log
    // that was never rotated (lastCkpt acts as the replay boundary there).
    let restart = -1;
    let lastCkpt = -1;
    for (let i = 0; i < recs.length; i++) {
      if (recs[i].type === W_RESTART) restart = i;
      if (recs[i].type === W_CKPT) lastCkpt = i;
    }
    if (restart >= 0) {
      if (!(await this.loadPersistedCatalog())) {
        err("E_WAL_CORRUPT", "Restart record without a valid catalog snapshot.");
      }
    }
    // Pass 1: determine transaction outcomes from commit/abort records across
    // the WHOLE log — a commit before the last checkpoint still gates catalog
    // replay and page-image repair below. Only page Redo is bounded.
    const committed = new Set<bigint>();
    const started = new Set<bigint>();
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (r.type === W_BEGIN) started.add(r.xid);
      if (r.type === W_COMMIT) committed.add(r.xid);
      this.g.lsn = r.lsn > this.g.lsn ? r.lsn : this.g.lsn;
    }
    // Pass 2: redo durable records only. Uncommitted page images and catalog
    // snapshots never reach the data files, so replaying them would resurrect
    // writes from aborted or interrupted transactions. xid 0 marks system
    // records (initialization, non-transactional bookkeeping).
    //
    // In a log that was never rotated, page images before the last checkpoint
    // are already in the data files (redoing them would roll pages back); they
    // are kept as repair sources instead — if a data page fails its checksum,
    // the newest pre-checkpoint image rebuilds it. After a rotation there is
    // nothing before the restart record, so every image in the log is redone.
    const repair = new Map<number, Uint8Array>();
    const redone = new Set<number>();
    for (let i = restart >= 0 ? restart + 1 : 0; i < recs.length; i++) {
      const r = recs[i];
      if (r.xid !== 0n && !committed.has(r.xid)) continue;
      if (r.type === W_PAGE) {
        const pid = Number(u64(r.payload, 0));
        const page = r.payload.subarray(8);
        if (page.length !== PAGE_SIZE) err("E_WAL_CORRUPT", "WAL page image size.");
        if (restart < 0 && i <= lastCkpt) {
          repair.set(pid, page);
          continue;
        }
        redone.add(pid);
        await this.g.pager.write(pid, page);
        this.g.cache.delete(pid);
      }
      if (r.type === W_CAT) this.applyCatalog(JSON.parse(new TextDecoder().decode(r.payload)) as CatSnap);
      if (r.type === W_SUPER) {
        this.g.nextPage = Number(u64(r.payload, 0));
        this.g.nextXid = u64(r.payload, 8);
        this.g.nextOid = u64(r.payload, 16);
      }
      if (r.type === W_EVIDENCE) {
        this.g.evidence.push(JSON.parse(new TextDecoder().decode(r.payload)) as EvidenceEvent);
      }
    }
    // Post-restart events replayed from the log (no re-run: they are durable).
    if (this.g.evidence.length > this.g.evidenceAccepted) {
      this.g.evidenceAccepted = this.g.evidence.length;
    }
    // Repair pass: pages with no newer image are trusted as they are unless
    // they fail their checksum, in which case the newest pre-checkpoint image
    // restores them.
    for (const [pid, page] of repair) {
      if (redone.has(pid)) continue;
      const raw = await this.g.pager.read(pid);
      if (raw) {
        try {
          decodePage(raw);
          continue;
        } catch {
          // damaged page: rebuild it from the log
        }
      }
      await this.g.pager.write(pid, page);
      this.g.cache.delete(pid);
    }
    for (const xid of committed) this.g.clog.set(xid, "c");
    for (const xid of started) if (!committed.has(xid)) this.g.clog.set(xid, "a");
  }

  private applyCatalog(snap: CatSnap): void {
    this.g.tables.clear();
    this.g.roles = new Set(snap.roles);
    // A W_CAT snapshot carries the loss marker but never the event list: up to
    // `evidence_accepted` events were accepted at the last rotation and are
    // gone from the log. The list itself only ever grows in memory during an
    // open session (rotateWal keeps it) or via W_EVIDENCE replay. A snapshot
    // replayed from an OLD stretch of the log would otherwise resurrect events
    // already known to be lost.
    this.g.evidenceAccepted = Math.max(this.g.evidenceAccepted, snap.evidence_accepted ?? 0);
    const floor = BigInt(snap.xid_floor ?? "0");
    if (floor > this.g.xidFloor) this.g.xidFloor = floor;
    this.g.grants = snap.grants.map((g) => ({
      role: g.role,
      priv: g.priv,
      table: g.table,
      columns: g.columns === "*" ? "*" : g.columns,
      row: g.row ? extractWhen(g.row) : null,
    }));
    for (const t of snap.tables) {
      this.g.tables.set(t.name, {
        oid: BigInt(t.oid),
        name: t.name,
        heapPages: t.heapPages,
        indexes: t.indexes,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.type,
          pk: c.pk,
          unique: c.unique,
          needed: c.needed,
          private: c.private,
          fallback: c.fallback ? extractExpr(c.fallback) : null,
          fk: c.fk,
          atLeast: c.atLeast ? extractExpr(c.atLeast) : null,
        })),
      });
    }
    this.g.catalogVersion = snap.catalogVersion;
    this.g.policyVersion = snap.policyVersion;
    this.g.nextOid = BigInt(snap.nextOid);
  }

  private catalogSnap(): CatSnap {
    return {
      catalogVersion: this.g.catalogVersion,
      policyVersion: this.g.policyVersion,
      at_lsn: "0",
      xid_floor: this.g.xidFloor.toString(),
      evidence_accepted: this.g.evidence.length,
      nextOid: this.g.nextOid.toString(),
      roles: [...this.g.roles],
      grants: this.g.grants.map((g) => ({
        role: g.role,
        priv: g.priv,
        table: g.table,
        columns: g.columns,
        row: g.row ? pretty({ k: "yeet", table: "t", filter: g.row, span: g.row.span }).replace(/^yeet from t when /, "") : null,
      })),
      tables: [...this.g.tables.values()].map((t) => ({
        oid: t.oid.toString(),
        name: t.name,
        heapPages: t.heapPages,
        indexes: t.indexes,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.type,
          pk: c.pk,
          unique: c.unique,
          needed: c.needed,
          private: c.private,
          fallback: c.fallback ? prettyExprWrap(c.fallback) : null,
          fk: c.fk,
          atLeast: c.atLeast ? prettyExprWrap(c.atLeast) : null,
        })),
      })),
    };
  }

  private async run(stmt: Statement, source: string): Promise<QueryResult> {
    if (stmt.k === "spill") {
      const target =
        stmt.inner.k === "pull"
          ? stmt.inner.from
          : stmt.inner.k === "tweak" || stmt.inner.k === "yeet" || stmt.inner.k === "dropin"
            ? stmt.inner.table
            : "";
      if (target) this.assertPriv("spill", target, "*");
      const plan = this.planText(stmt.inner);
      return { columns: ["plan"], rows: [[{ t: "text", v: plan }]], xid: "0", commit_lsn: null, evidence_state: "none", plan };
    }
    if (stmt.k === "start") {
      if (this.tx) err("E_TX_STATE", "Already in a transaction.");
      await this.begin(true);
      return this.emptyResult();
    }
    if (stmt.k === "lockin") {
      if (!this.tx) err("E_TX_STATE", "No transaction to lock in.");
      return await this.commit();
    }
    if (stmt.k === "dip") {
      if (!this.tx) err("E_TX_STATE", "No transaction to dip from.");
      await this.abort();
      return this.emptyResult();
    }
    const auto = !this.tx;
    if (auto) await this.begin(false);
    try {
      let res: QueryResult;
      switch (stmt.k) {
        case "spawn":
          res = await this.spawn(stmt);
          break;
        case "index":
          res = await this.createIndex(stmt);
          break;
        case "let":
        case "block":
          res = await this.grantStmt(stmt);
          break;
        case "dropin":
          res = await this.insert(stmt);
          break;
        case "tweak":
          res = await this.update(stmt);
          break;
        case "yeet":
          res = await this.remove(stmt);
          break;
        case "pull":
          res = await this.pull(stmt);
          break;
        case "insertSel":
          res = await this.insertSel(stmt);
          break;
        case "view":
          res = await this.viewStmt(stmt);
          break;
        case "check":
          res = await this.checkTable(stmt.table);
          break;
        case "ship":
          res = await this.ship(stmt);
          break;
        case "alter":
          res = await this.alter(stmt);
          break;
        default:
          err("E_FEATURE_NOT_SUPPORTED", "Statement is not in seamql/0.1.");
      }
      if (auto) {
        const c = await this.commit(source, stmt);
        res.xid = c.xid;
        res.commit_lsn = c.commit_lsn;
        res.evidence_state = c.evidence_state;
      }
      return res;
    } catch (e) {
      if (this.tx) await this.abort();
      throw e;
    }
  }

  private emptyResult(): QueryResult {
    return { columns: [], rows: [], xid: this.tx ? this.tx.xid.toString() : "0", commit_lsn: null, evidence_state: "none" };
  }

  private async begin(explicit: boolean): Promise<void> {
    const xid = this.g.nextXid++;
    const snap: Snapshot = { xmax: xid, active: new Set(this.g.active.keys()) };
    this.tx = {
      xid,
      snap,
      explicit,
      dirtyPages: new Set(),
      status: "active",
      writer: false,
      writes: new Set(),
      catalogBackup: JSON.stringify(this.catalogSnap()),
    };
    this.g.active.set(xid, this.tx);
    await this.wal(W_BEGIN, xid, new Uint8Array());
    await this.walSuper();
  }

  private async commit(_source = "", stmt?: Statement): Promise<QueryResult> {
    const tx = this.requireTx();
    const rec = await this.wal(W_COMMIT, tx.xid, new Uint8Array());
    try {
      await this.g.pager.walSync();
    } catch (e) {
      err("E_COMMIT_AMBIGUOUS", "WAL sync failed after commit record.");
      void e;
    }
    this.g.clog.set(tx.xid, "c");
    tx.status = "committed";
    for (const pid of tx.dirtyPages) {
      const c = this.g.cache.get(pid);
      if (c) c.active = false;
    }
    let evidence_state: QueryResult["evidence_state"] = "none";
    if (stmt && stmt.k !== "pull" && stmt.k !== "check" && stmt.k !== "spill") {
      const ev: EvidenceEvent = {
        engine: "seamdb-engine/0.1.0",
        lang: LANG,
        xid: tx.xid.toString(),
        commit_lsn: rec.toString(),
        catalog_version: this.g.catalogVersion,
        statement_fp: await sha384Hex(utf8(pretty(stmt))),
        plan_fp: await sha384Hex(utf8(this.planText(stmt))),
        write_set: [...tx.writes],
        policy_version: this.g.policyVersion,
        ts_us: String(Date.now() * 1000),
        clock: "host-local",
        evidence_state: "COMMITTED",
      };
      try {
        await this.wal(W_EVIDENCE, tx.xid, utf8(JSON.stringify(ev)));
        this.g.evidence.push(ev);
        evidence_state = "COMMITTED";
      } catch {
        evidence_state = "COMMITTED_EVIDENCE_PENDING";
      }
    }
    this.g.active.delete(tx.xid);
    this.tx = null;
    try {
      await this.flushDirty();
    } catch {
      // The commit is already durable in the WAL; dirty pages stay cached and
      // are retried at the next flush or checkpoint.
    }
    return { columns: [], rows: [], xid: tx.xid.toString(), commit_lsn: rec.toString(), evidence_state };
  }

  private async abort(): Promise<void> {
    const tx = this.requireTx();
    await this.wal(W_ABORT, tx.xid, new Uint8Array());
    this.g.clog.set(tx.xid, "a");
    tx.status = "aborted";
    for (const pid of tx.dirtyPages) this.g.cache.delete(pid);
    this.applyCatalog(JSON.parse(tx.catalogBackup) as CatSnap);
    this.g.active.delete(tx.xid);
    this.tx = null;
  }

  /**
   * Take the single-writer lock for this transaction. Readers interleave freely;
   * a second writer is refused with E_CONFLICT instead of corrupting shared
   * cached pages. Auto-commit statements acquire and release it within one call.
   */
  private ensureWrite(table: string): Tx {
    const tx = this.requireTx();
    if (!tx.writer) {
      for (const [xid, other] of this.g.active) {
        if (xid !== tx.xid && other.writer) err("E_CONFLICT", "Another transaction holds the write lock.");
      }
      tx.writer = true;
    }
    tx.writes.add(table);
    return tx;
  }

  private requireTx(): Tx {
    if (!this.tx) err("E_TX_STATE", "No active transaction.");
    return this.tx;
  }

  private visible(t: HeapTuple, snap: Snapshot, xid: bigint): boolean {
    if (t.xmin === xid) return t.xmax !== xid;
    // Below the rotation floor the transaction is committed by definition;
    // the clog no longer carries pre-rotation entries.
    if (t.xmin < this.g.xidFloor) {
      if (t.xmax === 0n || t.xmax === xid) return t.xmax !== xid;
      // A durable xmax below the floor is a COMMITTED delete: aborted deletes
      // never reach disk (no-steal cache), so the deleter committed.
      if (t.xmax < this.g.xidFloor) return false;
      if (t.xmax >= snap.xmax || snap.active.has(t.xmax)) return true;
      return this.g.clog.get(t.xmax) !== "c";
    }
    if (this.g.clog.get(t.xmin) !== "c") return false;
    if (t.xmin >= snap.xmax || snap.active.has(t.xmin)) return false;
    if (t.xmax === 0n) return true;
    if (t.xmax === xid) return false;
    if (t.xmax < this.g.xidFloor) return true;
    if (this.g.clog.get(t.xmax) !== "c") return true;
    if (t.xmax >= snap.xmax || snap.active.has(t.xmax)) return true;
    return false;
  }

  private async spawn(stmt: Extract<Statement, { k: "spawn" }>): Promise<QueryResult> {
    this.ensureWrite(stmt.name);
    this.assertPriv("spawn", stmt.name, "*");
    if (this.g.tables.has(stmt.name)) err("E_UNIQUE", `Table \`${stmt.name}\` already exists.`);
    const columns = stmt.columns.map((c) => colFromDef(c));
    const pks = columns.filter((c) => c.pk);
    if (pks.length !== 1) err("E_SYNTAX", "Exactly one main key is required.");
    pks[0].needed = true;
    pks[0].unique = true;
    const oid = this.g.nextOid++;
    const heap = await this.allocPage(PT_HEAP, oid);
    const table: Table = { oid, name: stmt.name, columns, heapPages: [heap], indexes: [] };
    this.g.tables.set(stmt.name, table);
    this.g.catalogVersion++;
    await this.walCatalog();
    return this.emptyResult();
  }

  private async alter(stmt: Extract<Statement, { k: "alter" }>): Promise<QueryResult> {
    const t = this.mustTable(stmt.table);
    this.ensureWrite(t.name);
    this.assertPriv("spawn", t.name, "*");
    if (t.columns.some((c) => c.name === stmt.column.name)) err("E_UNIQUE", "Column already exists.");
    t.columns.push(colFromDef(stmt.column));
    this.g.catalogVersion++;
    await this.walCatalog();
    return this.emptyResult();
  }

  private async grantStmt(stmt: Extract<Statement, { k: "let" | "block" }>): Promise<QueryResult> {
    this.ensureWrite("catalog");
    if (!this.isOwner()) err("E_DENIED", "Only owner can let or block roles.");
    this.g.roles.add(stmt.role);
    if (stmt.k === "let") {
      this.g.grants.push({ role: stmt.role, priv: stmt.priv, table: stmt.target, columns: stmt.columns, row: stmt.row });
    } else {
      this.g.grants = this.g.grants.filter(
        (g) => !(g.role === stmt.role && g.priv === stmt.priv && g.table === stmt.target),
      );
    }
    this.g.policyVersion++;
    await this.walCatalog();
    return this.emptyResult();
  }

  private async createIndex(stmt: Extract<Statement, { k: "index" }>): Promise<QueryResult> {
    const t = this.mustTable(stmt.table);
    this.ensureWrite(t.name);
    this.assertPriv("index", t.name, "*");
    for (const c of stmt.columns) if (!t.columns.some((x) => x.name === c)) err("E_UNKNOWN_NAME", `No column \`${c}\`.`);
    const root = await this.allocPage(PT_BT_LEAF, t.oid);
    const unique = stmt.columns.every((c) => t.columns.find((x) => x.name === c)?.unique);
    t.indexes.push({ name: stmt.name, columns: stmt.columns, unique, root });
    await this.rebuildIndex(t, t.indexes[t.indexes.length - 1]);
    this.g.catalogVersion++;
    await this.walCatalog();
    return this.emptyResult();
  }

  private async insert(stmt: Extract<Statement, { k: "dropin" }>): Promise<QueryResult> {
    const t = this.mustTable(stmt.table);
    this.ensureWrite(t.name);
    this.assertPriv("tweak", t.name, "*");
    const tx = this.requireTx();
    await this.initSubs(stmt.fields.map((f) => f.expr));
    const ctx = this.ctx({});
    this.curRow = {};
    const values: SeamValue[] = t.columns.map((c) => {
      const f = stmt.fields.find((x) => x.name === c.name);
      if (f) return coerce(evalExpr(f.expr, ctx), c.type);
      if (c.fallback) return coerce(evalExpr(c.fallback, ctx), c.type);
      if (c.needed) err("E_NEEDED", `Column \`${c.name}\` is needed.`);
      return { t: "null" };
    });
    this.checkRow(t, values, ctx);
    await this.enforceUnique(t, values, null);
    await this.enforceFk(t, values);
    const tup = encodeTuple({ xmin: tx.xid, xmax: 0n, flags: 0, values });
    const tid = await this.heapInsert(t, tup);
    await this.indexMaintain(t, values, tid, "put");
    return this.emptyResult();
  }

  private async update(stmt: Extract<Statement, { k: "tweak" }>): Promise<QueryResult> {
    const t = this.mustTable(stmt.table);
    this.ensureWrite(t.name);
    this.assertPriv("tweak", t.name, stmt.sets.map((s) => s.name));
    const tx = this.requireTx();
    const policy = this.rowGrant("tweak", t.name);
    await this.initSubs([stmt.filter, ...stmt.sets.map((s) => s.expr)]);
    let n = 0;
    for (const rec of await this.scan(t)) {
      if (!this.visible(rec.tuple, tx.snap, tx.xid)) continue;
      const row = this.rowMap(t, rec.tuple.values);
      this.curRow = row;
      if (stmt.filter && !predTrue(stmt.filter, this.ctx(row))) continue;
      if (policy?.row && !predTrue(policy.row, this.ctx(row))) continue;
      this.conflict(rec.tuple, tx.xid);
      const next = rec.tuple.values.slice();
      const ctx = this.ctx(row);
      for (const s of stmt.sets) {
        const i = t.columns.findIndex((c) => c.name === s.name);
        if (i < 0) err("E_UNKNOWN_NAME", `No column \`${s.name}\`.`);
        next[i] = coerce(evalExpr(s.expr, ctx), t.columns[i].type);
      }
      this.checkRow(t, next, ctx);
      await this.enforceUnique(t, next, rec.tid);
      await this.enforceFk(t, next);
      await this.heapSetXmax(t, rec.tid, tx.xid);
      const tup = encodeTuple({ xmin: tx.xid, xmax: 0n, flags: 0, values: next });
      const tid = await this.heapInsert(t, tup);
      await this.indexMaintain(t, rec.tuple.values, rec.tid, "del");
      await this.indexMaintain(t, next, tid, "put");
      n++;
      if (n > 100000) err("E_LIMIT", "Too many row versions in one tweak.");
    }
    return this.emptyResult();
  }

  private async remove(stmt: Extract<Statement, { k: "yeet" }>): Promise<QueryResult> {
    const t = this.mustTable(stmt.table);
    this.ensureWrite(t.name);
    this.assertPriv("yeet", t.name, "*");
    const tx = this.requireTx();
    const policy = this.rowGrant("yeet", t.name);
    await this.initSubs([stmt.filter]);
    for (const rec of await this.scan(t)) {
      if (!this.visible(rec.tuple, tx.snap, tx.xid)) continue;
      const row = this.rowMap(t, rec.tuple.values);
      this.curRow = row;
      if (!predTrue(stmt.filter, this.ctx(row))) continue;
      if (policy?.row && !predTrue(policy.row, this.ctx(row))) continue;
      this.conflict(rec.tuple, tx.xid);
      await this.heapSetXmax(t, rec.tid, tx.xid);
      await this.indexMaintain(t, rec.tuple.values, rec.tid, "del");
    }
    return this.emptyResult();
  }

  private async pull(stmt: Extract<Statement, { k: "pull" }>): Promise<QueryResult> {
    const tx = this.requireTx();
    const savedTemps = this.temps;
    const savedSubs = this.subCache;
    const savedWin = this.winVals;
    // State save/restore: every nested select (CTE, view, subquery) starts with
    // fresh materialization state and puts the caller's back on exit.
    this.temps = new Map(savedTemps);
    this.subCache = new Map();
    this.winVals = new Map();
    try {
      // CTEs materialize first, each visible to the ones declared after it.
      for (const c of stmt.ctes) {
        const mat = await this.materialize(c.select, c.name);
        if (!mat) err("E_SYNTAX", `CTE \`${c.name}\` needs a select.`, { line: c.select.span.line, column: c.select.span.column });
        this.temps.set(c.name, mat);
      }
      // Base source: real table / CTE / derived table / view.
      let baseCols: Column[];
      let baseTable: Table | null = null;
      let rows: Record<string, SeamValue>[];
      let srcName: string;
      if (stmt.fromSel) {
        const mat = await this.materialize(stmt.fromSel.select, stmt.fromSel.alias);
        if (!mat) err("E_SYNTAX", "Derived table needs a select.", { line: stmt.span.line, column: stmt.span.column });
        this.temps.set(stmt.fromSel.alias, mat);
        srcName = stmt.fromSel.alias;
        baseCols = mat.cols;
        rows = mat.rows;
      } else {
        const temp = this.temps.get(stmt.from);
        const viewDef = temp ? undefined : this.g.views.get(stmt.from);
        const view = viewDef ?? null;
        if (temp) {
          srcName = stmt.from;
          baseCols = temp.cols;
          rows = temp.rows;
        } else if (view) {
          const mat = await this.materialize(view.select, stmt.from);
          if (!mat) err("E_UNKNOWN_NAME", `View \`${stmt.from}\` has no select to materialize.`, { line: stmt.span.line, column: stmt.span.column });
          srcName = stmt.from;
          baseCols = mat.cols;
          rows = mat.rows;
        } else {
          const t = this.mustTable(stmt.from);
          this.assertPriv("pull", t.name, "*");
          baseTable = t;
          srcName = t.name;
          baseCols = t.columns;
          const grant0 = this.rowGrant("pull", t.name);
          const phys = planPull(stmt, [...this.g.tables.values()].flatMap((tb) => tb.indexes.map((i) => ({ name: i.name, table: tb.name, columns: i.columns }))), this.g.optimize);
          const scanned = phys.k === "Filter" && phys.inner.k === "IndexPoint" ? await this.indexScanTable(t, phys.inner) : await this.scan(t);
          rows = scanned.filter((r) => this.visible(r.tuple, tx.snap, tx.xid)).map((r) => this.rowMap(t, r.tuple.values, t.name));
          if (grant0?.row) rows = rows.filter((row) => predTrue(grant0.row!, this.ctx(row)));
        }
      }
      const phys = planPull(stmt, [...this.g.tables.values()].flatMap((tb) => tb.indexes.map((i) => ({ name: i.name, table: tb.name, columns: i.columns }))), this.g.optimize);
      const grant = this.rowGrant("pull", srcName);
      // Joins — inner / left / right / full / cross, each side may be a table,
      // view, CTE, or derived table.
      for (const j of stmt.joins) {
        let right: Record<string, SeamValue>[];
        let rcols: Column[];
        const rtemp = this.temps.get(j.table);
        const rviewDef = rtemp ? undefined : this.g.views.get(j.table);
        const rview = rviewDef ?? null;
        if (rtemp) {
          rcols = rtemp.cols;
          right = rtemp.rows;
        } else if (rview) {
          const mat = await this.materialize(rview.select, j.alias ?? j.table);
          rcols = mat?.cols ?? [];
          right = mat?.rows ?? [];
        } else {
          const rt = this.mustTable(j.table);
          this.assertPriv("pull", rt.name, "*");
          const rgrant = this.rowGrant("pull", rt.name);
          rcols = rt.columns;
          right = (await this.scan(rt)).filter((r) => this.visible(r.tuple, tx.snap, tx.xid)).map((r) => this.rowMap(rt, r.tuple.values, j.alias ?? rt.name));
          if (rgrant?.row) right = right.filter((row) => predTrue(rgrant.row!, this.ctx(row)));
        }
        const joined: Record<string, SeamValue>[] = [];
        if (j.kind === "cross") {
          for (const L of rows) for (const R of right) joined.push({ ...L, ...R });
        } else {
          const matchedRight = new Set<number>();
          for (const L of rows) {
            let matched = false;
            for (let ri = 0; ri < right.length; ri++) {
              const R = right[ri];
              const ctx = this.ctx({ ...L, ...R });
              if (predTrue(j.on!, ctx)) {
                joined.push({ ...L, ...R });
                matched = true;
                matchedRight.add(ri);
              }
            }
        if (!matched && j.kind === "left") joined.push(this.nullExtend(L, rcols, j.alias ?? j.table, false));
          }
          if (j.kind === "right" || j.kind === "full") {
            const leftSchema = rows[0] ? Object.keys(rows[0]) : baseCols.flatMap((c) => [c.name, `${srcName}.${c.name}`]);
            for (const ri of right.keys()) {
              if (matchedRight.has(ri)) continue;
              if (j.kind === "right") {
                const nulls: Record<string, SeamValue> = {};
                for (const k of leftSchema) nulls[k] = { t: "null" };
                joined.push({ ...nulls, ...right[ri] });
              } else {
                const leftNulls: Record<string, SeamValue> = {};
                for (const k of leftSchema) leftNulls[k] = { t: "null" };
                joined.push({ ...leftNulls, ...right[ri], ...right[ri] });
              }
            }
          }
        }
        rows = joined;
        if (rows.length > 1_000_000) err("E_LIMIT", "Join blew past the row budget.");
      }
      // Materialize every subquery in the statement once, before row-wise eval.
      try {
        const exprs = [stmt.filter, stmt.having, ...stmt.joins.map((x) => x.on), ...stmt.proj, ...stmt.group, ...stmt.order.map((o) => o.expr)];
        await this.initSubs(exprs);
        if (stmt.filter) {
          const kept: Record<string, SeamValue>[] = [];
          for (const row of rows) {
            this.curRow = row;
            if (predTrue(stmt.filter!, this.ctx(row))) kept.push(row);
          }
          rows = kept;
        }
        // Aggregation / windows
        const agg = stmt.proj.some(isAggProj);
        const wfns = collectWfns([stmt.having, ...stmt.proj, ...stmt.order.map((o) => o.expr)]);
        this.winVals = new Map();
        try {
          if (wfns.length && (agg || stmt.group.length)) {
            err("E_FEATURE_NOT_SUPPORTED", "Window functions cannot be mixed with bunch by in v0.", { line: stmt.span.line, column: stmt.span.column });
          }
          if (stmt.order.length && !agg) {
            rows = rows.slice();
            rows.sort((a, b) => {
              for (const k of stmt.order) {
                this.curRow = a;
                const ca = evalExpr(k.expr, this.ctx(a));
                this.curRow = b;
                const cb = evalExpr(k.expr, this.ctx(b));
                const c = compareValues(ca, cb);
                if (c) return k.desc ? -c : c;
              }
              return 0;
            });
          }
          if (wfns.length) {
            const host = { ev: (e: Expr, row: Record<string, SeamValue>) => plainEval(e, row, this.ctx(row)) };
            this.winVals = computeWindows(rows, wfns, host);
          }
          let outRows: SeamValue[][];
          let colNames: string[];
          if (agg || stmt.group.length) {
            const groups = new Map<string, Record<string, SeamValue>[]>();
            for (const row of rows) {
              const key = JSON.stringify(stmt.group.map((g) => evalExpr(g, this.ctx(row))));
              const arr = groups.get(key) ?? [];
              arr.push(row);
              groups.set(key, arr);
            }
            const gentries = stmt.group.length === 0 ? [["__all", rows] as const] : [...groups.entries()];
            colNames = stmt.proj.map((p, i) => projName(p, i));
            outRows = gentries
              .filter(([, rs]) => {
                if (!stmt.having) return true;
                // HAVING is computed per group: aggregate call sites evaluate
                // once over the group, then splice in as synthetic columns.
                const { expr, row } = this.havingRow(stmt.having, rs);
                return predTrue(expr, this.ctx(row));
              })
              .map(([, rs]) => {
                this.curRow = rs[0] ?? {};
                return stmt.proj.map((p) => this.evalProjAgg(p, rs));
              });
          } else {
            colNames = stmt.proj.map((p, i) => projName(p, i));
            outRows = [];
            for (let i = 0; i < rows.length; i++) {
              const row = rows[i];
              this.winRow = i;
              this.curRow = row;
              if (stmt.proj.length === 1 && stmt.proj[0].op === "star") {
                if (stmt.joins.length || baseTable === null) err("E_FEATURE_NOT_SUPPORTED", "Star projection across joins/derived tables is not in seamql/0.1. Name the columns.");
                colNames = baseTable.columns.map((c) => c.name);
                outRows.push(baseTable.columns.map((c) => row[`${srcName}.${c.name}`] ?? row[c.name]));
              } else {
                outRows.push(stmt.proj.map((p) => (p.op === "star" ? { t: "null" as const } : this.evalProj(p, row, baseTable!))));
              }
            }
          }
          if (stmt.order.length && agg) {
            const base = this.ctx({});
            outRows.sort((a, b) => {
              for (let i = 0; i < stmt.order.length; i++) {
                const oa = evalOnRow(stmt.order[i]!.expr, a, colNames, base);
                const ob = evalOnRow(stmt.order[i]!.expr, b, colNames, base);
                const c = compareValues(oa, ob);
                if (c) return stmt.order[i]!.desc ? -c : c;
              }
              return 0;
            });
          }
          // Set operations (union / intersect / except chains)
          for (const op of stmt.ops) {
            const bres = await this.pull(op.select as Extract<Statement, { k: "pull" }>);
            if (bres.columns.length !== colNames.length) err("E_TYPE_MISMATCH", `${op.kind} needs equal column counts on both sides.`, { line: op.span.line, column: op.span.column });
            const key = (r: SeamValue[]) => JSON.stringify(r.map((v) => (v.t === "null" ? "null" : displayValue(v))));
            if (op.kind === "unionAll") {
              for (const r of bres.rows) outRows.push(r);
            } else if (op.kind === "union") {
              outRows = dedupeRows([...outRows, ...bres.rows], key);
            } else {
              const set = new Set(bres.rows.map(key));
              outRows = dedupeRows(
                outRows.filter((r) => (op.kind === "intersect" ? set.has(key(r)) : !set.has(key(r)))),
                key,
              );
            }
          }
          if (stmt.distinct) {
            const key = (r: SeamValue[]) => JSON.stringify(r.map((v) => (v.t === "null" ? "null" : displayValue(v))));
            outRows = dedupeRows(outRows, key);
          }
          if (stmt.offset != null) outRows = outRows.slice(stmt.offset);
          if (stmt.cap != null) outRows = outRows.slice(0, stmt.cap);
          if (grant && grant.columns !== "*" && baseTable) {
            const keep = new Set(grant.columns);
            const idx = colNames.map((n, i) => (keep.has(n) || keep.has(n.split(".").pop()!) ? i : -1)).filter((i) => i >= 0);
            colNames = idx.map((i) => colNames[i]);
            outRows = outRows.map((r) => idx.map((i) => r[i]));
          }
          if (baseTable) this.stripPrivate(baseTable, colNames, outRows);
          return { columns: colNames, rows: outRows, xid: tx.xid.toString(), commit_lsn: null, evidence_state: "none", plan: renderPhysical(phys) };
        } finally {
          this.winVals = savedWin;
          this.winRow = -1;
        }
      } finally {
        this.subCache = savedSubs;
        this.curRow = null;
      }
    } finally {
      this.temps = savedTemps;
    }
  }

  /** Rows whose right-side columns are filled with nulls (left/right join padding). */
  private nullExtend(L: Record<string, SeamValue>, rcols: Column[], rname: string, _leftSide: boolean): Record<string, SeamValue> {
    const out: Record<string, SeamValue> = { ...L };
    for (const c of rcols) {
      out[c.name] = { t: "null" };
      out[`${rname}.${c.name}`] = { t: "null" };
    }
    return out;
  }

  /**
   * Run every subquery (scalar / exists / in-select) in the expression set once
   * up front and hold it in memory; row-wise evaluation reads the cache instead
   * of re-running the query per row.
   */
  private async initSubs(exprs: Array<Expr | null | undefined>): Promise<void> {
    const nodes: Extract<Expr, { op: "subq" | "exists" | "in" }>[] = [];
    for (const e of exprs) {
      if (!e) continue;
      walkExpr(e, (x) => {
        if (x.op === "subq" || x.op === "exists" || (x.op === "in" && x.sub)) {
          nodes.push(x as Extract<Expr, { op: "subq" | "exists" | "in" }>);
        }
      });
    }
    const seen = new Set<string>();
    for (const n of nodes) {
      const key = prettyExpr(n);
      if (seen.has(key)) continue;
      seen.add(key);
      const sel = n.op === "in" ? n.sub : n.sel;
      if (!sel) continue;
      const res = await this.pull(sel as Extract<Statement, { k: "pull" }>);
      this.subCache.set(key, { rows: res.rows });
    }
  }

  /**
   * HAVING evaluates aggregates per group, not per row: every aggregate call
   * site is computed once over the group, then spliced into the predicate as a
   * synthetic column so the rest of the expression tree evaluates normally.
   */
  private havingRow(h: Expr, rs: Record<string, SeamValue>[]): { expr: Expr; row: Record<string, SeamValue> } {
    const extra: Record<string, SeamValue> = {};
    let n = 0;
    const sub = (e: Expr): Expr => {
      if (e.op === "fn" && isAgg(e.name)) {
        const name = `__having${n++}`;
        extra[name] = this.evalProjAgg(e, rs);
        return { op: "col", name, span: e.span };
      }
      if (e.op === "bin") return { ...e, left: sub(e.left), right: sub(e.right) };
      if (e.op === "case") return { ...e, whens: e.whens.map((w) => ({ when: sub(w.when), then: sub(w.then) })), els: e.els ? sub(e.els) : null };
      if (e.op === "unary") return { ...e, inner: sub(e.inner) };
      if (e.op === "cast") return { ...e, inner: sub(e.inner) };
      if (e.op === "in") return { ...e, left: sub(e.left), list: e.list.map(sub) };
      if (e.op === "like") return { ...e, left: sub(e.left) };
      if (e.op === "is") return { ...e, left: sub(e.left) };
      return e;
    };
    return { expr: sub(h), row: { ...(rs[0] ?? {}), ...extra } };
  }

  /**
   * `insert into t [(cols)] (select …)` — run the select, then feed each row
   * through the plain insert path: coercion, checks, unique, fk, index upkeep.
   */
  private async insertSel(stmt: Extract<Statement, { k: "insertSel" }>): Promise<QueryResult> {
    const t = this.mustTable(stmt.table);
    this.ensureWrite(t.name);
    this.assertPriv("tweak", t.name, "*");
    const tx = this.requireTx();
    const res = await this.pull(stmt.select);
    let n = 0;
    for (const vals of res.rows) {
      const ctx = this.ctx({});
      this.curRow = {};
      const values: SeamValue[] = t.columns.map((c) => {
        const i = stmt.columns.length
          ? stmt.columns.findIndex((x) => x === c.name)
          : res.columns.findIndex((x) => x.split(".").pop() === c.name);
        if (i < 0 || i >= vals.length || vals[i].t === "undefined" as unknown) {
          if (c.fallback) return coerce(evalExpr(c.fallback, ctx), c.type);
          if (c.needed) err("E_NEEDED", `Column \`${c.name}\` is needed.`);
          return { t: "null" };
        }
        return coerce(vals[i], c.type);
      });
      this.checkRow(t, values, ctx);
      await this.enforceUnique(t, values, null);
      await this.enforceFk(t, values);
      const tup = encodeTuple({ xmin: tx.xid, xmax: 0n, flags: 0, values });
      const tid = await this.heapInsert(t, tup);
      await this.indexMaintain(t, values, tid, "put");
      n++;
      if (n > 100000) err("E_LIMIT", "Too many rows in one insert-select.");
    }
    return this.emptyResult();
  }

  /**
   * `create view name as select` — the select is kept in the catalog; every
   * read re-runs it through the live engine, so a view always reflects current
   * data. `drop view name` removes it.
   */
  private async viewStmt(stmt: Extract<Statement, { k: "view" }>): Promise<QueryResult> {
    if (stmt.drop) {
      if (!this.g.views.has(stmt.name)) err("E_UNKNOWN_NAME", `No view \`${stmt.name}\`.`);
      this.g.views.delete(stmt.name);
      return this.emptyResult();
    }
    if (!stmt.select) err("E_SYNTAX", "create view requires a select.", { line: stmt.span.line, column: stmt.span.column });
    // Dry-run the select once: a broken view fails at creation time, not on the
    // first unlucky read.
    await this.pull(stmt.select);
    this.g.views.set(stmt.name, { name: stmt.name, select: stmt.select });
    return this.emptyResult();
  }

  /**
   * Materialize a nested select (CTE body, derived table, or view) and fill in
   * its output as a named source: rows carry both bare `col` keys and
   * `srcName.col` keys, so `c.col` references resolve exactly like real table
   * columns. Column types are inferred from the first non-null value.
   */
  private async materialize(select: Statement | null, srcName: string): Promise<{ cols: Column[]; rows: Record<string, SeamValue>[] } | null> {
    if (!select) return null;
    if (select.k !== "pull") return null;
    if (this.viewDepth > 8) err("E_LIMIT", "View materialization is too deep (recursive view?).", { line: select.span.line, column: select.span.column });
    this.viewDepth++;
    try {
      const res = await this.pull(select);
      const names = res.columns.map((c) => (c.includes(".") ? c.split(".")[1]! : c));
      const cols: Column[] = names.map((name, i) => {
        let ty: SeamType = { k: "text" };
        for (const r of res.rows) {
          if (r[i].t !== "null") {
            ty = valueType(r[i]);
            break;
          }
        }
        return { name, type: ty, pk: false, unique: false, needed: false, private: false, fallback: null, fk: null, atLeast: null };
      });
      const rows: Record<string, SeamValue>[] = res.rows.map((vals) => {
        const row: Record<string, SeamValue> = {};
        names.forEach((name, i) => {
          row[name] = vals[i];
          row[`${srcName}.${name}`] = vals[i];
        });
        return row;
      });
      return { cols, rows };
    } finally {
      this.viewDepth--;
    }
  }

  private async indexScanTable(t: Table, p: { k: "IndexPoint"; index: string; key: Expr }): Promise<Array<{ tid: Tid; tuple: HeapTuple }>> {
    const idx = t.indexes.find((i) => i.name === p.index);
    if (!idx || idx.columns.length !== 1) return this.scan(t);
    const tx = this.requireTx();
    const keyVal = evalExpr(p.key, this.ctx({}));
    const colType = t.columns.find((c) => c.name === idx.columns[0])?.type;
    if (!colType) return this.scan(t);
    const key = encodeKey([coerce(keyVal, colType)]);
    const tids = await this.tree.find(idx.root, key);
    const types = t.columns.map((c) => c.type);
    const out: Array<{ tid: Tid; tuple: HeapTuple }> = [];
    for (const tid of tids) {
      const rec = await this.heapGet(t, tid, types);
      if (rec && this.visible(rec.tuple, tx.snap, tx.xid)) out.push(rec);
    }
    return out;
  }

  private async heapGet(_t: Table, tid: Tid, types: SeamType[]): Promise<{ tid: Tid; tuple: HeapTuple } | null> {
    const buf = await this.pin(tid.page);
    const d = decodePage(buf.raw);
    const slot = d.slots[tid.slot];
    this.unpin(tid.page);
    if (!slot?.length) return null;
    return { tid, tuple: decodeTuple(slot, types) };
  }

  private evalProj(p: Expr, row: Record<string, SeamValue>, _t: Table): SeamValue {
    if (p.op === "star") err("E_SYNTAX", "Mixed star projection is not in v0.");
    return evalExpr(p, this.ctx(row));
  }

  private evalProjAgg(p: Expr, rows: Record<string, SeamValue>[]): SeamValue {
    if (p.op === "fn" && p.name === "__as") return this.evalProjAgg(p.args[0], rows);
    if (p.op === "fn" && isAgg(p.name)) {
      const n = p.name.toLowerCase();
      if (n === "tally" || n === "count") {
        if (p.args[0]?.op === "star") return { t: "int", v: BigInt(rows.length) };
        let c = 0n;
        for (const r of rows) if (evalExpr(p.args[0], this.ctx(r)).t !== "null") c++;
        return { t: "int", v: c };
      }
      const xs = rows.map((r) => evalExpr(p.args[0], this.ctx(r))).filter((v) => v.t !== "null");
      if (n === "sum" || n === "stack") {
        if (xs.length === 0) return { t: "null" };
        if (xs.every((v) => v.t === "int")) {
          let s = 0n;
          for (const v of xs) {
            if (v.t !== "int") err("E_TYPE_MISMATCH", "sum/stack needs whole numbers in v0.");
            s = checkInt(s + v.v);
          }
          return { t: "int", v: s };
        }
        if (xs.every((v) => v.t === "decimal")) {
          let scale = 0;
          for (const v of xs) if (v.t === "decimal") scale = Math.max(scale, v.v.scale);
          let s = 0n;
          for (const v of xs) if (v.t === "decimal") s = checkInt(s + v.v.rescaled(scale, 38).unscaled);
          return { t: "decimal", v: new Decimal(s, scale, 38) };
        }
        err("E_TYPE_MISMATCH", "sum/stack needs whole numbers or decimals, never a mix.");
      }
      if (n === "min" || n === "max") {
        let best = xs[0] ?? { t: "null" as const };
        for (const v of xs) {
          const c = compareValues(v, best);
          if (n === "min" ? c < 0 : c > 0) best = v;
        }
        return best;
      }
      if (n === "avg") {
        if (xs.length === 0) return { t: "null" };
        if (xs.every((v) => v.t === "int")) {
          let s = 0n;
          for (const v of xs) {
            if (v.t !== "int") err("E_TYPE_MISMATCH", "avg needs whole numbers in v0.");
            s += v.v;
          }
          return { t: "decimal", v: new Decimal((s * 100n) / BigInt(xs.length), 2, 38) };
        }
        if (xs.every((v) => v.t === "decimal")) {
          let scale = 0;
          for (const v of xs) if (v.t === "decimal") scale = Math.max(scale, v.v.scale);
          let s = 0n;
          for (const v of xs) if (v.t === "decimal") s += v.v.rescaled(scale, 38).unscaled;
          const extra = 6;
          return { t: "decimal", v: new Decimal((s * 10n ** BigInt(extra)) / BigInt(xs.length), scale + extra, 38) };
        }
        err("E_TYPE_MISMATCH", "avg needs whole numbers or decimals, never a mix.");
      }
    }
    return evalExpr(p, this.ctx(rows[0] ?? {}));
  }

  private async checkTable(name: string): Promise<QueryResult> {
    const t = this.mustTable(name);
    this.assertPriv("check", name, "*");
    let rows = 0;
    let bad = 0;
    for (const rec of await this.scan(t)) {
      if (!this.tx || !this.visible(rec.tuple, this.tx.snap, this.tx.xid)) continue;
      rows++;
      try {
        decodeTuple(encodeTuple(rec.tuple), t.columns.map((c) => c.type));
      } catch {
        bad++;
      }
    }
    for (const idx of t.indexes) {
      const fromHeap = (await this.scan(t)).filter((r) => this.tx && this.visible(r.tuple, this.tx.snap, this.tx.xid));
      for (const rec of fromHeap) {
        const key = encodeKey(idx.columns.map((c) => rec.tuple.values[t.columns.findIndex((x) => x.name === c)]));
        const found = await this.btreeFind(idx.root, key);
        if (found.length === 0) bad++;
      }
    }
    return {
      columns: ["rows", "faults"],
      rows: [
        [
          { t: "int", v: BigInt(rows) },
          { t: "int", v: BigInt(bad) },
        ],
      ],
      xid: this.tx?.xid.toString() ?? "0",
      commit_lsn: null,
      evidence_state: "none",
    };
  }

  private async ship(stmt: Extract<Statement, { k: "ship" }>): Promise<QueryResult> {
    this.assertPriv("ship", stmt.table, "*");
    const t = this.mustTable(stmt.table);
    const pulled = await this.pull({
      k: "pull",
      proj: [{ op: "star", span: stmt.span }],
      from: t.name,
      fromSel: null,
      ctes: [],
      joins: [],
      filter: null,
      group: [],
      having: null,
      order: [],
      cap: null,
      offset: null,
      distinct: false,
      ops: [],
      span: stmt.span,
    });
    const body = {
      spec: "seamdb.sealed/v1",
      table: t.name,
      lang: LANG,
      path: stmt.path,
      columns: pulled.columns,
      row_count: pulled.rows.length,
      // the digest covers the exported values, not the transaction that read them
      rows: pulled.rows.map((row) => row.map(displayValue)),
    };
    const digest = "sha384:" + (await sha384Hex(utf8(canonicalize(body))));
    return {
      columns: ["path", "digest", "rows"],
      rows: [[{ t: "text", v: stmt.path }, { t: "text", v: digest }, { t: "int", v: BigInt(pulled.rows.length) }]],
      xid: pulled.xid,
      commit_lsn: null,
      evidence_state: "none",
    };
  }

  private stripPrivate(t: Table, cols: string[], rows: SeamValue[][]): void {
    if (this.isOwner()) return;
    const priv = new Set(t.columns.filter((c) => c.private).map((c) => c.name));
    const grant = this.columnGrant("pull", t.name);
    rows.forEach((r, ri) => {
      r.forEach((_v, i) => {
        const n = cols[i]?.split(".").pop() ?? "";
        if (priv.has(n) && !(grant && grant !== "*" && grant.includes(n)) && grant !== "*") {
          rows[ri][i] = { t: "null" };
        }
      });
    });
  }

  private isOwner(): boolean {
    return this.identity.roles.includes("owner");
  }

  private assertPriv(priv: string, table: string, cols: string[] | "*"): void {
    if (this.isOwner()) return;
    const g = this.effectiveGrant(priv, table);
    if (!g) err("E_DENIED", "Not allowed.");
    if (cols !== "*" && g.columns !== "*") {
      for (const c of cols) if (!g.columns.includes(c)) err("E_DENIED", "Not allowed.");
    }
  }

  /**
   * Merge every grant matching this identity for one (privilege, table):
   * column sets union (a `*` grant absorbs the rest) and row predicates all
   * have to hold — one unrestricted grant lifts the row filter entirely.
   */
  private effectiveGrant(priv: string, table: string): Grant | undefined {
    if (this.isOwner()) return undefined;
    const matches = this.g.grants.filter(
      (x) => this.identity.roles.includes(x.role) && x.priv === priv && x.table === table,
    );
    if (matches.length === 0) return undefined;
    let columns: string[] | "*" = [];
    for (const g of matches) {
      if (g.columns === "*") {
        columns = "*";
        break;
      }
      columns = [...new Set([...columns, ...g.columns])];
    }
    let row: Expr | null = null;
    for (const g of matches) {
      if (!g.row) {
        row = null;
        break;
      }
      row = row ? { op: "bin", kind: "and", left: row, right: g.row, span: g.row.span } : g.row;
    }
    return { role: "(merged)", priv, table, columns, row };
  }

  private rowGrant(priv: string, table: string): Grant | undefined {
    return this.effectiveGrant(priv, table);
  }

  private columnGrant(priv: string, table: string): string[] | "*" | undefined {
    return this.effectiveGrant(priv, table)?.columns;
  }

  private mustTable(name: string): Table {
    const t = this.g.tables.get(name);
    if (!t) {
      if (this.isOwner()) err("E_UNKNOWN_NAME", `No table \`${name}\`.`);
      err("E_DENIED", "Not allowed.");
    }
    return t;
  }

  private checkRow(t: Table, values: SeamValue[], ctx: EvalCtx): void {
    t.columns.forEach((c, i) => {
      const v = values[i];
      if (c.needed && v.t === "null") err("E_NEEDED", `Column \`${c.name}\` is needed.`);
      if (c.atLeast && v.t !== "null") {
        const bound = coerce(evalExpr(c.atLeast, ctx), t.columns[i].type);
        if (compareValues(v, bound) < 0) err("E_TYPE_MISMATCH", `\`${c.name}\` is below at least.`);
      }
    });
  }

  private async enforceUnique(t: Table, values: SeamValue[], self: Tid | null): Promise<void> {
    const tx = this.requireTx();
    for (const c of t.columns.filter((x) => x.unique || x.pk)) {
      const i = t.columns.findIndex((x) => x.name === c.name);
      const v = values[i];
      if (v.t === "null" && !c.pk) continue;
      for (const rec of await this.scan(t)) {
        if (self && rec.tid.page === self.page && rec.tid.slot === self.slot) continue;
        if (!this.visible(rec.tuple, tx.snap, tx.xid) && rec.tuple.xmin !== tx.xid) continue;
        if (rec.tuple.xmax === tx.xid) continue;
        if (compareValues(rec.tuple.values[i], v) === 0) err("E_UNIQUE", `Unique/main key clash on \`${c.name}\`.`);
      }
    }
  }

  private async enforceFk(t: Table, values: SeamValue[]): Promise<void> {
    const tx = this.requireTx();
    for (let i = 0; i < t.columns.length; i++) {
      const c = t.columns[i];
      if (!c.fk || values[i].t === "null") continue;
      const parent = this.mustTable(c.fk.table);
      const pi = parent.columns.findIndex((x) => x.name === c.fk!.column);
      let ok = false;
      for (const rec of await this.scan(parent)) {
        if (!this.visible(rec.tuple, tx.snap, tx.xid)) continue;
        if (compareValues(rec.tuple.values[pi], values[i]) === 0) ok = true;
      }
      if (!ok) err("E_FK", `No visible linked row for \`${c.name}\`.`);
    }
  }

  private conflict(tuple: HeapTuple, xid: bigint): void {
    if (tuple.xmax !== 0n && tuple.xmax !== xid && this.g.clog.get(tuple.xmax) !== "a") err("E_CONFLICT", "Another transaction wrote this row.");
  }

  private rowMap(t: Table, values: SeamValue[], alias = t.name): Record<string, SeamValue> {
    const row: Record<string, SeamValue> = {};
    t.columns.forEach((c, i) => {
      row[c.name] = values[i];
      row[`${alias}.${c.name}`] = values[i];
    });
    return row;
  }

  private ctx(row: Record<string, SeamValue>): EvalCtx {
    const now = BigInt(Date.now()) * 1000n;
    const db = this;
    return {
      row,
      now,
      today: Number(now / 86400000000n),
      subQ: (e) => db.subLookup(e),
      winPath: (e) => db.winLookup(e),
    };
  }

  /** Resolve a materialized subquery / exists / in (select …) node against the
   * row currently under evaluation. */
  private subLookup(e: Extract<Expr, { op: "subq" | "exists" | "in" }>): SeamValue {
    if (e.op === "in" && e.sub) {
      const cached = this.subCache.get(prettyExpr(e));
      if (!cached) err("E_SYNTAX", "Subquery was not materialized.", { line: e.span.line, column: e.span.column });
      const l = evalExpr(e.left, this.ctx(this.curRow ?? {}));
      let hit = false;
      for (const r of cached.rows) if (compareValues(r[0]!, l) === 0) hit = true;
      if (l.t === "null") return { t: "null" };
      return { t: "bool", v: e.not ? !hit : hit };
    }
    if (e.op === "exists") {
      const cached = this.subCache.get(prettyExpr(e));
      if (!cached) err("E_SYNTAX", "Subquery was not materialized.", { line: e.span.line, column: e.span.column });
      return { t: "bool", v: cached.rows.length > 0 };
    }
    const cached = this.subCache.get(prettyExpr(e));
    if (!cached) err("E_SYNTAX", "Subquery was not materialized.", { line: e.span.line, column: e.span.column });
    if (cached.rows.length > 1) err("E_LIMIT", "Scalar subquery returned more than one row.", { line: e.span.line, column: e.span.column });
    return cached.rows[0]?.[0] ?? { t: "null" };
  }

  private winLookup(e: Extract<Expr, { op: "wfn" }>): SeamValue {
    const vals = this.winVals.get(prettyExpr(e));
    if (!vals) err("E_SYNTAX", "Window result is not attached.", { line: e.span.line, column: e.span.column });
    if (this.winRow < 0) err("E_SYNTAX", "Window function used outside its row context.", { line: e.span.line, column: e.span.column });
    return vals[this.winRow] ?? { t: "null" };
  }

  private planText(stmt: Statement): string {
    if (stmt.k === "pull") {
      const idxs = [...this.g.tables.values()].flatMap((tb) => tb.indexes.map((i) => ({ name: i.name, table: tb.name, columns: i.columns })));
      return renderPhysical(planPull(stmt, idxs, this.g.optimize));
    }
    return pretty(stmt);
  }

  private async scan(t: Table): Promise<Array<{ tid: Tid; tuple: HeapTuple }>> {
    const out: Array<{ tid: Tid; tuple: HeapTuple }> = [];
    const types = t.columns.map((c) => c.type);
    for (const pid of t.heapPages) {
      const page = await this.pin(pid);
      const d = decodePage(page.raw);
      d.slots.forEach((slot, i) => {
        if (!slot.length) return;
        out.push({ tid: { page: pid, slot: i }, tuple: decodeTuple(slot, types) });
      });
      this.unpin(pid);
    }
    if (out.length > 100000) err("E_LIMIT", "Scan exceeded 100000 tuples.");
    return out;
  }

  private async heapInsert(t: Table, tup: Uint8Array): Promise<Tid> {
    for (const pid of t.heapPages) {
      const buf = await this.pin(pid);
      if (freeSpace(buf.raw) >= tup.length + 4) {
        const d = decodePage(buf.raw);
        const slots = d.slots.slice();
        slots.push(tup);
        await this.writePage(pid, encodeSlots(d, slots, this.g.lsn + 1n));
        this.unpin(pid);
        return { page: pid, slot: slots.length - 1 };
      }
      this.unpin(pid);
    }
    const pid = await this.allocPage(PT_HEAP, t.oid);
    t.heapPages.push(pid);
    await this.walCatalog();
    const buf = await this.pin(pid);
    const d = decodePage(buf.raw);
    await this.writePage(pid, encodeSlots(d, [tup], this.g.lsn + 1n));
    this.unpin(pid);
    return { page: pid, slot: 0 };
  }

  private async heapSetXmax(t: Table, tid: Tid, xmax: bigint): Promise<void> {
    const buf = await this.pin(tid.page);
    const d = decodePage(buf.raw);
    const types = t.columns.map((c) => c.type);
    const tup = decodeTuple(d.slots[tid.slot], types);
    tup.xmax = xmax;
    const slots = d.slots.slice();
    slots[tid.slot] = encodeTuple(tup);
    await this.writePage(tid.page, encodeSlots(d, slots, this.g.lsn + 1n));
    this.unpin(tid.page);
  }

  private async indexMaintain(t: Table, values: SeamValue[], tid: Tid, op: "put" | "del"): Promise<void> {
    for (const idx of t.indexes) {
      const key = encodeKey(idx.columns.map((c) => values[t.columns.findIndex((x) => x.name === c)]));
      if (op === "put") {
        const root = await this.tree.insert(idx, key, tid);
        if (root !== idx.root) {
          idx.root = root;
          await this.walCatalog();
        }
      } else {
        idx.root = await this.tree.delete(idx.root, key, tid);
      }
    }
  }

  private async rebuildIndex(t: Table, idx: IndexDef): Promise<void> {
    const tx = this.requireTx();
    for (const rec of await this.scan(t)) {
      if (!this.visible(rec.tuple, tx.snap, tx.xid)) continue;
      const key = encodeKey(idx.columns.map((c) => rec.tuple.values[t.columns.findIndex((x) => x.name === c)]));
      idx.root = await this.tree.insert(idx, key, rec.tid);
    }
  }

  private async btreeFind(root: number, key: Uint8Array): Promise<Tid[]> {
    return this.tree.find(root, key);
  }

  private async allocPage(type: 1 | 2 | 3 | 4 | 5 | 6, oid: bigint): Promise<number> {
    const id = this.g.nextPage++;
    const raw = emptyPage(type, BigInt(id), oid, 1n);
    await this.writePage(id, raw);
    await this.walSuper();
    return id;
  }

  private async pin(id: number): Promise<{ raw: Uint8Array }> {
    let e = this.g.cache.get(id);
    if (!e) {
      const raw = await this.getRaw(id);
      e = { raw, pin: 0, dirty: false, active: false };
      this.g.cache.set(id, e);
    }
    e.pin++;
    return e;
  }

  private unpin(id: number): void {
    const e = this.g.cache.get(id);
    if (e && e.pin > 0) e.pin--;
  }

  private async getRaw(id: number): Promise<Uint8Array> {
    const c = this.g.cache.get(id);
    if (c) return c.raw;
    const raw = await this.g.pager.read(id);
    if (!raw) err("E_CORRUPT", `Missing page ${id}.`);
    decodePage(raw);
    return raw;
  }

  private async writePage(id: number, raw: Uint8Array): Promise<void> {
    decodePage(raw);
    const payload = new Uint8Array(8 + PAGE_SIZE);
    putU64(payload, 0, BigInt(id));
    payload.set(raw, 8);
    await this.wal(W_PAGE, this.tx?.xid ?? 0n, payload);
    let e = this.g.cache.get(id);
    if (!e) {
      e = { raw, pin: 0, dirty: true, active: true };
      this.g.cache.set(id, e);
    } else {
      e.raw = raw;
      e.dirty = true;
      e.active = true;
    }
    this.tx?.dirtyPages.add(id);
    if (this.g.cache.size > 256) this.evict();
  }

  private evict(): void {
    for (const [id, e] of this.g.cache) {
      if (e.pin === 0 && !e.dirty && !e.active) {
        this.g.cache.delete(id);
        if (this.g.cache.size <= 256) return;
      }
    }
    if (this.g.cache.size > 512) err("E_LIMIT", "Buffer pool exhausted (no-steal).");
  }

  private async flushDirty(): Promise<void> {
    for (const [id, e] of this.g.cache) {
      if (e.dirty && !e.active) {
        await this.g.pager.write(id, e.raw);
        e.dirty = false;
      }
    }
    const superRaw = emptyPage(PT_SUPER, 0n, 0n, 1n);
    this.writeSuperInto(superRaw);
    await this.g.pager.write(0, superRaw);
    await this.g.pager.sync();
  }

  private async checkpoint(): Promise<void> {
    await this.flushDirty();
    await this.wal(W_CKPT, 0n, new Uint8Array());
    await this.g.pager.walSync();
    // Rotate when the log holds more transaction records than the retention
    // budget. flushDirty put every dirty page and the superblock in the data
    // files first, so from here on the data files alone are a consistent
    // database; the log only needs to carry work newer than that. The catalog
    // snapshot (including the xid floor and the evidence-loss marker) is
    // written on each rotation, so an abrupt stop right after a rotation loses
    // nothing but events already re-logged below.
    if (this.shouldRotate()) await this.rotateWal();
  }

  /** Rotation trigger: bytes appended since the last baseline exceeds budget. */
  private shouldRotate(): boolean {
    if (this.tx) return false;
    return this.rotationMeter > this.rotateBudget;
  }

  /** Public hook: force a checkpoint (and rotation, if the budget is met). */
  async checkpointNow(): Promise<void> {
    return this.serialize(() => this.checkpoint());
  }

  /**
   * Replace the log with a fresh one. Sequence (fixed order, crash-safe):
   *  1. allocate the catalog page slot in the superblock FIRST, then sync
   *     (a stop before the restart record leaves a stale/absent override —
   *     both load as the previous, good snapshot);
   *  2. persist the catalog snapshot with `at_lsn` = current LSN and
   *     `xid_floor` folded in, plus the evidence-loss marker;
   *  3. write the restart record; replace the log with exactly one record.
   * Recovery only ever honors the restart record, so torn steps are inert.
   */
  private async rotateWal(): Promise<void> {
    const prevCatalog = this.g.catalogPageNew;
    const page = this.g.nextPage++;
    this.g.catalogPageNew = page;
    if (prevCatalog !== 0) await this.g.pager.write(prevCatalog, emptyPage(PT_FREE, BigInt(prevCatalog), 0n, 1n));
    await this.flushDirty(); // catalogs live in the superblock now

    // Every xid below nextXid is resolved (committed, or aborted with no
    // durable page image — the no-steal cache guarantees aborted writes never
    // reach disk). Bumping the floor to nextXid lets the trimmed log forget
    // their commit records without changing what any future snapshot sees.
    this.g.xidFloor = this.g.nextXid;
    const snap = this.catalogSnap();
    snap.at_lsn = this.g.lsn.toString();
    snap.xid_floor = this.g.xidFloor.toString();
    snap.evidence_accepted = this.g.evidenceAccepted;
    const raw = emptyPage(PT_CATALOG, BigInt(page), 0n, 1n);
    const encoded = encodeSlots({ ...decodePage(raw), type: PT_CATALOG }, [utf8(JSON.stringify(snap))], this.g.lsn);
    raw.set(encoded);
    await this.g.pager.write(page, raw);
    await this.g.pager.sync();

    this.g.prevLsn = this.g.lsn;
    await this.wal(W_RESTART, 0n, new Uint8Array());
    this.rotationMeter = 0;
    await this.g.pager.walTruncate(16);
    await this.wal(W_RESTART, 0n, new Uint8Array());
    await this.g.pager.walSync();
  }

  private async wal(type: number, xid: bigint, payload: Uint8Array): Promise<bigint> {
    this.g.lsn += 1n;
    const rec = new Uint8Array(38 + payload.length);
    putU32(rec, 0, WMAGIC);
    putU32(rec, 4, payload.length);
    rec[8] = type;
    rec[9] = 0;
    putU64(rec, 10, this.g.lsn);
    putU64(rec, 18, this.g.prevLsn);
    putU64(rec, 26, xid);
    rec.set(payload, 38);
    putU32(rec, 34, 0);
    putU32(rec, 34, crc32(rec));
    this.g.prevLsn = this.g.lsn;
    await this.g.pager.walAppend(rec);
    this.rotationMeter += rec.length;
    return this.g.lsn;
  }

  private async walCatalog(): Promise<void> {
    await this.wal(W_CAT, this.tx?.xid ?? 0n, utf8(JSON.stringify(this.catalogSnap())));
  }

  private async walSuper(): Promise<void> {
    const p = new Uint8Array(24);
    putU64(p, 0, BigInt(this.g.nextPage));
    putU64(p, 8, this.g.nextXid);
    putU64(p, 16, this.g.nextOid);
    await this.wal(W_SUPER, this.tx?.xid ?? 0n, p);
  }
}

interface CatSnap {
  catalogVersion: number;
  policyVersion: number;
  /** Highest commit LSN represented by this snapshot; 0 = never rotated. */
  at_lsn: string;
  /** Transactions below the log floor are committed by definition. */
  xid_floor: string;
  /** Evidence events durable in this snapshot; events above the accepted count
   * were re-logged in the WAL and lost with it. Declared openly, never hidden. */
  evidence_accepted: number;
  nextOid: string;
  roles: string[];
  grants: { role: string; priv: string; table: string; columns: string[] | "*"; row: string | null }[];
  tables: Array<{
    oid: string;
    name: string;
    heapPages: number[];
    indexes: IndexDef[];
    columns: Array<{
      name: string;
      type: SeamType;
      pk: boolean;
      unique: boolean;
      needed: boolean;
      private: boolean;
      fallback: string | null;
      fk: { table: string; column: string } | null;
      atLeast: string | null;
    }>;
  }>;
}

/**
 * Walk the write-ahead log and collect every record that carries a valid
 * checksum. A damaged stretch is skipped byte by byte instead of ending the
 * scan, so corruption in the middle of the log cannot hide the records that
 * follow it (including the checkpoint that tells replay where to start).
 */
function scanWal(wal: Uint8Array): Array<{ type: number; xid: bigint; lsn: bigint; payload: Uint8Array }> {
  const recs: Array<{ type: number; xid: bigint; lsn: bigint; payload: Uint8Array }> = [];
  const hasHeader = wal.length >= 16 && wal[0] === 0x53 && wal[1] === 0x45 && wal[2] === 0x41 && wal[3] === 0x57;
  let off = hasHeader ? 16 : 0;
  while (off + 38 <= wal.length) {
    const magic = u32(wal, off);
    const len = u32(wal, off + 4);
    if (magic === WMAGIC && len <= 1024 * 1024 && off + 38 + len <= wal.length) {
      const rec = wal.subarray(off, off + 38 + len);
      const stored = u32(rec, 34);
      const copy = rec.slice();
      putU32(copy, 34, 0);
      if (crc32(copy) === stored) {
        recs.push({ type: rec[8], xid: u64(rec, 26), lsn: u64(rec, 10), payload: rec.subarray(38) });
        off += 38 + len;
        continue;
      }
    }
    off++;
  }
  return recs;
}

function walHeader(): Uint8Array {
  const h = new Uint8Array(16);
  h[0] = 0x53;
  h[1] = 0x45;
  h[2] = 0x41;
  h[3] = 0x57;
  putU16(h, 4, 1);
  putU16(h, 6, 16);
  return h;
}

function colFromDef(c: ColDef): Column {
  const type = specType(c.type);
  const col: Column = {
    name: c.name,
    type,
    pk: c.modifiers.some((m) => m.k === "pk"),
    unique: c.modifiers.some((m) => m.k === "unique" || m.k === "pk"),
    needed: c.modifiers.some((m) => m.k === "needed" || m.k === "pk"),
    private: c.modifiers.some((m) => m.k === "private"),
    fallback: c.modifiers.find((m) => m.k === "fallback")?.k === "fallback" ? (c.modifiers.find((m) => m.k === "fallback") as { expr: Expr }).expr : null,
    fk: (() => {
      const m = c.modifiers.find((x) => x.k === "fk");
      return m && m.k === "fk" ? { table: m.table, column: m.column } : null;
    })(),
    atLeast: (() => {
      const m = c.modifiers.find((x) => x.k === "at_least");
      return m && m.k === "at_least" ? m.expr : null;
    })(),
  };
  return col;
}

function specType(t: TypeSpec): SeamType {
  if (t.k === "int") return { k: "int" };
  if (t.k === "decimal") return { k: "decimal", precision: t.precision, scale: t.scale };
  if (t.k === "text") return { k: "text" };
  if (t.k === "bool") return { k: "bool" };
  if (t.k === "stamp") return { k: "stamp" };
  return { k: "day" };
}

function coerce(v: SeamValue, ty: SeamType): SeamValue {
  if (v.t === "null") return v;
  if (ty.k === "int" && v.t === "int") return { t: "int", v: checkInt(v.v) };
  if (ty.k === "text" && v.t === "text") return v;
  if (ty.k === "bool" && v.t === "bool") return v;
  if (ty.k === "stamp" && v.t === "stamp") return v;
  if (ty.k === "day" && v.t === "day") return v;
  if (ty.k === "decimal" && v.t === "decimal") return { t: "decimal", v: v.v.rescaled(ty.scale, ty.precision) };
  if (ty.k === "decimal" && v.t === "int") return { t: "decimal", v: new Decimal(v.v, 0, ty.precision).rescaled(ty.scale, ty.precision) };
  if (ty.k === "stamp" && v.t === "int") return { t: "stamp", v: v.v };
  if (ty.k === "day" && v.t === "int") return { t: "day", v: Number(v.v) };
  err("E_TYPE_MISMATCH", `${typeName(ty)} vs ${v.t}. No implicit conversion was performed.`, {
    hint: `Try a ${typeName(ty)} value.`,
  });
}

function isAgg(name: string): boolean {
  return ["count", "tally", "sum", "stack", "min", "max", "avg"].includes(name.toLowerCase());
}

function isAggProj(p: Expr): boolean {
  if (p.op !== "fn") return false;
  if (isAgg(p.name)) return true;
  return p.name === "__as" && p.args[0]?.op === "fn" && isAgg(p.args[0].name);
}

/** Keep the first occurrence of every distinct row (union / distinct / except). */
function dedupeRows(rows: SeamValue[][], key: (r: SeamValue[]) => string): SeamValue[][] {
  const seen = new Set<string>();
  const out: SeamValue[][] = [];
  for (const r of rows) {
    const k = key(r);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}

function projName(p: Expr, i: number): string {
  if (p.op === "col") return p.name;
  if (p.op === "fn" && p.name === "__as" && p.args[1]?.op === "col") return p.args[1].name;
  if (p.op === "fn") return p.name;
  return `c${i}`;
}

function extractWhen(src: string): Expr {
  const s = parse(`yeet from t when ${src}`)[0];
  if (s.k !== "yeet") err("E_CORRUPT", "Catalog predicate corrupt.");
  return s.filter;
}

function extractExpr(src: string): Expr {
  const s = parse(`drop in t { x: ${src} }`)[0];
  if (s.k !== "dropin") err("E_CORRUPT", "Catalog expr corrupt.");
  return s.fields[0].expr;
}

function prettyExprWrap(e: Expr): string {
  return pretty({ k: "dropin", table: "t", fields: [{ name: "x", expr: e }], span: e.span }).replace(/^drop in t \{ x: /, "").replace(/ \}$/, "");
}

function evalOnRow(expr: Expr, row: SeamValue[], names: string[], base: EvalCtx): SeamValue {
  const map: Record<string, SeamValue> = { ...base.row };
  names.forEach((n, i) => {
    map[n] = row[i];
  });
  return evalExpr(expr, { ...base, row: map });
}

void displayValue;
void Database;
