# Null semantics — seamql/0.1

SQL-style three-valued logic. `needed` columns reject `null` at write (`E_NEEDED`).

Comparisons (`=`, `<>`, `<`, `>`, `<=`, `>=`) with a null operand yield unknown, not true.

`IS` / `IS NOT` against `null`, `yes`, `no`, or a non-null literal is a two-valued predicate.

`AND`/`OR`/`NOT` truth table is SQL. `WHEN` filters keep rows where the predicate is **true** (unknown drops).

Outer `link` (left): unmatched right columns are null. Inner `link` drops non-matches.

Aggregates skip null inputs except `tally(*)` which counts rows. `tally(expr)` counts non-null.

`UNIQUE` allows multiple nulls. `MAIN KEY` columns are `needed` and unique among visible versions.
