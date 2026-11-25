# SEAMQL 0.1 grammar notes

**Language version:** `seamql/0.1`  
**Unicode:** Input must be valid UTF-8. Unquoted identifiers are ASCII `[A-Za-z_][A-Za-z0-9_]*` and case-fold to lowercase. Quoted identifiers `"Like This"` preserve case; `""` is an embedded quote. Visually confusable Unicode is **not** folded. Non-ASCII unquoted identifiers fail with `E_IDENT_UNICODE`.

**Keywords:** Case-insensitive. Reserved; cannot be unquoted identifiers.

## Canonical wording (Gen Z, still exact)

This is a programming language, not a chatbot. Every keyword has one AST production. Slang is the surface; semantics are frozen.

| Job | Canonical SEAMQL | Frozen alias (same AST) |
|---|---|---|
| Create table | `spawn table` | `make table` |
| Insert | `drop in` | `add to` |
| Update | `tweak` | `change` |
| Delete | `yeet from … when …` | `remove from … where …` |
| Read | `pull` | `read` |
| Join | `link` | `join` |
| Filter | `when` | `where` |
| Group | `bunch by` | `group by` |
| Sort | `rank by` | `sort by` |
| Desc / asc | `high to low` / `low to high` | `descending` / `ascending` |
| Limit | `cap` | `take` |
| Begin | `start tx` | `begin transaction` |
| Commit | `lock in` | `commit` |
| Rollback | `dip` | `cancel transaction` |
| Explain | `spill` | `explain` |
| Verify structure | `check table` | `verify table`, `fah table`, `faah table` (meme form: “for real?” = verify) |
| Export | `ship t sealed 'file'` | `export t to sealed file 'file'` |
| Grant | `let role r pull …` | `allow role r to read …` |
| Revoke | `block role r pull …` | `deny role r to read …` |
| Primary key | `main key` | `primary key` |
| NOT NULL | `needed` | `required` |
| DEFAULT | `fallback` | `default` |
| BOOLEAN | `yesno` | `boolean` |
| TIMESTAMP | `stamp` | `timestamp` |
| DATE | `day` | `date` |
| TRUE/FALSE | `yes` / `no` | `true` / `false` |

`whole number`, `text`, `decimal(p,s)`, `private`, `unique`, `links to`, `at least`, `index`, `on`, `from`, `set`, `as`, `is`, `and`, `or`, `not`, `null` are identical in both surfaces.

## Lexer rules

- Line comments `--` to newline. Block comments `/* … */` are non-nested. Comment payload max 1 MiB.
- Strings `'…'` with `''`, `\n`, `\t`, `\\`, `\'` only. Other backslash sequences fail `E_BAD_ESCAPE`.
- Integers and decimals parse as exact big integers plus scale. No IEEE round-trip.
- Token and statement max 1 MiB. Nesting depth max 64.
- Trailing garbage after a statement fails. Complete input must be consumed.
- The lexer does not expand env vars, paths, or network references.

## Errors

Every failure has `code`, human `message`, `line`, `column`, `byte_offset`, and a `hint` that never contains protected row values or secrets.

## Pretty-print

Canonical print uses Gen Z keywords. Aliases parse, then print canonical. Round-trip preserves AST semantics, not original spelling.
