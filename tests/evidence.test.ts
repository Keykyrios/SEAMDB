import assert from "node:assert/strict";
import { test } from "node:test";
import { runAttackGallery } from "../src/engine/attacks";
import { capsuleDigest } from "../src/engine/capsule";
import { bootLab, runPipeline } from "../src/engine/control-plane";
import { runKnownAnswers } from "../src/engine/vectors";

test("known-answer vectors all pass", async () => {
  const v = await runKnownAnswers();
  assert.ok(v.length >= 5);
  for (const r of v) {
    assert.ok(r.pass, `${r.name}: ${r.detail}`);
  }
});

test("the adversarial gallery blocks every seeded attack", async () => {
  const gallery = await runAttackGallery();
  assert.ok(gallery.length >= 10, "at least ten seeded attacks");
  for (const a of gallery) {
    assert.ok(a.blocked, `${a.id} ${a.name} leaked: expected=${a.expected} got=${a.got} ${a.detail}`);
  }
});

test("purpose swap invalidates the capsule digest", async () => {
  const gallery = await runAttackGallery();
  const a08 = gallery.find((a) => a.id === "A08");
  assert.ok(a08, "purpose-swap attack exists");
  assert.ok(a08!.blocked, "rewriting the export purpose must change the digest");
});

test("full pipeline verifies PASS end to end", async () => {
  const lab = await bootLab();
  await runPipeline(lab);
  const v = lab.verify;
  assert.ok(v, "verification result produced");
  assert.equal(v!.verdict, "PASS");
  assert.equal(v!.failed.length, 0);
  for (const c of v!.checks) {
    assert.equal(c.verdict, "PASS", `${c.name}: ${c.code}`);
  }
});

test("capsule digest covers every sealed field", async () => {
  const lab = await bootLab();
  await runPipeline(lab);
  const rec = lab.capsule;
  assert.ok(rec);
  const original = rec!.capsule_digest;
  const fields: Array<() => void> = [
    () => (rec!.capsule.policy.purpose = "exfiltrate"),
    () => (rec!.capsule.policy.destination_ref = "attacker://elsewhere"),
    () => (rec!.capsule.result.row_count = 999999),
    () => (rec!.capsule.execution.profile = "attacker-profile"),
    () => (rec!.capsule.assurance_profile = "attacker-assurance"),
    () => (rec!.capsule.crypto.key_epoch = "attacker-epoch"),
  ];
  for (const mutate of fields) {
    const before = JSON.stringify(rec!.capsule);
    mutate();
    const after = await capsuleDigest(rec!.capsule);
    assert.notEqual(after, original, "mutating a sealed field must change the digest");
    // restore for the next mutation
    Object.assign(rec!.capsule, JSON.parse(before));
  }
});

test("tampering after sealing is detected by digest recomputation", async () => {
  const lab = await bootLab();
  await runPipeline(lab);
  const rec = lab.capsule!;
  rec.capsule.policy.purpose = "exfiltrate";
  const recomputed = await capsuleDigest(rec.capsule);
  assert.notEqual(recomputed, rec.capsule_digest);
});
