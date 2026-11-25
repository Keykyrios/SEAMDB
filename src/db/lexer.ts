import { SeamError, err } from "./errors";
import { utf8dec } from "./codec";

export type TokKind =
  | "IDENT"
  | "NUMBER"
  | "STRING"
  | "EOF"
  | "COMMA"
  | "COLON"
  | "DOT"
  | "LPAREN"
  | "RPAREN"
  | "LBRACE"
  | "RBRACE"
  | "STAR"
  | "EQ"
  | "NE"
  | "LT"
  | "GT"
  | "LE"
  | "GE"
  | "PLUS"
  | "MINUS"
  | "SLASH"
  | "KW";

export interface Token {
  kind: TokKind;
  lexeme: string;
  value?: string | bigint | { unscaled: string; scale: number };
  line: number;
  column: number;
  offset: number;
  kw?: string;
}

const KEYWORDS = new Set(
  [
    "spawn",
    "make",
    "table",
    "index",
    "on",
    "let",
    "allow",
    "block",
    "deny",
    "role",
    "to",
    "pull",
    "read",
    "tweak",
    "change",
    "yeet",
    "remove",
    "drop",
    "in",
    "add",
    "from",
    "when",
    "where",
    "set",
    "link",
    "join",
    "rank",
    "sort",
    "by",
    "cap",
    "take",
    "high",
    "low",
    "descending",
    "ascending",
    "start",
    "begin",
    "tx",
    "transaction",
    "lock",
    "commit",
    "dip",
    "cancel",
    "spill",
    "explain",
    "check",
    "verify",
    "fah",
    "faah",
    "ship",
    "export",
    "sealed",
    "file",
    "whole",
    "number",
    "decimal",
    "text",
    "yesno",
    "boolean",
    "stamp",
    "timestamp",
    "day",
    "date",
    "main",
    "primary",
    "key",
    "private",
    "unique",
    "needed",
    "required",
    "fallback",
    "default",
    "links",
    "at",
    "least",
    "as",
    "and",
    "or",
    "not",
    "is",
    "null",
    "yes",
    "no",
    "true",
    "false",
    "bunch",
    "group",
    "inner",
    "left",
    "cast",
    "select",
    "distinct",
    "having",
    "offset",
    "limit",
    "skip",
    "union",
    "all",
    "intersect",
    "except",
    "with",
    "over",
    "partition",
    "case",
    "then",
    "else",
    "end",
    "exists",
    "like",
    "order",
    "cross",
    "full",
    "outer",
    "right",
    "between",
    "insert",
    "into",
    "values",
    "update",
    "delete",
    "create",
    "view",
  ].map((k) => k),
);

/** Tokenize into `out`, throwing a SeamError at the first bad construct. */
function scanInto(input: string, out: Token[]): void {
  let bytes: Uint8Array;
  try {
    bytes = new TextEncoder().encode(input);
    utf8dec(bytes);
  } catch {
    err("E_BAD_UTF8", "Input is not valid UTF-8.");
  }
  if (input.length > 1024 * 1024) err("E_TOKEN_LIMIT", "Statement exceeds 1 MiB.");

  let i = 0;
  let line = 1;
  let col = 1;

  const peek = (n = 0) => input[i + n] ?? "";
  const bump = (): string => {
    const ch = input[i++];
    if (ch === "\n") {
      line++;
      col = 1;
    } else col++;
    return ch;
  };

  const push = (kind: TokKind, lexeme: string, start: { line: number; col: number; off: number }, extra?: Partial<Token>) => {
    out.push({ kind, lexeme, line: start.line, column: start.col, offset: start.off, ...extra });
  };
  const pos = (start: { line: number; col: number; off: number }) => ({
    line: start.line,
    column: start.col,
    byteOffset: start.off,
  });

  while (i < input.length) {
    const ch = peek();
    const start = { line, col, off: i };

    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      bump();
      continue;
    }
    if (ch === "-" && peek(1) === "-") {
      while (i < input.length && peek() !== "\n") bump();
      continue;
    }
    if (ch === "/" && peek(1) === "*") {
      bump();
      bump();
      let n = 0;
      while (i < input.length && !(peek() === "*" && peek(1) === "/")) {
        bump();
        if (++n > 1024 * 1024) err("E_TOKEN_LIMIT", "Comment exceeds 1 MiB.", pos(start));
      }
      if (i >= input.length) err("E_SYNTAX", "Unterminated block comment.", pos(start));
      bump();
      bump();
      continue;
    }

    if (ch === "'" || ch === '"') {
      const q = bump();
      let body = "";
      let closed = false;
      while (i < input.length) {
        const c = bump();
        if (c === q) {
          if (peek() === q) {
            bump();
            body += q;
            continue;
          }
          closed = true;
          break;
        }
        if (c === "\\") {
          const e = bump();
          if (e === "n") body += "\n";
          else if (e === "t") body += "\t";
          else if (e === "\\") body += "\\";
          else if (e === "'") body += "'";
          else err("E_BAD_ESCAPE", `Invalid escape \\${e}.`, pos(start));
        } else body += c;
        if (body.length > 1024 * 1024) err("E_TOKEN_LIMIT", "Literal exceeds 1 MiB.", pos(start));
      }
      if (!closed) {
        err("E_SYNTAX", "Unterminated string literal.", pos(start));
      }
      if (q === '"') {
        if (!body.length) err("E_SYNTAX", "Empty quoted identifier.", pos(start));
        push("IDENT", body, start, { value: body });
      } else push("STRING", body, start, { value: body });
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      let s = "";
      while (peek() >= "0" && peek() <= "9") s += bump();
      if (peek() === "." && peek(1) >= "0" && peek(1) <= "9") {
        s += bump();
        while (peek() >= "0" && peek() <= "9") s += bump();
        const [a, b] = s.split(".");
        push("NUMBER", s, start, { value: { unscaled: a + b, scale: b.length } });
      } else push("NUMBER", s, start, { value: BigInt(s) });
      continue;
    }

    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_") {
      let s = "";
      while (/[A-Za-z0-9_]/.test(peek())) s += bump();
      const low = s.toLowerCase();
      if (KEYWORDS.has(low)) push("KW", s, start, { kw: low });
      else push("IDENT", low, start, { value: low });
      continue;
    }

    if (ch.charCodeAt(0) > 127) {
      err("E_IDENT_UNICODE", "Unquoted names are ASCII only. Visually confusable characters are not folded.", pos(start));
    }

    const two = ch + peek(1);
    if (two === "<>" || two === "!=" || two === "<=" || two === ">=") {
      bump();
      bump();
      const kind = two === "<>" || two === "!=" ? "NE" : two === "<=" ? "LE" : "GE";
      push(kind, two, start);
      continue;
    }

    const singles: Record<string, TokKind> = {
      ",": "COMMA",
      ":": "COLON",
      ".": "DOT",
      "(": "LPAREN",
      ")": "RPAREN",
      "{": "LBRACE",
      "}": "RBRACE",
      "*": "STAR",
      "=": "EQ",
      "<": "LT",
      ">": "GT",
      "+": "PLUS",
      "-": "MINUS",
      "/": "SLASH",
    };
    if (singles[ch]) {
      bump();
      push(singles[ch], ch, start);
      continue;
    }

    err("E_SYNTAX", `Unexpected character \`${ch}\`.`, pos(start));
  }

  out.push({ kind: "EOF", lexeme: "", line, column: col, offset: i });
}

/** Tokenize a program. Throws a SeamError carrying line/column on bad input. */
export function lex(input: string): Token[] {
  const out: Token[] = [];
  scanInto(input, out);
  return out;
}

export interface ScanProblem {
  code: string;
  message: string;
  line: number;
  column: number;
  byteOffset: number;
}

/**
 * Tooling entry point: same scanner, but it never throws. Editors want the
 * tokens that were recognized before the first problem so a half-typed buffer
 * still highlights, plus the problem itself to show where the break is.
 */
export function scan(input: string): { tokens: Token[]; problem: ScanProblem | null } {
  const out: Token[] = [];
  try {
    scanInto(input, out);
    return { tokens: out, problem: null };
  } catch (e) {
    const s = e as SeamError;
    return {
      tokens: out,
      problem: {
        code: s.code ?? "E_SYNTAX",
        message: s.message ?? "Unreadable input.",
        line: s.line ?? 1,
        column: s.column ?? 1,
        byteOffset: s.byteOffset ?? 0,
      },
    };
  }
}
