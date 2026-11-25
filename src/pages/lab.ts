import { sectionHead } from "../ui/widgets";
import { chromeNav, chromeFooter } from "../ui/site";

/** The live SECP lab: gates/terminal/checks, coherence figure, attack gallery, ops. */
export function labPageHtml(): string {
  return `
  ${chromeNav("lab")}

  <main id="top">
    <section class="wrap hero hero-slim">
      <div>
        <h1>The SECP lab.<span class="rest"> Drive the nine-gate release.</span></h1>
        <p class="lede">Every button is an engine call against the in-process control plane — the same pipeline <code class="inline-code">npm run verify</code> runs offline. Northwind Health is a synthetic design-partner estate: 48 opaque member_ref rows, three seeded amount_cents disagreements. Opaque IDs only.</p>
        <p class="live-line" id="live-line">booting control plane…</p>
      </div>
    </section>

    <section class="section" id="lab" style="padding-top:8px">
      <div class="wrap reveal is-in">
        ${sectionHead("Pipeline →", "Seal, then break it on purpose.", "Tamper must FAIL, not PASS.", "Seal a capsule, then fire seeded faults: leaf tamper, stale policy, missing witness, bad appraisal, grant replay. If a fault still PASSes, the product is wrong.")}
        <div class="lab-shell">
          <aside class="rail">
            <h3>SECP/0.1</h3>
            <div id="gates"></div>
            <div class="actions">
              <button class="btn btn-primary" type="button" data-act="seal">Seal capsule</button>
              <button class="btn btn-ghost" type="button" data-act="tamper">Tamper leaf</button>
              <button class="btn btn-ghost" type="button" data-act="stale">Stale policy</button>
              <button class="btn btn-ghost" type="button" data-act="witness">Skip witness</button>
              <button class="btn btn-ghost" type="button" data-act="rats">Bad appraisal</button>
              <button class="btn btn-ghost" type="button" data-act="grant">Consume grant</button>
              <button class="btn btn-ghost" type="button" data-act="attacks">Attack gallery</button>
              <button class="btn btn-ghost" type="button" data-act="vectors">Known answers</button>
            </div>
          </aside>
          <div>
            <div class="frame">
              <div class="frame-inner">
                <div class="chrome">
                  <span class="file">operator@control-plane</span>
                  <span class="lang">SECP/0.1</span>
                </div>
                <div class="term fade-mask" id="term"></div>
              </div>
            </div>
            <div style="height:20px"></div>
            <div class="frame">
              <div class="frame-inner">
                <div class="chrome"><span class="file">named-checks</span><span class="lang">PASS/FAIL/INDETERMINATE</span></div>
                <div style="overflow-x:auto">
                  <table class="checks" id="checks"><thead><tr><th>Verdict</th><th>Check</th><th>Code</th><th>Artifact</th></tr></thead><tbody></tbody></table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="coherence">
      <div class="wrap reveal">
        ${sectionHead("Coherence →", "Contradictions are witnesses.", "Never pick the newest value.", "Bars are 1px rules in a 12ch track, width = |residual| / max. SYNTHETIC amounts. Accent marks the open finding under inspection.")}
        <div class="frame">
          <div class="frame-inner">
            <div class="chrome"><span class="file">overlap.amount_cents</span><span class="lang">SYNTHETIC</span></div>
            <div class="figure" id="figure"></div>
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="attacks">
      <div class="wrap reveal">
        ${sectionHead("Deny path →", "Ten seeded attacks.", "None may silently PASS.", "The gallery is the definition of done for the MVP. Green is forbidden when a dependency is missing. Press Attack gallery above, or read the table after it runs.")}
        <div class="frame">
          <div class="frame-inner">
            <div class="chrome"><span class="file">src/engine/attacks.ts</span><span class="lang">≥10 negatives</span></div>
            <div style="overflow-x:auto">
              <table class="checks" id="attack-table">
                <thead><tr><th>ID</th><th>Attack</th><th>Expected</th><th>Got</th><th>Blocked</th></tr></thead>
                <tbody><tr><td colspan="5" class="hash">Run Attack gallery in the lab.</td></tr></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="ops">
      <div class="wrap reveal">
        ${sectionHead("Ops →", "What failed, which evidence is missing.", "No row values in labels.", "Dashboards below are SYNTHETIC. They exist so an operator can see capture → seal → receipt without opening a source table.")}
        <div class="frame">
          <div class="frame-inner">
            <table class="checks" id="ops-table">
              <thead><tr><th>Signal</th><th>Reading</th><th>Note</th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  </main>

  ${chromeFooter()}`;
}
