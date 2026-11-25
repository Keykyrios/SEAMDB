import { codeFrame, sectionHead } from "../ui/widgets";
import { highlightSeamql } from "../ui/highlight";
import { IDE_SNIPPETS, LC183_SEAMQL } from "../ui/snippets";
import { chromeNav, chromeFooter } from "../ui/site";

/**
 * The docs hub: five short reference docs, deep-linkable, each with highlighted
 * examples that reuse the exact snippets the IDE and tests execute so the docs
 * cannot silently drift from the code.
 */
/** Syntax column of the grammar table — every cell is live-highlighted SEAMQL. */
function hl(s: string): string {
  return `<code class="inline-code">${highlightSeamql(s)}</code>`;
}

export function docsPageHtml(): string {
  const lc = IDE_SNIPPETS.lc183.code;

  return `
  ${chromeNav("docs")}

  <main id="top">
    <section class="wrap hero hero-slim">
      <div>
        <h1>Docs.<span class="rest"> Short, runnable, honest.</span></h1>
        <p class="lede">Five references, each deep-linkable. Every SEAMQL example on this page is executed by the test suite — <code class="inline-code">LC183_SEAMQL</code> runs verbatim in CI — so a doc that drifts from the engine is a broken build, not a broken promise.</p>
        <div class="hero-actions">
          <a class="btn btn-ghost" href="/docs.html#grammar">Grammar</a>
          <a class="btn btn-ghost" href="/docs.html#cli">CLI</a>
          <a class="btn btn-ghost" href="/docs.html#drivers">Drivers</a>
          <a class="btn btn-ghost" href="/docs.html#format">On-disk format</a>
          <a class="btn btn-ghost" href="/index.html#how">Control-plane API</a>
        </div>
      </div>
    </section>

    <section class="section" id="quickstart">
      <div class="wrap reveal is-in">
        ${sectionHead("0 · Quickstart →", "Five minutes, end to end.", "Boot a database, insert, query.", "Node/TypeScript uses the engine in-process. A Python driver speaks the framed protocol (below). Nothing else is required to run this snippet.")}
        ${codeFrame({ filename: "quickstart.seamql", lang: "SEAMQL", mode: "seamql", code: lc })}
        <p class="lede">Run it right now in <a href="/ide.html">the SQL IDE</a> — same script, same engine.</p>
      </div>
    </section>

    <section class="section" id="grammar">
      <div class="wrap reveal">
        ${sectionHead("1 · SEAMQL grammar →", "Canonical surface + frozen aliases.", "Readable without documentation.", "SEAMQL renames the tired SQL words but keeps their discipline. DDL is spawn; inserts are drop in; selects are pull; filters are when. The gherkin table below is the whole surface.")}
        <div class="frame"><div class="frame-inner"><div style="overflow-x:auto">
          <table class="checks">
            <thead><tr><th>Statement</th><th>Syntax</th><th>Errors it can raise</th></tr></thead>
            <tbody>
              <tr><td>Create table</td><td>${hl("spawn table folks: id: whole number, main key, name: text, needed")}</td><td>E_SYNTAX · E_UNKNOWN_NAME · E_EXIST</td></tr>
              <tr><td>Insert</td><td>${hl("drop in folks { id: 1, name: 'Ada' }")}</td><td>E_UNIQUE · E_FK · E_TYPE · E_UNKNOWN_NAME</td></tr>
              <tr><td>Update</td><td>${hl("tweak folks set name = 'Grace' when id = 2")}</td><td>E_TYPE · E_UNIQUE · E_UNKNOWN_NAME</td></tr>
              <tr><td>Delete</td><td>${hl("yeet from folks when id = 3")}</td><td>E_FK referenced by others</td></tr>
              <tr><td>Select</td><td>${hl("pull folks.name as customers from folks left link runs on folks.id = runs.folks_id when runs.rid is null")}</td><td>E_UNKNOWN_NAME · E_TYPE (resolve-time)</td></tr>
              <tr><td>Group / rank</td><td>${hl("pull dept, tally(1) as headcount from folks bunch by dept")}</td><td>E_UNKNOWN_NAME</td></tr>
              <tr><td>Order / cap</td><td>${hl("… rank by amount high to low cap 10 skip 5")}</td><td>—</td></tr>
              <tr><td>Index</td><td>${hl("add index ix_name on folks (name)")}</td><td>E_UNKNOWN_NAME</td></tr>
              <tr><td>Plan</td><td>${hl("spill pull id from folks when id = 1")}</td><td>— (prints physical plan)</td></tr>
              <tr><td>Transactions</td><td>${hl("start tx · lockin (commit) · dip (rollback)")}</td><td>E_TX on misuse</td></tr>
            </tbody>
          </table>
        </div></div></div>
        <h3 style="margin-top:24px">The verbs, plainly</h3>
        <p class="lede">SEAMQL's words are chosen to say what they mean: <code class="inline-code">yeet</code> deletes rows, <code class="inline-code">dip</code> aborts a transaction, <code class="inline-code">spill</code> spills the physical plan. If a word surprises you, it is on this list with what it does and the SQL word it replaces.</p>
        <div class="frame"><div class="frame-inner"><div style="overflow-x:auto">
          <table class="checks">
            <thead><tr><th>SEAMQL</th><th>SQL again</th><th>What it does</th></tr></thead>
            <tbody>
              <tr><td>${hl("spawn table t: ...")}</td><td>CREATE TABLE</td><td>Register a typed table in the catalog (DDL is itself a WAL-logged catalog write).</td></tr>
              <tr><td>${hl("drop in t { id: 1, name: 'Ada' }")}</td><td>INSERT INTO</td><td>Insert a row; main-key duplicates fail E_UNIQUE, dangling foreign keys fail E_FK.</td></tr>
              <tr><td>${hl("tweak t set x = 1 when id = 2")}</td><td>UPDATE</td><td>Rewrite columns of matching rows inside the same transaction snapshot.</td></tr>
              <tr><td>${hl("yeet from t when id = 2")}</td><td>DELETE FROM</td><td>Delete rows. A row a foreign key references cannot be yeeted.</td></tr>
              <tr><td>${hl("pull name from t when id = 1")}</td><td>SELECT</td><td>Read rows. <code class="inline-code">from</code> declares the source, <code class="inline-code">when</code> filters.</td></tr>
              <tr><td>${hl("left link o on t.id = o.t_id")}</td><td>LEFT JOIN</td><td>Join tables; unmatched outer rows null-extend. Plain <code class="inline-code">link</code> = inner join.</td></tr>
              <tr><td>${hl("bunch by dept")}</td><td>GROUP BY</td><td>Group rows for aggregates like <code class="inline-code">tally(1)</code> (count).</td></tr>
              <tr><td>${hl("rank by amount high to low cap 10 skip 5")}</td><td>ORDER BY ... LIMIT/OFFSET</td><td><code class="inline-code">rank by</code> sorts, <code class="inline-code">high to low</code>/<code class="inline-code">low to high</code> set direction, <code class="inline-code">cap</code> limits, <code class="inline-code">skip</code> offsets.</td></tr>
              <tr><td>${hl("add index ix_name on t (name)")}</td><td>CREATE INDEX</td><td>Build a B+tree secondary index; later spills show the plan flip to IndexPoint.</td></tr>
              <tr><td>${hl("spill pull id from t")}</td><td>EXPLAIN</td><td>Print the physical plan the planner chose — the exercise is not hidden from you.</td></tr>
              <tr><td>${hl("start tx · lockin · dip")}</td><td>BEGIN / COMMIT / ROLLBACK</td><td><code class="inline-code">start tx</code> opens a transaction, <code class="inline-code">lockin</code> commits it, <code class="inline-code">dip</code> aborts — aborted writes vanish.</td></tr>
              <tr><td>${hl("let role r to pull t")}</td><td>GRANT</td><td>Hand a privilege (pull/tweak/yeet/…) on a table (or t.col) to a role; optionally <code class="inline-code">when</code> a row predicate. <code class="inline-code">block role r to pull t</code> revokes.</td></tr>
              <tr><td>${hl("ship folks sealed 'glass.seam'")}</td><td>EXPORT</td><td>The release gate: writes the table's sealed capsule; the export must carry its proof before anything leaves (alias: <code class="inline-code">export</code>).</td></tr>
              <tr><td>${hl("tally(x) / stack(x)")}</td><td>COUNT / SUM</td><td>Aggregates: <code class="inline-code">tally</code> counts, <code class="inline-code">stack</code> totals.</td></tr>
              <tr><td>${hl("whole number / decimal / text / stamp")}</td><td>INT / DECIMAL / TEXT / TIMESTAMP</td><td>Typed columns. <code class="inline-code">main key</code>, <code class="inline-code">needed</code>, <code class="inline-code">unique</code>, <code class="inline-code">fallback</code> follow the type.</td></tr>
            </tbody>
          </table>
        </div></div></div>
        <div class="how-grid">
          <article class="how-col">
            <h3>Joins</h3>
            <p><code class="inline-code">link</code> is inner join; prefix it: <code class="inline-code">left link</code>, <code class="inline-code">right link</code>, <code class="inline-code">full link</code>, <code class="inline-code">cross link</code>. The condition follows <code class="inline-code">on</code>; unmatched outer rows null-extend.</p>
          </article>
          <article class="how-col">
            <h3>Types</h3>
            <p><code class="inline-code">whole number</code> (int64), <code class="inline-code">decimal(p, s)</code>, <code class="inline-code">text</code>, <code class="inline-code">yesno</code>, <code class="inline-code">stamp</code>/<code class="inline-code">day</code>. Column flags after types: <code class="inline-code">main key</code>, <code class="inline-code">needed</code>, <code class="inline-code">unique</code>, <code class="inline-code">fallback n</code>.</p>
          </article>
          <article class="how-col">
            <h3>Windows</h3>
            <p>Window functions run over an ordered frame: <code class="inline-code">rank() over (rank by amount high to low)</code> as a named column, typed at resolve time; <code class="inline-code">JSON.stringify</code>-style crash-on-bigint is a bug, not semantics.</p>
          </article>
        </div>
      </div>
    </section>

    <section class="section" id="cli">
      <div class="wrap reveal">
        ${sectionHead("2 · CLI →", "Same code as the lab.", "Exit 0 only on full PASS.", "The verifier never touches the network. INDETERMINATE exits non-zero: an incomplete proof is not a release signal.")}
        <div class="frame"><div class="frame-inner"><div style="overflow-x:auto">
          <table class="checks">
            <thead><tr><th>Command</th><th>What it does</th><th>Exit codes</th></tr></thead>
            <tbody>
              <tr><td><code class="inline-code">npm run verify</code></td><td>Seal a capsule over the synthetic estate and verify it offline through every named check.</td><td>0 PASS · 1 FAIL/INDETERMINATE</td></tr>
              <tr><td><code class="inline-code">npm run vectors</code></td><td>Known-answer test vectors for hash, canonicalization, Merkle and capsule paths.</td><td>0 all pass · 1 mismatch</td></tr>
              <tr><td><code class="inline-code">npm run attacks</code></td><td>The seeded attack gallery: tamper, replay, stale policy, missing witness, PQ overclaim…</td><td>0 all blocked · 1 leak</td></tr>
              <tr><td><code class="inline-code">npm test</code></td><td>Full Node engine suite: parser, resolver, planner, MVCC, WAL, crash matrix, protocol, drivers.</td><td>0 pass · failing test aborts</td></tr>
            </tbody>
          </table>
        </div></div></div>
        ${codeFrame({ filename: "verify.ts", lang: "TypeScript", code: `import { verifyBundle } from "./engine/verifier";\n\n// offline: no network in the verifier path\nconst result = await verifyBundle(bundle);\nconsole.log(result.verdict); // "PASS" | "FAIL" | "INDETERMINATE"\nprocess.exitCode = result.verdict === "PASS" ? 0 : 1;` })}
      </div>
    </section>

    <section class="section" id="drivers">
      <div class="wrap reveal">
        ${sectionHead("3 · Drivers →", "In-process or over the wire.", "Same instance contract, both paths.", "TypeScript embeds the engine directly. Python opens a framed socket session (the same protocol the engine exposes) and raises typed SeamError with the E_* code, message and position.")}
        <div class="how-grid">
          <article class="how-col">
            <h3>TypeScript (in-process)</h3>
            ${codeFrame({ filename: "app.ts", lang: "TypeScript", code: `import { Database } from "./src/db/engine";\nimport { FilePager } from "./src/db/file-pager";\n\nconst db = await Database.open(new FilePager("estate.seam"));\nawait db.exec("spawn table t: id: whole number, main key, needed");\nawait db.exec("drop in t { id: 1 }");\nfor (const r of (await db.exec("pull id from t")).flat()) {\n  console.log(r.columns, r.rows); // typed, BigInt preserved\n}\nawait db.close();` })}
          </article>
          <article class="how-col">
            <h3>Python (framed socket protocol)</h3>
            ${codeFrame({ filename: "app.py", lang: "Python", code: `from seamdb import SeamError, connect\n\nwith connect("localhost", 7772) as db:\n    db.run("spawn table t: id: whole number, main key, needed")\n    db.run("drop in t { id: 1 }")\n    rows = db.query("pull id from t")\n\ntry:\n    db.run("drop in t { id: 1 }")          # duplicate main key\nexcept SeamError as e:\n    print(e.code, e.message, e.position)   # E_UNIQUE failure, typed` })}
            <p class="lede">The driver catalogs the schema on connect (CATALOG frame) so autocompletion-aware clients can introspect types without another round trip.</p>
          </article>
        </div>
      </div>
    </section>

    <section class="section" id="format">
      <div class="wrap reveal">
        ${sectionHead("4 · On-disk format →", "One file format, one log.", "CRC every read, fail closed.", "Six facts about the bytes: what a page is, how tuples get versions, where the WAL ends, and why every read can fail closed.") }
        <dl class="dl">
          <div class="dl-row"><dt>Pages</dt><dd>16,384 bytes, CRC32 checked on every read, page ids are logical, heap and B+tree share one file.</dd></div>
          <div class="dl-row"><dt>Tuples</dt><dd><code class="inline-code">xmin/xmax</code> MVCC heap tuples; snapshot isolation with visible history; aborts write nothing.</dd></div>
          <div class="dl-row"><dt>B+tree</dt><dd>Leaf and internal splits with sibling chains; unique keys are storage-enforced (E_UNIQUE from the engine).</dd></div>
          <div class="dl-row"><dt>WAL</dt><dd>Per-record CRC32, torn tail recovery, checkpoint then rotate at 4 MiB, commits are durable-before-ack.</dd></div>
          <div class="dl-row"><dt>Evidence</dt><dd>Each committed statement writes a statement fingerprint + plan fingerprint + write set into the same WAL (W_EVIDENCE).</dd></div>
          <div class="dl-row"><dt>Encryption</dt><dd>AES-256-GCM envelope keys; page payloads authenticated, nonces are per-record and monotonic.</dd></div>
        </dl>
      </div>
    </section>

    <section class="section" id="lib183">
      <div class="wrap reveal">
        ${sectionHead("5 · Worked example →", "LeetCode 183, in SEAMQL.", "The page cannot drift from the engine.", "This exact script runs in the browser IDE and in CI. LEFT link null-extends, then the filter keeps every customer with no order.")}
        ${codeFrame({ filename: "lc183.seamql", lang: "SEAMQL", mode: "seamql", code: LC183_SEAMQL })}
      </div>
    </section>
  </main>

  ${chromeFooter()}`;
}
