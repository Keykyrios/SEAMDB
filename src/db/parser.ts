import { Decimal } from "./codec";
import { err } from "./errors";
import { lex, type Token } from "./lexer";

export interface Span {
  line: number;
  column: number;
  offset: number;
}

export type Expr =
  | { op: "lit"; value: Literal; span: Span }
  | { op: "col"; table?: string; name: string; span: Span }
  | { op: "star"; table?: string; span: Span }
  | { op: "fn"; name: string; args: Expr[]; span: Span }
  /** Window function: `fn(args) over (partition by ... order by ...)`. */
  | { op: "wfn"; name: string; args: Expr[]; partition: Expr[]; order: { expr: Expr; desc: boolean }[]; span: Span }
  | { op: "case"; whens: { when: Expr; then: Expr }[]; els: Expr | null; span: Span }
  | { op: "in"; left: Expr; sub: PullStmt | null; list: Expr[]; not: boolean; span: Span }
  | { op: "exists"; sel: PullStmt; span: Span }
  /** Scalar subquery - materialized up front by the engine. */
  | { op: "subq"; sel: PullStmt; span: Span }
  | { op: "like"; left: Expr; pat: string; not: boolean; span: Span }
  | { op: "unary"; kind: "-" | "not"; inner: Expr; span: Span }
  | { op: "bin"; kind: Bin; left: Expr; right: Expr; span: Span }
  | { op: "is"; left: Expr; not: boolean; right: Literal | { t: "null" }; span: Span }
  | { op: "cast"; inner: Expr; type: TypeSpec; span: Span };

export type Bin = "or" | "and" | "eq" | "ne" | "lt" | "gt" | "le" | "ge" | "+" | "-" | "*" | "/";

export type JoinKind = "inner" | "left" | "right" | "full" | "cross";

export interface PullStmt {
  k: "pull";
  proj: Expr[];
  from: string;
  fromSel: { select: Statement; alias: string } | null;
  ctes: { name: string; select: Statement }[];
  joins: { table: string; alias: string | null; on: Expr | null; kind: JoinKind }[];
  filter: Expr | null;
  group: Expr[];
  having: Expr | null;
  order: { expr: Expr; desc: boolean }[];
  cap: number | null;
  offset: number | null;
  distinct: boolean;
  ops: SetOp[];
  span: Span;
}

export interface SetOp {
  kind: "union" | "unionAll" | "intersect" | "except";
  select: Statement;
  span: Span;
}

export type Literal =
  | { t: "null" }
  | { t: "int"; v: bigint }
  | { t: "decimal"; v: Decimal }
  | { t: "text"; v: string }
  | { t: "bool"; v: boolean };

export type TypeSpec =
  | { k: "int" }
  | { k: "decimal"; precision: number; scale: number }
  | { k: "text" }
  | { k: "bool" }
  | { k: "stamp" }
  | { k: "day" };

export type Modifier =
  | { k: "pk" }
  | { k: "private" }
  | { k: "unique" }
  | { k: "needed" }
  | { k: "fallback"; expr: Expr }
  | { k: "fk"; table: string; column: string }
  | { k: "at_least"; expr: Expr };

export interface ColDef {
  name: string;
  type: TypeSpec;
  modifiers: Modifier[];
  span: Span;
}

export type Statement =
  | { k: "spawn"; name: string; columns: ColDef[]; span: Span }
  | { k: "index"; name: string; table: string; columns: string[]; span: Span }
  | { k: "let"; role: string; priv: Priv; target: string; columns: string[] | "*"; row: Expr | null; span: Span }
  | { k: "block"; role: string; priv: Priv; target: string; columns: string[] | "*"; row: Expr | null; span: Span }
  | { k: "dropin"; table: string; fields: { name: string; expr: Expr }[]; span: Span }
  | { k: "tweak"; table: string; sets: { name: string; expr: Expr }[]; filter: Expr | null; span: Span }
  | { k: "yeet"; table: string; filter: Expr; span: Span }    | {
      k: "pull";
      proj: Expr[];
      from: string;
      fromSel: { select: Statement; alias: string } | null;
      ctes: { name: string; select: Statement }[];
      joins: { table: string; alias: string | null; on: Expr | null; kind: JoinKind }[];
      filter: Expr | null;
      group: Expr[];
      having: Expr | null;
      order: { expr: Expr; desc: boolean }[];
      cap: number | null;
      offset: number | null;
      distinct: boolean;
      ops: SetOp[];
      span: Span;
    }
  | { k: "start"; span: Span }
  | { k: "lockin"; span: Span }
  | { k: "dip"; span: Span }
  | { k: "spill"; inner: Statement; span: Span }
  | { k: "check"; table: string; span: Span }
  | { k: "ship"; table: string; path: string; span: Span }
  | { k: "alter"; table: string; column: ColDef; span: Span }
  | { k: "insertSel"; table: string; columns: string[]; select: PullStmt; span: Span }
  | { k: "view"; name: string; select: PullStmt | null; drop: boolean; span: Span };

export type Priv = "pull" | "tweak" | "yeet" | "spawn" | "ship" | "check" | "spill" | "index";

const PRIV_MAP: Record<string, Priv> = {
  pull: "pull",
  read: "pull",
  tweak: "tweak",
  change: "tweak",
  yeet: "yeet",
  remove: "yeet",
  spawn: "spawn",
  make: "spawn",
  ship: "ship",
  export: "ship",
  check: "check",
  verify: "check",
  fah: "check",
  faah: "check",
  spill: "spill",
  explain: "spill",
  index: "index",
};

export function parse(source: string): Statement[] {
  const p = new Parser(lex(source));
  const stmts: Statement[] = [];
  while (!p.check("EOF")) stmts.push(p.statement());
  return stmts;
}

export function pretty(stmt: Statement): string {
  return printStmt(stmt);
}

/** Canonical source text for one expression. */
export function prettyExpr(e: Expr): string {
  return printExpr(e);
}

class Parser {
  i = 0;
  constructor(readonly toks: Token[]) {}

  at(): Token {
    return this.toks[this.i];
  }
  span(): Span {
    const t = this.at();
    return { line: t.line, column: t.column, offset: t.offset };
  }
  check(kind: Token["kind"], kw?: string): boolean {
    const t = this.at();
    if (t.kind !== kind) return false;
    if (kw && t.kw !== kw) return false;
    return true;
  }
  kw(...names: string[]): boolean {
    const t = this.at();
    return t.kind === "KW" && names.includes(t.kw ?? "");
  }
  advance(): Token {
    const t = this.at();
    if (t.kind !== "EOF") this.i++;
    return t;
  }
  expectKind(kind: Token["kind"], msg: string): Token {
    if (this.at().kind !== kind) this.fail(msg);
    return this.advance();
  }
  eatKw(...names: string[]): boolean {
    if (this.kw(...names)) {
      this.advance();
      return true;
    }
    return false;
  }
  expectKw(...names: string[]): Token {
    if (!this.kw(...names)) this.fail(`Expected ${names.join("/")}.`);
    return this.advance();
  }
  fail(msg: string): never {
    const t = this.at();
    err("E_SYNTAX", msg, { line: t.line, column: t.column, byteOffset: t.offset, hint: "Check the statement against seamql/0.1." });
  }

  ident(): string {
    if (this.at().kind !== "IDENT") {
      if (this.at().kind === "KW") this.fail(`\`${this.at().lexeme}\` is reserved. Quote it to use as a name.`);
      this.fail("Expected a name.");
    }
    const t = this.advance();
    return String(t.value ?? t.lexeme);
  }

  statement(): Statement {
    const sp = this.span();
    if (this.kw("spawn", "make")) return this.spawn(sp);
    if (this.kw("index") || (this.kw("add") && this.toks[this.i + 1]?.kw === "index")) {
      if (this.kw("add")) this.advance();
      return this.index(sp);
    }
    if (this.kw("let", "allow")) return this.grant(sp, "let");
    if (this.kw("block", "deny")) return this.grant(sp, "block");
    if (this.kw("drop") && this.toks[this.i + 1]?.kw === "view") {
      this.advance();
      return this.dropView(sp);
    }
    if (this.kw("drop") && this.toks[this.i + 1]?.kw === "table") {
      err("E_FEATURE_NOT_SUPPORTED", "drop table is not in v0; `yeet from <t> when <pred>` removes rows instead.", { line: sp.line, column: sp.column });
    }
    if (this.kw("drop") || (this.kw("add") && this.toks[this.i + 1]?.kw === "to")) return this.dropin(sp);
    if (this.kw("yeet", "remove")) return this.yeet(sp);
    if (this.kw("pull", "read")) return this.pullHead(sp);
    if (this.kw("select")) return this.selectPull(sp);
    if (this.kw("with")) return this.withPull(sp);
    if (this.kw("insert")) return this.insert(sp);
    if (this.kw("create")) return this.createStmt(sp);
    if (this.kw("delete")) return this.deleteSql(sp);
    if (this.kw("update")) return this.updateSql(sp);
    if (this.kw("start", "begin")) return this.start(sp);
    if (this.kw("lock") || this.kw("commit")) return this.lockin(sp);
    if (this.kw("dip") || this.kw("cancel")) return this.dip(sp);
    if (this.kw("spill", "explain")) return this.spill(sp);
    if (this.kw("check", "verify", "fah", "faah")) return this.checkStmt(sp);
    if (this.kw("ship", "export")) return this.ship(sp);
    if (this.kw("tweak", "change")) {
      if (this.toks[this.i + 1]?.kw === "table") return this.alter(sp);
      return this.tweak(sp);
    }
    this.fail("Expected a statement (spawn / pull / drop in / tweak / yeet / start tx / …).");
  }

  spawn(span: Span): Statement {
    this.expectKw("spawn", "make");
    this.expectKw("table");
    const name = this.ident();
    this.expectKind("COLON", "Expected `:` after the table name.");
    const columns = [this.colDef()];
    while (this.check("COMMA") || this.at().kind === "IDENT") {
      if (this.check("COMMA")) this.advance();
      if (this.at().kind !== "IDENT") break;
      columns.push(this.colDef());
    }
    return { k: "spawn", name, columns, span };
  }

  colDef(): ColDef {
    const span = this.span();
    const name = this.ident();
    this.expectKind("COLON", "Expected `:` after the column name.");
    const type = this.typeSpec();
    const modifiers: Modifier[] = [];
    while (this.check("COMMA")) {
      const nxt = this.toks[this.i + 1];
      if (nxt?.kind === "IDENT" && this.toks[this.i + 2]?.kind === "COLON") break;
      this.advance();
      modifiers.push(this.modifier());
    }
    while (
      this.kw(
        "main",
        "primary",
        "private",
        "unique",
        "needed",
        "required",
        "fallback",
        "default",
        "links",
        "at",
      )
    ) {
      modifiers.push(this.modifier());
    }
    return { name, type, modifiers, span };
  }

  typeSpec(): TypeSpec {
    if (this.eatKw("whole")) {
      this.expectKw("number");
      return { k: "int" };
    }
    if (this.eatKw("text")) return { k: "text" };
    if (this.eatKw("yesno", "boolean")) return { k: "bool" };
    if (this.eatKw("stamp", "timestamp")) return { k: "stamp" };
    if (this.eatKw("day", "date")) return { k: "day" };
    if (this.eatKw("decimal")) {
      this.expectKind("LPAREN", "Expected decimal(p, s).");
      const p = this.intLit();
      this.expectKind("COMMA", "Expected comma in decimal(p, s).");
      const s = this.intLit();
      this.expectKind("RPAREN", "Expected `)`.");
      if (p < 1 || p > 38 || s < 0 || s > p) err("E_TYPE_MISMATCH", "decimal(p,s) requires 1≤p≤38 and 0≤s≤p.");
      return { k: "decimal", precision: p, scale: s };
    }
    this.fail("Expected a type (whole number, text, yesno, stamp, day, decimal).");
  }

  modifier(): Modifier {
    if (this.eatKw("main") || this.eatKw("primary")) {
      this.expectKw("key");
      return { k: "pk" };
    }
    if (this.eatKw("private")) return { k: "private" };
    if (this.eatKw("unique")) return { k: "unique" };
    if (this.eatKw("needed", "required")) return { k: "needed" };
    if (this.eatKw("fallback", "default")) return { k: "fallback", expr: this.expr() };
    if (this.eatKw("links")) {
      this.expectKw("to");
      const table = this.ident();
      this.expectKind("DOT", "Expected table.column.");
      const column = this.ident();
      return { k: "fk", table, column };
    }
    if (this.eatKw("at")) {
      this.expectKw("least");
      return { k: "at_least", expr: this.expr() };
    }
    this.fail("Expected a column vibe: main key, private, unique, needed, fallback, links to, at least.");
  }

  index(span: Span): Statement {
    this.expectKw("index");
    const name = this.ident();
    this.expectKw("on");
    const table = this.ident();
    this.expectKind("LPAREN", "Expected (columns).");
    const columns = [this.ident()];
    while (this.check("COMMA")) {
      this.advance();
      columns.push(this.ident());
    }
    this.expectKind("RPAREN", "Expected `)`.");
    return { k: "index", name, table, columns, span };
  }

  grant(span: Span, k: "let" | "block"): Statement {
    this.expectKw("let", "allow", "block", "deny");
    this.expectKw("role");
    const role = this.ident();
    this.eatKw("to");
    if (!this.kw(...Object.keys(PRIV_MAP))) this.fail("Expected a privilege (pull/tweak/yeet/…).");
    const priv = PRIV_MAP[this.advance().kw ?? ""];
    let target: string;
    let columns: string[] | "*";
    if (this.check("IDENT") && this.toks[this.i + 1]?.kind === "DOT") {
      target = this.ident();
      this.advance();
      if (this.check("STAR")) {
        this.advance();
        columns = "*";
      } else {
        columns = [this.ident()];
        while (this.check("COMMA")) {
          this.advance();
          const t2 = this.ident();
          this.expectKind("DOT", "Expected table.column.");
          if (t2 !== target) this.fail("Grant columns must share one table.");
          columns.push(this.ident());
        }
      }
    } else {
      target = this.ident();
      columns = "*";
    }
    let row: Expr | null = null;
    if (this.eatKw("when", "where")) row = this.expr();
    return { k, role, priv, target, columns, row, span };
  }

  dropin(span: Span): Statement {
    if (this.kw("add")) {
      this.advance();
      this.expectKw("to");
    } else {
      this.expectKw("drop");
      this.expectKw("in");
    }
    const table = this.ident();
    this.expectKind("LBRACE", "Expected `{ fields }`.");
    const fields = [this.field()];
    while (this.check("COMMA")) {
      this.advance();
      if (this.check("RBRACE")) break;
      fields.push(this.field());
    }
    this.expectKind("RBRACE", "Expected `}`.");
    return { k: "dropin", table, fields, span };
  }

  field(): { name: string; expr: Expr } {
    const name = this.ident();
    this.expectKind("COLON", "Expected `name: value`.");
    return { name, expr: this.expr() };
  }

  tweak(span: Span): Statement {
    this.expectKw("tweak", "change");
    const table = this.ident();
    this.expectKw("set");
    const sets = [this.assign()];
    while (this.check("COMMA")) {
      this.advance();
      sets.push(this.assign());
    }
    let filter: Expr | null = null;
    if (this.eatKw("when", "where")) filter = this.expr();
    return { k: "tweak", table, sets, filter, span };
  }

  assign(): { name: string; expr: Expr } {
    const name = this.ident();
    this.expectKind("EQ", "Expected `=`.");
    return { name, expr: this.expr() };
  }

  yeet(span: Span): Statement {
    this.expectKw("yeet", "remove");
    this.expectKw("from");
    const table = this.ident();
    this.expectKw("when", "where");
    return { k: "yeet", table, filter: this.expr(), span };
  }

  selectPull(span: Span): Statement {
    this.expectKw("select");
    let distinct = false;
    if (this.kw("distinct")) {
      this.advance();
      distinct = true;
    }
    const proj = [this.proj()];
    while (this.check("COMMA")) {
      this.advance();
      proj.push(this.proj());
    }
    return this.pullTail(span, proj, distinct);
  }

  /** The shared suffix of both `pull` and `select`: from, joins, where, group
   * by, having, order by, limit/offset, and set operations. */
  private pullTail(span: Span, proj: Expr[], distinct: boolean): Statement {
    let fromSel: { select: Statement; alias: string } | null = null;
    let from = "";
    this.expectKw("from");
    if (this.check("LPAREN")) {
      this.advance();
      const sel = this.kw("select") ? this.selectPull(this.span()) : this.pullHead(this.span());
      this.expectKind("RPAREN", "Expected `)` after derived table.");
      const as = this.eatKw("as") ? this.ident() : this.ident();
      fromSel = { select: sel, alias: as };
    } else from = this.ident();
    const ctes: { name: string; select: Statement }[] = [];
    const joins: PullStmt["joins"] = [];
    while (this.kw("link", "join", "left", "inner", "right", "full", "cross")) {
      const kind = this.joinKind();
      if (kind === "cross") {
        const table = this.ident();
        joins.push({ table, alias: this.tableAlias(), on: null, kind });
        continue;
      }
      const table = this.ident();
      const alias = this.tableAlias();
      this.expectKw("on");
      joins.push({ table, alias, on: this.expr(), kind });
    }
    let filter: Expr | null = null;
    if (this.eatKw("when", "where")) filter = this.expr();
    const group: Expr[] = [];
    if (this.eatKw("bunch", "group")) {
      this.expectKw("by");
      group.push(this.expr());
      while (this.check("COMMA")) {
        this.advance();
        group.push(this.expr());
      }
    }
    let having: Expr | null = null;
    if (this.eatKw("having")) having = this.expr();
    const order: { expr: Expr; desc: boolean }[] = [];
    if (this.eatKw("rank", "sort", "order")) {
      this.expectKw("by");
      order.push(this.orderKey());
      while (this.check("COMMA")) {
        this.advance();
        order.push(this.orderKey());
      }
    }
    let cap: number | null = null;
    let offset: number | null = null;
    if (this.eatKw("cap", "take", "limit")) cap = this.intLit();
    if (this.eatKw("skip", "offset")) offset = this.intLit();
    if (this.eatKw("limit")) cap = this.intLit();
    const ops: SetOp[] = [];
    for (;;) {
      if (this.kw("union", "intersect", "except")) {
        const sp = this.span();
        const kind =
          this.eatKw("union") ? (this.kw("all") ? (this.advance(), "unionAll" as const) : ("union" as const))
            : this.eatKw("intersect") ? "intersect" as const
              : (this.advance(), "except" as const);
        const branch = this.kw("select") ? this.selectPull(this.span()) : this.pullHead(this.span());
        ops.push({ kind, select: branch, span: sp });
        continue;
      }
      break;
    }
    return {
      k: "pull",
      proj,
      from,
      fromSel,
      ctes,
      joins,
      filter,
      group,
      having,
      order,
      cap,
      offset,
      distinct,
      ops,
      span,
    };
  }

  private joinKind(): JoinKind {
    if (this.eatKw("left")) {
      this.eatKw("link", "join", "outer");
      if (!this.kw("link", "join")) this.eatKw("join");
      else this.eatKw("link", "join");
      return "left";
    }
    if (this.eatKw("right")) {
      this.eatKw("outer");
      this.eatKw("link", "join");
      return "right";
    }
    if (this.eatKw("full")) {
      this.eatKw("outer");
      this.eatKw("link", "join");
      return "full";
    }
    if (this.eatKw("cross")) {
      this.eatKw("join");
      return "cross";
    }
    if (this.eatKw("inner")) {
      this.eatKw("link", "join");
      return "inner";
    }
    this.eatKw("link", "join");
    return "inner";
  }

  private tableAlias(): string | null {
    if (this.eatKw("as")) return this.ident();
    if (this.at().kind === "IDENT" && !this.kw("on", "when", "where", "bunch", "group", "rank", "sort", "order", "having", "cap", "take", "limit", "skip", "offset", "union", "intersect", "except", "link", "join")) {
      return this.ident();
    }
    return null;
  }

  /** Head of a bare SEAMQL `pull` (used by CTE bodies and `exists (pull …)`). */
  private pullHead(span: Span): Statement {
    this.expectKw("pull", "read");
    let distinct = false;
    if (this.kw("distinct")) {
      this.advance();
      distinct = true;
    }
    const proj = [this.proj()];
    while (this.check("COMMA")) {
      this.advance();
      proj.push(this.proj());
    }
    return this.pullTail(span, proj, distinct);
  }

  /** A select that may be wrapped in a redundant paren: `as (select …)`. */
  private selectBody(span: Span): Statement {
    if (this.check("LPAREN")) {
      this.advance();
      const sel = this.kw("select") ? this.selectPull(this.span()) : this.pullHead(this.span());
      this.expectKind("RPAREN", "Expected `)` after the select.");
      return sel;
    }
    return this.kw("select") ? this.selectPull(span) : this.pullHead(span);
  }

  proj(): Expr {
    if (this.check("STAR")) {
      const span = this.span();
      this.advance();
      return { op: "star", span };
    }
    if (this.at().kind === "IDENT" && this.toks[this.i + 1]?.kind === "DOT" && this.toks[this.i + 2]?.kind === "STAR") {
      const span = this.span();
      const table = this.ident();
      this.advance();
      this.advance();
      return { op: "star", table, span };
    }
    const e = this.expr();
    if (this.eatKw("as")) {
      const name = this.ident();
      return { op: "fn", name: "__as", args: [e, { op: "col", name, span: e.span }], span: e.span };
    }
    return e;
  }

  orderKey(): { expr: Expr; desc: boolean } {
    const expr = this.expr();
    let desc = false;
    if (this.eatKw("high")) {
      this.expectKw("to");
      this.expectKw("low");
      desc = true;
    } else if (this.eatKw("low")) {
      this.expectKw("to");
      this.expectKw("high");
    } else if (this.eatKw("descending")) desc = true;
    else this.eatKw("ascending");
    return { expr, desc };
  }

  private withPull(span: Span): Statement {
    this.expectKw("with");
    const ctes: { name: string; select: Statement }[] = [];
    const name = this.ident();
    this.eatKw("as");
    this.expectKind("LPAREN", "Expected `(` after `name as`.");
    const sel = this.kw("select") ? this.selectPull(this.span()) : this.pullHead(this.span());
    this.expectKind("RPAREN", "Expected `)` after the CTE body.");
    ctes.push({ name, select: sel });
    while (this.check("COMMA")) {
      this.advance();
      const n2 = this.ident();
      this.eatKw("as");
      this.expectKind("LPAREN", "Expected `(` after `name as`.");
      const s2 = this.kw("select") ? this.selectPull(this.span()) : this.pullHead(this.span());
      this.expectKind("RPAREN", "Expected `)` after the CTE body.");
      ctes.push({ name: n2, select: s2 });
    }
    const root = this.kw("select") ? this.selectPull(this.span()) : this.pullHead(this.span());
    if (root.k !== "pull") err("E_SYNTAX", "WITH requires a select statement.");
    root.ctes.push(...ctes);
    root.span = span;
    return root as Statement;
  }

  private insert(span: Span): Statement {
    this.expectKw("insert");
    this.expectKw("into");
    const table = this.ident();
    const columns: string[] = [];
    if (this.check("LPAREN")) {
      this.advance();
      columns.push(this.ident());
      while (this.check("COMMA")) {
        this.advance();
        columns.push(this.ident());
      }
      this.expectKind("RPAREN", "Expected `)` after column list.");
    }
    if (this.kw("values")) {
      if (columns.length) err("E_SYNTAX", "CSV insert binds `{}` directly; drop the explicit column list.");
      this.advance();
    }
    const sel = this.selectBody(this.span());
    if (sel.k !== "pull") err("E_SYNTAX", "insert .. select requires a select.");
    return { k: "insertSel", table, columns, select: sel, span };
  }

  private createStmt(span: Span): Statement {
    this.expectKw("create");
    if (this.kw("table")) {
      this.advance();
      const name = this.ident();
      this.expectKind("COLON", "Expected `:` after the table name.");
      const columns = [this.colDef()];
      while (this.check("COMMA") || this.at().kind === "IDENT") {
        if (this.check("COMMA")) this.advance();
        if (this.at().kind !== "IDENT") break;
        columns.push(this.colDef());
      }
      return { k: "spawn", name, columns, span };
    }
    if (this.kw("view")) {
      this.advance();
      const name = this.ident();
      this.eatKw("as");
      const sel = this.selectBody(this.span());
      if (sel.k !== "pull") err("E_SYNTAX", "create view requires a select.");
      return { k: "view", name, select: sel, drop: false, span };
    }
    if (this.kw("index")) {
      this.advance();
      this.i -= 2;
      return this.index(span);
    }
    this.fail("Expected `create table`, `create view`, or `create index`.");
  }

  private dropView(span: Span): Statement {
    this.expectKw("view");
    const name = this.ident();
    return { k: "view", name, select: null, drop: true, span };
  }

  /** SQL-skin for yeet: `delete from t where ...`. */
  private deleteSql(span: Span): Statement {
    this.expectKw("delete");
    this.expectKw("from");
    const table = this.ident();
    this.expectKw("where");
    return { k: "yeet", table, filter: this.expr(), span };
  }

  /** SQL-skin for the tweak statement: `update t set x = y where ...`. */
  private updateSql(span: Span): Statement {
    this.expectKw("update");
    const table = this.ident();
    this.expectKw("set");
    const sets = [this.assign()];
    while (this.check("COMMA")) {
      this.advance();
      sets.push(this.assign());
    }
    let filter: Expr | null = null;
    if (this.eatKw("where")) filter = this.expr();
    return { k: "tweak", table, sets, filter, span };
  }

  start(span: Span): Statement {
    this.expectKw("start", "begin");
    this.expectKw("tx", "transaction");
    return { k: "start", span };
  }
  lockin(span: Span): Statement {
    if (this.eatKw("commit")) return { k: "lockin", span };
    this.expectKw("lock");
    this.expectKw("in");
    return { k: "lockin", span };
  }
  dip(span: Span): Statement {
    if (this.eatKw("dip")) return { k: "dip", span };
    this.expectKw("cancel");
    this.eatKw("transaction");
    return { k: "dip", span };
  }
  spill(span: Span): Statement {
    this.expectKw("spill", "explain");
    const inner = this.statement();
    if (!["pull", "tweak", "yeet", "dropin", "insertSel", "view"].includes(inner.k)) this.fail("spill only covers pull/tweak/yeet/drop in.");
    return { k: "spill", inner, span };
  }
  checkStmt(span: Span): Statement {
    this.expectKw("check", "verify", "fah", "faah");
    this.expectKw("table");
    return { k: "check", table: this.ident(), span };
  }
  ship(span: Span): Statement {
    if (this.eatKw("export")) {
      const table = this.ident();
      this.eatKw("to");
      this.expectKw("sealed");
      this.eatKw("file");
      const path = String(this.expectKind("STRING", "Expected a sealed file path.").value);
      return { k: "ship", table, path, span };
    }
    this.expectKw("ship");
    const table = this.ident();
    this.expectKw("sealed");
    const path = String(this.expectKind("STRING", "Expected a sealed file path.").value);
    return { k: "ship", table, path, span };
  }
  alter(span: Span): Statement {
    this.expectKw("tweak", "change");
    this.expectKw("table");
    const table = this.ident();
    this.expectKw("add");
    return { k: "alter", table, column: this.colDef(), span };
  }

  intLit(): number {
    if (this.at().kind !== "NUMBER" || typeof this.at().value !== "bigint") this.fail("Expected a whole number.");
    const n = Number(this.advance().value as bigint);
    if (!Number.isSafeInteger(n) || n < 0) this.fail("Expected a non-negative whole number.");
    return n;
  }

  expr(): Expr {
    return this.or();
  }
  or(): Expr {
    let e = this.and();
    while (this.eatKw("or")) {
      const right = this.and();
      e = { op: "bin", kind: "or", left: e, right, span: e.span };
    }
    return e;
  }
  and(): Expr {
    let e = this.not();
    while (this.eatKw("and")) {
      const right = this.not();
      e = { op: "bin", kind: "and", left: e, right, span: e.span };
    }
    return e;
  }
  not(): Expr {
    if (this.eatKw("not")) {
      const span = this.span();
      return { op: "unary", kind: "not", inner: this.not(), span };
    }
    if (this.kw("exists")) {
      this.advance();
      const e = this.primary();
      if (e.op !== "subq") this.fail("Expected a (select …) after exists.");
      return { op: "exists", sel: (e as Extract<Expr, { op: "subq" }>).sel, span: e.span };
    }
    return this.cmp();
  }
  cmp(): Expr {
    let e = this.add();
    if (this.eatKw("is")) {
      const not = this.eatKw("not");
      if (this.eatKw("null")) return { op: "is", left: e, not, right: { t: "null" }, span: e.span };
      const lit = this.literal();
      return { op: "is", left: e, not, right: lit, span: e.span };
    }
    if (this.kw("in") || (this.kw("not") && this.toks[this.i + 1]?.kw === "in")) {
      const not = this.eatKw("not");
      this.expectKw("in");
      this.expectKind("LPAREN", "Expected `(` after `in`.");
      const sp = e.span;
      if (this.kw("select", "pull")) {
        const sel = this.subquery();
        this.expectKind("RPAREN", "Expected `)`.");
        return { op: "in", left: e, sub: sel as PullStmt, list: [], not, span: sp };
      }
      const list = [this.expr()];
      while (this.check("COMMA")) {
        this.advance();
        list.push(this.expr());
      }
      this.expectKind("RPAREN", "Expected `)`.");
      return { op: "in", left: e, sub: null, list, not, span: sp };
    }
    if (this.kw("like") || (this.kw("not") && this.toks[this.i + 1]?.kw === "like")) {
      const not = this.eatKw("not");
      this.expectKw("like");
      const pat = String(this.expectKind("STRING", "Expected a 'pattern' string.").value);
      return { op: "like", left: e, pat, not, span: e.span };
    }
    if (this.kw("between") || (this.kw("not") && this.toks[this.i + 1]?.kw === "between")) {
      const not = this.eatKw("not");
      this.expectKw("between");
      const lo = this.add();
      this.expectKw("and");
      const hi = this.add();
      const loB: Expr = { op: "bin", kind: "ge", left: e, right: lo, span: e.span };
      if (not) {
        // `not between` = below lo OR above hi
        const hiB: Expr = { op: "bin", kind: "gt", left: e, right: hi, span: e.span };
        return { op: "bin", kind: "or", left: { op: "bin", kind: "lt", left: e, right: lo, span: e.span }, right: hiB, span: e.span };
      }
      return { op: "bin", kind: "and", left: loB, right: { op: "bin", kind: "le", left: e, right: hi, span: e.span }, span: e.span };
    }
    const t = this.at();
    const map: Partial<Record<Token["kind"], Bin>> = { EQ: "eq", NE: "ne", LT: "lt", GT: "gt", LE: "le", GE: "ge" };
    if (t.kind in map) {
      this.advance();
      const right = this.subqueryPostfix();
      e = { op: "bin", kind: map[t.kind] as Bin, left: e, right, span: e.span };
    }
    return e;
  }

  /** After a comparison operator the right operand may be a parenthesized
   * scalar subquery: `x = (select max(y) from t)`. */
  private subqueryPostfix(): Expr {
    if (this.check("LPAREN") && this.toks[this.i + 1]?.kind === "KW" && ["select", "pull"].includes(this.toks[this.i + 1].kw ?? "")) {
      const span = this.span();
      this.advance();
      const sel = this.subquery();
      this.expectKind("RPAREN", "Expected `)` after subquery.");
      return { op: "subq", sel: sel as PullStmt, span };
    }
    return this.add();
  }

  /** Body of a parenthesized subquery; caller consumed the `(`. */
  private subquery(): Statement {
    if (this.kw("select")) return this.selectPull(this.span());
    const sp = this.span();
    if (this.kw("pull")) return this.pullHead(sp);
    this.fail("Expected a select statement.");
  }
  add(): Expr {
    let e = this.mul();
    while (this.check("PLUS") || this.check("MINUS")) {
      const kind = this.advance().kind === "PLUS" ? "+" : "-";
      const right = this.mul();
      e = { op: "bin", kind, left: e, right, span: e.span };
    }
    return e;
  }
  mul(): Expr {
    let e = this.unary();
    while (this.check("STAR") || this.check("SLASH")) {
      const kind = this.advance().kind === "STAR" ? "*" : "/";
      const right = this.unary();
      e = { op: "bin", kind, left: e, right, span: e.span };
    }
    return e;
  }
  unary(): Expr {
    if (this.check("MINUS")) {
      const span = this.span();
      this.advance();
      // a minus sitting directly in front of a number is part of the literal
      if (this.at().kind === "NUMBER") {
        const lit = this.literal();
        if (lit.t === "int") return { op: "lit", value: { t: "int", v: -lit.v }, span };
        if (lit.t === "decimal") {
          return { op: "lit", value: { t: "decimal", v: new Decimal(-lit.v.unscaled, lit.v.scale, lit.v.precision) }, span };
        }
        this.fail("Expected a number after `-`.");
      }
      return { op: "unary", kind: "-", inner: this.unary(), span };
    }
    return this.primary();
  }
  primary(): Expr {
    const span = this.span();
    if (this.kw("case")) return this.caseExpr(span);
    // Window fns whose names are keywords (`rank`, `dense_rank`) still parse as
    // calls when immediately followed by `(`.
    let kwFn: string | null = null;
    if (this.kw("rank", "dense_rank") && this.toks[this.i + 1]?.kind === "LPAREN") kwFn = this.advance().kw ?? null;
    if (this.check("LPAREN")) {
      const nxt = this.toks[this.i + 1];
      if (nxt?.kind === "KW" && ["select", "pull"].includes(nxt.kw ?? "")) {
        this.advance();
        const sel = this.subquery();
        this.expectKind("RPAREN", "Expected `)` after subquery.");
        return { op: "subq", sel: sel as PullStmt, span };
      }
    }
    if (this.eatKw("cast")) {
      this.expectKind("LPAREN", "Expected cast(x as T).");
      const inner = this.expr();
      this.expectKw("as");
      const type = this.typeSpec();
      this.expectKind("RPAREN", "Expected `)`.");
      return { op: "cast", inner, type, span };
    }
    if (!kwFn && this.check("LPAREN")) {
      this.advance();
      const e = this.expr();
      this.      expectKind("RPAREN", "Expected `)`.");
      return e;
    }
    if (kwFn || this.at().kind === "IDENT") {
      const name = kwFn ?? this.ident();
      if (this.check("LPAREN")) {
        this.advance();
        const args: Expr[] = [];
        if (this.check("STAR")) {
          const sp = this.span();
          this.advance();
          args.push({ op: "star", span: sp });
        } else if (!this.check("RPAREN")) {
          args.push(this.expr());
          while (this.check("COMMA")) {
            this.advance();
            args.push(this.expr());
          }
        }
        this.expectKind("RPAREN", "Expected `)`.");
        if (this.kw("over")) return this.over(span, name, args);
        return { op: "fn", name, args, span };
      }
      if (this.check("DOT")) {
        this.advance();
        const col = this.ident();
        return { op: "col", table: name, name: col, span };
      }
      return { op: "col", name, span };
    }
    return { op: "lit", value: this.literal(), span };
  }

  /** `over (partition by … order by …)` after an aggregate call. */
  private over(span: Span, name: string, args: Expr[]): Expr {
    this.advance();
    this.expectKind("LPAREN", "Expected over ( … ).");
    const partition: Expr[] = [];
    if (this.kw("partition")) {
      this.advance();
      this.expectKw("by");
      partition.push(this.expr());
      while (this.check("COMMA")) {
        this.advance();
        partition.push(this.expr());
      }
    }
    const order: { expr: Expr; desc: boolean }[] = [];
    if (this.kw("order", "rank", "sort")) {
      this.advance();
      this.expectKw("by");
      order.push(this.orderKey());
      while (this.check("COMMA")) {
        this.advance();
        order.push(this.orderKey());
      }
    }
    this.expectKind("RPAREN", "Expected `)`.");
    return { op: "wfn", name, args, partition, order, span };
  }

  private caseExpr(span: Span): Expr {
    this.expectKw("case");
    const whens: { when: Expr; then: Expr }[] = [];
    let els: Expr | null = null;
    while (this.kw("when")) {
      this.advance();
      const when = this.expr();
      this.expectKw("then");
      const then = this.expr();
      whens.push({ when, then });
    }
    if (this.kw("else")) {
      this.advance();
      els = this.expr();
    }
    this.expectKw("end");
    if (!whens.length) this.fail("case requires at least one when.");
    return { op: "case", whens, els, span };
  }

  literal(): Literal {
    if (this.eatKw("null")) return { t: "null" };
    if (this.eatKw("yes", "true")) return { t: "bool", v: true };
    if (this.eatKw("no", "false")) return { t: "bool", v: false };
    if (this.at().kind === "STRING") return { t: "text", v: String(this.advance().value) };
    if (this.at().kind === "NUMBER") {
      const v = this.advance().value;
      if (typeof v === "bigint") return { t: "int", v };
      const d = v as { unscaled: string; scale: number };
      if (d.unscaled.length > 38) err("E_OVERFLOW", "Decimal literal exceeds 38 digits.");
      return { t: "decimal", v: new Decimal(BigInt(d.unscaled), d.scale, Math.max(d.unscaled.length, d.scale + 1)) };
    }
    this.fail("Expected a literal.");
  }
}

function printExpr(e: Expr): string {
  switch (e.op) {
    case "lit":
      return printLit(e.value);
    case "col":
      return e.table ? `${e.table}.${e.name}` : e.name;
    case "star":
      return e.table ? `${e.table}.*` : "*";
    case "fn":
      if (e.name === "__as") return `${printExpr(e.args[0])} as ${printExpr(e.args[1])}`;
      return `${e.name}(${e.args.map(printExpr).join(", ")})`;
    case "unary":
      return `${e.kind} ${printExpr(e.inner)}`;
    case "bin": {
      const op =
        e.kind === "eq"
          ? "="
          : e.kind === "ne"
            ? "<>"
            : e.kind === "and"
              ? "and"
              : e.kind === "or"
                ? "or"
                : e.kind === "lt"
                  ? "<"
                  : e.kind === "gt"
                    ? ">"
                    : e.kind === "le"
                      ? "<="
                      : e.kind === "ge"
                        ? ">="
                        : e.kind;
      return `(${printExpr(e.left)} ${op} ${printExpr(e.right)})`;
    }
    case "is":
      return `${printExpr(e.left)} is ${e.not ? "not " : ""}${e.right.t === "null" ? "null" : printLit(e.right)}`;
    case "cast":
      return `cast(${printExpr(e.inner)} as ${printType(e.type)})`;
    case "case":
      return `case ${e.whens.map((w) => `when ${printExpr(w.when)} then ${printExpr(w.then)}`).join(" ")}${e.els ? ` else ${printExpr(e.els)}` : ""} end`;
    case "wfn":
      return `${e.name}(${e.args.map(printExpr).join(", ")}) over (partition by ${e.partition.map(printExpr).join(", ") || "none"}${e.order.length ? ` ${e.order.map((o) => printExpr(o.expr) + (o.desc ? " high to low" : " low to high")).join(", ")}` : ""})`;
    case "in":
      return `(${printExpr(e.left)} ${e.not ? "not in" : "in"} ${e.sub ? "(select …)" : `(${e.list.map(printExpr).join(", ")})`})`;
    case "exists":
      return "exists (select …)";
    case "subq":
      return "(select …)";
    case "like":
      return `(${printExpr(e.left)} ${e.not ? "not like" : "like"} '${e.pat}'})`.replace("}'", "'");
  }
}

function printLit(v: Literal): string {
  if (v.t === "null") return "null";
  if (v.t === "bool") return v.v ? "yes" : "no";
  if (v.t === "text") return `'${v.v.replace(/'/g, "''")}'`;
  if (v.t === "int") return v.v.toString();
  return v.v.toString();
}

function printType(t: TypeSpec): string {
  if (t.k === "int") return "whole number";
  if (t.k === "decimal") return `decimal(${t.precision}, ${t.scale})`;
  if (t.k === "bool") return "yesno";
  if (t.k === "stamp") return "stamp";
  if (t.k === "day") return "day";
  return "text";
}

function printModifier(m: Modifier): string {
  if (m.k === "pk") return "main key";
  if (m.k === "private") return "private";
  if (m.k === "unique") return "unique";
  if (m.k === "needed") return "needed";
  if (m.k === "fallback") return `fallback ${printExpr(m.expr)}`;
  if (m.k === "fk") return `links to ${m.table}.${m.column}`;
  return `at least ${printExpr(m.expr)}`;
}

function printCol(c: ColDef): string {
  const mods = c.modifiers.map((m) => `, ${printModifier(m)}`).join("");
  return `${c.name}: ${printType(c.type)}${mods}`;
}

function printStmt(s: Statement): string {
  switch (s.k) {
    case "spawn":
      return `spawn table ${s.name}:\n` + s.columns.map((c) => `    ${printCol(c)}`).join("\n");
    case "index":
      return `index ${s.name} on ${s.table}(${s.columns.join(", ")})`;
    case "let":
    case "block":
      return `${s.k} role ${s.role} ${s.priv} ${s.target}${s.columns === "*" ? "" : "." + s.columns.join(",")}${s.row ? ` when ${printExpr(s.row)}` : ""}`;
    case "dropin":
      return `drop in ${s.table} { ${s.fields.map((f) => `${f.name}: ${printExpr(f.expr)}`).join(", ")} }`;
    case "tweak":
      return `tweak ${s.table} set ${s.sets.map((x) => `${x.name} = ${printExpr(x.expr)}`).join(", ")}${s.filter ? " when " + printExpr(s.filter) : ""}`;
    case "yeet":
      return `yeet from ${s.table} when ${printExpr(s.filter)}`;
    case "pull": {
      const p = s.proj.map(printExpr).join(", ");
      let q = `pull ${p} from ${s.fromSel ? "(select …)" : s.from}`;
      for (const j of s.joins) q += ` ${j.kind === "left" ? "left " : ""}${j.kind === "cross" ? "cross join " : j.kind === "inner" ? "link " : j.kind === "right" ? "right join " : j.kind === "full" ? "full join " : ""}${j.table} on ${j.on ? printExpr(j.on) : "true"}`;
      if (s.filter) q += ` when ${printExpr(s.filter)}`;
      if (s.group.length) q += ` bunch by ${s.group.map(printExpr).join(", ")}`;
      if (s.having) q += ` having ${printExpr(s.having)}`;
      if (s.order.length) q += ` rank by ${s.order.map((o) => printExpr(o.expr) + (o.desc ? " high to low" : " low to high")).join(", ")}`;
      if (s.cap != null) q += ` cap ${s.cap}`;
      if (s.offset != null) q += ` skip ${s.offset}`;
      if (s.distinct) q += " distinct";
      for (const op of s.ops) q += ` ${op.kind === "unionAll" ? "union all" : op.kind} (select …)`;
      return q;
    }
    case "start":
      return "start tx";
    case "lockin":
      return "lock in";
    case "dip":
      return "dip";
    case "spill":
      return `spill ${printStmt(s.inner)}`;
    case "check":
      return `check table ${s.table}`;
    case "ship":
      return `ship ${s.table} sealed '${s.path.replace(/'/g, "''")}'`;
    case "alter":
      return `tweak table ${s.table} add ${printCol(s.column)}`;
    case "insertSel":
      return `insert into ${s.table}${s.columns.length ? `(${s.columns.join(", ")})` : ""} (select …)`;
    case "view":
      return s.drop ? `drop view ${s.name}` : `create view ${s.name} as (select …)`;
  }
}
