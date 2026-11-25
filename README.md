# SEAMDB

**A proof-carrying database engine with a post-quantum evidence plane.**

SEAMDB is a from-scratch database engine paired with an evidence layer that proves what data was used, which policy authorized it, which upstream systems contributed it, and whether the result can be independently verified. It ships its own query language (SEAMQL), its own storage engine, its own wire protocol, and a browser-based IDE — all with zero runtime SQL-engine dependencies.

> **Status:** Research prototype (v0.1.0). Not production-ready. Independent security review has not been completed.

---

## What's Inside

| Layer | Description |
|---|---|
| **SEAMQL** | A typed query language with Gen-Z canonical keywords (`spawn table`, `pull`, `drop in`, `yeet`, `bunch by`, …) and frozen SQL aliases. Full lexer, parser, resolver, type checker, planner, and optimizer. |
| **Storage engine** | 16 KiB pages, slot-based tuple encoding, CRC-32 page checksums, B+tree indexes, WAL with crash recovery and log rotation, MVCC snapshot isolation, AES-256-GCM encryption at rest. |
| **Evidence plane** | SHA-384 Merkle trees, Evidence Capsules, SECP/0.1 state machine, transparency log, lineage DAG, algebraic constraint checker, sheaf-inspired coherence, offline verifier. |
| **Crypto posture** | SHA-384 commitments, AES-256-GCM, Ed25519 checkpoints, hybrid X25519 + ML-KEM-768 key exchange (FIPS 203 via `@noble/post-quantum`). Post-quantum transport is real, not a stub. |
| **Wire protocol** | Framed binary protocol with auth, idempotency keys, timeouts, and resource limits. |
| **Drivers** | Python client driver and a TypeScript client (`src/client/`). |
| **Desktop IDE** | PyQt6 native IDE (SEAMDB Studio) with schema explorer, syntax highlighting, and results/plan/evidence panes. |
| **Browser IDE** | In-browser SQL editor running the full engine client-side — no server needed for the demo. |

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **Python** ≥ 3.10 with **PyQt6** (only for the desktop IDE)

### 1. Install and run the website

```bash
npm install
npx vite
```

Open **http://localhost:5173/** — five pages:

| Route | Purpose |
|---|---|
| `/` | Landing page — proof-carrying evidence pitch |
| `/ide.html` | Browser SQL IDE — run SEAMQL against the real engine |
| `/lab.html` | SECP Lab — seal a capsule, tamper a leaf, watch the verifier fail |
| `/specs.html` | Architecture explorer, crypto profile, threat model |
| `/docs.html` | SEAMQL grammar, verb cheatsheet, CLI reference, driver docs |

### 2. Start the wire server

```bash
npx tsx src/server/tcp.ts --mem --port 7301
```

`--mem` keeps data in RAM. Drop it to persist to `./seamdata`.

### 3. Launch the desktop IDE

```bash
python ide/seamdb_ide.py --host 127.0.0.1 --port 7301 --user root --roles owner
```

### 4. Try some SEAMQL

```sql
spawn table folks: id: whole number, main key, name: text, needed
drop in folks { id: 1, name: 'Ada' }
drop in folks { id: 2, name: 'Grace' }
pull name from folks when id = 1
```

See [`DEMO_SNIPPETS.seamql`](DEMO_SNIPPETS.seamql) for a full walkthrough including joins, aggregates, window functions, transactions, error handling, and query plans.

---

## Tests

```bash
npm run test            # 204 tests — engine, parser, crypto, crash recovery, etc.
npm run verify          # offline capsule verifier (exit 0 = full PASS)
npm run attacks         # 10 seeded adversarial attacks, all BLOCKED
```

The test suite covers the full stack: lexer, parser, resolver, B+tree, WAL crash matrix, MVCC isolation, encryption round-trips, protocol abuse, page-level corruption detection, hybrid PQ key exchange, optimizer equivalence, and more.

---

## Project Structure

```
src/
  db/           Engine core — lexer, parser, resolver, planner, executor,
                page/tuple codecs, B+tree, WAL, MVCC, encryption, protocol
  engine/       Evidence plane — capsules, Merkle trees, transparency log,
                coherence, verifier, crypto, lineage, policy
  client/       TypeScript wire client
  server/       TCP server
  pages/        Website page renderers
  ui/           Browser UI components, IDE, lab, motion
  cli/          Verifier, vectors, and attack CLI tools
spec/           Formal specifications — grammar EBNF, page format, wire
                protocol, type system, transaction model, threat model
tests/          Full test suite
drivers/        Python client driver
ide/            PyQt6 desktop IDE (SEAMDB Studio)
docs/           LaTeX paper draft and roadmap
```

---

## SEAMQL at a Glance

| SQL | SEAMQL |
|---|---|
| `CREATE TABLE` | `spawn table` |
| `INSERT INTO` | `drop in` |
| `SELECT` | `pull` |
| `UPDATE` | `tweak` |
| `DELETE` | `yeet from` |
| `WHERE` | `when` |
| `JOIN` | `link` |
| `GROUP BY` | `bunch by` |
| `ORDER BY` | `rank by` |
| `LIMIT` | `cap` |
| `BEGIN` | `start tx` |
| `COMMIT` | `lock in` |
| `ROLLBACK` | `dip` |
| `EXPLAIN` | `spill` |
| `PRIMARY KEY` | `main key` |
| `NOT NULL` | `needed` |

Both surfaces (Gen-Z canonical and SQL aliases) parse to the same AST. See [`spec/seamql-grammar.md`](spec/seamql-grammar.md) for the full grammar.

---

## Specifications

Formal specs live in [`spec/`](spec/):

- **[seamql-grammar.ebnf](spec/seamql-grammar.ebnf)** — EBNF grammar
- **[page-format.md](spec/page-format.md)** — 16 KiB page layout, slot directory, tuple encoding
- **[wal-format.md](spec/wal-format.md)** — WAL record types and recovery semantics
- **[wire-protocol.md](spec/wire-protocol.md)** — Framed binary protocol spec
- **[transaction-model.md](spec/transaction-model.md)** — MVCC, snapshot isolation, write conflicts
- **[type-system.md](spec/type-system.md)** — Six-type system (whole number, decimal, text, yesno, stamp, day)
- **[crypto-profile.md](spec/crypto-profile.md)** — Cryptographic primitives and key hierarchy
- **[threat-model.md](spec/threat-model.md)** — Threat model and residual risks

---

## Crypto and Security Notes

- The hybrid PQ handshake uses `@noble/post-quantum` (ML-KEM-768, FIPS 203). ML-KEM is used for **key exchange only** — it is not a signature scheme. Witness checkpoints use classical Ed25519.
- Encryption at rest uses AES-256-GCM with per-write nonce generation. The dev key provider is refused in production mode.
- **Independent security review has not been completed.** This is a research prototype. Do not use it to protect real data without a thorough audit.

---

## Known Limitations (v0)

- Single-writer serialization (concurrent readers are fine)
- No cost-based optimizer or join-order search
- No hash/merge join (nested-loop only)
- No spill-to-disk for sorts or joins
- Buffer cache grows unbounded (no eviction)
- Witness quorum and KMS are simulated
- Not tested for production deployment

---

## Author

**Mitrajit Ghorui** · [Genauix](https://genauix.github.io/)

---

## License

This project is licensed under the [MIT License](LICENSE).
