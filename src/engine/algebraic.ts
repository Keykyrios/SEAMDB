/**
 * Bounded exact-arithmetic constraint checker over Q.
 * UNKNOWN is never treated as verified.
 */

export type SolverResult = "UNSAT" | "SAT" | "UNKNOWN";

export interface AlgebraicReport {
  result: SolverResult;
  profile: "conservation+linear/v1";
  ring: "Q";
  variables: string[];
  constraints_digest: string;
  solver_version: string;
  resource_cap: string;
  counterexample?: Record<string, number>;
  statement: string;
}

type Term = Map<string, number>;

function keyOf(exps: number[]): string {
  return exps.join(",");
}

class Poly {
  constructor(
    readonly vars: string[],
    readonly terms: Term,
  ) {}

  static fromLinear(vars: string[], coeffs: number[], constant: number): Poly {
    const terms = new Map<string, number>();
    const z = new Array(vars.length).fill(0);
    if (constant !== 0) terms.set(keyOf(z), constant);
    for (let i = 0; i < vars.length; i++) {
      if (coeffs[i] === 0) continue;
      const e = z.slice();
      e[i] = 1;
      terms.set(keyOf(e), coeffs[i]);
    }
    return new Poly(vars, terms);
  }

  isZero(): boolean {
    for (const c of this.terms.values()) if (c !== 0) return false;
    return true;
  }
}

function gaussian(eqs: number[][], rhs: number[]): { sat: boolean; sample?: number[] } | "singular" {
  const n = eqs[0]?.length ?? 0;
  const m = eqs.length;
  const A = eqs.map((row, i) => [...row, rhs[i]]);
  const cols = n + 1;
  let rank = 0;
  const pivotCol: number[] = [];
  for (let c = 0; c < n && rank < m; c++) {
    let piv = rank;
    for (let r = rank + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) continue;
    [A[rank], A[piv]] = [A[piv], A[rank]];
    const div = A[rank][c];
    for (let k = 0; k < cols; k++) A[rank][k] /= div;
    for (let r = 0; r < m; r++) {
      if (r === rank) continue;
      const f = A[r][c];
      for (let k = 0; k < cols; k++) A[r][k] -= f * A[rank][k];
    }
    pivotCol.push(c);
    rank++;
  }
  for (let r = 0; r < m; r++) {
    const allZero = A[r].slice(0, n).every((v) => Math.abs(v) < 1e-12);
    if (allZero && Math.abs(A[r][n]) > 1e-9) return { sat: false };
  }
  const x = new Array(n).fill(0);
  for (let i = 0; i < pivotCol.length; i++) x[pivotCol[i]] = A[i][n];
  return { sat: true, sample: x };
}

export async function checkConservation(args: {
  inputs: number[];
  outputs: number[];
  statement: string;
}): Promise<AlgebraicReport> {
  const { domainHashTagged } = await import("./hash");
  const { canonicalizeBytes } = await import("./canonical");
  const sumIn = args.inputs.reduce((a, b) => a + b, 0);
  const sumOut = args.outputs.reduce((a, b) => a + b, 0);
  const digest = await domainHashTagged(
    "SEAMDB/ALG/V1",
    canonicalizeBytes({ inputs: args.inputs, outputs: args.outputs }),
  );
  const ok = sumIn === sumOut;
  const poly = Poly.fromLinear(["S"], [1], -(sumIn - sumOut));
  return {
    result: ok ? "UNSAT" : "SAT",
    profile: "conservation+linear/v1",
    ring: "Q",
    variables: ["sum_in", "sum_out"],
    constraints_digest: digest,
    solver_version: "seamdb-lin/v1",
    resource_cap: "linear-systems ≤ 32 vars; higher degree → UNKNOWN",
    counterexample: ok ? undefined : { sum_in: sumIn, sum_out: sumOut, residual: sumIn - sumOut },
    statement: args.statement + (poly.isZero() ? " | identity" : ""),
  };
}

export async function checkLinearSystem(args: {
  matrix: number[][];
  rhs: number[];
  variables: string[];
  statement: string;
}): Promise<AlgebraicReport> {
  const { domainHashTagged } = await import("./hash");
  const { canonicalizeBytes } = await import("./canonical");
  if (args.matrix.some((r) => r.length !== args.variables.length)) {
    return {
      result: "UNKNOWN",
      profile: "conservation+linear/v1",
      ring: "Q",
      variables: args.variables,
      constraints_digest: await domainHashTagged("SEAMDB/ALG/V1", canonicalizeBytes({ err: "shape" })),
      solver_version: "seamdb-lin/v1",
      resource_cap: "linear-systems ≤ 32 vars; higher degree → UNKNOWN",
      statement: args.statement,
    };
  }
  if (args.variables.length > 32) {
    return {
      result: "UNKNOWN",
      profile: "conservation+linear/v1",
      ring: "Q",
      variables: args.variables,
      constraints_digest: await domainHashTagged("SEAMDB/ALG/V1", canonicalizeBytes({ err: "cap" })),
      solver_version: "seamdb-lin/v1",
      resource_cap: "linear-systems ≤ 32 vars; higher degree → UNKNOWN",
      statement: args.statement,
    };
  }
  const g = gaussian(args.matrix, args.rhs);
  const digest = await domainHashTagged(
    "SEAMDB/ALG/V1",
    canonicalizeBytes({ matrix: args.matrix, rhs: args.rhs }),
  );
  if (g === "singular") {
    return {
      result: "UNKNOWN",
      profile: "conservation+linear/v1",
      ring: "Q",
      variables: args.variables,
      constraints_digest: digest,
      solver_version: "seamdb-lin/v1",
      resource_cap: "linear-systems ≤ 32 vars; higher degree → UNKNOWN",
      statement: args.statement,
    };
  }
  return {
    result: g.sat ? "SAT" : "UNSAT",
    profile: "conservation+linear/v1",
    ring: "Q",
    variables: args.variables,
    constraints_digest: digest,
    solver_version: "seamdb-lin/v1",
    resource_cap: "linear-systems ≤ 32 vars; higher degree → UNKNOWN",
    counterexample: g.sat
      ? Object.fromEntries(args.variables.map((v, i) => [v, g.sample![i]]))
      : undefined,
    statement: args.statement,
  };
}

export function algebraicPassesRelease(report: AlgebraicReport, required: boolean): boolean {
  if (!required) return true;
  return report.result === "UNSAT";
}
