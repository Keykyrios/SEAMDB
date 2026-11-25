import { LC183_SEAMQL } from "./snippets";
import { codeFrame, sectionHead } from "./widgets";

/** Hand-drawn SVG architecture diagram, terminal-dark, no AI imagery. */
export function schemaSvg(): string {
  const ink = "#a8b3cf";
  const dim = "#5b6478";
  const acc = "#4f7cff";
  const ok = "#37d99e";
  const warn = "#ffb84d";
  const mono = 'font-family="ui-monospace, SFMono-Regular, Menlo, monospace"';
  const edge = (d: string, color = dim, dash = "") =>
    `<path d="${d}" stroke="${color}" stroke-width="1.5" fill="none" stroke-dasharray="${dash}"/>`;
  const label = (x: number, y: number, t: string, color = dim, size = 10) =>
    `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" ${mono}>${t}</text>`;
  const node = (
    x: number, y: number, w: number, h: number, title: string, lines: string[],
    accent = dim, titleColor = ink,
  ) => `
  <g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#0d1117" stroke="${accent}" stroke-width="1.4"/>
    <text x="${x + 14}" y="${y + 24}" fill="${titleColor}" font-size="12.5" font-weight="600" ${mono}>${title}</text>
    ${lines.map((l, i) => `<text x="${x + 14}" y="${y + 44 + i * 15}" fill="${dim}" font-size="10" ${mono}>${l}</text>`).join("")}
  </g>`;
  return `<svg viewBox="0 0 980 620" role="img" aria-label="SEAMDB architecture: query path, storage path, and evidence path on one diagram" ${mono} style="width:100%;height:auto;display:block">
  <defs>
    <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="${dim}"/>
    </marker>
    <marker id="arrA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="${acc}"/>
    </marker>
  </defs>

  <!-- Clients band -->
${node(330, 20, 320, 74, "Clients", ["IDE browser tab · SECP lab", "protocol.ts framed sessions"], acc, ink)}
  ${edge("M 400 94 L 400 128", acc)}  ${label(408, 118, "SEAMQL", acc)}
  ${edge("M 580 94 L 580 128")}  ${label(588, 118, "frames")}

  <!-- Query path -->
${node(40, 130, 300, 148, "Query path", ["lexer.ts → tokens", "parser.ts → AST (seamql/0.1)", "resolve.ts → typed plans", "eval.ts · plan.ts → executor"], acc, ink)}
${node(640, 130, 300, 148, "Engine (single writer)", ["engine.ts · MVCC snapshots", "conflict = first committer wins", "readers interleave freely"], ok, ink)}

  ${edge("M 340 204 L 640 204", acc)}
  ${label(435, 196, "physical plans", acc)}

  <!-- Storage path -->
${node(40, 340, 300, 130, "Storage", ["page.ts 16,384-byte pages + CRC32", "tuple.ts xmin/xmax heap tuples", "btree.ts leaf/int splits + chains"], dim, ink)}
${node(400, 340, 240, 130, "Buffer cache", ["no-steal · pin counted", "512-page ceiling"], dim, ink)}
${node(700, 340, 240, 130, "Pager", ["MemoryPager · FilePager", "crypto-pager AES-256-GCM"], dim, ink)}

  ${edge("M 190 278 L 190 340")}  ${label(198, 312, "page ids")}
  ${edge("M 340 388 L 400 388")}  ${label(346, 380, "pin/unpin")}
  ${edge("M 640 388 L 700 388")}  ${label(646, 380, "read/write/sync")}

  <!-- WAL band -->
${node(700, 520, 240, 80, "Write-ahead log", ["per-record CRC32 · torn tail", "checkpoint → rotate at 4 MiB"], warn, ink)}
  ${edge("M 820 470 L 820 520")}  ${label(828, 500, "W_PAGE/COMMIT", warn)}

  <!-- Evidence band -->
${node(40, 520, 300, 80, "Evidence events", ["statement_fp · plan_fp · write_set", "W_EVIDENCE after durable commit"], ok, ink)}
  ${edge("M 340 560 L 700 560", ok)}  ${label(430, 552, "commit → evidence (same WAL)", ok)}

  <!-- Transcript caption -->
  ${label(40, 608, "SEAMDB/0.1 · one file format, one log, one verifier language. The capsule seal is out of frame to the right.", dim, 10)}
</svg>`;
}

export function proofSection(): string {
  return `
  <section class="section" id="leetcode-proof">
    <div class="wrap reveal">
      ${sectionHead(
        "2.8 Proof by problem →",
        "LeetCode 183, solved by the engine.",
        "Not a claim. A runnable script.",
        "Customers Who Never Order: return every customer with no order row. The engine answers it with a LEFT JOIN over a foreign key — and the same script is executed verbatim by tests/demo-proof.test.ts, so the page cannot drift from the engine.",
      )}
      <div class="how-grid">
        <article class="how-col">
          <h3>The problem, in SEAMQL</h3>
          <p>Every line is engine work, not commentary: spawn is catalog DDL (WAL-cat), drop in takes the B+tree path, left link is a null-extending join.</p>
          ${codeFrame({ filename: "lc183.seamql", lang: "SEAMQL", mode: "seamql", code: LC183_SEAMQL })}
          <p class="lede">Runs in the browser IDE below and in CI. Result: <code class="inline-code">customers = Grace, Linus</code>.</p>
        </article>
        <article class="how-col">
          <h3>Why this proves the engine</h3>
          <dl class="dl dl-tight">
            <div class="dl-row"><dt>Main key ⇒ storage-enforced</dt><dd>Re-inserting <code class="inline-code">id: 1</code> fails <code class="inline-code">E_UNIQUE</code> inside the engine, not in app code.</dd></div>
            <div class="dl-row"><dt>Foreign key ⇒ real FK</dt><dd><code class="inline-code">links to folks.id</code> is checked on every insert (<code class="inline-code">E_FK</code> on violation) and survives WAL recovery.</dd></div>
            <div class="dl-row"><dt>Left join ⇒ null extension</dt><dd>Unmatched customers get null-extended rows, then <code class="inline-code">when runs.rid is null</code> keeps exactly the ordering-free ones. Same snapshot for both sides of the join.</dd></div>
            <div class="dl-row"><dt>Index ⇒ you can see it</dt><dd><code class="inline-code">add index ix_name on folks(name)</code> then <code class="inline-code">spill pull … when name = 'Ada'</code> prints <code class="inline-code">IndexPoint(folks.ix_name) -&gt; Filter -&gt; Project</code> instead of a heap scan.</dd></div>
            <div class="dl-row"><dt>Evidence ⇒ receipt</dt><dd>Each drop in writes a statement+plan fingerprint into the WAL, so the answer is reproducible with the digests it committed with.</dd></div>
          </dl>
          <p class="lede" style="margin-top:12px">Try it now — <a href="/ide.html">open the SQL IDE</a>, paste, run. Result pane returns <code class="inline-code">Grace, Linus</code>.</p>
        </article>
      </div>
    </div>
  </section>`;
}

/** Self-verifying flag: the lab/IDE can run this against engine results. */
export function comparisonHtml(): string {
  const rows: Array<[string, string, string]> = [
    ["Data model", "Key-value blobs + ephemeral structures; server decides semantics", "Typed relational store with schema, indexes, constraints, MVCC"],
    ["Durability", "Optional persistence (AOF/RDB snapshots); data loss windows are normal", "Every commit is durable WAL before ack; crash matrix proves byte-exact recovery"],
    ["Query language", "Command verbs (GET/SET/HGETALL), no joins", "SEAMQL: lexer/parser/resolver/planner we wrote from scratch — joins, aggregates, casts, policies"],
    ["Isolation", "Single-threaded event loop; no snapshot semantics between commands", "Snapshot isolation with visible history; aborted writes demonstrably vanish"],
    ["Corruption response", "Best-effort rewrite; what you get back is what survived", "CRC every page and WAL record; fail closed with named error codes, repair from log"],
    ["Trust story", "Trust the process memory; no receipts, no export proofs", "Evidence event per commit (statement/plan/write-set digests); offline capsule verifier; tamper → FAIL"],
    ["Honest role", "Battle-tested cache/message broker — keep it", "Not competing on microsecond latency; competes on proof-carrying custody"],
  ];
  const head = `<table class="checks compare"><thead><tr><th>Dimension</th><th>Redis</th><th>SEAMDB</th></tr></thead><tbody>`;
  const body = rows.map(([k, r, s]) => `<tr><td>${k}</td><td>${r}</td><td>${s}</td></tr>`).join("");
  return `
  <section class="section" id="whynot-redis">
    <div class="wrap reveal">
      ${sectionHead(
        "2.5 vs Redis →",
        "Different problem, different tool.",
        "Cache vs. custody.",
        "Redis is a superb in-memory data structure server; it was never asked to produce export evidence. SEAMDB is a source of record: every write carries its own proof, every read can be explained, and the store refuses to serve what failed checksums.",
      )}
      ${head}${body}</tbody></table>
    </div>
  </section>`;
}

export function schemaSection(): string {
  return `
  <section class="section" id="big-schema">
    <div class="wrap reveal">
      ${sectionHead(
        "7.5 Full schematic →",
        "One diagram, no hand-waving.",
        "Query path · storage path · evidence path.",
        "Everything drawn here is a file you can open: lexer on the left, WAL on the bottom right, evidence events on the bottom left. This is the same dataflow the verifier walks offline.",
      )}
      <div class="frame">
        <div class="frame-inner">
          <div class="chrome"><span class="file">schema.svg</span><span class="lang">hand-drawn · no AI imagery</span></div>
          <div class="figure">${schemaSvg()}</div>
        </div>
      </div>
    </div>
  </section>`;
}


