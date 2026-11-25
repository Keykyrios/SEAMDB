const KEYWORDS = new Set([
  "import",
  "from",
  "const",
  "let",
  "var",
  "await",
  "async",
  "if",
  "else",
  "throw",
  "for",
  "of",
  "in",
  "return",
  "export",
  "new",
  "type",
  "interface",
  "function",
  "class",
  "true",
  "false",
  "null",
  "undefined",
  "as",
  "void",
  "typeof",
]);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function span(cls: string, s: string): string {
  return `<span class="${cls}">${esc(s)}</span>`;
}

export function highlightTs(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      const cut = end === -1 ? src.length : end;
      out += span("tok-cmt", src.slice(i, cut));
      i = cut;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") j += 2;
        else j += 1;
      }
      out += span("tok-str", src.slice(i, Math.min(j + 1, src.length)));
      i = Math.min(j + 1, src.length);
      continue;
    }
    if (/[0-9]/.test(c) && (i === 0 || /[^\w$]/.test(src[i - 1]))) {
      let j = i;
      while (j < src.length && /[0-9._xXa-fA-F]/.test(src[j])) j += 1;
      out += span("tok-num", src.slice(i, j));
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\w$]/.test(src[j])) j += 1;
      const word = src.slice(i, j);
      let k = j;
      while (k < src.length && /\s/.test(src[k])) k += 1;
      if (KEYWORDS.has(word)) out += span("tok-kw", word);
      else if (/^[A-Z][A-Z0-9_]+$/.test(word)) out += span("tok-const", word);
      else if (src[k] === "(") out += span("tok-fn", word);
      else out += span("tok-plain", word);
      i = j;
      continue;
    }
    out += span("tok-op", c);
    i += 1;
  }
  return out;
}

export function highlightShell(src: string): string {
  return src
    .split("\n")
    .map((line) => {
      if (line.startsWith("#") || line.startsWith("//")) return span("tok-cmt", line);
      const m = line.match(/^(\$\s*)(.*)$/);
      if (m) return span("tok-cmt", m[1]) + span("tok-plain", m[2]);
      return span("tok-op", line);
    })
    .join("\n");
}

/** SEAMQL keywords — canonical surface and frozen aliases (spec/seamql-grammar.md). */
const SEAMQL_KEYWORDS = new Set([
  "spawn", "make", "table",
  "drop", "in", "add", "to", "insert", "into",
  "tweak", "change", "yeet", "remove", "from", "when", "where", "set",
  "pull", "read", "select", "bunch", "group", "by", "having", "rank", "sort", "order",
  "cap", "take", "limit", "skip", "offset", "link", "join", "left", "right", "full",
  "cross", "inner", "outer", "on", "as", "and", "or", "not", "null", "yes", "no",
  "true", "false", "start", "begin", "tx", "transaction", "lock", "lockin", "dip",
  "cancel", "commit", "rollback", "spill", "explain", "check", "verify", "fah", "faah",
  "ship", "export", "sealed", "let", "allow", "block", "deny", "role",
  "main", "primary", "key", "needed", "required", "private", "unique", "fallback",
  "default", "links", "at", "least", "index", "create", "view", "with",
  "union", "all", "intersect", "except", "distinct", "partition", "over",
  "high", "low", "descending", "ascending", "case", "then", "else", "end",
  "exists", "like", "is", "cast", "tally", "stack",
]);

/** SEAMQL type words get their own color. */
const SEAMQL_TYPES = new Set([
  "whole", "number", "text", "decimal", "yesno", "boolean", "stamp", "timestamp", "day", "date",
  "row_number", "dense_rank", "lead", "lag", "sum", "avg", "min", "max", "count", "now", "today",
]);

/** Full SEAMQL highlighting for the site's code frames and the browser IDE. */
export function highlightSeamql(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    // line comment
    if (c === "-" && src[i + 1] === "-") {
      const end = src.indexOf("\n", i);
      const cut = end === -1 ? src.length : end;
      out += span("tok-cmt", src.slice(i, cut));
      i = cut;
      continue;
    }
    // block comment (non-nested)
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const cut = end === -1 ? src.length : end + 2;
      out += span("tok-cmt", src.slice(i, cut));
      i = cut;
      continue;
    }
    // string
    if (c === "'") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") j += 2;
        else if (src[j] === "'") {
          if (src[j + 1] === "'") j += 2; // '' escape
          else {
            j += 1;
            break;
          }
        } else j += 1;
      }
      out += span("tok-str", src.slice(i, Math.min(j, src.length)));
      i = Math.min(j, src.length);
      continue;
    }
    // number
    if (/[0-9]/.test(c) && (i === 0 || /[^\w]/.test(src[i - 1]))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j += 1;
      out += span("tok-num", src.slice(i, j));
      i = j;
      continue;
    }
    // identifier / keyword
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\w]/.test(src[j])) j += 1;
      // dotted upper-words like decimal(12, 2) already split; numbers like 2 handled above
      const word = src.slice(i, j);
      const lower = word.toLowerCase();
      let k = j;
      while (k < src.length && /\s/.test(src[k])) k += 1;
      if (SEAMQL_KEYWORDS.has(lower)) out += span("tok-kw", word);
      else if (SEAMQL_TYPES.has(lower) || src[k] === "(") out += span("tok-fn", word);
      else out += span("tok-plain", word);
      i = j;
      continue;
    }
    out += esc(c);
    i += 1;
  }
  return out;
}
