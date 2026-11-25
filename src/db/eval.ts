import { Decimal } from "./codec";
import { err } from "./errors";
import type { Expr, Literal } from "./parser";
import { checkInt, displayValue, typeName, type SeamType, type SeamValue, valueType } from "./values";

export type Ternary = true | false | "unknown";

export interface EvalCtx {
  row: Record<string, SeamValue>;
  now: bigint;
  today: number;
  /** Scalar subquery / exists — resolved by the engine into a materialized result. */
  subQ?: (e: Extract<Expr, { op: "subq" | "exists" | "in" }>) => SeamValue;
  /** Window functions — precomputed per-row values resolved by the engine. */
  winPath?: (e: Extract<Expr, { op: "wfn" }>) => SeamValue;
}

export function evalExpr(e: Expr, ctx: EvalCtx): SeamValue {
  switch (e.op) {
    case "lit":
      return lit(e.value);
    case "col": {
      const key = e.table ? `${e.table}.${e.name}` : e.name;
      const v = ctx.row[key] ?? ctx.row[e.name];
      if (!v) err("E_UNKNOWN_NAME", `Column \`${key}\` is not in scope.`, { line: e.span.line, column: e.span.column });
      return v;
    }
    case "star":
      err("E_SYNTAX", "`*` is not an expression value.");
    case "fn":
      return evalFn(e.name, e.args, ctx);
    case "unary": {
      const inner = evalExpr(e.inner, ctx);
      if (e.kind === "not") {
        const t = asBool(inner);
        if (t === "unknown") return { t: "null" };
        return { t: "bool", v: !t };
      }
      if (inner.t === "null") return { t: "null" };
      if (inner.t === "int") return { t: "int", v: checkInt(-inner.v) };
      if (inner.t === "decimal") return { t: "decimal", v: new Decimal(-inner.v.unscaled, inner.v.scale, inner.v.precision) };
      err("E_TYPE_MISMATCH", `Cannot negate ${typeName(valueType(inner))}.`);
    }
    case "bin":
      return evalBin(e.kind, evalExpr(e.left, ctx), evalExpr(e.right, ctx));
    case "is": {
      const l = evalExpr(e.left, ctx);
      let eq: boolean;
      if (e.right.t === "null") eq = l.t === "null";
      else eq = equal(l, lit(e.right as Literal));
      return { t: "bool", v: e.not ? !eq : eq };
    }
    case "cast":
      return cast(evalExpr(e.inner, ctx), {
        int: { k: "int" },
        decimal: e.type.k === "decimal" ? e.type : { k: "decimal", precision: 38, scale: 0 },
        text: { k: "text" },
        bool: { k: "bool" },
        stamp: { k: "stamp" },
        day: { k: "day" },
      }[e.type.k] as SeamType);
    case "case": {
      for (const w of e.whens) {
        if (asBool(evalExpr(w.when, ctx)) === true) return evalExpr(w.then, ctx);
      }
      return e.els ? evalExpr(e.els, ctx) : { t: "null" };
    }
    case "in":
      return evalIn(e, ctx);
    case "exists":
    case "subq":
      if (!ctx.subQ) err("E_SYNTAX", "Subquery used outside a statement context.", { line: e.span.line, column: e.span.column });
      return ctx.subQ(e) as SeamValue;
    case "like": {
      const l = evalExpr(e.left, ctx);
      if (l.t === "null") return { t: "null" };
      if (l.t !== "text") err("E_TYPE_MISMATCH", "like needs a text value.", { line: e.span.line, column: e.span.column });
      const hit = likeMatch(l.v, e.pat);
      return { t: "bool", v: e.not ? !hit : hit };
    }
    case "wfn":
      if (!ctx.winPath) err("E_SYNTAX", "over (…) needs a select context.", { line: e.span.line, column: e.span.column });
      return ctx.winPath(e) as SeamValue;
  }
}

function evalIn(e: Extract<Expr, { op: "in" }>, ctx: EvalCtx): SeamValue {
  const l = evalExpr(e.left, ctx);
  if (l.t === "null") return { t: "null" };
  if (e.sub) {
    if (!ctx.subQ) err("E_SYNTAX", "in (select …) needs a select context.", { line: e.span.line, column: e.span.column });
    if (asBool(ctx.subQ(e)) !== true) return e.not ? { t: "bool", v: true } : { t: "bool", v: false };
    return e.not ? { t: "bool", v: false } : { t: "bool", v: true };
  }
  let hit = false;
  for (const it of e.list) {
    const v = evalExpr(it, ctx);
    if (v.t === "null") continue;
    if (equal(l, v)) {
      hit = true;
      break;
    }
  }
  return { t: "bool", v: e.not ? !hit : hit };
}

/** SQL like: `%` is any run, `_` is exactly one char. Everything else is literal. */
export function likeMatch(text: string, pat: string): boolean {
  let re = "";
  for (const ch of pat) {
    if (ch === "%") re += ".*";
    else if (ch === "_") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "").test(text);
}

export function predTrue(e: Expr, ctx: EvalCtx): boolean {
  const v = evalExpr(e, ctx);
  return asBool(v) === true;
}

function lit(v: Literal): SeamValue {
  if (v.t === "decimal") return { t: "decimal", v: v.v };
  if (v.t === "int") return { t: "int", v: v.v };
  if (v.t === "text") return { t: "text", v: v.v };
  if (v.t === "bool") return { t: "bool", v: v.v };
  return { t: "null" };
}

function asBool(v: SeamValue): Ternary {
  if (v.t === "null") return "unknown";
  if (v.t !== "bool") err("E_TYPE_MISMATCH", "Predicate must be yesno.");
  return v.v;
}

function equal(a: SeamValue, b: SeamValue): boolean {
  if (a.t === "null" || b.t === "null") return false;
  if (a.t !== b.t) return false;
  if (a.t === "decimal" && b.t === "decimal") {
    const s = Math.max(a.v.scale, b.v.scale);
    return a.v.rescaled(s, 38).unscaled === b.v.rescaled(s, 38).unscaled;
  }
  if (a.t === "int" || a.t === "stamp") return b.t === a.t && a.v === b.v;
  if (a.t === "text") return b.t === "text" && a.v === b.v;
  if (a.t === "bool") return b.t === "bool" && a.v === b.v;
  if (a.t === "day") return b.t === "day" && a.v === b.v;
  return false;
}

function cmp(a: SeamValue, b: SeamValue): number | null {
  if (a.t === "null" || b.t === "null") return null;
  if (a.t === "int" && b.t === "decimal") {
    a = { t: "decimal", v: new Decimal(a.v, 0, 38) };
  } else if (a.t === "decimal" && b.t === "int") {
    b = { t: "decimal", v: new Decimal(b.v, 0, 38) };
  }
  if (a.t !== b.t) err("E_TYPE_MISMATCH", `Cannot compare ${typeName(valueType(a))} and ${typeName(valueType(b))}.`);
  if (a.t === "int" && b.t === "int") return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
  if (a.t === "decimal" && b.t === "decimal") {
    const s = Math.max(a.v.scale, b.v.scale);
    const x = a.v.rescaled(s, 38).unscaled;
    const y = b.v.rescaled(s, 38).unscaled;
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (a.t === "text" && b.t === "text") return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
  if (a.t === "bool" && b.t === "bool") return Number(a.v) - Number(b.v);
  if (a.t === "stamp" && b.t === "stamp") return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
  if (a.t === "day" && b.t === "day") return a.v - b.v;
  err("E_TYPE_MISMATCH", "Incomparable values.");
}

function evalBin(kind: string, l: SeamValue, r: SeamValue): SeamValue {
  if (kind === "and" || kind === "or") {
    const a = asBool(l);
    const b = asBool(r);
    const res = kind === "and" ? and3(a, b) : or3(a, b);
    if (res === "unknown") return { t: "null" };
    return { t: "bool", v: res };
  }
  if (["eq", "ne", "lt", "gt", "le", "ge"].includes(kind)) {
    const c = cmp(l, r);
    if (c == null) return { t: "null" };
    const v =
      kind === "eq"
        ? c === 0
        : kind === "ne"
          ? c !== 0
          : kind === "lt"
            ? c < 0
            : kind === "gt"
              ? c > 0
              : kind === "le"
                ? c <= 0
                : c >= 0;
    return { t: "bool", v };
  }
  if (l.t === "null" || r.t === "null") return { t: "null" };
  if (l.t === "int" && r.t === "decimal") {
    return evalBin(kind, { t: "decimal", v: new Decimal(l.v, 0, 38) }, r);
  }
  if (l.t === "decimal" && r.t === "int") {
    return evalBin(kind, l, { t: "decimal", v: new Decimal(r.v, 0, 38) });
  }
  if (l.t === "int" && r.t === "int") {
    if (kind === "+") return { t: "int", v: checkInt(l.v + r.v) };
    if (kind === "-") return { t: "int", v: checkInt(l.v - r.v) };
    if (kind === "*") return { t: "int", v: checkInt(l.v * r.v) };
    if (kind === "/") {
      if (r.v === 0n) err("E_DIV_ZERO", "Division by zero.");
      return { t: "int", v: l.v / r.v };
    }
  }
  if (l.t === "decimal" && r.t === "decimal") {
    const s = Math.max(l.v.scale, r.v.scale);
    const a = l.v.rescaled(s, 38);
    const b = r.v.rescaled(s, 38);
    if (kind === "+") return { t: "decimal", v: new Decimal(a.unscaled + b.unscaled, s, 38) };
    if (kind === "-") return { t: "decimal", v: new Decimal(a.unscaled - b.unscaled, s, 38) };
    if (kind === "*") {
      // scales add, so exact digits are kept: 0.10 * 3 = 0.30, not 0.3000
      return { t: "decimal", v: new Decimal(l.v.unscaled * r.v.unscaled, l.v.scale + r.v.scale, 38) };
    }
    if (kind === "/") {
      if (b.unscaled === 0n) err("E_DIV_ZERO", "Division by zero.");
      const extra = 6;
      const num = a.unscaled * 10n ** BigInt(extra);
      return { t: "decimal", v: new Decimal(num / b.unscaled, extra, 38) };
    }
  }
  err("E_TYPE_MISMATCH", `Cannot apply ${kind} to ${typeName(valueType(l))} and ${typeName(valueType(r))}.`);
}

function and3(a: Ternary, b: Ternary): Ternary {
  if (a === false || b === false) return false;
  if (a === true && b === true) return true;
  return "unknown";
}
function or3(a: Ternary, b: Ternary): Ternary {
  if (a === true || b === true) return true;
  if (a === false && b === false) return false;
  return "unknown";
}

function evalFn(name: string, args: Expr[], ctx: EvalCtx): SeamValue {
  const n = name.toLowerCase();
  if (n === "now") return { t: "stamp", v: ctx.now };
  if (n === "today") return { t: "day", v: ctx.today };
  if (n === "__as") return evalExpr(args[0], ctx);
  if (n === "tally" || n === "count" || n === "sum" || n === "stack" || n === "min" || n === "max" || n === "avg") {
    err("E_SYNTAX", "Aggregates only belong in pull lists with bunch by.");
  }
  err("E_UNKNOWN_NAME", `Function \`${name}\` is not in seamql/0.1.`);
}

export function cast(v: SeamValue, ty: SeamType): SeamValue {
  if (v.t === "null") return { t: "null" };
  if (ty.k === "text") return { t: "text", v: displayValue(v).replace(/^"|"$/g, "") };
  if (ty.k === "int" && v.t === "int") return v;
  if (ty.k === "int" && v.t === "decimal") {
    const i = v.v.rescaled(0, 38).unscaled;
    return { t: "int", v: checkInt(i) };
  }
  if (ty.k === "decimal" && v.t === "int") return { t: "decimal", v: new Decimal(v.v, 0, ty.precision).rescaled(ty.scale, ty.precision) };
  if (ty.k === "decimal" && v.t === "decimal") return { t: "decimal", v: v.v.rescaled(ty.scale, ty.precision) };
  err("E_TYPE_MISMATCH", `Cannot cast ${typeName(valueType(v))} to ${ty.k}.`);
}

export function compareValues(a: SeamValue, b: SeamValue): number {
  const c = cmp(a, b);
  if (c == null) return a.t === "null" ? (b.t === "null" ? 0 : -1) : 1;
  return c;
}
