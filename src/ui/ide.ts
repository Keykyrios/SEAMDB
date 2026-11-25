/**
 * The SQL IDE section of the landing page — a real editor wired to the real
 * engine. No mock data, no simulated results: `Database` + `MemoryPager` from
 * src/db execute the SEAMQL the user types, and every pane shows what the
 * engine actually returned (typed rows, plan text, xid, commit LSN, evidence
 * state, or a typed E_* error). Statements run one at a time so a failure
 * mid-script is visible per statement — the engine stops the failing statement,
 * the page keeps going, and nothing is swallowed: the error code, message and
 * source position are rendered verbatim.
 */

import { Database, type QueryResult } from "../db/engine";
import { MemoryPager } from "../db/pager";
import { parse } from "../db/parser";
import { displayValue } from "../db/values";
import { IDE_SNIPPETS } from "./snippets";

const KIND_LABEL: Record<string, string> = {
  spawn: "create table",
  index: "add index",
  dropin: "insert",
  tweak: "update",
  yeet: "delete",
  pull: "query",
  start: "begin tx",
  lockin: "commit tx",
  dip: "rollback",
  spill: "explain",
  let: "grant",
  block: "revoke",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface ErrorCard {
  code: string;
  message: string;
  position: string | null;
}

function asErrorCard(e: unknown, position: string | null): ErrorCard {
  const any = e as { code?: string; message?: string };
  return {
    code: typeof any?.code === "string" ? any.code : "E_INTERNAL",
    message: typeof any?.message === "string" ? any.message : String(e),
    position,
  };
}

export class SqlIde {
  private db: Database | null = null;
  private running = false;

  constructor(private root: HTMLElement) {}

  wire(): void {
    const ed = this.editor();
    if (!ed) return;
    this.showSnippet("lc183"); // the LeetCode 183 script the proof section names
    this.setStatus("idle", "ready · in-memory session");

    this.root.querySelector("#ide-run")?.addEventListener("click", () => void this.run());
    this.root.querySelector("#ide-reset")?.addEventListener("click", () => void this.reset());
    this.root.querySelectorAll<HTMLElement>("[data-snippet]").forEach((btn) => {
      btn.addEventListener("click", () => this.showSnippet(btn.dataset.snippet!));
    });
    ed.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        ev.preventDefault();
        void this.run();
      }
    });
  }

  private editor(): HTMLTextAreaElement | null {
    return this.root.querySelector("#ide-editor");
  }

  private showSnippet(id: string): void {
    const snip = IDE_SNIPPETS[id];
    const ed = this.editor();
    if (!snip || !ed) return;
    ed.value = snip.code;
    this.root.querySelectorAll<HTMLElement>("[data-snippet]").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.snippet === id);
    });
  }

  private setStatus(kind: string, text: string): void {
    const el = this.root.querySelector("#ide-status");
    if (!el) return;
    el.className = `lang ide-status is-${kind}`;
    el.textContent = text;
  }

  private setTxChip(): void {
    const el = this.root.querySelector("#ide-tx");
    if (!el) return;
    if (!this.db) {
      el.textContent = "autocommit";
      return;
    }
    const tx = this.db.txInfo();
    el.textContent = tx.open ? `xid ${tx.xid}${tx.explicit ? " (explicit)" : ""}` : "autocommit";
  }

  private out(html: string): void {
    const host = this.root.querySelector("#ide-out");
    if (host) host.innerHTML = html;
  }

  async run(): Promise<void> {
    if (this.running) return;
    const ed = this.editor();
    if (!ed) return;
    this.running = true;
    const runBtn = this.root.querySelector<HTMLButtonElement>("#ide-run");
    if (runBtn) runBtn.disabled = true;
    this.setStatus("busy", "running…");
    const t0 = performance.now();
    try {
      if (!this.db) this.db = await Database.open(new MemoryPager());
      const source = ed.value;
      const html = await this.execute(source);
      const ms = (performance.now() - t0).toFixed(1);
      this.out(html);
      const failed = (html.match(/class="ide-card err"/g) ?? []).length;
      if (failed) this.setStatus("err", `${failed} statement${failed > 1 ? "s" : ""} failed · ${ms} ms`);
      else this.setStatus("ok", `ok · ${ms} ms`);
    } catch (e) {
      this.out(this.errorCardHtml(asErrorCard(e, null)));
      this.setStatus("err", "failed");
    } finally {
      this.setTxChip();
      this.running = false;
      if (runBtn) runBtn.disabled = false;
    }
  }

  /** Parse once, then execute statement by statement so every failure is local. */
  private async execute(source: string): Promise<string> {
    if (!source.trim()) return `<div class="ide-card"><div class="ide-empty">Editor is empty. Pick a script below, or write SEAMQL.</div></div>`;
    let spans: Array<{ k: string; offset: number }>;
    try {
      spans = parse(source).map((s) => ({ k: s.k, offset: s.span.offset }));
    } catch (e) {
      const any = e as { code?: string; message?: string; line?: number; column?: number };
      const pos = typeof any?.line === "number" ? `${any.line}:${any.column ?? 0}` : null;
      return this.errorCardHtml({
        code: typeof any?.code === "string" ? any.code : "E_SYNTAX",
        message: typeof any?.message === "string" ? any.message : String(e),
        position: pos,
      });
    }
    const cards: string[] = [];
    for (let i = 0; i < spans.length; i++) {
      const start = spans[i].offset;
      const end = i + 1 < spans.length ? spans[i + 1].offset : source.length;
      const chunk = source.slice(start, end);
      const t0 = performance.now();
      try {
        // Each chunk is a real engine call: parse → typecheck → execute.
        const results = await this.db!.exec(chunk);
        for (const r of results) cards.push(this.resultCardHtml(spans[i].k, chunk, r, performance.now() - t0));
      } catch (e) {
        const any = e as { line?: number; column?: number };
        const pos = typeof any?.line === "number" ? `${any.line}:${any.column ?? 0}` : null;
        cards.push(this.errorCardHtml(asErrorCard(e, pos)));
      }
    }
    return cards.join("");
  }

  private resultCardHtml(kind: string, chunk: string, r: QueryResult, ms: number): string {
    const label = KIND_LABEL[kind] ?? kind;
    const first = chunk.trim().split("\n")[0].trim();
    const head = `<div class="ide-card-head"><span class="kind">${esc(label)}</span><span class="src">${esc(first.length > 64 ? `${first.slice(0, 64)}…` : first)}</span><span class="ms">${ms.toFixed(1)} ms</span></div>`;
    let body: string;
    if (r.columns.length) {
      const headRow = r.columns.map((c) => `<th>${esc(c)}</th>`).join("");
      const rows = r.rows
        .map((row) => `<tr>${row.map((v) => `<td>${esc(displayValue(v))}</td>`).join("")}</tr>`)
        .join("");
      const empty = r.rows.length ? "" : `<tr><td colspan="${r.columns.length}" class="ide-empty">0 rows</td></tr>`;
      body = `<div class="ide-table-wrap"><table class="ide-table"><thead><tr>${headRow}</tr></thead><tbody>${rows}${empty}</tbody></table></div>`;
    } else {
      body = `<div class="ide-ok">ok</div>`;
    }
    const plan = r.plan ? `<pre class="ide-plan">${esc(r.plan)}</pre>` : "";
    const meta = `<div class="ide-meta"><span>xid ${esc(r.xid)}</span><span>lsn ${r.commit_lsn ? esc(r.commit_lsn) : "—"}</span><span>evidence ${esc(r.evidence_state)}</span></div>`;
    return `<div class="ide-card">${head}${body}${plan}${meta}</div>`;
  }

  private errorCardHtml(e: ErrorCard): string {
    const pos = e.position ? `<span class="pos">${esc(e.position)}</span>` : "";
    return `<div class="ide-card err"><div class="ide-card-head"><span class="kind">${esc(e.code)}</span>${pos}</div><div class="ide-err-msg">${esc(e.message)}</div><div class="ide-meta"><span>fail-closed · the failing statement did not write</span></div></div>`;
  }

  async reset(): Promise<void> {
    if (this.db) {
      try {
        await this.db.close();
      } catch {
        // close is best-effort on reset; a fresh pager follows anyway
      }
    }
    this.db = null;
    this.out("");
    this.setStatus("idle", "fresh session · in-memory");
    this.setTxChip();
  }
}
