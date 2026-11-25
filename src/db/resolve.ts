import { err } from "./errors";
import type { Expr, Statement, TypeSpec } from "./parser";
import { typeName, unify, type SeamType } from "./values";

export interface CatalogView {
  table(name: string): { name: string; columns: { name: string; type: SeamType }[] } | undefined;
  /** Registered views (create view …). */
  view?(name: string): { name: string; columns: { name: string; type: SeamType }[] } | undefined;
  isOwner: boolean;
}

export function typecheck(
  stmt: Statement,
  cat: CatalogView,
  local: Map<string, { name: string; columns: { name: string; type: SeamType }[] }> = new Map(),
): void {
  switch (stmt.k) {
    case "spawn": {
      const names = new Set<string>();
      for (const c of stmt.columns) {
        if (names.has(c.name)) {
          err("E_UNIQUE", `Duplicate column \`${c.name}\`.`, { line: c.span.line, column: c.span.column });
        }
        names.add(c.name);
        const declared = specToSeam(c.type);
        const scope: Record<string, SeamType> = { [c.name]: declared };
        for (const m of c.modifiers) {
          if (m.k === "fallback" || m.k === "at_least") {
          const given = exprType(m.expr, scope, cat);
          if (!assignable(given, declared)) {
            err("E_TYPE_MISMATCH", `A ${typeName(given)} bound does not fit ${typeName(declared)}.`, {
              line: m.expr.span.line,
              column: m.expr.span.column,
            });
          }
          }
        }
      }
      return;
    }
    case "dropin": {
      const t = needTable(stmt.table, cat);
      const scope = scopeFor([t]);
      for (const f of stmt.fields) {
        const col = t.columns.find((c) => c.name === f.name);
        if (!col) unknown(f.name, stmt.span.line, stmt.span.column, cat);
        const given = exprType(f.expr, scope, cat);
        if (!assignable(given, col.type)) mismatch(given, col.type, f.expr);
      }
      return;
    }
    case "tweak": {
      const t = needTable(stmt.table, cat);
      const scope = scopeFor([t]);
      for (const s of stmt.sets) {
        const col = t.columns.find((c) => c.name === s.name);
        if (!col) unknown(s.name, stmt.span.line, stmt.span.column, cat);
        const given = exprType(s.expr, scope, cat);
        if (!assignable(given, col.type)) mismatch(given, col.type, s.expr);
      }
      if (stmt.filter) expectBool(exprType(stmt.filter, scope, cat), stmt.filter.span);
      return;
    }
    case "yeet": {
      const t = needTable(stmt.table, cat);
      expectBool(exprType(stmt.filter, scopeFor([t]), cat), stmt.filter.span);
      return;
    }
    case "pull": {
      // CTEs are visible to every nested select in this statement: the map is
      // passed down through typecheck/viewCols recursion.
      for (const c of stmt.ctes) {
        typecheck(c.select, cat, local);
        if (c.select.k === "pull") local.set(c.name, { name: c.name, columns: viewCols(c.select, cat, local) });
      }
      let base: { name: string; columns: { name: string; type: SeamType }[] } | undefined;
      if (stmt.fromSel && stmt.fromSel.select.k === "pull") {
        typecheck(stmt.fromSel.select, cat, local);
        base = { name: stmt.fromSel.alias, columns: viewCols(stmt.fromSel.select, cat, local) };
      } else base = lookupSource(stmt.from, cat, local);
      if (!base) {
        if (stmt.from !== "") unknown(stmt.from, stmt.span.line, stmt.span.column, cat);
        base = { name: stmt.fromSel?.alias ?? "", columns: [] };
      }
      const tables = [base];
      let scope = scopeFor(tables);
      for (const j of stmt.joins) {
        const rt = lookupSource(j.table, cat, local) ?? needTable(j.table, cat);
        tables.push({ name: j.alias ?? rt.name, columns: rt.columns });
        scope = scopeFor(tables);
        if (j.on) expectBool(exprType(j.on, scope, cat), j.on.span);
      }
      if (stmt.filter) expectBool(exprType(stmt.filter, scope, cat), stmt.filter.span);
      const projScope = scope; // proj may reference select-outputs when ordering
      for (const p of stmt.proj) {
        if (p.op === "star") continue;
        exprType(p, projScope, cat);
      }
      for (const g of stmt.group) exprType(g, scope, cat);
      if (stmt.having) expectBool(exprType(stmt.having, scope, cat), stmt.having.span);
      for (const o of stmt.order) exprType(o.expr, scope, cat);
      for (const op of stmt.ops) typecheck(op.select, cat, local);
      return;
    }
    case "index": {
      const t = needTable(stmt.table, cat);
      for (const c of stmt.columns) if (!t.columns.some((x) => x.name === c)) unknown(c, stmt.span.line, stmt.span.column, cat);
      return;
    }
    case "check":
    case "ship":
      needTable(stmt.table, cat);
      return;
    case "insertSel": {
      const t = needTable(stmt.table, cat);
      typecheck(stmt.select as unknown as Statement, cat, local);
      for (const c of stmt.columns) if (!t.columns.some((x) => x.name === c)) unknown(c, stmt.span.line, stmt.span.column, cat);
      return;
    }
    case "view":
      if (stmt.select) typecheck(stmt.select as unknown as Statement, cat, local);
      return;
    case "alter":
      needTable(stmt.table, cat);
      return;
    case "spill":
      typecheck(stmt.inner, cat, local);
      return;
    default:
      return;
  }
}

function specToSeam(t: TypeSpec): SeamType {
  if (t.k === "decimal") return { k: "decimal", precision: t.precision, scale: t.scale };
  return t;
}

function needTable(name: string, cat: CatalogView): { name: string; columns: { name: string; type: SeamType }[] } {
  const t = cat.table(name);
  if (!t) {
    if (cat.isOwner) err("E_UNKNOWN_NAME", `No table \`${name}\`.`);
    err("E_DENIED", "Not allowed.");
  }
  return t;
}

/** Resolve a source: real table, registered view, or a local CTE. */
function lookupSource(
  name: string,
  cat: CatalogView,
  local: Map<string, { name: string; columns: { name: string; type: SeamType }[] }>,
): { name: string; columns: { name: string; type: SeamType }[] } | undefined {
  const l = local.get(name);
  if (l) return l;
  const t = cat.table(name);
  if (t) return t;
  return cat.view?.(name) ?? undefined;
}

/** Public helper: the output columns of a select as types for catalog use. */
export function selectOutputCols(
  select: Statement,
  cat: CatalogView,
): { name: string; type: SeamType }[] {
  try {
    return viewCols(select, cat, new Map());
  } catch {
    return [];
  }
}

/** Static projection columns of a select (used for CTE/derived-table scope). */
function viewCols(
  sel: Statement,
  cat: CatalogView,
  local: Map<string, { name: string; columns: { name: string; type: SeamType }[] }> = new Map(),
): { name: string; columns: { name: string; type: SeamType }[] }["columns"] {
  if (sel.k !== "pull" || typeof sel === "string") return [];
  const pull = sel as unknown as { proj: Expr[] };
  // Resolve the select's own sources first so its projections can refer to its
  // columns by name, exactly as at execution time.
  const innerLocal = new Map(local);
  for (const c of sel.ctes) if (c.select.k === "pull") innerLocal.set(c.name, { name: c.name, columns: viewCols(c.select, cat, innerLocal) });
  let base: { name: string; columns: { name: string; type: SeamType }[] } | undefined;
  if (sel.fromSel && sel.fromSel.select.k === "pull") base = { name: sel.fromSel.alias, columns: viewCols(sel.fromSel.select, cat, innerLocal) };
  else base = lookupSource(sel.from, cat, innerLocal);
  const tables = [base ?? { name: "", columns: [] as { name: string; type: SeamType }[] }];
  for (const j of sel.joins) {
    const rt = lookupSource(j.table, cat, innerLocal) ?? needTable(j.table, cat);
    tables.push({ name: j.alias ?? rt.name, columns: rt.columns });
  }
  const srcScope = scopeFor(tables);
  const cols: { name: string; type: SeamType }[] = [];
  pull.proj.forEach((p, i) => {
    if (p.op === "star") return;
    let name = `c${i}`;
    if (p.op === "fn" && p.name === "__as" && p.args[1]?.op === "col") name = p.args[1].name;
    else if (p.op === "col") name = p.name;
    const ty =
      p.op === "fn" && p.name === "__as"
        ? exprType(p.args[0], srcScope, cat)
        : exprType(p, srcScope, cat);
    cols.push({ name, type: ty });
  });
  return cols;
}

function unknown(name: string, line: number, column: number, cat: CatalogView): never {
  if (cat.isOwner) err("E_UNKNOWN_NAME", `No column \`${name}\`.`, { line, column });
  err("E_DENIED", "Not allowed.", { line, column });
}

function mismatch(given: SeamType, target: SeamType, at: { span: { line: number; column: number } }): never {
  err("E_TYPE_MISMATCH", `${typeName(given)} does not fit ${typeName(target)}. No implicit conversion was performed.`, {
    line: at.span.line,
    column: at.span.column,
    hint: "Try a value that matches the declared type.",
  });
}

function fallbackMismatch(given: SeamType, target: SeamType, at: { line: number; column: number }): never {
  err("E_TYPE_MISMATCH", `case arms mix ${typeName(given)} and ${typeName(target)}.`, { line: at.line, column: at.column });
}

/**
 * A value may be stored in a column when it is the column's own type, a null,
 * or a whole number widening into a decimal column (exact, nothing is lost).
 * The reverse — a decimal into a whole number — would drop digits, so it stays
 * an error rather than a silent coercion.
 */
function assignable(given: SeamType, target: SeamType): boolean {
  if (given.k === "null" || target.k === "null") return true;
  if (given.k === target.k) return true;
  return given.k === "int" && target.k === "decimal";
}

const AMBIGUOUS = Symbol("ambiguous columns");

/**
 * Name scope for a query: `table.column` always resolves, and an unqualified
 * name resolves only while exactly one table in the join owns it. Names that
 * several tables own are recorded so the resolver can report E_AMBIGUOUS.
 */
function scopeFor(tables: { name: string; columns: { name: string; type: SeamType }[] }[]): Record<string, SeamType> {
  const s: Record<string, SeamType> = {};
  const owner = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const t of tables) {
    for (const c of t.columns) {
      s[`${t.name}.${c.name}`] = c.type;
      const prev = owner.get(c.name);
      if (prev === undefined) {
        owner.set(c.name, t.name);
        s[c.name] = c.type;
      } else if (prev !== t.name && prev !== "") {
        owner.set(c.name, "");
        ambiguous.add(c.name);
        delete s[c.name];
      }
    }
  }
  Object.defineProperty(s, AMBIGUOUS, { value: ambiguous, enumerable: false });
  return s;
}

function expectBool(ty: SeamType, span: { line: number; column: number }): void {
  if (ty.k !== "bool" && ty.k !== "null") {
    err("E_TYPE_MISMATCH", `Predicate must be yesno, not ${typeName(ty)}.`, { line: span.line, column: span.column });
  }
}

function exprType(e: Expr | null, scope: Record<string, SeamType>, cat: CatalogView, optional = false): SeamType {
  if (!e) return { k: "null" };
  switch (e.op) {
    case "lit":
      if (e.value.t === "null") return { k: "null" };
      if (e.value.t === "int") return { k: "int" };
      if (e.value.t === "text") return { k: "text" };
      if (e.value.t === "bool") return { k: "bool" };
      return { k: "decimal", precision: e.value.v.precision, scale: e.value.v.scale };
    case "col": {
      const key = e.table ? `${e.table}.${e.name}` : e.name;
      const amb = (scope as unknown as Record<symbol, Set<string>>)[AMBIGUOUS];
      if (!e.table && amb?.has(e.name)) {
        err("E_AMBIGUOUS", `Column \`${e.name}\` is ambiguous.`, { line: e.span.line, column: e.span.column });
      }
      const ty = scope[key] ?? scope[e.name];
      if (!ty) unknown(key, e.span.line, e.span.column, cat);
      return ty;
    }
    case "star":
      return { k: "null" };
    case "fn": {
      const n = e.name.toLowerCase();
      const at = { line: e.span.line, column: e.span.column };
      if (n === "now") return { k: "stamp" };
      if (n === "today") return { k: "day" };
      if (n === "__as") return exprType(e.args[0], scope, cat);
      if (n === "count" || n === "tally") {
        for (const a of e.args) exprType(a, scope, cat);
        return { k: "int" };
      }
      if (n === "sum" || n === "stack") {
        const inner = exprType(e.args[0], scope, cat);
        if (inner.k === "int" || inner.k === "decimal" || inner.k === "null") return inner.k === "null" ? { k: "int" } : inner;
        err("E_TYPE_MISMATCH", `sum needs a number column, not ${typeName(inner)}.`, at);
      }
      if (n === "avg") {
        const inner = exprType(e.args[0], scope, cat);
        if (inner.k !== "int" && inner.k !== "decimal" && inner.k !== "null") {
          err("E_TYPE_MISMATCH", `avg needs a number column, not ${typeName(inner)}.`, at);
        }
        // averages of whole numbers report hundredths; decimal averages keep
        // six extra digits past the column's own scale
        return { k: "decimal", precision: 38, scale: inner.k === "decimal" ? inner.scale + 6 : 2 };
      }
      if (n === "min" || n === "max") return exprType(e.args[0], scope, cat);
      err("E_UNKNOWN_NAME", `Function \`${e.name}\` is not in seamql/0.1.`, at);
    }
    case "unary":
      return e.kind === "not" ? { k: "bool" } : exprType(e.inner, scope, cat);
    case "bin":
      if (e.kind === "and" || e.kind === "or" || ["eq", "ne", "lt", "gt", "le", "ge"].includes(e.kind)) return { k: "bool" };
      return unify(exprType(e.left, scope, cat), exprType(e.right, scope, cat));
    case "is":
    case "in":
    case "exists":
    case "like":
      return { k: "bool" };
    case "subq":
      return viewCols(e.sel as unknown as Statement, cat)[0]?.type ?? { k: "null" };
    case "case": {
      const tys: SeamType[] = [];
      for (const w of e.whens) {
        expectBool(exprType(w.when, scope, cat), w.when.span);
        tys.push(exprType(w.then, scope, cat));
      }
      if (e.els) tys.push(exprType(e.els, scope, cat));
      const first = tys.find((t) => t.k !== "null");
      if (!first) return { k: "null" };
      for (const t of tys) if (t.k !== "null" && t.k !== first.k) fallbackMismatch(t, first, e.span);
      return first;
    }
    case "wfn": {
      const n = e.name.toLowerCase();
      if (n === "row_number" || n === "rank" || n === "dense_rank" || n === "count") return { k: "int" };
      if (n === "ntile") return { k: "int" };
      if (n === "lead" || n === "lag") return exprType(e.args[0] ?? { op: "lit", value: { t: "null" }, span: e.span }, scope, cat);
      if (n === "sum") {
        const inner = exprType(e.args[0], scope, cat);
        if (inner.k === "int" || inner.k === "decimal" || inner.k === "null") return inner;
        err("E_TYPE_MISMATCH", `sum over needs a number column, not ${typeName(inner)}.`, { line: e.span.line, column: e.span.column });
      }
      if (n === "avg") {
        const inner = exprType(e.args[0], scope, cat);
        if (inner.k !== "int" && inner.k !== "decimal" && inner.k !== "null") {
          err("E_TYPE_MISMATCH", `avg over needs a number column.`, { line: e.span.line, column: e.span.column });
        }
        return { k: "decimal", precision: 38, scale: inner.k === "decimal" ? inner.scale + 6 : 2 };
      }
      if (n === "min" || n === "max") return exprType(e.args[0], scope, cat);
      err("E_FEATURE_NOT_SUPPORTED", `Window function \`${e.name}\` is not in seamql/0.1.`, { line: e.span.line, column: e.span.column });
    }
    case "cast":
      if (e.type.k === "int") return { k: "int" };
      if (e.type.k === "decimal") return e.type;
      if (e.type.k === "text") return { k: "text" };
      if (e.type.k === "bool") return { k: "bool" };
      if (e.type.k === "stamp") return { k: "stamp" };
      return { k: "day" };
  }
  void optional;
}
