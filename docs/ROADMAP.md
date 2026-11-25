# SEAMDB — What's Built, What's Missing, and What Makes a Professor Sweat

Grounded in a re-read of the actual code (not memory). Written 2026-10-28.

## 0. Where the code actually stands

| Layer | Status | Honest gap |
|---|---|---|
| Storage (pager, page codec, B-tree, WAL) | Real. CRC'd pages, slot encoding, WAL with `W_BEGIN..W_RESTART`, log rotation with double-buffered catalog, `tryLock` ownership, encrypted pager, file backup | No buffer eviction (cache grows unbounded), torn-page checksums exist but no group-commit |
| MVCC / tx | Snapshot (`xmax` + active set), clog, WAL-rollback crash recovery, savepoint-free | **Single writer**: all write txs serialize on one `Promise` chain |
| Planner | Decorrelation + index point lookups + rule-based | No cost model, no stats table, no join-order search, no hash/merge join |
| Language | Typed parser, FK/pk/unique/atLeast/fallback attrs, grants with row predicates | No `GROUP BY`/`HAVING` beyond limited agg detection, no window functions, no cursors, no prepared statements |
| Protocol (`src/db/protocol.ts`) | Framed, versioned, idempotency keys, timeouts, error taxonomy over the wire | JSON-encoded payloads, in-process only — **no real TCP server exists anywhere in the codebase** |
| Evidence plane | Signature chains, transparency trees, witnesses, MDL residual, nine-gate SECP, attacker gallery, fallback crypto probing | Quorum/witness/KMS simulated in one browser tab; committee JSON files are static |
| Frontend | Landing + IDE + lab, real engine in-browser, motion layer, 182 tests green | No benchmark/observability surface on the site |

## 1. The headline answer: yes to drivers — but not JDBC first

A "JDBC-like" seam is the single highest-leverage credibility move, because it
changes the story from *"we built a toy engine"* to *"you can connect to this
from any language in the world."* The cheapest correct way:

**Phase 1 — PostgreSQL wire protocol (v3) server.** Target ~600–900 lines in
`src/server/`. Implement from the PostgreSQL frontend/backend message spec:
SSLRequest → StartupMessage → ParameterStatus/BackendKeyData → ReadyForQuery;
`Query` → RowDescription/DataRow/CommandComplete/CommandComplete-with-tag/
ErrorResponse → ReadyForQuery. Map SEAMDB's typed values to PG OIDs (int8,
numeric, text, bool) for the wire. Then **every existing JDBC/ODBC/JDBC-JVM
driver, `psycopg`, `pgx`, `node-postgres`, `rust-postgres`, DBeaver, `psql`
sign-in works unchanged** — that is the same trick YugabyteDB/Neon use to buy
an entire driver ecosystem for free. A JVM JDBC driver written by hand is a
multi-week Maven-side task with no extra educational value over this; keep it
as an optional thin wrapper later (adjust catalog hacks like
`select version()`, `pg_catalog` sizing queries that every client tool probes
for compatibility).

**Phase 2 — first-class npm driver `@seamdb/client`.** A small SayQL-native
client: `<script>` and ES-module builds, prepared statements with tag binding,
streaming `next()` cursor, typed parameter codec using the *same* `seamql` sha384
representation the engine already uses. This is the "JDBC"-shaped API that is
uniquely yours.

**Phase 3 — `bin/seam` CLI REPL.** Autocomplete over the grammar EBNF in
`spec/`, `\d`, `\xid`, `\explain`, redisplay on `↑`, crash-injection flags
(`--crash-after=N,commit`) to demo recovery live. Start from the existing CLI
verifier harness.

**Also needed for all three:** the frame payloads stop being JSON (pack a
binary tuple codec — minimal strings for column names, native 64-bit ints for
the values). Right now every query round-trips JSON.parse — that caps QPS around
tens-of-thousands *and* loses int64/numeric fidelity.

## 2. Concurrency: kill the single-writer chain and prove it

Right now every transaction serializes on `g.chain`, which makes MVCC
unnecessary on the write path. The big payoff is:

- Multi-writer with the snapshot already implemented; extend `Tx` with
  per-tuple `xmax` on heap tuples, first-updater-wins behavior, and SSI- or
  at least RC-with-conflict-detection semantics.
- Distributed deadlock detector or timeouts. Demonstrate recovery of an
  aborted loser via the WAL (already testable with existing harness).
- **Group commit:** fsync once per batch of waiting txs, not once per commit —
  so WAL becomes actually an interesting perf story, not only correctness.

## 3. Give the planner a nose (cost-based optimizer)

`src/db/plan.ts` is 87 lines today. The steps that look relentless to a
reviewer and are each a weekend:

1. `ANALYZE`-style `ndistinct`/MCV/histogram samples stored in catalog (you
   already have a catalog-page mechanism to extend).
2. Join reordering over cardinality estimates for `JOIN`s (currently the engine
   picks from syntax shape).
3. Hash join and sort-merge join as new plan nodes; start using them when the
   index path estimates worse.
4. Anti/semi-join rewrite for `EXISTS`/`IN (SELECT)` with the decorrelation you
   already have.
5. An show-and-tell: an "Optimizer" gate in the lab UI that renders `rows↓`
   estimates vs. actual row counts side by side, with `EXPLAIN ANALYZE` timing
   per operator. Nothing earns credibility faster than the
   "estimates match — 1725/1730" story.

## 4. Stop simulating the honest weaknesses

doc's §11 lists "simulated KMS/witnesses/single-writer" — three of these are
fixable with modest work:

- **Committee:** run N=3–5 in-process nodes of the engine over `node:net` using
  the frame server from §1 as the RPC substrate. Swifts all the
  witness-network plumbing on a real, testable cluster. Quorum by 2-of-3 BFT.
  Then update §11 to say "5-node local cluster," not "simulated."
- **KMS:** split keys across two real WebCrypto/Node crypto keyrings with a
  documented rekey ceremony, so the fallback problem is honest instead of a
  stub. Oddly, this is straightforward but expensive to describe — keep the doc
  modest until a second node type exists.
- **Time:** the `clock: "host-local"` honesty tag exists. Move to a signed
  monotonic clock source and cross-node median.

## 5. TLA+/PlusCal model of the SECP state machine

Nine states, guarded transitions, a DENIED absorbing state — this is *begging*
to be written as a PlusCal algorithm and model-checked with TLC to prove
"no state transition sequence is reachable that bypasses FILTRATION checks."
One weekend, 100 lines of TLA+, and it's the one thing on a CV that separates
this project from every other student DB: **"decision variables of each state
machine were model-checked in TLA+ before implementation."**
Cross-check the runtime wrapper in `src/ui/lab.ts` by asserting the safe
post-state in tests. Put the TLA+ file in `spec/secp.tla` and prove it's a
free-committed sync; spec/*.fig (labeled wine) or a Graphviz diagram goes into
§Figure of the LaTeX doc, replacing the hand-drawn gate list.

## 6. Performance: build the instrument, then use it

Seven engine tests exist but no benchmark harness. Add:

- `bench/` with micro benchmarks: point-select, index range scan, full scan,
  insert throughput, commit throughput, WAL rotate.
- Print the numbers into the landing-stat band (`data-count` elements the site
  already has) so the browser shows *real* timing, fading the hero number when
  there's no measured number.
- Optional: a subset of TPC-C-style (supplier/border/district), only what's
  honest for a single-writer store, and always label the limits in §11.

## 7. Everything else, sorted by visible payoff

| Item | Effort | Payoff |
|---|---|---|
| GROUP BY / HAVING / window functions (`OVER`) — the parser plumbing to do it exists in principle | M | Huge — advanced SQL queries is the lowest bar to clear for it to be called a database |
| Prepared statements (parse once, bind parameters) | S | Needed before protocol work anyway |
| Cursors / streaming results over the protocol | S | Needed once result sets stop being small |
| `ON CONFLICT` / upsert / `MERGE` | S–M | Popular ask, exercises unique indexes |
| Savepoints (`SAVEPOINT` / `ROLLBACK TO`) | S | Cheap, strong MVCC demo |
| Recursive/Common Table Expressions (`WITH RECURSIVE`) | M | Lineage queries prove the evidence story |
| `seam shell` CLI (see §1 Phase 3) | S | Live demos, recovery stories |
| Property-based testing via `fast-check`: random statements + injury/recovery fuzzing of the WAL | M | professors believe fuzzing more than hand tests |
| Fuzz the parser (`--seed` should be recorded) | S | 10x test-count growth at no design cost |
| EXPLAIN_ANALYZE / explain analyze per-operator timing in the plan text | S | You already render plan text |
| Buffer manager with a tiny LRU and a `TURN OFF "volatile"` flag | S | Real catalog-paged DBs won't work without it as you grow |
| Advisor/policy store refresh so policy changes don't require a restart view | M | Ends the "reload to refresh policy" itch |

## 8. The one paragraph for the reflection page

"As part of a language/language-theory course this would look like a compiler;
in a databases course the engine, its WAL, the B-tree, MVCC, and grants are the
whole; what made this one different is the evidence plane, which is a
second system of logs, hashes, signatures, witnesses, quorum trees, and an MDL
anomaly detector wrapped around the same engine that is on the same page."
Say that, then lead a 60-second demo: LC183 → add index → plan flips;
seal → nine gates PASS; attack gallery → 10/10 blocked; tamper → DENIED exit 1;
and (once §1 lands) `psql -h localhost` connecting to what was a browser toy.

## 9. Ordered priority list

1. PG wire protocol server + binary frame payloads (§1 Phase 1)
2. `ANALYZE` stats + join reordering + hash join (§3)
3. Multi-writer MVCC + group commit (§2)
4. GROUP BY/JOIN-over with aggregates/window (§7)
5. TLA+ spec for SECP transitions (§5)
6. `seamdb` CLI shell + EXPLAIN ANALYZE (§1 Phase 3, §7)
7. Multi-node witness federation over the frame server (§4)
8. Benchmark harness wired to the landing-page stat band (§6)
9. Property-based parser/engine fuzzing (§7)
10. KMS rekey ceremony + policy refresh (§7)
