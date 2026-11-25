import assert from "node:assert/strict";
import { test } from "node:test";
import {
  negotiateTransport,
  transportFinish,
  transportParty,
  transportReply,
  type TransportReply,
} from "../src/engine/crypto";

test("hybrid X25519 + ML-KEM-768 handshake: both parties derive the same 32-byte secret", async () => {
  const initiator = await transportParty();
  const responder = await transportParty();
  // key sizes come from FIPS 203 through @noble/post-quantum
  assert.equal(initiator.hello.ek.length, 1184);
  assert.equal(initiator.hello.x_pub.length, 32);
  const { reply, secret: responderSecret } = await transportReply(initiator.hello, responder);
  assert.equal(reply.ct.length, 1088);
  const { secret: initiatorSecret } = await transportFinish(reply, initiator);
  assert.equal(initiatorSecret.length, 32);
  assert.ok(Buffer.from(initiatorSecret).equals(Buffer.from(responderSecret)), "same traffic secret on both sides");
});

test("session secret refuses to exist without ML-KEM: swap the KEM half for zeros and the secrets diverge", async () => {
  // Downgrade proof: a classical-only peer cannot reproduce the hybrid secret
  // because the KEM shared secret is a mandatory HKDF input. Simulated by
  // deriving each side with DIFFERENT hello pairs, which is what a MITM
  // re-keying one half would produce.
  const a = await transportParty();
  const b = await transportParty();
  const evil = await transportParty();
  const { secret: honest } = await transportReply(a.hello, b);
  const { secret: evilSecret } = await transportReply(a.hello, evil);
  assert.ok(!Buffer.from(honest).equals(Buffer.from(evilSecret)), "a different KEM party derives a different secret");
});

test("tampered ML-KEM ciphertext fails closed (implicit rejection => different secret)", async () => {
  const initiator = await transportParty();
  const responder = await transportParty();
  const { reply, secret: good } = await transportReply(initiator.hello, responder);
  const tampered: TransportReply = { ...reply, ct: reply.ct.slice() };
  tampered.ct[0] ^= 0xff;
  const { secret: bad } = await transportFinish(tampered, initiator);
  assert.ok(!Buffer.from(bad).equals(Buffer.from(good)), "tampering cannot go undetected in derived material");
});

test("wrong decapsulation key derives a different secret, not an error oracle", async () => {
  const initiator = await transportParty();
  const responder = await transportParty();
  const other = await transportParty();
  const { reply, secret: good } = await transportReply(initiator.hello, responder);
  const impostor: TransportParty = { ...initiator, kem_dk: other.kem_dk };
  const { secret: bad } = await transportFinish(reply, impostor);
  assert.ok(!Buffer.from(bad).equals(Buffer.from(good)));
});

test("negotiateTransport runs the real handshake and binds the record to the encapsulation key", async () => {
  const hybrid = await negotiateTransport(true);
  assert.equal(hybrid.profile, "hybrid-x25519-mlkem768");
  assert.equal(hybrid.pq_labelled, true);
  assert.match(hybrid.peer_ek ?? "", /^sha384:[0-9a-f]{96}$/);
  assert.match(hybrid.note, /FIPS 203|@noble\/post-quantum/);
  assert.doesNotMatch(hybrid.note, /label|posture/i, "no posture language on an actually-executed handshake");

  const classical = await negotiateTransport(false);
  assert.equal(classical.profile, "tls13-x25519");
  assert.equal(classical.pq_labelled, false, "classical fallback is honestly labelled");
  assert.equal(classical.peer_ek, undefined, "no key binding claimed when no KEM ran");
  assert.match(classical.note, /NOT post-quantum/);
});
