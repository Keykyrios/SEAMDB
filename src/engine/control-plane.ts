import { uuidV7, hex, randomBytes, utf8 } from "./bytes";
import { canonicalizeBytes } from "./canonical";
import { domainHashTagged } from "./hash";
import { capsuleDigest, nowUtc } from "./capsule";
import { captureSnapshot } from "./connectors";
import { runCoherence, type ViewSection } from "./coherence";
import { evaluatePolicy, policyBundleDigest } from "./policy";
import { TransparencyLog } from "./transparency";
import { appraise, demoEvidence } from "./appraisal";
import { checkConservation } from "./algebraic";
import { mdlScore } from "./mdl";
import { verifyBundle, VERIFIER_VERSION, type VerifyResult } from "./verifier";
import { canTransition, FILTRATION } from "./secp";
import { EvidenceStore } from "./store";
import { proveInclusion } from "./merkle";
import { negotiateTransport, deriveDek, aesGcmEncrypt, aadBytes } from "./crypto";
import {
  ASSURANCE,
  DESTINATION,
  KEY_EPOCH,
  PRINCIPAL,
  PURPOSE,
  SOURCES,
  TENANT,
  TRANSFORM,
  buildSyntheticRows,
} from "./demo-estate";
import { detectCycle } from "./lineage";
import type {
  CapsuleRecord,
  CanonicalRow,
  DiscrepancyWitness,
  EvidenceCapsule,
  MerkleTree,
  NamedCheck,
  ReleaseGrant,
  SecpState,
} from "./types";
import type { AlgebraicReport } from "./algebraic";
import type { MdlScore } from "./mdl";
import type { CaptureManifest } from "./connectors";
import type { TransportNegotiation } from "./crypto";

export interface PipelineTrace {
  t: number;
  phase: string;
  detail: string;
}

export interface LabState {
  store: EvidenceStore;
  log: TransparencyLog;
  tenantSecret: Uint8Array;
  commitmentSecret: Uint8Array;
  rows: ReturnType<typeof buildSyntheticRows>;
  trees: Record<string, MerkleTree>;
  manifests: Record<string, CaptureManifest>;
  views: ViewSection[];
  findings: DiscrepancyWitness[];
  capsule?: CapsuleRecord;
  grant?: ReleaseGrant;
  verify?: VerifyResult;
  algebraic?: AlgebraicReport;
  mdl?: MdlScore;
  transport: TransportNegotiation;
  envelope?: { nonce: string; ciphertext: string };
  state: SecpState;
  traces: PipelineTrace[];
  parentCapsuleDigest?: string;
  statement_digest?: string;
  code_digest?: string;
  query_digest?: string;
  tampered: boolean;
}

function trace(lab: LabState, phase: string, detail: string) {
  lab.traces.push({ t: performance.now(), phase, detail });
}

export async function bootLab(): Promise<LabState> {
  const store = new EvidenceStore();
  store.tenants.set(TENANT.tenant_id, {
    tenant_id: TENANT.tenant_id,
    crypto_domain: TENANT.crypto_domain,
    policy_root: "pending",
    status: "active",
  });
  for (const s of SOURCES) {
    store.sources.set(s.source_ref, {
      source_id: s.source_ref,
      tenant_id: TENANT.tenant_id,
      kind: s.kind,
      locator_ref: `opaque:${s.source_ref}`,
      connector_version: s.connector_version,
      owner: s.owner,
      status: "active",
    });
  }
  const log = new TransparencyLog();
  await log.init();
  const tenantSecret = randomBytes(32);
  const commitmentSecret = randomBytes(32);
  const rows = buildSyntheticRows();
  const policyRoot = await policyBundleDigest();
  store.tenants.get(TENANT.tenant_id)!.policy_root = policyRoot;

  const lab: LabState = {
    store,
    log,
    tenantSecret,
    commitmentSecret,
    rows,
    trees: {},
    manifests: {},
    views: [],
    findings: [],
    state: "INTENT_CREATED",
    traces: [],
    tampered: false,
    transport: await negotiateTransport(true),
  };
  trace(lab, "boot", "Control plane online. Synthetic estate loaded. No source payloads leave the browser.");
  return lab;
}

async function advance(lab: LabState, to: SecpState) {
  if (!canTransition(lab.state, to) && to !== "DENIED") {
    throw new Error(`illegal SECP transition ${lab.state} → ${to}`);
  }
  lab.state = to;
}

export async function runPipeline(lab: LabState, opts?: { tamper?: boolean; stalePolicy?: boolean; skipWitness?: boolean; badAppraisal?: boolean }): Promise<LabState> {
  lab.traces = [];
  lab.tampered = Boolean(opts?.tamper);
  lab.state = "INTENT_CREATED";
  const intent = uuidV7();
  const nonce = hex(randomBytes(16));
  if (!lab.store.consumeNonce(nonce)) throw new Error("nonce replay");
  trace(lab, "intent", `Intent ${intent} purpose=${PURPOSE} dest=${DESTINATION}`);

  const started = nowUtc();
  const captured = [];
  for (const source of SOURCES) {
    const pack = source.source_ref === "src_claims" ? lab.rows.claims : source.source_ref === "src_wh" ? lab.rows.warehouse : lab.rows.features;
    const cap = await captureSnapshot({
      source,
      rows: pack,
      token: `snap-${source.source_ref}-20261015`,
      commitmentSecret: lab.commitmentSecret,
      started_at: started,
    });
    lab.trees[source.source_ref] = cap.tree;
    lab.manifests[source.source_ref] = cap.manifest;
    lab.store.snapshots.set(cap.manifest.source_version_token, {
      snapshot_id: cap.manifest.source_version_token,
      source_id: source.source_ref,
      schema_digest: cap.manifest.schema_digest,
      root_digest: cap.manifest.root_digest,
      row_count: cap.manifest.row_count,
      snapshot_token: cap.manifest.source_version_token,
      crypto_epoch: KEY_EPOCH,
      canonicalization_version: "canon/v1",
      tree: cap.tree,
      sealed: true,
    });
    captured.push(source.source_ref);
    trace(lab, "capture", `${source.name} root=${cap.tree.root_commitment.slice(0, 22)}… rows=${cap.manifest.row_count}`);
  }
  await advance(lab, "SOURCE_COMMITTED");

  lab.views = SOURCES.map((s) => ({
    source_ref: s.source_ref,
    snapshot_root: lab.trees[s.source_ref].root_commitment,
    mapping_version: "map/amount-cents/v1",
    rows: s.source_ref === "src_claims" ? lab.rows.claims : s.source_ref === "src_wh" ? lab.rows.warehouse : lab.rows.features,
    overlap_key: "member_ref",
    numeric_fields: ["amount_cents"],
    tau: 0,
  }));
  const coh = await runCoherence(lab.views);
  lab.findings = coh.alerts;
  lab.store.findings = coh.alerts;
  trace(lab, "coherence", `${coh.alerts.length} discrepancy witnesses · obstruction ‖δ‖=${coh.obstruction_norm.toFixed(1)}`);

  const code_digest = await domainHashTagged("SEAMDB/CODE/V1", utf8("export tabular-export/v1 lockfile=pnpm@9"));
  const query_digest = await domainHashTagged(
    "SEAMDB/QUERY/V1",
    canonicalizeBytes({ profile: TRANSFORM.query_profile, params_commit: "omitted" }),
  );
  lab.code_digest = code_digest;
  lab.query_digest = query_digest;

  const parentRows: CanonicalRow[] = lab.rows.claims.map((r) => ({
    row_ref: `out:${r.row_ref}`,
    partition: "p0",
    fields: {
      member_ref: r.fields.member_ref,
      amount_cents: r.fields.amount_cents,
      dx_class: r.fields.dx_class,
      encounter_day: r.fields.encounter_day,
    },
  }));
  if (opts?.tamper) {
    parentRows[0] = {
      ...parentRows[0],
      fields: { ...parentRows[0].fields, amount_cents: Number(parentRows[0].fields.amount_cents) + 999999 },
    };
    trace(lab, "tamper", "Seeded leaf mutation on output row 0 (+999999 cents)");
  }

  const resultCap = await captureSnapshot({
    source: {
      source_ref: "src_export",
      kind: "object",
      name: "Governed export",
      owner: "ml-platform",
      connector_version: "seamdb-obj/0.1.0",
      schema: SOURCES[0].schema,
    },
    rows: parentRows,
    token: "snap-export-20261015",
    commitmentSecret: lab.commitmentSecret,
    started_at: started,
  });
  lab.trees.export = resultCap.tree;

  const inSum = lab.rows.claims.reduce((s, r) => s + Number(r.fields.amount_cents), 0);
  const outSum = parentRows.reduce((s, r) => s + Number(r.fields.amount_cents), 0);
  lab.algebraic = await checkConservation({
    inputs: [inSum],
    outputs: [outSum],
    statement: "sum(claims.amount_cents) = sum(export.amount_cents) over member_ref",
  });

  const lineageEdges = [
    { child: "export", parent: "src_claims", relation: "derived_from" },
    { child: "export", parent: "src_feat", relation: "derived_from" },
  ];
  if (detectCycle(lineageEdges)) throw new Error("cycle");
  await advance(lab, "LINEAGE_CLOSED");
  trace(lab, "lineage", "Parent closure acyclic. OpenLineage run bound.");

  const bundle = await policyBundleDigest();
  const issued = nowUtc();
  const expires = new Date(Date.now() + 180_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const criticalOpen = lab.findings.some((f) => f.severity === "critical" && f.disposition === "open");
  const decision = await evaluatePolicy({
    principal: PRINCIPAL,
    purpose: PURPOSE,
    source_root: lab.trees.src_claims.root_commitment,
    destination: DESTINATION,
    data_classes: ["regulated", "pseudonymized"],
    query_profile: TRANSFORM.query_profile,
    max_rows: 500000,
    max_bytes: 1073741824,
    capsule_intent: intent,
    policy_bundle_digest: opts?.stalePolicy ? "sha384:dead" : bundle,
    issued_at: issued,
    expires_at: expires,
    key_epoch: KEY_EPOCH,
    high_severity_open: criticalOpen,
    nonce,
  });
  lab.store.decisions.push(decision);
  if (!decision.allow) {
    await advance(lab, "DENIED");
    trace(lab, "policy", `DENY ${decision.reason_codes.join(",")}`);
    lab.verify = {
      verdict: "FAIL",
      checks: [
        {
          name: "POLICY_BINDING",
          verdict: "FAIL",
          code: decision.reason_codes[0] ?? "DENY",
          detail: decision.reason_codes.join(", "),
          artifact: decision.decision_digest,
        },
      ],
      failed: decision.reason_codes,
      verifier_version: VERIFIER_VERSION,
    };
    return lab;
  }
  await advance(lab, "POLICY_APPRAISED");
  trace(lab, "policy", `ALLOW decision=${decision.decision_digest.slice(0, 22)}… obligations=${decision.obligations.length}`);

  const rats = demoEvidence(nonce, !opts?.badAppraisal);
  const appraisal = await appraise(rats, nonce, decision.require_attestation);
  if (!appraisal.pass) {
    lab.state = "DENIED";
    trace(lab, "appraisal", `FAIL ${appraisal.reasons.join(",")}`);
    lab.verify = {
      verdict: "FAIL",
      checks: [
        {
          name: "APPRAISAL",
          verdict: "FAIL",
          code: appraisal.reasons[0] ?? "APPRAISAL_FAIL",
          detail: appraisal.reasons.join(", "),
          artifact: appraisal.evidence_digest,
        },
      ],
      failed: appraisal.reasons,
      verifier_version: VERIFIER_VERSION,
    };
    return lab;
  }
  await advance(lab, "EXECUTION_APPRAISED");
  await advance(lab, "RESULT_COMMITTED");
  trace(lab, "appraisal", `RATS pass · ${appraisal.profile}`);

  const capsule: EvidenceCapsule = {
    spec: "seamdb.capsule/v1",
    tenant_ref: TENANT.tenant_id,
    capsule_id: uuidV7(),
    created_at: nowUtc(),
    source: {
      source_ref: "src_claims",
      snapshot_ref: lab.manifests.src_claims.source_version_token,
      schema_sha384: lab.manifests.src_claims.schema_digest,
      root_sha384: lab.trees.src_claims.root_commitment,
      row_count: lab.manifests.src_claims.row_count,
      canonicalizer: "canon/v1",
    },
    transform: {
      image_digest: TRANSFORM.image_digest,
      code_digest,
      query_profile: TRANSFORM.query_profile,
      query_digest,
    },
    parents: [],
    policy: {
      bundle_digest: decision.bundle_digest,
      decision_digest: decision.decision_digest,
      purpose: PURPOSE,
      destination_ref: DESTINATION,
    },
    execution: {
      profile: appraisal.profile,
      evidence_digest: appraisal.evidence_digest,
    },
    result: {
      root_sha384: lab.trees.export.root_commitment,
      row_count: resultCap.manifest.row_count,
      schema_sha384: resultCap.manifest.schema_digest,
    },
    crypto: { hash: "SHA-384", key_epoch: KEY_EPOCH },
    transparency: { statement_digest: "pending", receipt_ref: "pending" },
    assurance_profile: ASSURANCE,
  };

  const digest = await capsuleDigest(capsule);
  capsule.transparency.statement_digest = digest;
  const rec: CapsuleRecord = { capsule, capsule_digest: digest, state: "CAPSULE_SEALED" };
  lab.store.sealCapsule(rec);
  lab.capsule = rec;
  await advance(lab, "CAPSULE_SEALED");
  trace(lab, "seal", `Capsule ${digest.slice(0, 24)}…`);

  const appended = await lab.log.append(digest);
  const witnesses = await lab.log.witnessAcks(appended.checkpoint, opts?.skipWitness ? 0 : 2);
  capsule.transparency.receipt_ref = lab.log.receiptRef();
  lab.statement_digest = digest;
  lab.store.receipts.push({
    receipt_id: capsule.transparency.receipt_ref,
    capsule_id: capsule.capsule_id,
    inclusion: appended.inclusion,
    checkpoint: appended.checkpoint,
    consistency: appended.consistency,
    witnesses,
  });
  rec.state = "RECEIPT_VERIFIED";
  await advance(lab, "RECEIPT_VERIFIED");
  trace(lab, "receipt", `log size=${appended.checkpoint.tree_size} witnesses=${witnesses.length}`);

  const proof = await proveInclusion(lab.trees.export, 0);
  const inclOk = proof.siblings.length >= 0;

  lab.mdl = await mdlScore(
    { roots: Object.values(lab.trees).map((t) => t.root_commitment), alerts: lab.findings.length },
    { roots: ["baseline"], alerts: 0 },
    {
      schema_delta: 0,
      null_rate: 0,
      cardinality_delta: 0,
      join_ratio: 1,
      graph_edit_cost: lab.findings.length,
      row_count_residual: Math.abs(inSum - outSum) > 0 ? Math.abs(inSum - outSum) : 0,
      lineage_branch_delta: 2,
    },
    false,
    false,
  );

  const dek = new Uint8Array(await deriveDek(lab.tenantSecret, capsule.capsule_id, KEY_EPOCH));
  lab.envelope = await aesGcmEncrypt(
    dek,
    utf8(`capsule:${digest}`),
    aadBytes({
      tenant_id: TENANT.tenant_id,
      object_id: capsule.capsule_id,
      object_type: "capsule-meta",
      schema_version: "seamdb.capsule/v1",
      key_epoch: KEY_EPOCH,
    }),
  );

  const result = await verifyBundle({
    record: rec,
    sourceTree: lab.trees.src_claims,
    resultTree: lab.trees.export,
    inclusion: { tree: lab.trees.export, index: 0 },
    parents: [],
    lineageEdges: [],
    log: lab.log,
    statement_digest: digest,
    inclusionProof: appended.inclusion,
    checkpoint: appended.checkpoint,
    consistency: appended.consistency,
    witnesses,
    requiredWitnesses: 2,
    findings: lab.findings.filter((f) => f.severity === "critical"),
    algebraic: lab.algebraic,
    expectedDestination: DESTINATION,
    appraisalRequired: decision.require_attestation,
    appraisalPassed: appraisal.pass,
  });
  lab.verify = result;
  lab.store.verificationRuns.push({
    run_id: uuidV7(),
    capsule_id: capsule.capsule_id,
    verifier_version: VERIFIER_VERSION,
    verdict: result.verdict,
    failed_checks: result.failed,
  });
  trace(lab, "verify", `${result.verdict} failed=${result.failed.join(",") || "none"} inclProbe=${inclOk}`);

  if (result.verdict === "PASS") {
    const grant: ReleaseGrant = {
      grant_id: uuidV7(),
      capsule_digest: digest,
      destination: DESTINATION,
      decision_digest: decision.decision_digest,
      nonce,
      expires_at: expires,
      consumed: false,
      max_rows: 500000,
      max_bytes: 1073741824,
    };
    lab.grant = grant;
    lab.store.grants.set(grant.grant_id, grant);
    rec.state = "RELEASED";
    await advance(lab, "RELEASED");
    trace(lab, "release", `One-use grant ${grant.grant_id} TTL 180s`);
  } else {
    lab.state = "DENIED";
    rec.state = "DENIED";
    trace(lab, "release", "Gate refused. No grant issued.");
  }

  return lab;
}

export async function consumeGrant(lab: LabState): Promise<{ ok: boolean; detail: string }> {
  if (!lab.grant) return { ok: false, detail: "no grant" };
  if (lab.grant.consumed) return { ok: false, detail: "replay: grant already consumed" };
  if (Date.parse(lab.grant.expires_at) <= Date.now()) return { ok: false, detail: "grant expired" };
  lab.grant.consumed = true;
  return { ok: true, detail: "bytes released once; subsequent calls fail closed" };
}

export { FILTRATION };

export function checksOf(lab: LabState): NamedCheck[] {
  return lab.verify?.checks ?? [];
}
