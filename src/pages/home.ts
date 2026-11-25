import { codeFrame, sectionHead } from "../ui/widgets";
import { CAPTURE_TS, HERO_TS, INSTALL, POLICY_TS, VERIFY_TS } from "../ui/snippets";
import { comparisonHtml, proofSection } from "../ui/showcase";
import { chromeNav, chromeFooter } from "../ui/site";

export function homeHtml(): string {
  const pmTabs = Object.keys(INSTALL)
    .map((k, i) => `<button type="button" class="pm-tab${i === 0 ? " is-on" : ""}" data-pm="${k}">${k}</button>`)
    .join("");

  return `
  ${chromeNav("home")}

  <main id="top">
    <section class="wrap hero">
      <div>
        <h1>Git-like evidence for <span id="hero-rotator" class="rot-slot"></span>.
          <span class="rest">A capsule, a receipt, and an offline verifier — not another warehouse.</span>
        </h1>
        <p class="lede">SEAMDB sits beside Postgres, a warehouse, and a feature store. High-risk exports leave only with a proof-carrying Evidence Capsule. This site runs the in-process control plane in your browser. Estate is synthetic; no source payloads leave the tab.</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="/ide.html">Open the SQL IDE</a>
          <a class="btn btn-ghost" href="/lab.html">Seal a capsule</a>
        </div>
        <p class="live-line" id="live-line">booting control plane…</p>
      </div>
      <div class="hero-glow">
        ${codeFrame({ filename: "verify.ts", lang: "TypeScript", code: HERO_TS, highlightLine: 7 })}
      </div>
    </section>

    <section class="stat-band" aria-label="build facts">
      <div class="wrap stat-row">
        <div class="stat"><span class="stat-n" data-count="0">0</span><span class="stat-l">runtime npm dependencies (engine core)</span></div>
        <div class="stat"><span class="stat-n" data-count="16384">16,384</span><span class="stat-l">byte pages, CRC32 on every read</span></div>
        <div class="stat"><span class="stat-n" data-count="384">384</span><span class="stat-l">bit commitments, domain-tagged</span></div>
        <div class="stat"><span class="stat-n" data-count="9">9</span><span class="stat-l">SECP release gates</span></div>
        <div class="stat"><span class="stat-n" data-count="10">10</span><span class="stat-l">seeded attacks, all blocked</span></div>
      </div>
    </section>

    <section class="section" id="pages">
      <div class="wrap reveal">
        ${sectionHead("0.5 The site →", "Five pages, one engine.", "Every section has a URL.", "The one-pager is gone: the IDE, the SECP lab, the architecture and crypto specs, and the reference docs each live on their own page, wired to the same in-browser control plane.")}
        <div class="how-grid">
          <article class="how-col"><h3><a href="/ide.html">SQL IDE →</a></h3><p>Real SEAMQL editor against the in-memory engine: typed rows, plans, MVCC, fail-closed errors.</p></article>
          <article class="how-col"><h3><a href="/lab.html">SECP lab →</a></h3><p>Nine-gate release pipeline, tamper/stale/witness attacks live in the tab, transparency receipts.</p></article>
          <article class="how-col"><h3><a href="/specs.html">Specs →</a></h3><p>Architecture planes, crypto profile, coherence findings, ops table, threat list.</p></article>
          <article class="how-col"><h3><a href="/docs.html">Docs →</a></h3><p>SEAMQL grammar, CLI reference, drivers, on-disk format, and the highlighted snippets.</p></article>
        </div>
      </div>
    </section>

    <section class="section" id="install">
      <div class="wrap reveal">
        ${sectionHead("1.0 Install →", "One command.", "Exit 0 only on full PASS.", "The CLI is the same verifier the lab uses. Known-answer vectors and the attack gallery are sibling scripts.")}
        <div class="install">
          <div class="pm-tabs">${pmTabs}</div>
          <div class="install-row">
            <span class="prompt">$</span>
            <code id="install-cmd">${INSTALL.npm}</code>
            <button type="button" class="copy" data-copy="${encodeURIComponent(INSTALL.npm)}" aria-label="Copy install command" id="install-copy">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor"/><path d="M10.5 5.5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8A1.3 1.3 0 0 0 2.5 3.8v5.4A1.3 1.3 0 0 0 3.8 10.5H5.5" stroke="currentColor"/></svg>
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="how">
      <div class="wrap reveal">
        ${sectionHead("2.0 How it works →", "Three calls.", "Snapshot, policy, verify — fail-closed.", "The control plane is additive. Source systems stay systems of record. The capsule binds snapshot root, lineage, policy digest, appraisal, result root, and a transparency receipt.")}
        <div class="how-grid">
          <article class="how-col">
            <h3>Commit the snapshot</h3>
            <p>Keyed Merkle leaves over a canonical row stream. Same token, same SHA-384 root.</p>
            ${codeFrame({ filename: "connectors.ts", lang: "TypeScript", code: CAPTURE_TS })}
          </article>
          <article class="how-col">
            <h3>Appraise the policy</h3>
            <p>Rego-equivalent gate. Stale bundle digest or open critical discrepancy denies the grant.</p>
            ${codeFrame({ filename: "policy.ts", lang: "TypeScript", code: POLICY_TS })}
          </article>
          <article class="how-col">
            <h3>Verify offline</h3>
            <p>Named checks. INDETERMINATE is not PASS. No network in the verifier path.</p>
            ${codeFrame({ filename: "verifier.ts", lang: "TypeScript", code: VERIFY_TS })}
          </article>
        </div>
      </div>
    </section>

    ${comparisonHtml()}
    ${proofSection()}

    <section class="section" id="pricing">
      <div class="wrap reveal">
        ${sectionHead("2.9 Pilot →", "One pipeline, one buyer, one dossier.", "Price is a hypothesis, not a quote.", "Charge only if a regulated handoff is already expensive. Avoid teams whose only need is disk encryption.")}
        <div class="pricing">
          <div class="price-block">
            <div class="price-amt">$25k–$40k</div>
            <span class="price-unit">6–8 week design-partner pilot · creditable · not market data</span>
            <p class="lede">Buyer: CISO / CDO / AI risk on a named pipeline. Deliverable: capsule + verifier + disagreement report + measured overhead.</p>
          </div>
          <div class="price-block">
            <h3>Open research core</h3>
            <p class="lede">Canonicalization, Merkle profile, verifier, and attack gallery run offline after load. Production KMS/HSM custody is simulated envelope keys over real AES-256-GCM.</p>
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="cta">
      <div class="wrap reveal">
        ${sectionHead("3.0 →", "Copy the command.", "Then break the capsule on purpose.", "If tamper still PASSes, the product is wrong. The lab is the argument.")}
        <div class="install-row">
          <span class="prompt">$</span>
          <code>npm run verify</code>
          <button type="button" class="copy" data-copy="${encodeURIComponent("npm run verify")}" aria-label="Copy install command">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor"/><path d="M10.5 5.5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8A1.3 1.3 0 0 0 2.5 3.8v5.4A1.3 1.3 0 0 0 3.8 10.5H5.5" stroke="currentColor"/></svg>
          </button>
          <p class="lede" style="margin-top:10px">Run it in the browser instead — <a href="/lab.html">the SECP lab executes the same pipeline live</a>.</p>
        </div>
      </div>
    </section>
  </main>

  ${chromeFooter()}`;
}
