import { Decimal } from "./codec";
import { err } from "./errors";
import { compareValues, evalExpr, type EvalCtx } from "./eval";
import { prettyExpr, type Expr } from "./parser";
import { displayValue, type SeamValue } from "./values";

export type Wfn = Extract<Expr, { op: "wfn" }>;

/** Walk every node of an expression tree, including nested case/in/exists/subq. */
export function walkExpr(e: Expr, f: (x: Expr) => void): void {
  f(e);
  switch (e.op) {
    case "unary":
      return walkExpr(e.inner, f);
    case "bin":
      walkExpr(e.left, f);
      return walkExpr(e.right, f);
    case "is":
      return walkExpr(e.left, f);
    case "cast":
      return walkExpr(e.inner, f);
    case "fn":
      return e.args.forEach((a) => walkExpr(a, f));
    case "wfn":
      e.args.forEach((a) => walkExpr(a, f));
      e.partition.forEach((a) => walkExpr(a, f));
      e.order.forEach((o) => walkExpr(o.expr, f));
      return;
    case "case":
      e.whens.forEach((w) => {
        walkExpr(w.when, f);
        walkExpr(w.then, f);
      });
      if (e.els) walkExpr(e.els, f);
      return;
    case "in":
      walkExpr(e.left, f);
      e.list.forEach((a) => walkExpr(a, f));
      return;
    case "like":
      return walkExpr(e.left, f);
    default:
      return;
  }
}

/** Every `over (…)` node in a statement's expression set. */
export function collectWfns(exprs: Array<Expr | null>): Wfn[] {
  const out: Wfn[] = [];
  for (const e of exprs) {
    if (!e) continue;
    walkExpr(e, (x) => {
      if (x.op === "wfn") out.push(x);
    });
  }
  return out;
}

export interface WinHost {
  /** evaluates one scalar against a row, using a plain (no subquery/window) context */
  ev: (e: Expr, row: Record<string, SeamValue>) => SeamValue;
}

/**
 * Compute every window function over `rows` (the post-filter, pre-projection
 * row set). Frames are whole-partition: aggregates run over the whole window
 * partition (seamql/0.1 documents no `rows between` frames yet).
 */
export function computeWindows(rows: Record<string, SeamValue>[], wfns: Wfn[], host: WinHost): Map<string, SeamValue[]> {
  const out = new Map<string, SeamValue[]>();
  for (const w of wfns) {
    const name = w.name.toLowerCase();
    if (!["row_number", "rank", "dense_rank", "ntile", "lead", "lag", "sum", "avg", "min", "max", "count"].includes(name)) {
      err("E_FEATURE_NOT_SUPPORTED", `Window function \`${w.name}\` is not in seamql/0.1.`, { line: w.span.line, column: w.span.column });
    }
    // sort indices by partition key, then window order — stable for ties
    const idx = rows.map((_, i) => i);
    idx.sort((ia, ib) => {
      for (const p of w.partition) {
        const c = compareValues(host.ev(p, rows[ia]), host.ev(p, rows[ib]));
        if (c) return c;
      }
      for (const o of w.order) {
        const c = compareValues(host.ev(o.expr, rows[ia]), host.ev(o.expr, rows[ib]));
        if (c) return o.desc ? -c : c;
      }
      return 0;
    });
    const vals: SeamValue[] = new Array(rows.length);
    // walk sorted order, cutting at partition boundaries
    const partKey = (i: number) => w.partition.map((p) => displayValue(host.ev(p, rows[i]))).join("\u0000");
    const orderKey = (i: number) => w.order.map((o) => displayValue(host.ev(o.expr, rows[i]))).join("\u0000");
    // Precompute peer groups (equal order keys) per partition
    const groups: number[][] = [];
    let start = 0;
    for (let k = 1; k <= idx.length; k++) {
      const boundary =
        k === idx.length ||
        partKey(idx[k]) !== partKey(idx[start]) ||
        (w.order.length > 0 && orderKey(idx[k]) !== orderKey(idx[start]));
      if (boundary) {
        groups.push(idx.slice(start, k));
        start = k;
      }
    }
    // groups arrive ordered; a partition switch resets rank/dense position
    let pos = 0;
    let rank = 0; // 1-based row index of first peer within its partition
    let dense = 0; // distinct peer keys seen so far in this partition
    let prevPart = "\u0001";
    let partIdx: number[] = []; // full ordered index set of the current partition
    for (const g of groups) {
      const part = partKey(g[0] ?? idx[0] ?? 0);
      if (part !== prevPart) {
        rank = 0;
        dense = 0;
        prevPart = part;
        partIdx = idx.filter((j) => partKey(j) === part);
      }
      rank = pos + 1;
      dense += 1; // each peer group advances the dense counter
      g.forEach((i, gi) => {
        switch (name) {
          case "row_number":
            vals[i] = { t: "int", v: BigInt(pos + gi + 1) };
            break;
          case "rank":
            vals[i] = { t: "int", v: BigInt(rank) };
            break;
          case "dense_rank":
            vals[i] = { t: "int", v: BigInt(dense) };
            break;
          case "ntile": {
            const n = Number(host.ev(w.args[0], rows[i]));
            if (!Number.isSafeInteger(n) || n < 1) err("E_TYPE_MISMATCH", "ntile(n) needs a positive whole number.", { line: w.span.line, column: w.span.column });
            vals[i] = { t: "int", v: BigInt(Math.floor((gi * n) / g.length) + 1) };
            break;
          }
          case "lead":
          case "lag": {
            const off = w.args[1] ? Number(host.ev(w.args[1], rows[i])) : 1;
            const dflt = w.args[2] ? host.ev(w.args[2], rows[i]) : { t: "null" as const };
            // Walk the whole ordered partition, not the peer group.
            const pi = partIdx.indexOf(i);
            const target = name === "lead" ? partIdx[pi + off] : partIdx[pi - off];
            vals[i] = target !== undefined ? host.ev(w.args[0], rows[target]) : dflt;
            break;
          }
          case "sum":
          case "avg":
          case "min":
          case "max":
          case "count": {
            // whole-partition aggregate (no sliding frames in v0)
            const xs = g.map((j) => host.ev(w.args[0] ?? { op: "star", span: w.span }, rows[j])).filter((v) => v.t !== "null");
            if (name === "count") {
              const star = !w.args[0] || w.args[0].op === "star";
              vals[i] = { t: "int", v: BigInt(star ? g.length : xs.length) };
            } else {
              vals[i] = aggScalar(name, w, xs);
            }
            break;
          }
        }
      });
      pos += g.length;
    }
    out.set(prettyExpr(w), vals);
  }
  return out;
}

function aggScalar(name: string, _w: Wfn, xs: SeamValue[]): SeamValue {
  if (xs.length === 0) return { t: "null" };
  if (name === "min" || name === "max") {
    let best = xs[0]!;
    for (const v of xs) {
      const c = compareValues(v, best);
      if (name === "min" ? c < 0 : c > 0) best = v;
    }
    return best;
  }
  if (name === "sum") {
    if (!xs.every((v) => v.t === "int" || v.t === "decimal")) err("E_TYPE_MISMATCH", "sum over needs whole numbers or decimals, never a mix.");
    return sumNums(xs);
  }
  // avg: whole numbers report hundredths; decimals keep six extra digits
  if (!xs.every((v) => v.t === "int" || v.t === "decimal")) err("E_TYPE_MISMATCH", "avg over needs whole numbers or decimals, never a mix.");
  const s = sumNums(xs);
  if (s.t === "int") return { t: "decimal", v: new Decimal((s.v * 100n) / BigInt(xs.length), 2, 38) };
  if (s.t === "decimal") return { t: "decimal", v: new Decimal((s.v.unscaled * 10n ** 6n) / BigInt(xs.length), s.v.scale + 6, 38) };
  return { t: "null" };
}

/** Exact integer/decimal sum through a common scale — no float rounding. */
function sumNums(xs: SeamValue[]): SeamValue {
  if (xs.every((v) => v.t === "int")) {
    let s = 0n;
    for (const v of xs) s += v.v;
    return { t: "int", v: s };
  }
  let scale = 0;
  for (const v of xs) if (v.t === "decimal") scale = Math.max(scale, v.v.scale);
  let s = 0n;
  for (const v of xs) {
    if (v.t === "decimal") s += v.v.rescaled(scale, 38).unscaled;
    else if (v.t === "int") s += v.v * 10n ** BigInt(scale);
  }
  return { t: "decimal", v: new Decimal(s, scale, 38) };
}

/** Evaluates one scalar against a row with the current context (partition keys,
 * window order). Window/subquery hooks inside are rejected by the engine. */
export function plainEval(e: Expr, row: Record<string, SeamValue>, ctx: EvalCtx): SeamValue {
  return evalExpr(e, { ...ctx, row });
}

