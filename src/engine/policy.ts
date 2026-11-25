import { canonicalizeBytes } from "./canonical";
import { domainHashTagged } from "./hash";
import type { PolicyDecision, PolicyInput } from "./types";

export const POLICY_BUNDLE = {
  allowed_purposes: ["model-training", "audit-export"],
  allowed_destinations: [
    "partner://opaque/data-contract-17",
    "workspace://opaque/model-registry-3",
  ],
  denied_classes: ["direct-identifier", "full-ssn"],
  max_rows: 500000,
  max_bytes: 1073741824,
  evaluator_version: "seamdb-policy/v1",
};

export async function policyBundleDigest(): Promise<string> {
  return domainHashTagged("SEAMDB/POLICY-BUNDLE/V1", canonicalizeBytes(POLICY_BUNDLE));
}

export async function evaluatePolicy(input: PolicyInput): Promise<PolicyDecision> {
  const bundle = await policyBundleDigest();
  const reasons: string[] = [];
  const now = Date.parse(input.issued_at);
  const exp = Date.parse(input.expires_at);

  if (input.policy_bundle_digest !== bundle) reasons.push("STALE_POLICY_BUNDLE");
  if (!POLICY_BUNDLE.allowed_purposes.includes(input.purpose)) reasons.push("PURPOSE_DENIED");
  if (!POLICY_BUNDLE.allowed_destinations.includes(input.destination)) reasons.push("DESTINATION_DENIED");
  if (input.max_rows > POLICY_BUNDLE.max_rows) reasons.push("ROW_CEILING");
  if (input.max_bytes > POLICY_BUNDLE.max_bytes) reasons.push("BYTE_CEILING");
  if (Number.isNaN(now) || Number.isNaN(exp) || exp <= now) reasons.push("EXPIRED_WINDOW");
  if (input.high_severity_open) reasons.push("OPEN_CRITICAL_COHERENCE");
  for (const cls of input.data_classes) {
    if (POLICY_BUNDLE.denied_classes.includes(cls)) reasons.push("DENIED_DATA_CLASS");
  }
  if (!input.nonce || input.nonce.length < 16) reasons.push("WEAK_NONCE");

  const requireAttestation = input.data_classes.includes("regulated");
  const allow = reasons.length === 0;
  const obligations: string[] = [];
  if (requireAttestation) obligations.push("require_rats_appraisal");
  obligations.push("consume_one_use_grant");
  obligations.push("bind_destination_exactly");

  const decision = {
    allow,
    require_attestation: requireAttestation,
    obligations,
    bundle_digest: bundle,
    evaluator_version: POLICY_BUNDLE.evaluator_version,
    expires_at: input.expires_at,
    reason_codes: reasons,
  };
  const decision_digest = await domainHashTagged(
    "SEAMDB/POLICY-DECISION/V1",
    canonicalizeBytes({
      ...decision,
      principal: input.principal,
      capsule_intent: input.capsule_intent,
      source_root: input.source_root,
      nonce: input.nonce,
    }),
  );

  return { ...decision, decision_digest };
}
