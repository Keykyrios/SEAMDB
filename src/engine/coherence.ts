import { canonicalizeBytes } from "./canonical";
import { domainHashTagged } from "./hash";
import { uuidV7 } from "./bytes";
import type { CanonicalRow, DiscrepancyWitness } from "./types";

export interface ViewSection {
  source_ref: string;
  snapshot_root: string;
  mapping_version: string;
  rows: CanonicalRow[];
  overlap_key: string;
  numeric_fields: string[];
  tau: number;
}

export interface CoherenceReport {
  alerts: DiscrepancyWitness[];
  comparable: boolean;
  cycle_witness: { cycle: string[]; residual: number; keys_digest: string } | null;
  obstruction_norm: number;
}

function indexByKey(section: ViewSection): Map<string, CanonicalRow> {
  const m = new Map<string, CanonicalRow>();
  for (const row of section.rows) {
    const key = String(row.fields[section.overlap_key]);
    m.set(key, row);
  }
  return m;
}

export async function compareSections(left: ViewSection, right: ViewSection): Promise<CoherenceReport> {
  if (left.mapping_version !== right.mapping_version) {
    return {
      alerts: [
        {
          finding_id: uuidV7(),
          overlap_id: `${left.source_ref}∩${right.source_ref}`,
          left_source: left.source_ref,
          right_source: right.source_ref,
          row_ref: "n/a",
          field: "*",
          class: "mapping_version",
          residual: 1,
          severity: "high",
          left_snapshot_root: left.snapshot_root,
          right_snapshot_root: right.snapshot_root,
          mapping_digest: await domainHashTagged(
            "SEAMDB/MAP/V1",
            canonicalizeBytes({ l: left.mapping_version, r: right.mapping_version }),
          ),
          disposition: "open",
        },
      ],
      comparable: false,
      cycle_witness: null,
      obstruction_norm: 1,
    };
  }

  const mapping_digest = await domainHashTagged(
    "SEAMDB/MAP/V1",
    canonicalizeBytes({ version: left.mapping_version, key: left.overlap_key }),
  );

  const L = indexByKey(left);
  const R = indexByKey(right);
  const keys = new Set([...L.keys(), ...R.keys()]);
  const alerts: DiscrepancyWitness[] = [];

  for (const k of keys) {
    const a = L.get(k);
    const b = R.get(k);
    if (!a || !b) continue;
    for (const field of left.numeric_fields) {
      const va = Number(a.fields[field] ?? 0);
      const vb = Number(b.fields[field] ?? 0);
      const residual = va - vb;
      if (Math.abs(residual) > left.tau) {
        alerts.push({
          finding_id: uuidV7(),
          overlap_id: `${left.source_ref}∩${right.source_ref}`,
          left_source: left.source_ref,
          right_source: right.source_ref,
          row_ref: a.row_ref,
          field,
          class: "equality",
          residual,
          severity: Math.abs(residual) > 2000 ? "critical" : Math.abs(residual) > 500 ? "high" : "medium",
          left_snapshot_root: left.snapshot_root,
          right_snapshot_root: right.snapshot_root,
          mapping_digest,
          disposition: "open",
        });
      }
    }
  }

  const obstruction_norm = Math.sqrt(alerts.reduce((s, a) => s + a.residual * a.residual, 0));
  return {
    alerts,
    comparable: true,
    cycle_witness: null,
    obstruction_norm,
  };
}

export async function cycleResidual(
  cycle: ViewSection[],
  field: string,
): Promise<{ cycle: string[]; residual: number; keys_digest: string } | null> {
  if (cycle.length < 3) return null;
  if (cycle.some((s) => s.mapping_version !== cycle[0].mapping_version)) return null;
  const maps = cycle.map(indexByKey);
  const keys = [...maps[0].keys()].filter((k) => maps.every((m) => m.has(k)));
  let residual = 0;
  for (const k of keys) {
    const values = maps.map((m) => Number(m.get(k)!.fields[field] ?? 0));
    residual += values[0] - values[values.length - 1];
    for (let i = 0; i < values.length - 1; i++) residual += values[i] - values[i + 1];
  }
  const keys_digest = await domainHashTagged(
    "SEAMDB/CYCLE-KEYS/V1",
    canonicalizeBytes({ keys: keys.sort(), field }),
  );
  return { cycle: cycle.map((c) => c.source_ref), residual, keys_digest };
}

export async function runCoherence(views: ViewSection[]): Promise<CoherenceReport> {
  const all: DiscrepancyWitness[] = [];
  let obstruction = 0;
  let comparable = true;
  for (let i = 0; i < views.length; i++) {
    for (let j = i + 1; j < views.length; j++) {
      const r = await compareSections(views[i], views[j]);
      all.push(...r.alerts);
      obstruction += r.obstruction_norm;
      comparable &&= r.comparable;
    }
  }
  const cycle = views.length >= 3 ? await cycleResidual(views, views[0].numeric_fields[0]) : null;
  if (cycle && Math.abs(cycle.residual) > 0) {
    all.push({
      finding_id: uuidV7(),
      overlap_id: cycle.cycle.join("→"),
      left_source: cycle.cycle[0],
      right_source: cycle.cycle[cycle.cycle.length - 1],
      row_ref: "cycle",
      field: views[0].numeric_fields[0],
      class: "cycle",
      residual: cycle.residual,
      severity: "high",
      left_snapshot_root: views[0].snapshot_root,
      right_snapshot_root: views[views.length - 1].snapshot_root,
      mapping_digest: cycle.keys_digest,
      disposition: "open",
    });
  }
  return {
    alerts: all,
    comparable,
    cycle_witness: cycle && Math.abs(cycle.residual) > 0 ? cycle : null,
    obstruction_norm: obstruction,
  };
}
