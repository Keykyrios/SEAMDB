import type { SecpState } from "./types";

const ORDER: SecpState[] = [
  "INTENT_CREATED",
  "SOURCE_COMMITTED",
  "LINEAGE_CLOSED",
  "POLICY_APPRAISED",
  "EXECUTION_APPRAISED",
  "RESULT_COMMITTED",
  "CAPSULE_SEALED",
  "RECEIPT_VERIFIED",
  "RELEASED",
];

export function canTransition(from: SecpState, to: SecpState): boolean {
  if (to === "DENIED") return from !== "RELEASED";
  const a = ORDER.indexOf(from);
  const b = ORDER.indexOf(to);
  if (a < 0 || b < 0) return false;
  return b === a + 1;
}

export function filtrationIndex(state: SecpState): number {
  if (state === "DENIED") return -1;
  return ORDER.indexOf(state);
}

export const FILTRATION = [
  { id: "intent", label: "Source identity", state: "INTENT_CREATED" as const },
  { id: "snapshot", label: "Snapshot commitment", state: "SOURCE_COMMITTED" as const },
  { id: "lineage", label: "Lineage closure", state: "LINEAGE_CLOSED" as const },
  { id: "policy", label: "Policy decision", state: "POLICY_APPRAISED" as const },
  { id: "exec", label: "Execution appraisal", state: "EXECUTION_APPRAISED" as const },
  { id: "result", label: "Result binding", state: "RESULT_COMMITTED" as const },
  { id: "seal", label: "Capsule sealed", state: "CAPSULE_SEALED" as const },
  { id: "receipt", label: "Transparency receipt", state: "RECEIPT_VERIFIED" as const },
  { id: "release", label: "One-use grant", state: "RELEASED" as const },
];
