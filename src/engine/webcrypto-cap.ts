/**
 * WebCrypto capability detection.
 *
 * Not every browser build exposes the same algorithm set: Ed25519 (RFC 8032)
 * and X25519 (RFC 7748) are recent WebCrypto additions, while Node 20+ ships
 * both. The engine must run identically everywhere, so every key-agreement or
 * signing site asks this module which algorithm the runtime actually has and
 * picks the strongest one it does — labelling the choice honestly in every
 * record it emits. Fail-closed invariant: a fallback is only ever chosen by
 * probing real WebCrypto support, never by an attacker-controlled input, so a
 * downgrade cannot be forced from the wire.
 */

export type SigAlg = "Ed25519" | "ECDSA-P384";
export type EcdhGroup = "x25519" | "ecdh-p256";

let ed25519: boolean | null = null;
let x25519: boolean | null = null;

/** Probe (once) whether `crypto.subtle.generateKey` accepts Ed25519. */
export async function hasEd25519(): Promise<boolean> {
  if (ed25519 === null) {
    try {
      await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
      ed25519 = true;
    } catch {
      ed25519 = false;
    }
  }
  return ed25519;
}

/** Probe (once) whether `crypto.subtle.generateKey` accepts X25519. */
export async function hasX25519(): Promise<boolean> {
  if (x25519 === null) {
    try {
      await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]);
      x25519 = true;
    } catch {
      x25519 = false;
    }
  }
  return x25519;
}

/** Strongest classical signature algorithm this runtime can produce. */
export async function defaultSigAlg(): Promise<SigAlg> {
  return (await hasEd25519()) ? "Ed25519" : "ECDSA-P384";
}

/** Strongest classical ephemeral-agreement group this runtime can run. */
export async function defaultEcdhGroup(): Promise<EcdhGroup> {
  return (await hasX25519()) ? "x25519" : "ecdh-p256";
}

/**
 * Test hook: pin the cached probe answers so fallback branches execute in
 * runtimes that DO have the algorithms (Node). Pass null to re-probe.
 */
export function setCapabilityForTests(p: { ed25519?: boolean | null; x25519?: boolean | null }): void {
  if ("ed25519" in p) ed25519 = p.ed25519 ?? null;
  if ("x25519" in p) x25519 = p.x25519 ?? null;
}
