import { utf8 } from "./bytes";
import { canonicalize, canonicalizeBytes } from "./canonical";
import { sha384Hex } from "./hash";
import { buildMerkle, proveInclusion, verifyInclusion, verifyRootCommitment } from "./merkle";
import { capsuleDigest } from "./capsule";
import type { CanonicalRow, EvidenceCapsule } from "./types";

export interface VectorResult {
  name: string;
  pass: boolean;
  detail: string;
}

export async function runKnownAnswers(): Promise<VectorResult[]> {
  const results: VectorResult[] = [];

  const obj = { b: 2, a: 1 };
  const jcs = canonicalize(obj);
  results.push({
    name: "JCS key sort",
    pass: jcs === '{"a":1,"b":2}',
    detail: jcs,
  });

  const h = await sha384Hex(utf8("SEAMDB"));
  results.push({
    name: "SHA-384('SEAMDB') length",
    pass: h.length === 96,
    detail: h,
  });

  const rows: CanonicalRow[] = [
    { row_ref: "r1", partition: "p0", fields: { member_ref: "m_001", amount_cents: 10 } },
    { row_ref: "r2", partition: "p0", fields: { member_ref: "m_002", amount_cents: 20 } },
    { row_ref: "r3", partition: "p0", fields: { member_ref: "m_003", amount_cents: 30 } },
  ];
  const schema = await sha384Hex(canonicalizeBytes({ member_ref: "string", amount_cents: "int" }));
  const tree = await buildMerkle(rows, schema, "p0");
  const proof = await proveInclusion(tree, 1);
  const ok = (await verifyInclusion(tree, 1, proof)) && (await verifyRootCommitment(tree));
  const tree2 = await buildMerkle(rows, schema, "p0");
  results.push({
    name: "Merkle determinism + inclusion",
    pass: ok && tree.root_commitment === tree2.root_commitment,
    detail: tree.root_commitment,
  });

  const empty = await buildMerkle([], schema, "p0");
  results.push({
    name: "Empty tree domain-separated",
    pass: empty.leaves.length === 0 && empty.tree_root.startsWith("sha384:"),
    detail: empty.root_commitment,
  });

  const odd = await buildMerkle(rows.slice(0, 1), schema, "p0");
  results.push({
    name: "Single-leaf odd-level promotion",
    pass: odd.leaves.length === 1 && (await verifyRootCommitment(odd)),
    detail: odd.tree_root,
  });

  const capsule: EvidenceCapsule = {
    spec: "seamdb.capsule/v1",
    tenant_ref: "t",
    capsule_id: "00000000-0000-7000-8000-000000000001",
    created_at: "2026-10-15T00:00:00Z",
    source: {
      source_ref: "s",
      snapshot_ref: "snap",
      schema_sha384: "sha384:" + "ab".repeat(48),
      root_sha384: "sha384:" + "cd".repeat(48),
      row_count: 3,
      canonicalizer: "canon/v1",
    },
    transform: {
      image_digest: "sha256:00",
      code_digest: "sha384:00",
      query_profile: "tabular-export/v1",
      query_digest: "sha384:00",
    },
    parents: [],
    policy: {
      bundle_digest: "sha384:00",
      decision_digest: "sha384:00",
      purpose: "model-training",
      destination_ref: "partner://opaque/data-contract-17",
    },
    execution: { profile: "none", evidence_digest: "sha384:00" },
    result: { root_sha384: "sha384:" + "ef".repeat(48), row_count: 3, schema_sha384: "sha384:" + "ab".repeat(48) },
    crypto: { hash: "SHA-384", key_epoch: "tenant-key-epoch-17" },
    transparency: { statement_digest: "sha384:00", receipt_ref: "r" },
    assurance_profile: "SEAMDB-BASELINE-1",
  };
  const d1 = await capsuleDigest(capsule);
  const d2 = await capsuleDigest(capsule);
  results.push({
    name: "Capsule digest stable",
    pass: d1 === d2 && d1.startsWith("sha384:"),
    detail: d1,
  });

  return results;
}
