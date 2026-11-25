import assert from "node:assert/strict";
import { after, test } from "node:test";
import { negotiateTransport, transportFinish, transportParty, transportReply } from "../src/engine/crypto";
import { hasEd25519, hasX25519, setCapabilityForTests } from "../src/engine/webcrypto-cap";
import { TransparencyLog } from "../src/engine/transparency";

// This file pins the cached capability probes; restore real answers afterwards.
after(() => setCapabilityForTests({ ed25519: null, x25519: null }));

test("the real probe answers truthfully on this runtime", async () => {
  setCapabilityForTests({ ed25519: null, x25519: null });
  assert.equal(await hasEd25519(), true, "Node 20+ implements Ed25519");
  assert.equal(await hasX25519(), true, "Node 20+ implements X25519");
});

test("transport without X25519 falls back to ECDH P-256 and both parties still agree", async () => {
  setCapabilityForTests({ x25519: false });
  const initiator = await transportParty();
  const responder = await transportParty();
  assert.equal(initiator.hello.group, "ecdh-p256");
  assert.equal(initiator.hello.x_pub.length, 65, "uncompressed P-256 point");
  const { reply, secret: responderSecret } = await transportReply(initiator.hello, responder);
  assert.equal(reply.group, "ecdh-p256");
  assert.equal(reply.ct.length, 1088, "ML-KEM half unchanged");
  const { secret: initiatorSecret } = await transportFinish(reply, initiator);
  assert.ok(Buffer.from(initiatorSecret).equals(Buffer.from(responderSecret)), "same traffic secret both sides");
});

test("the fallback negotiation record says exactly what ran — ECDH P-256 + ML-KEM-768", async () => {
  setCapabilityForTests({ x25519: false });
  const hybrid = await negotiateTransport(true);
  assert.equal(hybrid.profile, "hybrid-p256-mlkem768");
  assert.deepEqual(hybrid.groups, ["ECDH-P256", "ML-KEM-768"]);
  assert.equal(hybrid.pq_labelled, true, "still genuinely hybrid");
  assert.match(hybrid.peer_ek ?? "", /^sha384:[0-9a-f]{96}$/);
  assert.match(hybrid.note, /FIPS 203|@noble\/post-quantum/);
  assert.match(hybrid.note, /no X25519/, "says why the classical group changed");
  assert.doesNotMatch(hybrid.note, /label|posture/i, "no posture language on a real handshake");

  const classical = await negotiateTransport(false);
  assert.equal(classical.profile, "tls13-p256");
  assert.deepEqual(classical.groups, ["ECDH-P256"]);
  assert.equal(classical.pq_labelled, false);
  assert.equal(classical.peer_ek, undefined);
  assert.match(classical.note, /NOT post-quantum/);
});

test("a group mismatch fails closed instead of silently mixing curves", async () => {
  const x = await transportParty("x25519");
  const p = await transportParty("ecdh-p256");
  await assert.rejects(
    () => transportReply(x.hello, p),
    (e: unknown) => (e as { code?: string }).code === "E_CRYPTO" || /E_CRYPTO/.test((e as Error).message),
    "responder group must match the hello",
  );
});

test("transparency log without Ed25519 signs checkpoints with ECDSA P-384 and says so", async () => {
  setCapabilityForTests({ ed25519: false });
  const log = new TransparencyLog();
  await log.init();
  assert.equal(log.signatureAlgorithm, "ECDSA-P384");
  const digest = `sha384:${"ab".repeat(48)}`;
  const { checkpoint, inclusion } = await log.append(digest);
  assert.equal(checkpoint.alg, "ECDSA-P384", "the checkpoint names its algorithm");
  assert.match(checkpoint.signature, /^[0-9a-f]+$/);
  assert.ok(checkpoint.signature.length > 0);
  // inclusion is hash-based: signature algorithm must not affect it
  assert.equal(await log.verifyInclusion(digest, inclusion, checkpoint), true);
});

test("transparency log with Ed25519 available uses it and labels it", async () => {
  setCapabilityForTests({ ed25519: true });
  const log = new TransparencyLog();
  await log.init();
  assert.equal(log.signatureAlgorithm, "Ed25519");
  const digest = `sha384:${"cd".repeat(48)}`;
  const { checkpoint } = await log.append(digest);
  assert.equal(checkpoint.alg, "Ed25519");
});
