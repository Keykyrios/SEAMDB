import { bootLab, runPipeline, consumeGrant, type LabState } from "./control-plane";
import { fromHex, sha384Tag, hex } from "./bytes";
import { capsuleDigest } from "./capsule";

export interface AttackResult {
  id: string;
  name: string;
  expected: "FAIL" | "INDETERMINATE";
  got: string;
  blocked: boolean;
  detail: string;
}

async function isolate(run: (lab: LabState) => Promise<void> | void): Promise<AttackResult & { lab: LabState }> {
  const lab = await bootLab();
  await run(lab);
  return { lab } as AttackResult & { lab: LabState };
}

export async function runAttackGallery(): Promise<AttackResult[]> {
  const out: AttackResult[] = [];

  const a1 = await bootLab();
  await runPipeline(a1, { tamper: true });
  out.push({
    id: "A01",
    name: "Tampered output leaf",
    expected: "FAIL",
    got: a1.verify?.verdict ?? a1.state,
    blocked: a1.state === "DENIED" || a1.verify?.verdict !== "PASS",
    detail: a1.verify?.failed.join(", ") || a1.state,
  });

  const a2 = await bootLab();
  await runPipeline(a2, { stalePolicy: true });
  out.push({
    id: "A02",
    name: "Stale policy bundle digest",
    expected: "FAIL",
    got: a2.verify?.verdict ?? a2.state,
    blocked: a2.state === "DENIED" || a2.verify?.verdict !== "PASS",
    detail: a2.verify?.failed.join(", ") || "policy deny",
  });

  const a3 = await bootLab();
  await runPipeline(a3, { badAppraisal: true });
  out.push({
    id: "A03",
    name: "Untrusted RATS issuer / image",
    expected: "FAIL",
    got: a3.verify?.verdict ?? a3.state,
    blocked: a3.state === "DENIED" || a3.verify?.verdict !== "PASS",
    detail: a3.verify?.failed.join(", ") || "appraisal deny",
  });

  const a4 = await bootLab();
  await runPipeline(a4, { skipWitness: true });
  out.push({
    id: "A04",
    name: "Witness quorum short",
    expected: "INDETERMINATE",
    got: a4.verify?.verdict ?? a4.state,
    blocked: a4.verify?.verdict !== "PASS",
    detail: a4.verify?.failed.join(", ") || "",
  });

  const a5 = await bootLab();
  await runPipeline(a5);
  if (a5.capsule) {
    a5.capsule.capsule.source.root_sha384 = sha384Tag("00".repeat(48));
    const v = await (await import("./verifier")).verifyBundle({
      record: a5.capsule,
      sourceTree: a5.trees.src_claims,
      resultTree: a5.trees.export,
      inclusion: { tree: a5.trees.export, index: 0 },
      parents: [],
      lineageEdges: [],
      log: a5.log,
      statement_digest: a5.statement_digest!,
      inclusionProof: a5.store.receipts[0].inclusion,
      checkpoint: a5.store.receipts[0].checkpoint,
      consistency: a5.store.receipts[0].consistency,
      witnesses: a5.store.receipts[0].witnesses,
      requiredWitnesses: 2,
      findings: [],
      algebraic: a5.algebraic!,
      expectedDestination: a5.capsule.capsule.policy.destination_ref,
      appraisalRequired: true,
      appraisalPassed: true,
    });
    out.push({
      id: "A05",
      name: "Mutated snapshot root in capsule",
      expected: "FAIL",
      got: v.verdict,
      blocked: v.verdict !== "PASS",
      detail: v.failed.join(", "),
    });
  }

  const a6 = await bootLab();
  await runPipeline(a6);
  const replay1 = await consumeGrant(a6);
  const replay2 = await consumeGrant(a6);
  out.push({
    id: "A06",
    name: "Release-grant replay",
    expected: "FAIL",
    got: replay2.ok ? "PASS" : "FAIL",
    blocked: replay1.ok && !replay2.ok,
    detail: replay2.detail,
  });

  const a7 = await bootLab();
  const n = a7.store.consumeNonce("fixed-nonce-value-01");
  const n2 = a7.store.consumeNonce("fixed-nonce-value-01");
  out.push({
    id: "A07",
    name: "Nonce reuse",
    expected: "FAIL",
    got: n2 ? "PASS" : "FAIL",
    blocked: n && !n2,
    detail: "second consumeNonce rejected",
  });

  const a8 = await bootLab();
  await runPipeline(a8);
  if (a8.capsule) {
    const original = a8.capsule.capsule_digest;
    a8.capsule.capsule.policy.purpose = "exfiltrate";
    const recomputed = await capsuleDigest(a8.capsule.capsule);
    out.push({
      id: "A08",
      name: "Purpose swap without recanonicalizing",
      expected: "FAIL",
      got: recomputed === original ? "PASS" : "FAIL",
      blocked: recomputed !== original,
      detail: "digest detaches from mutated purpose",
    });
  }

  const a9 = await bootLab();
  const bodyA = { intent: "alpha" };
  const bodyB = { intent: "beta" };
  const { domainHashTagged } = await import("./hash");
  const { canonicalizeBytes } = await import("./canonical");
  const da = await domainHashTagged("IDEM", canonicalizeBytes(bodyA));
  const db = await domainHashTagged("IDEM", canonicalizeBytes(bodyB));
  a9.store.putIdempotent("k1", da, 201, bodyA);
  const clash = a9.store.putIdempotent("k1", db, 201, bodyB);
  out.push({
    id: "A09",
    name: "Idempotency-Key body mismatch",
    expected: "FAIL",
    got: clash.conflict ? "FAIL" : "PASS",
    blocked: clash.conflict,
    detail: "409 conflict on same key different body",
  });

  const a10 = await bootLab();
  await runPipeline(a10);
  if (a10.store.receipts[0]) {
    const cp = { ...a10.store.receipts[0].checkpoint, root_digest: sha384Tag(hex(fromHex("11".repeat(48)))) };
    const split = a10.log.detectSplit(a10.store.receipts[0].checkpoint, cp);
    out.push({
      id: "A10",
      name: "Witness split-view / equivocation",
      expected: "FAIL",
      got: split ? "FAIL" : "PASS",
      blocked: split,
      detail: "same tree_size, disagreeing roots",
    });
  }

  void isolate;
  return out;
}
