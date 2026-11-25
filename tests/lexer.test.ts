import assert from "node:assert/strict";
import { test } from "node:test";
import { SeamError } from "../src/db/errors";
import { lex } from "../src/db/lexer";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as SeamError).code ?? "NOT_SEAM";
  }
  return "NO_THROW";
}

test("gen-z keywords and frozen aliases both tokenize as keywords", () => {
  for (const kw of ["yeet", "pull", "spawn", "drop", "tweak", "spill", "lock", "dip", "fah", "faah", "bunch", "rank", "cap", "ship"]) {
    const t = lex(kw)[0];
    assert.equal(t.kind, "KW", kw);
    assert.equal(t.kw, kw, kw);
  }
  for (const kw of ["remove", "read", "make", "change", "explain", "verify", "commit", "cancel"]) {
    assert.equal(lex(kw)[0].kind, "KW", kw);
  }
});

test("keywords are case-insensitive; identifiers fold to lowercase", () => {
  assert.equal(lex("YEET")[0].kw, "yeet");
  const ident = lex("MyTable")[0];
  assert.equal(ident.kind, "IDENT");
  assert.equal(ident.value, "mytable");
});

test("quoted identifiers preserve case and allow spaces", () => {
  const t = lex('"Weird Name"')[0];
  assert.equal(t.kind, "IDENT");
  assert.equal(t.value, "Weird Name");
  assert.equal(codeOf(() => lex('""')), "E_SYNTAX");
});

test("line and block comments are skipped; unterminated block comment fails", () => {
  const toks = lex("-- a comment\npull /* inline */ id");
  assert.equal(toks[0].kw, "pull");
  assert.equal(toks[1].kind, "IDENT");
  assert.equal(codeOf(() => lex("pull /* never closed")), "E_SYNTAX");
});

test("strings support exactly the documented escapes", () => {
  const s = lex("'it''s\\nok\\t\\\\done\\'x'")[0];
  assert.equal(s.kind, "STRING");
  assert.equal(s.value, "it's\nok\t\\done'x");
  assert.equal(codeOf(() => lex("'bad \\q escape'")), "E_BAD_ESCAPE");
  assert.equal(codeOf(() => lex("'unterminated")), "E_SYNTAX");
});

test("integers and decimals parse exactly without float round trips", () => {
  const i = lex("42")[0];
  assert.equal(i.value, 42n);
  const d = lex("12.50")[0];
  assert.deepEqual(d.value, { unscaled: "1250", scale: 2 });
  const neg = lex("-7")[0];
  assert.equal(neg.kind, "MINUS"); // minus is an operator; parser builds unary
  assert.equal(lex("3.")[0].kind, "NUMBER"); // "3." is int 3 followed by '.'
});

test("spans carry line, column and byte offset", () => {
  const toks = lex("pull id\n  from users");
  const from = toks.find((t) => t.kw === "from")!;
  assert.equal(from.line, 2);
  assert.equal(from.column, 3);
  assert.ok(from.offset > toks[0].offset);
});

test("non-ASCII unquoted identifiers are refused (no confusable folding)", () => {
  assert.equal(codeOf(() => lex("tаble")), "E_IDENT_UNICODE"); // Cyrillic а
  assert.equal(codeOf(() => lex("naïve")), "E_IDENT_UNICODE");
});

test("oversized input is refused before allocation", () => {
  const big = "pull " + "a".repeat(2 * 1024 * 1024);
  assert.equal(codeOf(() => lex(big)), "E_TOKEN_LIMIT");
});

test("unexpected characters produce E_SYNTAX with a position", () => {
  try {
    lex("pull $id");
    assert.fail("should throw");
  } catch (e) {
    const se = e as SeamError;
    assert.equal(se.code, "E_SYNTAX");
    assert.equal(se.column, 6);
  }
});

test("operators and punctuation tokenize", () => {
  const kinds = lex(">= <= <> != = < > + - / , : . ( ) { } *").map((t) => t.kind);
  assert.deepEqual(kinds, [
    "GE", "LE", "NE", "NE", "EQ", "LT", "GT", "PLUS", "MINUS", "SLASH",
    "COMMA", "COLON", "DOT", "LPAREN", "RPAREN", "LBRACE", "RBRACE", "STAR", "EOF",
  ]);
});

test("EOF token terminates every stream", () => {
  const toks = lex("");
  assert.equal(toks.length, 1);
  assert.equal(toks[0].kind, "EOF");
});
