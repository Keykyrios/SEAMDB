import { canonicalizeBytes } from "./canonical";
import { domainHashTagged } from "./hash";
import { nowUtc } from "./capsule";

export interface RatsEvidence {
  profile: string;
  nonce: string;
  issuer: string;
  measurements: {
    image_digest: string;
    policy_digest: string;
    firmware: string;
  };
  issued_at: string;
}

export interface AppraisalResult {
  pass: boolean;
  evidence_digest: string;
  reasons: string[];
  profile: string;
}

const ALLOW_ISSUERS = new Set(["spiffe://tenant/attester/cvm-1"]);
const ALLOW_IMAGES = new Set([
  "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
]);
const ALLOW_FW = new Set(["measured-fw/v3.2"]);

export async function appraise(evidence: RatsEvidence, expectedNonce: string, required: boolean): Promise<AppraisalResult> {
  const reasons: string[] = [];
  if (!required) {
    const digest = await domainHashTagged("SEAMDB/RATS/NONE/V1", canonicalizeBytes({ profile: "none" }));
    return { pass: true, evidence_digest: digest, reasons: ["PROFILE_NONE"], profile: "none" };
  }
  if (evidence.profile !== "rats-seamdb-1") reasons.push("UNKNOWN_PROFILE");
  if (evidence.nonce !== expectedNonce) reasons.push("STALE_OR_REPLAYED_NONCE");
  if (!ALLOW_ISSUERS.has(evidence.issuer)) reasons.push("UNTRUSTED_ISSUER");
  if (!ALLOW_IMAGES.has(evidence.measurements.image_digest)) reasons.push("IMAGE_NOT_ALLOWLISTED");
  if (!ALLOW_FW.has(evidence.measurements.firmware)) reasons.push("FIRMWARE_NOT_ALLOWLISTED");
  const age = Date.now() - Date.parse(evidence.issued_at);
  if (Number.isNaN(age) || age > 5 * 60 * 1000) reasons.push("EVIDENCE_STALE");
  const digest = await domainHashTagged("SEAMDB/RATS/V1", canonicalizeBytes(evidence));
  return {
    pass: reasons.length === 0,
    evidence_digest: digest,
    reasons,
    profile: evidence.profile,
  };
}

export function demoEvidence(nonce: string, valid: boolean): RatsEvidence {
  return {
    profile: "rats-seamdb-1",
    nonce,
    issuer: valid ? "spiffe://tenant/attester/cvm-1" : "spiffe://unknown/attester",
    measurements: {
      image_digest: valid
        ? "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
        : "sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      policy_digest: "bound-at-runtime",
      firmware: valid ? "measured-fw/v3.2" : "unknown-fw",
    },
    issued_at: nowUtc(),
  };
}
