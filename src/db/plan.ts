import type { Expr, Statement } from "./parser";

export type PhysicalPlan =
  | { k: "HeapScan"; table: string }
  | { k: "IndexPoint"; table: string; index: string; key: Expr }
  | { k: "Filter"; inner: PhysicalPlan; pred: Expr }
  | { k: "NestedLoop"; left: PhysicalPlan; right: PhysicalPlan; on: Expr; leftJoin: boolean }
  | { k: "Project"; inner: PhysicalPlan }
  | { k: "HashAgg"; inner: PhysicalPlan }
  | { k: "Sort"; inner: PhysicalPlan }
  | { k: "Cap"; inner: PhysicalPlan; n: number };

export interface IndexHint {
  name: string;
  table: string;
  columns: string[];
}

export function planPull(
  stmt: Extract<Statement, { k: "pull" }>,
  indexes: IndexHint[],
  optimize: boolean,
): PhysicalPlan {
  let p: PhysicalPlan = chooseScan(stmt.fromSel?.alias || stmt.from, stmt.filter, indexes, optimize);
  if (stmt.filter) p = { k: "Filter", inner: p, pred: stmt.filter };
  for (const j of stmt.joins) {
    if (!j.on) {
      // cross join: cartesian product, no static source predicate
      const r = { k: "HeapScan" as const, table: j.table };
      p = { k: "NestedLoop", left: p, right: r, on: { op: "lit", value: { t: "bool", v: true }, span: { line: 1, column: 1, offset: 0 } }, leftJoin: false };
      continue;
    }
    const r = chooseScan(j.table, j.on, indexes, optimize);
    p = { k: "NestedLoop", left: p, right: r, on: j.on, leftJoin: j.kind === "left" };
  }
  const agg = stmt.group.length > 0 || stmt.proj.some(isAggProj);
  if (agg) {
    p = { k: "HashAgg", inner: p };
    if (stmt.order.length) p = { k: "Sort", inner: p };
  } else {
    if (stmt.order.length) p = { k: "Sort", inner: p };
    p = { k: "Project", inner: p };
  }
  if (stmt.cap != null) p = { k: "Cap", inner: p, n: stmt.cap };
  return p;
}

function chooseScan(table: string, filter: Expr | null, indexes: IndexHint[], optimize: boolean): PhysicalPlan {
  if (!optimize || !filter) return { k: "HeapScan", table };
  const eq = eqColumn(filter);
  if (!eq) return { k: "HeapScan", table };
  const idx = indexes.find((i) => i.table === table && i.columns.length === 1 && i.columns[0] === eq.col);
  if (!idx) return { k: "HeapScan", table };
  return { k: "IndexPoint", table, index: idx.name, key: eq.rhs };
}

function eqColumn(e: Expr): { col: string; rhs: Expr } | null {
  if (e.op === "bin" && e.kind === "eq") {
    if (e.left.op === "col" && e.right.op === "lit") return { col: e.left.name, rhs: e.right };
    if (e.right.op === "col" && e.left.op === "lit") return { col: e.right.name, rhs: e.left };
  }
  if (e.op === "bin" && e.kind === "and") return eqColumn(e.left) ?? eqColumn(e.right);
  return null;
}

function isAgg(name: string): boolean {
  return ["count", "tally", "sum", "stack", "min", "max", "avg"].includes(name.toLowerCase());
}

function isAggProj(p: Expr): boolean {
  if (p.op !== "fn") return false;
  if (isAgg(p.name)) return true;
  return p.name === "__as" && p.args[0]?.op === "fn" && isAgg(p.args[0].name);
}

export function planText(p: PhysicalPlan): string {
  switch (p.k) {
    case "HeapScan":
      return `HeapScan(${p.table})`;
    case "IndexPoint":
      return `IndexPoint(${p.table}.${p.index})`;
    case "Filter":
      return `${planText(p.inner)} -> Filter`;
    case "NestedLoop":
      return `${planText(p.left)} -> NestedLoop${p.leftJoin ? "Left" : ""}(${planText(p.right)})`;
    case "Project":
      return `${planText(p.inner)} -> Project`;
    case "HashAgg":
      return `${planText(p.inner)} -> HashAgg`;
    case "Sort":
      return `${planText(p.inner)} -> Sort`;
    case "Cap":
      return `${planText(p.inner)} -> Cap(${p.n})`;
  }
}

export function planFingerprint(p: PhysicalPlan): string {
  return planText(p);
}
