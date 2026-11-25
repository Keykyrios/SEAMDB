import { sectionHead } from "../ui/widgets";
import { schemaSection } from "../ui/showcase";
import { chromeNav, chromeFooter } from "../ui/site";

/** Architecture, crypto profile and threat model. snapshot/evidence numbers render into the placeholders by LabApp on load. */
export function specsPageHtml(): string {
  return `
  ${chromeNav("specs")}

  <main id="top">
    <section class="wrap hero hero-slim">
      <div>
        <h1>Specs & architecture.<span class="rest"> Numbers the verifier actually uses.</span></h1>
        <p class="lede">Each plane below carries a trust boundary, an owner, an API, a health note, and an open threat — click a plane. The crypto section reports what the runtime really negotiated for the transport handshake, fetched live from the control plane, not from marketing copy.</p>
      </div>
    </section>

    <section class="section" id="evidence-specs">
      <div class="wrap reveal is-in">
        ${sectionHead("Capsule facts →", "Live numbers, fetched on boot.", "Demo figures labelled synthetic.", "Bundle size here is the in-browser capsule metadata envelope, not a production SLO. Capture lag and p95 verifier latency are targets until measured on a real pipeline.")}
        <div class="frame">
          <div class="frame-inner">
            <div class="chrome"><span class="file">live capsule</span><span class="lang">fetched · SYNTHETIC estate</span></div>
            <div style="overflow-x:auto">
              <table class="checks" id="specs-table">
                <thead><tr><th>Metric</th><th>Value</th><th>Source</th></tr></thead>
                <tbody><tr><td colspan="3" class="hash">Filling from control plane…</td></tr></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="crypto">
      <div class="wrap reveal">
        ${sectionHead("Crypto →", "Imported primitives.", "PQ is transport, not a signature.", "SEAMDB does not invent a cipher, a TLS stack, or a proof system. ML-KEM-768 comes from the referenced @noble/post-quantum implementation and the hybrid handshake really executes; signatures stay classical — named in every checkpoint.")}
        <div class="crypto-cols" id="crypto-cols"></div>
      </div>
    </section>

    <section class="section" id="architecture">
      <div class="wrap reveal">
        ${sectionHead("Architecture →", "Overlay the estate.", "Do not forklift the warehouse.", "Planes: customer data, control, evidence, trust, consumer. Each node carries a trust boundary, owner, API, health, and an open threat. Click a plane; the contract is the product.")}
        <div class="arch-split">
          <div class="arch-list" id="arch-list"></div>
          <div class="arch-detail" id="arch-detail"></div>
        </div>
      </div>
    </section>

    ${schemaSection()}

    <section class="section" id="threats">
      <div class="wrap reveal">
        ${sectionHead("Threats →", "Residual risk stays visible.", "Honesty is a product feature.", "The MVP will not claim to prove arbitrary SQL, a malicious source of record, or that sheaf cohomology is a cryptographic primitive. These rows are the honest debt list.")}
        <dl class="dl" id="threat-dl"></dl>
      </div>
    </section>
  </main>

  ${chromeFooter()}`;
}
