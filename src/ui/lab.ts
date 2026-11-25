import { bootLab, consumeGrant, FILTRATION, runPipeline, type LabState } from "../engine/control-plane";
import { runAttackGallery } from "../engine/attacks";
import { runKnownAnswers } from "../engine/vectors";
import { INSTALL } from "./snippets";
import { TENANT } from "../engine/demo-estate";

const ARCH = [
  {
    id: "data",
    title: "Customer data plane",
    k: "trust: customer",
    owner: "source-system owners",
    api: "read-only connectors / snapshot tokens",
    health: "sources registered",
    threat: "malicious source of record is out of scope",
    body: "Postgres, warehouse, feature store remain systems of record. Capture is read-only in MVP. Raw rows stay in customer-controlled storage.",
  },
  {
    id: "control",
    title: "SEAMDB control plane",
    k: "trust: operator",
    owner: "platform lead",
    api: "in-process REST semantics: intent, snapshot, seal, grant, verify",
    health: "online in this tab",
    threat: "admin identity must not equal runtime identity",
    body: "May authorize a release. Must not silently mutate source snapshots. Illegal SECP transitions throw.",
  },
  {
    id: "evidence",
    title: "Evidence plane",
    k: "trust: deterministic bytes",
    owner: "crypto/verification lead",
    api: "canon/v1 · Merkle profile · capsule digest",
    health: "JCS + domain-separated SHA-384",
    threat: "pretty-JSON hashing",
    body: "Canonicalizer, commitment worker, lineage index, discrepancy engine. Proof bundles are content-addressed. Events are idempotent.",
  },
  {
    id: "trust",
    title: "Trust plane",
    k: "trust: split duty",
    owner: "security lead",
    api: "transparency log · witnesses · verifier CLI",
    health: "quorum required before RELEASED",
    threat: "same party creating and solely verifying evidence",
    body: "KMS is simulated envelope keys over real AES-256-GCM. Checkpoints are signed by the runtime's classical algorithm — Ed25519 where WebCrypto has it, ECDSA P-384 where it does not — and every checkpoint names which. No service is both author and sole verifier.",
  },
  {
    id: "consumer",
    title: "Consumer plane",
    k: "trust: auditor",
    owner: "partner / model registry",
    api: "capsule + npm run verify",
    health: "offline after export",
    threat: "ingest without receipt check",
    body: "Auditor receives the capsule plus proofs. Exit 0 only on full PASS. INDETERMINATE is not a release signal.",
  },
];

const THREATS = [
  ["Source equivocation", "Witness split-view detection. Same tree_size, disagreeing roots → FAIL."],
  ["Grant replay", "One-use nonce. Second consumeGrant fails closed."],
  ["Policy stale-roll", "Decision binds bundle digest. sha384:dead denies."],
  ["Leaf tamper", "Output amount_cents mutation fails algebraic conservation and verifier."],
  ["PQ overclaim", "ML-KEM is transport only (real hybrid handshake: ML-KEM-768 + the runtime's classical group, named in the record). Never shown as a signature scheme."],
  ["PII in the UI", "Opaque member_ref. No record-level values rendered by default."],
];

function shortHash(h: string | undefined, n = 22): string {
  if (!h) return "—";
  return h.length > n ? `${h.slice(0, n)}…` : h;
}

function termLine(kind: string, text: string): string {
  if (kind === "in") return `<div><span class="meta">$</span> <span class="in">${text}</span></div>`;
  if (kind === "ok") return `<div class="ok">${text}</div>`;
  if (kind === "err") return `<div class="err">${text}</div>`;
  return `<div>${text}</div>`;
}

export class LabApp {
  lab!: LabState;
  constructor(private root: HTMLElement) {}

  async start(): Promise<void> {
    this.wireStatic();
    this.renderArch(0);
    this.renderThreats();
    try {
      await this.run("seal");
    } catch (e) {
      // Boot must fail loudly and visibly, never as a silently empty page.
      const term = this.root.querySelector("#term");
      if (term) term.innerHTML = termLine("err", `boot failed: ${(e as Error).message}`);
      const live = this.root.querySelector("#live-line");
      if (live) live.innerHTML = `<span class="bad">BOOT FAILED</span>  ${(e as Error).message}`;
      throw e;
    }
  }

  private wireStatic(): void {
    this.root.querySelectorAll("[data-pm]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = (btn as HTMLElement).dataset.pm!;
        this.root.querySelectorAll("[data-pm]").forEach((b) => b.classList.toggle("is-on", b === btn));
        const cmd = INSTALL[id];
        const code = this.root.querySelector("#install-cmd");
        const copy = this.root.querySelector<HTMLButtonElement>("#install-copy");
        if (code) code.textContent = cmd;
        if (copy) copy.dataset.copy = encodeURIComponent(cmd);
      });
    });
    this.root.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        void this.run((btn as HTMLElement).dataset.act!);
      });
    });
  }

  private renderGates(): void {
    const host = this.root.querySelector("#gates");
    if (!host) return;
    const denied = this.lab.state === "DENIED";
    const cur = FILTRATION.findIndex((x) => x.state === this.lab.state);
    host.innerHTML = FILTRATION.map((g, i) => {
      const passed = !denied && cur >= i;
      const cls = denied ? " is-fail" : passed ? " is-on" : "";
      const st = denied ? "DENIED" : passed ? "PASS" : "WAIT";
      return `<div class="gate${cls}"><span>${g.label}</span><span class="st">${st}</span></div>`;
    }).join("");
  }

  private renderTerm(command: string): void {
    const el = this.root.querySelector("#term");
    if (!el) return;
    const lines = [termLine("in", command)];
    for (const t of this.lab.traces) {
      lines.push(termLine("meta", `${t.phase.padEnd(11)} ${t.detail}`));
    }
    const v = this.lab.verify?.verdict;
    if (v === "PASS") lines.push(termLine("ok", `exit 0  verdict=${v}`));
    else if (v) lines.push(termLine("err", `exit 1  verdict=${v}  ${this.lab.verify?.failed.join(",") ?? ""}`));
    el.innerHTML = lines.join("");
    el.scrollTop = el.scrollHeight;
  }

  private renderChecks(): void {
    const body = this.root.querySelector("#checks tbody");
    if (!body) return;
    const checks = this.lab.verify?.checks ?? [];
    if (!checks.length) {
      body.innerHTML = `<tr><td colspan="4" class="hash">No named checks yet.</td></tr>`;
      return;
    }
    body.innerHTML = checks
      .map(
        (c) =>
          `<tr><td class="v-${c.verdict}">${c.verdict}</td><td>${c.name}</td><td class="hash">${c.code}</td><td class="hash">${shortHash(c.artifact, 40)}</td></tr>`,
      )
      .join("");
  }

  private renderLive(): void {
    const el = this.root.querySelector("#live-line");
    if (!el) return;
    const v = this.lab.verify?.verdict ?? this.lab.state;
    const cls = v === "PASS" ? "ok" : v === "FAIL" || this.lab.state === "DENIED" ? "bad" : "warn";
    el.innerHTML = `<span class="${cls}">${v}</span>  state=${this.lab.state}  digest=${shortHash(this.lab.capsule?.capsule_digest, 28)}  tenant=${TENANT.tenant_id}`;
  }

  private renderFigure(): void {
    const el = this.root.querySelector("#figure");
    if (!el) return;
    const findings = this.lab.findings;
    const max = Math.max(1, ...findings.map((f) => Math.abs(f.residual)));
    const header = "ROW            LEFT/RIGHT              RESIDUAL   STATE";
    const rows = findings.slice(0, 6).map((f, i) => {
      const pct = Math.max(8, (Math.abs(f.residual) / max) * 100);
      const accent = i === 0 ? " accent" : "";
      return `<div class="${accent}">${f.row_ref.padEnd(14)} ${f.left_source}/${f.right_source.padEnd(10)} <span class="bar-track"><span style="width:${pct}%"></span></span>  ${String(f.residual).padStart(6)}  ${f.disposition}</div>`;
    });
    while (rows.length < 6) rows.push("<div> </div>");
    el.innerHTML = `<div>${header}</div>${rows.join("")}<div>note ${this.lab.rows.note}</div>`;
  }

  private renderSpecs(): void {
    const body = this.root.querySelector("#specs-table tbody");
    if (!body) return;
    const c = this.lab.capsule?.capsule;
    const rows: Array<[string, string, string]> = [
      ["Hash", "SHA-384", "crypto profile"],
      ["Capsule digest", shortHash(this.lab.capsule?.capsule_digest, 48), "live"],
      ["Source rows", String(c?.source.row_count ?? "—"), "synthetic estate"],
      ["Merkle leaves (export)", String(this.lab.trees.export?.leaves.length ?? "—"), "live tree"],
      ["Discrepancy witnesses", String(this.lab.findings.length), "SYNTHETIC overlap"],
      ["Obstruction residual", this.lab.algebraic ? String(this.lab.algebraic.result) : "—", "conservation check"],
      ["MDL score", this.lab.mdl ? this.lab.mdl.score.toFixed(4) : "—", "not K(x)"],
      ["Witnesses", String(this.lab.store.receipts[0]?.witnesses.length ?? 0), "quorum=2"],
      ["Checkpoint sig", this.lab.log.signatureAlgorithm, "runtime WebCrypto"],
      ["Transport", this.lab.transport.profile, this.lab.transport.note],
      ["Verifier", this.lab.verify?.verifier_version ?? "—", "offline"],
    ];
    body.innerHTML = rows
      .map(([a, b, c]) => `<tr><td>${a}</td><td class="hash">${b}</td><td class="hash">${c}</td></tr>`)
      .join("");
  }

  private renderOps(): void {
    const body = this.root.querySelector("#ops-table tbody");
    if (!body) return;
    const v = this.lab.verify;
    const failN = v?.checks.filter((c) => c.verdict === "FAIL").length ?? 0;
    const rows: Array<[string, string, string]> = [
      ["Pipeline", `${this.lab.state}`, "source → commit → lineage → policy → appraisal → capsule → receipt → release"],
      ["Failed checks", String(failN), "never green on missing deps"],
      ["Grant", this.lab.grant ? (this.lab.grant.consumed ? "consumed" : "issued") : "none", "one-use"],
      ["Capture lag", "SYNTHETIC n/a (in-process)", "target: p95 < 5 min on a bounded pipeline (unmeasured)"],
      ["Verify duration", `${this.lab.traces.at(-1)?.t.toFixed(0) ?? "—"} ms from boot marks`, "local, no remote fetch"],
      ["PQ negotiation", this.lab.transport.groups.join("+"), this.lab.transport.pq_labelled ? `hybrid ${this.lab.transport.peer_ek?.slice(0, 22)}…` : "classical fallback"],
    ];
    body.innerHTML = rows.map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td class="hash">${c}</td></tr>`).join("");
  }

  private renderCrypto(): void {
    const host = this.root.querySelector("#crypto-cols");
    if (!host) return;
    const t = this.lab.transport;
    host.innerHTML = `
      <article><h3>Commitments</h3><p>SHA-384 with domain tags. HMAC keyed leaves. AES-256-GCM envelopes. ${this.lab.log.signatureAlgorithm} checkpoints.</p></article>
      <article><h3>Transport</h3><p class="hash">${t.profile}</p><p>${t.note}</p></article>
      <article><h3>What this is not</h3><p>Not a custom cipher. Not PQ signatures. Not a claim that ML-KEM attests the capsule.</p></article>`;
  }

  private renderArch(i: number): void {
    const list = this.root.querySelector("#arch-list");
    const detail = this.root.querySelector("#arch-detail");
    if (!list || !detail) return;
    list.innerHTML = ARCH.map(
      (a, idx) =>
        `<button type="button" class="arch-item${idx === i ? " is-on" : ""}" data-arch="${idx}"><div>${a.title}</div><div class="k">${a.k}</div></button>`,
    ).join("");
    const a = ARCH[i];
    detail.innerHTML = `<h3>${a.title}</h3>
      <dl class="dl">
        <div class="dl-row"><dt>Owner</dt><dd>${a.owner}</dd></div>
        <div class="dl-row"><dt>API</dt><dd class="hash">${a.api}</dd></div>
        <div class="dl-row"><dt>Health</dt><dd>${a.health}</dd></div>
        <div class="dl-row"><dt>Threat</dt><dd>${a.threat}</dd></div>
      </dl>
      <p class="lede">${a.body}</p>`;
    list.querySelectorAll("[data-arch]").forEach((btn) => {
      btn.addEventListener("click", () => this.renderArch(Number((btn as HTMLElement).dataset.arch)));
    });
  }

  private renderThreats(): void {
    const host = this.root.querySelector("#threat-dl");
    if (!host) return;
    host.innerHTML = THREATS.map(
      ([k, v]) => `<div class="dl-row"><dt>${k}</dt><dd>${v}</dd></div>`,
    ).join("");
  }

  private async run(act: string): Promise<void> {
    if (act === "attacks") {
      const rows = await runAttackGallery();
      const body = this.root.querySelector("#attack-table tbody");
      if (body) {
        body.innerHTML = rows
          .map(
            (r) =>
              `<tr><td class="hash">${r.id}</td><td>${r.name}</td><td class="hash">${r.expected}</td><td class="v-${r.got === "PASS" ? "FAIL" : r.blocked ? "PASS" : "FAIL"}">${r.got}</td><td class="${r.blocked ? "v-PASS" : "v-FAIL"}">${r.blocked ? "BLOCKED" : "LEAK"}</td></tr>`,
          )
          .join("");
      }
      const term = this.root.querySelector("#term");
      if (term) {
        term.innerHTML =
          termLine("in", "npm run attacks") +
          rows.map((r) => termLine(r.blocked ? "ok" : "err", `${r.id} ${r.name}  got=${r.got}`)).join("");
      }
      return;
    }
    if (act === "vectors") {
      const rows = await runKnownAnswers();
      const term = this.root.querySelector("#term");
      if (term) {
        term.innerHTML =
          termLine("in", "npm run vectors") +
          rows.map((r) => termLine(r.pass ? "ok" : "err", `${r.pass ? "PASS" : "FAIL"}  ${r.name}  ${r.detail.slice(0, 72)}`)).join("");
      }
      return;
    }
    if (act === "grant") {
      const r = await consumeGrant(this.lab);
      const term = this.root.querySelector("#term");
      if (term) {
        term.innerHTML = termLine("in", "POST /v1/releases:consume") + termLine(r.ok ? "ok" : "err", r.detail);
      }
      this.renderOps();
      return;
    }

    this.lab = await bootLab();
    const opts =
      act === "tamper"
        ? { tamper: true }
        : act === "stale"
          ? { stalePolicy: true }
          : act === "witness"
            ? { skipWitness: true }
            : act === "rats"
              ? { badAppraisal: true }
              : {};
    await runPipeline(this.lab, opts);
    this.renderGates();
    this.renderTerm(
      act === "tamper"
        ? "runPipeline({ tamper: true })"
        : act === "stale"
          ? "runPipeline({ stalePolicy: true })"
          : act === "witness"
            ? "runPipeline({ skipWitness: true })"
            : act === "rats"
              ? "runPipeline({ badAppraisal: true })"
              : "runPipeline(lab)",
    );
    this.renderChecks();
    this.renderLive();
    this.renderFigure();
    this.renderSpecs();
    this.renderOps();
    this.renderCrypto();
    const foot = this.root.querySelector("#foot-meta");
    if (foot) {
      foot.textContent = `seamdb/0.1.0 · ${shortHash(this.lab.capsule?.capsule_digest, 16)} · ${this.lab.state} · SYNTHETIC`;
    }
  }
}
