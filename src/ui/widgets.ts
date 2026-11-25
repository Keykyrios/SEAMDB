import { highlightShell, highlightTs, highlightSeamql } from "./highlight";

const COPY_SVG = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor"/><path d="M10.5 5.5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8A1.3 1.3 0 0 0 2.5 3.8v5.4A1.3 1.3 0 0 0 3.8 10.5H5.5" stroke="currentColor"/></svg>`;
const CHECK_SVG = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" stroke-width="1.5"/></svg>`;

export function copyButton(text: string, label = "Copy code"): string {
  return `<button type="button" class="copy" data-copy="${encodeURIComponent(text)}" aria-label="${label}">${COPY_SVG}</button>`;
}

export function wireCopy(root: ParentNode): void {
  root.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-copy]");
    if (!btn) return;
    const text = decodeURIComponent(btn.dataset.copy ?? "");
    await navigator.clipboard.writeText(text);
    btn.innerHTML = CHECK_SVG;
    btn.setAttribute("aria-label", "Copied");
    const live = document.getElementById("copy-live");
    if (live) live.textContent = "Copied";
    window.setTimeout(() => {
      btn.innerHTML = COPY_SVG;
      btn.setAttribute("aria-label", "Copy code");
      if (live) live.textContent = "";
    }, 1200);
  });
}

export function codeFrame(opts: {
  filename: string;
  lang: string;
  code: string;
  highlightLine?: number;
  fade?: boolean;
  mode?: "ts" | "shell" | "seamql";
}): string {
  const lines = opts.code.replace(/\n$/, "").split("\n");
  const paint =
    opts.mode === "shell" ? highlightShell
      : opts.mode === "seamql" ? highlightSeamql
        : highlightTs;
  const body = lines
    .map((line, i) => {
      const n = i + 1;
      const hi = opts.highlightLine === n ? " hi" : "";
      return `<div class="code-line${hi}"><span class="ln" aria-hidden="true">${n}</span><span>${paint(line)}</span></div>`;
    })
    .join("");
  const fade = opts.fade ? " fade-mask" : "";
  return `<div class="frame"><div class="frame-inner">
    <div class="chrome">
      <span class="file">${opts.filename}</span>
      <span class="lang">${opts.lang}</span>
      ${copyButton(opts.code)}
    </div>
    <pre class="code${fade}"><code lang="${opts.lang}">${body}</code></pre>
  </div></div>`;
}

export function sectionHead(index: string, title: string, rest: string, desc: string): string {
  return `<header class="section-head">
    <h2>${title} <span class="rest">${rest}</span></h2>
    <div class="desc">
      <p class="desc">${desc}</p>
      <p class="index-line">${index}</p>
    </div>
  </header>`;
}

export function wireReveal(root: ParentNode): void {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const nodes = [...root.querySelectorAll(".reveal")];
  if (reduce) {
    for (const n of nodes) n.classList.add("is-in");
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12 },
  );
  for (const n of nodes) io.observe(n);
}

let navScrollWired = false;

export function wireNav(): void {
  const onScroll = () => {
    const nav = document.querySelector(".nav");
    if (nav) nav.classList.toggle("is-raised", window.scrollY > 8);
  };
  onScroll();
  // the landing page is re-rendered when leaving the IDE; register the window
  // listener once and let it find the current nav
  if (navScrollWired) return;
  navScrollWired = true;
  window.addEventListener("scroll", onScroll, { passive: true });
}
