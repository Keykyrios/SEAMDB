import "./ui/styles.css";
import { homeHtml } from "./pages/home";
import { idePageHtml } from "./pages/ide";
import { labPageHtml } from "./pages/lab";
import { specsPageHtml } from "./pages/specs";
import { docsPageHtml } from "./pages/docs";
import { PAGE_TITLES, wireChrome } from "./ui/site";
import { wireCopy, wireReveal } from "./ui/widgets";
import { wireAeroShards, wireCountUp, wireCrosshair, wireGridScan, wireStaggeredMenu, rotatingText } from "./ui/motion";
import { LabApp } from "./ui/lab";
import { SqlIde } from "./ui/ide";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

/** Which page is this tab on? Determined from the URL path, not a hash. */
function currentPage(): "home" | "ide" | "lab" | "specs" | "docs" {
  const p = window.location.pathname;
  if (p.startsWith("/ide")) return "ide";
  if (p.startsWith("/lab")) return "lab";
  if (p.startsWith("/specs")) return "specs";
  if (p.startsWith("/docs")) return "docs";
  return "home";
}

const page = currentPage();
document.title = PAGE_TITLES[page];

// Render the right page's chrome + sections, then wire only those present.
root.innerHTML = page === "ide" ? idePageHtml()
  : page === "lab" ? labPageHtml()
  : page === "specs" ? specsPageHtml()
  : page === "docs" ? docsPageHtml()
  : homeHtml();

wireCopy(root);
wireReveal(root);
wireAeroShards(root);
wireGridScan(root);
wireCrosshair(root);
wireStaggeredMenu(root);
wireCountUp(root);
wireChrome();

if (page === "home") {
  rotatingText("hero-rotator", ["regulated exports.", "model releases.", "evidence custody.", "audit trails."]);
}

// The IDE runs the real engine (src/db) against an in-memory pager; on pages
// without its markup, this is a no-op.
if (page === "ide") {
  const ide = new SqlIde(root);
  ide.wire();
}

// The lab boots the real evidence pipeline. On pages without its markup,
// LabApp renders nothing but must still not throw.
if (page === "lab" || page === "specs") {
  const lab = new LabApp(root);
  void lab.start().catch((e: unknown) => {
    console.error("lab boot failed", e);
  });
}
