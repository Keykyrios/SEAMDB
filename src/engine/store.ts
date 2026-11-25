import type {
  CapsuleRecord,
  DiscrepancyWitness,
  MerkleTree,
  PolicyDecision,
  ReleaseGrant,
  SecpState,
} from "./types";
import type { Checkpoint, InclusionProof, ConsistencyProof, WitnessAck } from "./transparency";

export interface Tenant {
  tenant_id: string;
  crypto_domain: string;
  policy_root: string;
  status: "active" | "suspended";
}

export interface SourceRow {
  source_id: string;
  tenant_id: string;
  kind: string;
  locator_ref: string;
  connector_version: string;
  owner: string;
  status: string;
}

export interface SnapshotRow {
  snapshot_id: string;
  source_id: string;
  schema_digest: string;
  root_digest: string;
  row_count: number;
  snapshot_token: string;
  crypto_epoch: string;
  canonicalization_version: string;
  tree: MerkleTree;
  sealed: boolean;
}

export interface IdempotencyRecord {
  key: string;
  body_digest: string;
  status: number;
  body: unknown;
}

export class EvidenceStore {
  tenants = new Map<string, Tenant>();
  sources = new Map<string, SourceRow>();
  snapshots = new Map<string, SnapshotRow>();
  capsules = new Map<string, CapsuleRecord>();
  capsulesByDigest = new Map<string, CapsuleRecord>();
  decisions: PolicyDecision[] = [];
  grants = new Map<string, ReleaseGrant>();
  findings: DiscrepancyWitness[] = [];
  nonces = new Set<string>();
  idempotency = new Map<string, IdempotencyRecord>();
  events = new Map<string, unknown>();
  receipts: Array<{
    receipt_id: string;
    capsule_id: string;
    inclusion: InclusionProof;
    checkpoint: Checkpoint;
    consistency: ConsistencyProof | null;
    witnesses: WitnessAck[];
  }> = [];
  verificationRuns: Array<{
    run_id: string;
    capsule_id: string;
    verifier_version: string;
    verdict: string;
    failed_checks: string[];
  }> = [];

  putIdempotent(key: string, bodyDigest: string, status: number, body: unknown): { conflict: boolean; prior?: IdempotencyRecord } {
    const prior = this.idempotency.get(key);
    if (!prior) {
      const rec = { key, body_digest: bodyDigest, status, body };
      this.idempotency.set(key, rec);
      return { conflict: false };
    }
    if (prior.body_digest !== bodyDigest) return { conflict: true, prior };
    return { conflict: false, prior };
  }

  consumeNonce(nonce: string): boolean {
    if (this.nonces.has(nonce)) return false;
    this.nonces.add(nonce);
    return true;
  }

  sealCapsule(rec: CapsuleRecord): void {
    this.capsules.set(rec.capsule.capsule_id, rec);
    this.capsulesByDigest.set(rec.capsule_digest, rec);
  }

  setState(id: string, state: SecpState): void {
    const rec = this.capsules.get(id);
    if (!rec) return;
    rec.state = state;
  }
}
