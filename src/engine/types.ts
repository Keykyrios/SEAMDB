export type Verdict = "PASS" | "FAIL" | "INDETERMINATE";

export type SecpState =
  | "INTENT_CREATED"
  | "SOURCE_COMMITTED"
  | "LINEAGE_CLOSED"
  | "POLICY_APPRAISED"
  | "EXECUTION_APPRAISED"
  | "RESULT_COMMITTED"
  | "CAPSULE_SEALED"
  | "RECEIPT_VERIFIED"
  | "RELEASED"
  | "DENIED";

export type CheckName =
  | "CANONICALIZATION"
  | "SOURCE_ROOT"
  | "LINEAGE_CLOSURE"
  | "POLICY_BINDING"
  | "APPRAISAL"
  | "INCLUSION"
  | "CONSISTENCY"
  | "WITNESS_QUORUM"
  | "RELEASE_SCOPE"
  | "COHERENCE"
  | "ALGEBRAIC"
  | "CRYPTO_EPOCH";

export interface NamedCheck {
  name: CheckName;
  verdict: Verdict;
  code: string;
  detail: string;
  artifact: string;
}

export interface CanonicalRow {
  row_ref: string;
  partition: string;
  fields: Record<string, string | number | boolean>;
}

export interface SourceView {
  source_ref: string;
  kind: "postgres" | "warehouse" | "feature_store" | "object";
  name: string;
  owner: string;
  connector_version: string;
  schema: Record<string, "string" | "int" | "bool">;
}

export interface EvidenceCapsule {
  spec: "seamdb.capsule/v1";
  tenant_ref: string;
  capsule_id: string;
  created_at: string;
  source: {
    source_ref: string;
    snapshot_ref: string;
    schema_sha384: string;
    root_sha384: string;
    row_count: number;
    canonicalizer: "canon/v1";
  };
  transform: {
    image_digest: string;
    code_digest: string;
    query_profile: string;
    query_digest: string;
  };
  parents: Array<{ capsule_digest: string; edge: string }>;
  policy: {
    bundle_digest: string;
    decision_digest: string;
    purpose: string;
    destination_ref: string;
  };
  execution: {
    profile: string;
    evidence_digest: string;
  };
  result: {
    root_sha384: string;
    row_count: number;
    schema_sha384: string;
  };
  crypto: {
    hash: "SHA-384";
    key_epoch: string;
  };
  transparency: {
    statement_digest: string;
    receipt_ref: string;
  };
  assurance_profile: string;
}

export interface CapsuleRecord {
  capsule: EvidenceCapsule;
  capsule_digest: string;
  state: SecpState;
}

export interface ProofPath {
  leaf_index: number;
  siblings: Array<{ side: "L" | "R"; hash: string }>;
}

export interface MerkleTree {
  leaves: string[];
  levels: string[][];
  tree_root: string;
  root_commitment: string;
  schema_digest: string;
  partition_id: string;
}

export interface DiscrepancyWitness {
  finding_id: string;
  overlap_id: string;
  left_source: string;
  right_source: string;
  row_ref: string;
  field: string;
  class: "equality" | "range" | "conservation" | "cycle" | "mapping_version";
  residual: number;
  severity: "low" | "medium" | "high" | "critical";
  left_snapshot_root: string;
  right_snapshot_root: string;
  mapping_digest: string;
  disposition: "open" | "waived" | "resolved";
}

export interface PolicyInput {
  principal: string;
  purpose: string;
  source_root: string;
  destination: string;
  data_classes: string[];
  query_profile: string;
  max_rows: number;
  max_bytes: number;
  capsule_intent: string;
  policy_bundle_digest: string;
  issued_at: string;
  expires_at: string;
  key_epoch: string;
  high_severity_open: boolean;
  nonce: string;
}

export interface PolicyDecision {
  allow: boolean;
  require_attestation: boolean;
  obligations: string[];
  bundle_digest: string;
  decision_digest: string;
  evaluator_version: string;
  expires_at: string;
  reason_codes: string[];
}

export interface ReleaseGrant {
  grant_id: string;
  capsule_digest: string;
  destination: string;
  decision_digest: string;
  nonce: string;
  expires_at: string;
  consumed: boolean;
  max_rows: number;
  max_bytes: number;
}

export interface ApiError {
  code: string;
  message: string;
  retryable: boolean;
  request_id: string;
  details: string[];
}
