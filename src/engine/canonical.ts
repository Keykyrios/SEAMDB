import { utf8 } from "./bytes";

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) for the JSON subset
 * SEAMDB actually emits: objects, arrays, strings, integers, booleans.
 * Non-finite numbers and duplicate keys are rejected before this function.
 */
export function canonicalize(value: unknown): string {
  return emit(value);
}

export function canonicalizeBytes(value: unknown): Uint8Array {
  return utf8(canonicalize(value));
}

function emit(value: unknown): string {
  if (value === null) throw new Error("canonical JSON forbids null in SEAMDB v1 required fields");
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number");
    if (!Number.isInteger(value)) {
      throw new Error("SEAMDB v1 forbids floats in canonical objects; use integer micros/cents");
    }
    if (Object.is(value, -0)) return "0";
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => emit(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const k of keys) {
      if (seen.has(k)) throw new Error("duplicate key");
      seen.add(k);
      const v = rec[k];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${emit(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new Error(`unserializable canonical type: ${typeof value}`);
}
