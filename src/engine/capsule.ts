import { canonicalize, canonicalizeBytes } from "./canonical";
import { domainHashTagged } from "./hash";
import type { EvidenceCapsule } from "./types";

/**
 * Digest projection for the capsule: the canonical form of every sealed field.
 * The only exclusion is `transparency`, whose two members are written after
 * sealing — `statement_digest` is set to this very digest (so including it
 * would be circular) and `receipt_ref` is assigned once the transparency log
 * appends. Both stay bound out-of-band: the log statement covers the digest,
 * and the receipt store maps capsule → receipt.
 *
 * Keep this projection exhaustive. A field silently dropped here is a field
 * an attacker can rewrite without invalidating the digest; the purpose-swap
 * case in the adversarial suite exists to catch exactly that.
 */
export function capsuleBodyForDigest(capsule: EvidenceCapsule): Record<string, unknown> {
  return {
    spec: capsule.spec,
    tenant_ref: capsule.tenant_ref,
    capsule_id: capsule.capsule_id,
    created_at: capsule.created_at,
    source: {
      source_ref: capsule.source.source_ref,
      snapshot_ref: capsule.source.snapshot_ref,
      schema_sha384: capsule.source.schema_sha384,
      root_sha384: capsule.source.root_sha384,
      row_count: capsule.source.row_count,
      canonicalizer: capsule.source.canonicalizer,
    },
    transform: {
      image_digest: capsule.transform.image_digest,
      code_digest: capsule.transform.code_digest,
      query_profile: capsule.transform.query_profile,
      query_digest: capsule.transform.query_digest,
    },
    parents: capsule.parents.map((p) => ({ capsule_digest: p.capsule_digest, edge: p.edge })).sort((a, b) =>
      a.capsule_digest < b.capsule_digest ? -1 : a.capsule_digest > b.capsule_digest ? 1 : 0,
    ),
    policy: {
      bundle_digest: capsule.policy.bundle_digest,
      decision_digest: capsule.policy.decision_digest,
      purpose: capsule.policy.purpose,
      destination_ref: capsule.policy.destination_ref,
    },
    execution: {
      profile: capsule.execution.profile,
      evidence_digest: capsule.execution.evidence_digest,
    },
    result: {
      root_sha384: capsule.result.root_sha384,
      row_count: capsule.result.row_count,
      schema_sha384: capsule.result.schema_sha384,
    },
    crypto: {
      hash: capsule.crypto.hash,
      key_epoch: capsule.crypto.key_epoch,
    },
    assurance_profile: capsule.assurance_profile,
  };
}

export async function capsuleDigest(capsule: EvidenceCapsule): Promise<string> {
  const body = canonicalizeBytes(capsuleBodyForDigest(capsule));
  return domainHashTagged("SEAMDB/CAPSULE/V1", body);
}

export function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function assertCapsuleShape(capsule: EvidenceCapsule): void {
  if (capsule.spec !== "seamdb.capsule/v1") throw new Error("unsupported capsule spec");
  if (capsule.crypto.hash !== "SHA-384") throw new Error("unsupported hash");
  canonicalize(capsule as unknown as Record<string, unknown>);
}
