import { sectionHead } from "../ui/widgets";
import { IDE_SNIPPETS } from "../ui/snippets";
import { chromeNav, chromeFooter } from "../ui/site";

/** Full-page SQL IDE. The editor is wired by SqlIde from src/ui/ide.ts. */
export function idePageHtml(): string {
  const snipBtns = Object.entries(IDE_SNIPPETS)
    .map(([id, s]) => `<button type="button" class="ide-snip" data-snippet="${id}">${s.label}</button>`)
    .join("");

  return `
  ${chromeNav("ide")}

  <main id="top">
    <section class="wrap hero hero-slim">
      <div>
        <h1>The SQL IDE.<span class="rest"> Real engine, real SEAMQL, no mocks.</span></h1>
        <p class="lede">This is the same engine the Node tests run: B+tree storage, MVCC snapshots, buffered I/O, typed E_* errors. Paste a script, run, and the result pane returns what the engine actually produced — typed rows, physical plans, xid, commit LSN, evidence state, or a typed E_* error with source position.</p>
        <div class="hero-actions">
          <a class="btn btn-ghost" href="/docs.html#grammar">SEAMQL grammar →</a>
          <a class="btn btn-ghost" href="/docs.html#drivers">Python driver →</a>
        </div>
      </div>
    </section>

    <section class="section" id="ide" style="padding-top:8px">
      <div class="wrap reveal is-in">
        ${sectionHead("IDE session →", "Fail-closed by construction.", "A failed statement writes nothing.", "Each statement executes on its own so a failure mid-script is visible per statement. In-memory session; nothing leaves the tab.")}
        <div class="ide-shell">
          <div class="frame">
            <div class="frame-inner">
              <div class="chrome">
                <span class="file">seamql · browser session</span>
                <span class="lang ide-status is-idle" id="ide-status">ready</span>
              </div>
              <textarea id="ide-editor" class="ide-editor" rows="14" spellcheck="false" aria-label="SEAMQL editor" placeholder="spawn table t: id: whole number, main key, needed"></textarea>
              <div class="ide-bar">
                <button class="btn btn-primary" type="button" id="ide-run">Run</button>
                <button class="btn btn-ghost" type="button" id="ide-reset">New session</button>
                <span class="ide-tx" id="ide-tx">autocommit</span>
                <span class="ide-hint">⌘⏎ / Ctrl+Enter runs · each statement executes on its own</span>
                <div class="ide-snips">${snipBtns}</div>
              </div>
              <div class="ide-out" id="ide-out"></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>

  ${chromeFooter()}`;
}
