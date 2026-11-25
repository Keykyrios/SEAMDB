/**
 * Shared chrome for the multi-page site: one nav, one footer, one wiring pass,
 * used by every entry point (src/main.ts, src/pages/*). Keeping this in one
 * module is what makes the pages coherent — same nav highlight rules, same
 * reveal-on-scroll, same copy buttons — instead of five drifting copies.
 */

export type PageId = "home" | "ide" | "lab" | "specs" | "docs";

export const PAGE_TITLES: Record<PageId, string> = {
  home: "SEAMDB — Proof-carrying evidence plane",
  ide: "SQL IDE · SEAMDB",
  lab: "SECP Lab · SEAMDB",
  specs: "Specs & architecture · SEAMDB",
  docs: "Docs · SEAMDB",
};

export function navHref(page: PageId): string {
  return page === "home" ? "/" : `/${page}.html`;
}

/** One nav for every page. `active` is "home" | "ide" | "lab" | "specs" | "docs". */
export function chromeNav(active: PageId): string {
  const link = (page: PageId, label: string) =>
    `<a href="${navHref(page)}"${page === active ? ' aria-current="page" class="is-on"' : ""}>${label}</a>`;
  return `
  <div class="nav">
    <a class="wordmark" href="/">SEAMDB</a>
    <div class="nav-links">
      ${link("home", "Home")}
      ${link("ide", "SQL IDE")}
      ${link("lab", "SECP Lab")}
      ${link("specs", "Specs")}
      ${link("docs", "Docs")}
      <a class="btn btn-primary" href="/lab.html">Run verifier</a>
    </div>
  </div>`;
}

export function chromeFooter(meta = "seamdb/0.1.0 · SHA-384 · SECP/0.1 · SYNTHETIC"): string {
  return `
  <footer class="wrap footer">
    <div>
      <a class="wordmark" href="/">SEAMDB</a>
      <p>Proof-carrying evidence plane. Overlay, not a database engine.</p>
      <p class="foot-meta" id="foot-meta">${meta}</p>
      <p class="foot-genauix">A product of <a href="https://genauix.github.io/" target="_blank" rel="noopener">Genauix</a> · by <span class="foot-author">Mitrajit Ghorui</span></p>
    </div>
    <div>
      <p><a href="/docs.html">Docs</a></p>
      <p><a href="/ide.html">SQL IDE</a></p>
      <p><a href="/lab.html">Lab</a></p>
    </div>
    <div>
      <p><a href="/specs.html#architecture">Architecture</a></p>
      <p><a href="/specs.html#crypto">Crypto</a></p>
      <p><a href="/lab.html#attacks">Attacks</a></p>
    </div>
    <div>
      <p><a href="/docs.html#cli">CLI</a></p>
      <p><a href="/docs.html#grammar">Grammar</a></p>
      <p><a href="/index.html#how">API</a></p>
    </div>
  </footer>
  <div class="sr-only" id="copy-live" aria-live="polite"></div>`;
}

/** Everything every page needs, regardless of the page-specific app. */
export function wireChrome(): void {
  wireNavScroll();
  wireAnchors();
}

function wireNavScroll(): void {
  const nav = document.querySelector(".nav");
  if (!nav) return;
  const onScroll = () => nav.classList.toggle("is-raised", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

/** Cross-page anchors: /lab.html#attacks etc. — scroll past the fixed nav. */
function wireAnchors(): void {
  const hash = window.location.hash;
  if (!hash) return;
  const target = document.querySelector(hash);
  if (target) target.scrollIntoView();
}
