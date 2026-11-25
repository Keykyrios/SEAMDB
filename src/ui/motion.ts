/**
 * Landing-page motion layer, hand-built in vanilla TS/CSS.
 * Effects are our own implementations of well-known visual idioms (grid scan
 * sweep, crosshair cursor, rotating text, staggered reveal) — no framework,
 * no copied component code, degrades cleanly under reduced motion.
 */

const REDUCE = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Grid-scan background: a fixed grid plane with a light sweep that follows
 * the pointer, like radar across a plotting table. Pure CSS variables +
 * one rAF-throttled pointer listener. */
export function wireGridScan(root: ParentNode): void {
  const host = document.createElement("div");
  host.className = "grid-scan";
  host.setAttribute("aria-hidden", "true");
  host.innerHTML = `<div class="gs-grid"></div><div class="gs-sweep"></div><div class="gs-glow"></div>`;
  document.body.prepend(host);

  if (REDUCE()) return;
  let raf = 0;
  let x = 0.5;
  let y = 0.35;
  const paint = () => {
    host.style.setProperty("--gs-x", `${(x * 100).toFixed(2)}%`);
    host.style.setProperty("--gs-y", `${(y * 100).toFixed(2)}%`);
    raf = 0;
  };
  window.addEventListener(
    "pointermove",
    (e) => {
      x = e.clientX / window.innerWidth;
      y = e.clientY / window.innerHeight;
      if (!raf) raf = requestAnimationFrame(paint);
    },
    { passive: true },
  );
  void root;
}

/** Aero shards: three large gradient shards drifting slowly behind the page,
 * like light off cut glass. Pure CSS animation; frozen under reduced motion. */
export function wireAeroShards(root: ParentNode): void {
  if (document.querySelector(".aero")) return;
  const host = document.createElement("div");
  host.className = "aero";
  host.setAttribute("aria-hidden", "true");
  host.innerHTML = `<i></i><i></i><i></i>`;
  document.body.prepend(host);
  void root;
}

/** Crosshair: hairline rules following the cursor with live coordinates,
 * locking onto interactive elements and measuring them. Hidden on touch. */
export function wireCrosshair(root: ParentNode): void {
  if (REDUCE() || !window.matchMedia("(pointer: fine)").matches) return;
  const el = document.createElement("div");
  el.className = "crosshair";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <span class="ch-v"></span><span class="ch-h"></span>
    <span class="ch-tag ch-tag-v"></span><span class="ch-tag ch-tag-h"></span>
    <span class="ch-box"></span>`;
  document.body.append(el);
  const v = el.querySelector<HTMLElement>(".ch-v")!;
  const h = el.querySelector<HTMLElement>(".ch-h")!;
  const tv = el.querySelector<HTMLElement>(".ch-tag-v")!;
  const th = el.querySelector<HTMLElement>(".ch-tag-h")!;
  const box = el.querySelector<HTMLElement>(".ch-box")!;
  let raf = 0;
  let active = false;

  const measure = (target: HTMLElement | null, cx: number, cy: number) => {
    const hit = target?.closest<HTMLElement>("a, button, .frame, .arch-item");
    if (hit) {
      const r = hit.getBoundingClientRect();
      box.style.cssText = `transform: translate(${r.left}px, ${r.top}px); width:${r.width}px; height:${r.height}px; opacity:1`;
      tv.textContent = `${Math.round(r.width)}×${Math.round(r.height)}`;
      th.textContent = hit instanceof HTMLAnchorElement ? hit.getAttribute("href") ?? "" : "lock";
    } else {
      box.style.opacity = "0";
      tv.textContent = "";
      th.textContent = "";
    }
    void cx;
    void cy;
  };

  window.addEventListener(
    "pointermove",
    (e) => {
      if (!active) {
        active = true;
        el.classList.add("is-on");
      }
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const x = e.clientX;
        const y = e.clientY;
        v.style.transform = `translateX(${x}px)`;
        h.style.transform = `translateY(${y}px)`;
        tv.style.transform = `translate(${x + 8}px, ${8}px)`;
        th.style.transform = `translate(${8}px, ${y + 8}px)`;
        measure(e.target as HTMLElement | null, x, y);
      });
    },
    { passive: true },
  );
  window.addEventListener("pointerdown", () => el.classList.add("is-click"), { passive: true });
  window.addEventListener("pointerup", () => el.classList.remove("is-click"), { passive: true });
  document.documentElement.addEventListener("pointerleave", () => {
    el.classList.remove("is-on");
    active = false;
  });
  void root;
}

/** Rotating text: flips a word stack with a 3D roll, pauses on reduced motion. */
export function rotatingText(id: string, words: string[]): void {
  const host = document.getElementById(id);
  if (!host || host.childElementCount) return;
  host.classList.add("rotator");
  const inner = document.createElement("span");
  inner.className = "rotator-inner";
  host.append(inner);
  let i = 0;
  inner.textContent = words[0];
  const widest = () => {
    inner.style.width = "auto";
    const w = Math.max(...words.map((w2) => (inner.textContent = w2, inner.offsetWidth)));
    inner.textContent = words[i];
    host.style.setProperty("--rot-w", `${w}px`);
  };
  widest();
  if (REDUCE()) return;
  window.setInterval(() => {
    inner.classList.add("is-out");
    window.setTimeout(() => {
      i = (i + 1) % words.length;
      inner.textContent = words[i];
      inner.classList.remove("is-out");
      widest();
    }, 180);
  }, 2200);
}

/** Staggered menu: nav links reveal in a wave after each paint. */
export function wireStaggeredMenu(root: ParentNode): void {
  const links = [...root.querySelectorAll<HTMLElement>(".nav-links > a, .nav-links > .btn")];
  if (REDUCE()) return;
  links.forEach((a, i) => {
    a.style.animation = `menu-stagger 360ms ${80 + i * 55}ms cubic-bezier(.2,.7,.2,1) both`;
  });
}

/** Count-up tabular numerals for the stat band. */
export function wireCountUp(root: ParentNode): void {
  const reduce = REDUCE();
  const num = (el: HTMLElement) => {
    const raw = el.dataset.count ?? "";
    const target = Number(raw);
    if (!raw || Number.isNaN(target)) return;
    const dur = 900;
    const t0 = performance.now();
    const ease = (t: number) => 1 - (1 - t) ** 3;
    const tick = (now: number) => {
      const t = reduce ? 1 : Math.min(1, (now - t0) / dur);
      const val = Math.round(target * ease(t));
      el.textContent = val.toLocaleString("en-US");
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        num(e.target as HTMLElement);
        io.unobserve(e.target);
      }
    }
  }, { threshold: 0.4 });
  root.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => io.observe(el));
}
