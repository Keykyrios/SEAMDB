import { capsuleDigest } from "./capsule";
import { verifyInclusion, verifyRootCommitment } from "./merkle";
import { detectCycle, parentClosure } from "./lineage";
import { policyBundleDigest } from "./policy";
import type { CapsuleRecord, MerkleTree, NamedCheck, Verdict } from "./types";
import type { Checkpoint, ConsistencyProof, InclusionProof, WitnessAck } from "./transparency";
import type { TransparencyLog } from "./transparency";
import type { DiscrepancyWitness } from "./types";
import type { AlgebraicReport } from "./algebraic";
import { algebraicPassesRelease } from "./algebraic";

export const VERIFIER_VERSION = "seamdb-verifier/v1";

export interface VerifyBundle {
  record: CapsuleRecord;
  sourceTree: MerkleTree;
  resultTree: MerkleTree;
  inclusion?: { tree: MerkleTree; index: number };
  parents: string[];
  lineageEdges: Array<{ child: string; parent: string; relation: string }>;
  log: TransparencyLog;
  statement_digest: string;
  inclusionProof: InclusionProof;
  checkpoint: Checkpoint;
  priorCheckpoint?: Checkpoint;
  consistency?: ConsistencyProof | null;
  witnesses: WitnessAck[];
  requiredWitnesses: number;
  findings: DiscrepancyWitness[];
  algebraic: AlgebraicReport;
  grant?: { destination: string; consumed: boolean; expires_at: string; capsule_digest: string };
  expectedDestination: string;
  appraisalRequired: boolean;
  appraisalPassed: boolean;
}

export interface VerifyResult {
  verdict: Verdict;
  checks: NamedCheck[];
  failed: string[];
  verifier_version: string;
}

function rollup(checks: NamedCheck[]): Verdict {
  if (checks.some((c) => c.verdict === "FAIL")) return "FAIL";
  if (checks.some((c) => c.verdict === "INDETERMINATE")) return "INDETERMINATE";
  return "PASS";
}

export async function verifyBundle(b: VerifyBundle): Promise<VerifyResult> {
  const checks: NamedCheck[] = [];

  try {
    const d = await capsuleDigest(b.record.capsule);
    checks.push({
      name: "CANONICALIZATION",
      verdict: d === b.record.capsule_digest ? "PASS" : "FAIL",
      code: d === b.record.capsule_digest ? "CANON_OK" : "DIGEST_MISMATCH",
      detail: "Capsule digest = SHA384(SEAMDB/CAPSULE/V1 || JCS(body))",
      artifact: d,
    });
  } catch (e) {
    checks.push({
      name: "CANONICALIZATION",
      verdict: "FAIL",
      code: "CANON_THROW",
      detail: String(e),
      artifact: b.record.capsule_digest,
    });
  }

  const srcOk = await verifyRootCommitment(b.sourceTree);
  const srcMatch = b.sourceTree.root_commitment === b.record.capsule.source.root_sha384;
  checks.push({
    name: "SOURCE_ROOT",
    verdict: srcOk && srcMatch ? "PASS" : "FAIL",
    code: srcOk && srcMatch ? "ROOT_OK" : "ROOT_TAMPER",
    detail: "Recomputed Merkle root commitment against capsule snapshot_root",
    artifact: b.sourceTree.root_commitment,
  });

  const cycle = detectCycle(b.lineageEdges);
  const closure = parentClosure(b.record.capsule_digest, b.lineageEdges);
  const missing = b.record.capsule.parents.filter((p) => !closure.has(p.capsule_digest) && !b.parents.includes(p.capsule_digest));
  const lineageOk = !cycle && missing.length === 0;
  checks.push({
    name: "LINEAGE_CLOSURE",
    verdict: lineageOk ? "PASS" : "FAIL",
    code: cycle ? "LINEAGE_CYCLE" : missing.length ? "MISSING_PARENT" : "LINEAGE_OK",
    detail: cycle ? `cycle ${cycle.join("→")}` : missing.length ? `missing ${missing.map((m) => m.capsule_digest).join(",")}` : "Parent set closed and acyclic",
    artifact: b.record.capsule_digest,
  });

  const liveBundle = await policyBundleDigest();
  const policyOk =
    b.record.capsule.policy.bundle_digest === liveBundle && Boolean(b.record.capsule.policy.decision_digest);
  checks.push({
    name: "POLICY_BINDING",
    verdict: policyOk ? "PASS" : "FAIL",
    code: policyOk ? "POLICY_OK" : "STALE_POLICY",
    detail: "Capsule policy digest must match the evaluator bundle used at decision time",
    artifact: b.record.capsule.policy.bundle_digest,
  });

  if (b.appraisalRequired && !b.appraisalPassed) {
    checks.push({
      name: "APPRAISAL",
      verdict: "FAIL",
      code: "APPRAISAL_FAIL",
      detail: "RATS appraisal required for regulated class and did not pass",
      artifact: b.record.capsule.execution.evidence_digest,
    });
  } else if (b.appraisalRequired && !b.record.capsule.execution.evidence_digest) {
    checks.push({
      name: "APPRAISAL",
      verdict: "INDETERMINATE",
      code: "APPRAISAL_MISSING",
      detail: "Appraisal required but evidence unavailable — not PASS",
      artifact: "missing",
    });
  } else {
    checks.push({
      name: "APPRAISAL",
      verdict: "PASS",
      code: b.appraisalRequired ? "RATS_OK" : "PROFILE_NONE",
      detail: b.appraisalRequired ? "Allow-listed measurements and fresh nonce" : "Assurance profile does not require TEE",
      artifact: b.record.capsule.execution.profile,
    });
  }

  let incl = true;
  if (b.inclusion) {
    const { proveInclusion } = await import("./merkle");
    const proof = await proveInclusion(b.inclusion.tree, b.inclusion.index);
    incl = await verifyInclusion(b.inclusion.tree, b.inclusion.index, proof);
  }
  const logIncl = await b.log.verifyInclusion(b.statement_digest, b.inclusionProof, b.checkpoint);
  checks.push({
    name: "INCLUSION",
    verdict: incl && logIncl ? "PASS" : "FAIL",
    code: incl && logIncl ? "INCLUDED" : "NOT_INCLUDED",
    detail: "Row Merkle inclusion and transparency-log inclusion of capsule statement",
    artifact: b.checkpoint.root_digest,
  });

  if (!b.priorCheckpoint || !b.consistency) {
    checks.push({
      name: "CONSISTENCY",
      verdict: b.log.size === 1 ? "PASS" : "INDETERMINATE",
      code: b.log.size === 1 ? "FIRST_CHECKPOINT" : "CONSISTENCY_UNAVAILABLE",
      detail: b.log.size === 1 ? "First checkpoint has no predecessor" : "Missing consistency proof — not PASS",
      artifact: b.checkpoint.root_digest,
    });
  } else {
    const ok = await b.log.verifyConsistency(b.priorCheckpoint, b.checkpoint, b.consistency);
    checks.push({
      name: "CONSISTENCY",
      verdict: ok ? "PASS" : "FAIL",
      code: ok ? "APPEND_ONLY" : "LOG_SPLIT_OR_BAD_PROOF",
      detail: "Checkpoint is an append-only extension of the prior tree",
      artifact: b.checkpoint.root_digest,
    });
  }

  const quorum = b.witnesses.length >= b.requiredWitnesses && b.witnesses.every((w) => w.checkpoint_root === b.checkpoint.root_digest);
  const split = b.witnesses.some((w) => w.checkpoint_root !== b.checkpoint.root_digest);
  checks.push({
    name: "WITNESS_QUORUM",
    verdict: split ? "FAIL" : quorum ? "PASS" : "INDETERMINATE",
    code: split ? "SPLIT_VIEW" : quorum ? "QUORUM_OK" : "QUORUM_SHORT",
    detail: split ? "Witness disagrees with log checkpoint" : `Witnesses ${b.witnesses.length}/${b.requiredWitnesses}`,
    artifact: b.witnesses.map((w) => w.witness_id).join(","),
  });

  const destOk = !b.grant || (b.grant.capsule_digest === b.record.capsule_digest && b.grant.destination === b.expectedDestination && !b.grant.consumed && Date.parse(b.grant.expires_at) > Date.now());
  checks.push({
    name: "RELEASE_SCOPE",
    verdict: destOk ? "PASS" : "FAIL",
    code: destOk ? "SCOPE_OK" : "GRANT_INVALID",
    detail: "Grant audience, capsule digest, TTL and unused nonce",
    artifact: b.grant?.destination ?? "no-grant-yet",
  });

  const critical = b.findings.filter((f) => f.severity === "critical" && f.disposition === "open");
  checks.push({
    name: "COHERENCE",
    verdict: critical.length ? "FAIL" : "PASS",
    code: critical.length ? "OPEN_CRITICAL_MISMATCH" : "OVERLAP_OK",
    detail: critical.length ? `${critical.length} open critical discrepancy witnesses` : "No open critical overlap mismatches",
    artifact: String(b.findings.length),
  });

  const algOk = algebraicPassesRelease(b.algebraic, true);
  checks.push({
    name: "ALGEBRAIC",
    verdict: b.algebraic.result === "UNKNOWN" ? "INDETERMINATE" : algOk ? "PASS" : "FAIL",
    code: b.algebraic.result,
    detail: "Conservation / linear constraints. UNKNOWN is not verified.",
    artifact: b.algebraic.constraints_digest,
  });

  checks.push({
    name: "CRYPTO_EPOCH",
    verdict: b.record.capsule.crypto.hash === "SHA-384" ? "PASS" : "FAIL",
    code: "EPOCH_OK",
    detail: `hash=${b.record.capsule.crypto.hash} epoch=${b.record.capsule.crypto.key_epoch}`,
    artifact: b.record.capsule.crypto.key_epoch,
  });

  const verdict = rollup(checks);
  return {
    verdict,
    checks,
    failed: checks.filter((c) => c.verdict !== "PASS").map((c) => c.code),
    verifier_version: VERIFIER_VERSION,
  };
}
