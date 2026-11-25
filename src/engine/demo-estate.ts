import type { CanonicalRow, SourceView } from "./types";

export const TENANT = {
  tenant_id: "tn_7c91e2a0",
  crypto_domain: "crypto.tn_7c91e2a0",
  display: "Northwind Health (synthetic design-partner)",
};

export const SOURCES: SourceView[] = [
  {
    source_ref: "src_claims",
    kind: "postgres",
    name: "Claims system of record",
    owner: "actuarial-platform",
    connector_version: "seamdb-pg/0.4.2",
    schema: { member_ref: "string", amount_cents: "int", dx_class: "string", encounter_day: "int" },
  },
  {
    source_ref: "src_wh",
    kind: "warehouse",
    name: "Analytics warehouse",
    owner: "data-platform",
    connector_version: "seamdb-wh/0.3.1",
    schema: { member_ref: "string", amount_cents: "int", dx_class: "string", encounter_day: "int" },
  },
  {
    source_ref: "src_feat",
    kind: "feature_store",
    name: "Model feature store",
    owner: "ml-platform",
    connector_version: "seamdb-fs/0.2.0",
    schema: { member_ref: "string", amount_cents: "int", dx_class: "string", encounter_day: "int" },
  },
];

const DX = ["A00", "B12", "C04", "D19", "E08"];

function row(source: string, i: number, amount: number): CanonicalRow {
  return {
    row_ref: `${source}:r${String(i).padStart(3, "0")}`,
    partition: "p0",
    fields: {
      member_ref: `m_${String(i).padStart(3, "0")}`,
      amount_cents: amount,
      dx_class: DX[i % DX.length],
      encounter_day: 20261001 + (i % 12),
    },
  };
}

export function buildSyntheticRows(): {
  claims: CanonicalRow[];
  warehouse: CanonicalRow[];
  features: CanonicalRow[];
  note: string;
} {
  const claims: CanonicalRow[] = [];
  const warehouse: CanonicalRow[] = [];
  const features: CanonicalRow[] = [];
  for (let i = 1; i <= 48; i++) {
    const base = 12000 + i * 37;
    claims.push(row("claims", i, base));
    let wh = base;
    let ft = base;
    if (i === 7) wh = base + 850;
    if (i === 19) wh = base - 400;
    if (i === 31) {
      wh = base + 1200;
      ft = base + 1200;
    }
    warehouse.push(row("wh", i, wh));
    features.push(row("feat", i, ft));
  }
  return {
    claims,
    warehouse,
    features,
    note: "SYNTHETIC. Opaque member_ref keys. Three seeded amount_cents disagreements on overlap (7, 19, 31).",
  };
}

export const TRANSFORM = {
  image_digest: "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  code_digest: "sha384:pending",
  query_profile: "tabular-export/v1",
};

export const DESTINATION = "partner://opaque/data-contract-17";
export const PRINCIPAL = "spiffe://tenant/workload/model-exporter";
export const PURPOSE = "model-training";
export const KEY_EPOCH = "tenant-key-epoch-17";
export const ASSURANCE = "SEAMDB-BASELINE-1";
