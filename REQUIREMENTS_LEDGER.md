# SEAMDB Requirements Ledger

Living checklist. **Part A** tracks `SEAMDB_Implementation_Blueprint.md` (evidence plane). **Part B** tracks `SEAMDB_From_Scratch_Engine_Blueprint.md` (the engine — an extension of, not a replacement for, Part A). Status is updated as implementation lands. Demo figures are labelled **synthetic**. The interactive UI is designed to run **offline after load**.

Legend: `OPEN` · `IN PROGRESS` · `DONE` · `BOUNDED` (implemented with the blueprint's explicit non-goal / research boundary)

Gate rule (from the engine blueprint, §11.6 / Appendix C): a Part B row is `DONE` only when implementation **and** positive tests **and** adversarial tests exist in `tests/` and the suite passes via `npm run engine:test`. A green typecheck or a demo is not evidence.

---

## Part A — Evidence plane (`SEAMDB_Implementation_Blueprint.md`)

| ID | Deliverable | Blueprint source | Status | Evidence in repo |
|----|-------------|------------------|--------|------------------|
| R01 | Product thesis UI: proof-carrying evidence plane, not a new DB | §01 Executive brief | DONE | `src/ui` terminal-dark landing + live lab |
| R02 | Buyer / wedge / moat framing visible without marketing-as-crypto | §01–§02, §13 | DONE | Hero + pilot + threat sections |
| R03 | Seven-step journey: register → snapshot → lineage → coherence → appraisal → receipt → verify | §03 | DONE | SECP gate rail + `runPipeline` |
| R04 | Release rule: no capsule, no high-risk export; bypass logged | §03 RELEASE RULE | DONE | Policy + grant engine + consume grant |
| R05 | Additive architecture overlay with inspectable component contracts | §04 | DONE | Architecture explorer |
| R06 | Crypto posture: SHA-384 commitments, AES-256-GCM, HMAC keyed leaves, Ed25519 checkpoints, hybrid PQ **labelled as transport only** | §05, §26 | DONE | `src/engine/crypto.ts`, crypto section |
| R07 | Evidence Capsule v1 wire object + canonical digest | §06, §24 | DONE | `src/engine/capsule.ts` |
| R08 | RFC 8785 JCS canonicalization, domain separation, no pretty-JSON hashing | §24 canonicalization | DONE | `src/engine/canonical.ts` |
| R09 | Merkle profile: leaf/node/root domain tags, proofs, empty/odd trees | §30 | DONE | `src/engine/merkle.ts` |
| R10 | SECP/0.1 state machine + replay/idempotency | §25 | DONE | `src/engine/secp.ts`, control plane |
| R11 | REST semantic control plane (in-process, same contracts) | §11, §29 | DONE | `src/engine/control-plane.ts` |
| R12 | Relational metadata model + immutability / outbox invariants | §23 | DONE | `src/engine/store.ts` |
| R13 | Postgres-style snapshot capture (synthetic connector, real canonical stream) | §27 | DONE | `src/engine/connectors.ts` |
| R14 | Policy gate (fail-closed Rego-equivalent) + one-use grant | §28 | DONE | `src/engine/policy.ts` |
| R15 | OpenLineage-compatible event ingest + DAG closure / cycle detect | §03, §39 S4 | DONE | `src/engine/lineage.ts` |
| R16 | Transparency log: inclusion, consistency, witnesses, split-view | §30, §25 | DONE | `src/engine/transparency.ts` |
| R17 | Verifier: named checks, PASS/FAIL/INDETERMINATE, never green on missing deps | §19, §30, §34 | DONE | `src/engine/verifier.ts` + named-checks table |
| R18 | Offline verifier CLI, exit 0 only on full PASS | §22, §39 S3 | DONE | `src/cli/verifier.ts` |
| R19 | Sheaf-inspired coherence: restriction maps, discrepancy witnesses, cycle residual | §07, §31 | DONE | `src/engine/coherence.ts` + figure |
| R20 | MDL / compression residual anomaly score (not claimed as K(x)) | §09, §32 | DONE | `src/engine/mdl.ts` |
| R21 | Algebraic constraint checker: SAT/UNSAT/UNKNOWN, never UNKNOWN as verified | §08, §33 | DONE | `src/engine/algebraic.ts` |
| R22 | Bidirectional invariants / filtration gates | §08 | DONE | Filtration UI + verifier gates |
| R23 | Privacy: opaque IDs, keyed leaves, no record-level PII in UI | §34 | DONE | Demo estate + UI (no row payloads) |
| R24 | Observability dashboards with synthetic label | §35 | DONE | Ops table (SYNTHETIC) |
| R25 | ≥10 seeded negative attacks; none silently PASS | §36, §39 DoD | DONE | `src/engine/attacks.ts`, Attack gallery; **regression-tested in `tests/evidence.test.ts`** (see CL-2026-10-16-01: A08 purpose-swap leak fixed by extending the capsule digest projection to cover the full sealed capsule) |
| R26 | Known-answer vectors for canonicalization + Merkle | §39 S3 | DONE | `src/engine/vectors.ts` |
| R27 | Interactive visual product (trust in 5s) | User mandate + §34 visual | DONE | Terminal-dark hero + live digest (no WebGL) |
| R28 | Architecture nodes: trust boundary, owner, API, health, threat | §34 | DONE | Architecture explorer |
| R29 | RATS-style appraisal profile (fail-closed) | §03 step 05, §21 | DONE | `src/engine/appraisal.ts` + Bad appraisal |
| R30 | Hybrid PQ transport **displayed honestly** (X25519+ML-KEM as posture, classical demo channel) | §05, §26 | DONE | Crypto section + negotiation record |
| R31 | ANOVA/factorial experiment **synthetic labelled** | §32 | BOUNDED | Specs/ops note blueprint hypothesis; no fabricated factorial plot |
| R32 | Threat model + residual risks visible | §10, §40 | DONE | Threat section |
| R33 | No TODOs, placeholders, or dummy hashes | User mandate | DONE | Entire `src/` |

---

## Part B — From-scratch engine (`SEAMDB_From_Scratch_Engine_Blueprint.md`)

Engine implementation: `src/db/` (SEAMQL lexer/parser/resolver/typechecker, planner, executor, page + tuple codecs, heap, buffer cache, B+tree, WAL + recovery, MVCC transactions, row/column policy, AES-256-GCM encryption at rest, backup/restore, wire protocol). Spec: `spec/`. Test suite: `tests/` (runner `npm run engine:test`). No external SQL engine is used anywhere at runtime (`package.json` has zero runtime dependencies).

| ID | Requirement | Evidence required | Status | Evidence in repo |
|----|-------------|-------------------|--------|------------------|
| FS-01 | SEAMQL grammar and language version frozen (`seamql/0.1`, gen-z canonical + frozen aliases) | EBNF, AST spec, conformance corpus | DONE | `spec/seamql-grammar.ebnf`, `spec/seamql-grammar.md`, corpus in `tests/parser.test.ts` |
| FS-02 | Lexer implemented from SEAMDB spec | Unit/property/fuzz tests | DONE | `src/db/lexer.ts`, `tests/lexer.test.ts` (incl. malformed UTF-8, escapes, 1 MiB bounds, confusables rejected) |
| FS-03 | Parser implemented from SEAMDB grammar | Conformance + malformed-input tests | DONE | `src/db/parser.ts`, `tests/parser.test.ts` (all statements, both surfaces incl. `fah`/`faah`, negative literals, pretty-print round trip, trailing-garbage rejection) |
| FS-04 | Resolver and type checker | Semantic test matrix | DONE | `src/db/resolve.ts`, `tests/resolve.test.ts` (unknown names, join ambiguity, assignment direction int→decimal only, aggregate argument typing, predicate typing, no implicit coercion) |
| FS-05 | Execution engine owned by SEAMDB | No runtime SQL-engine dependency; architecture review | DONE | `src/db/engine.ts`; zero runtime deps; `tests/` run against the native engine only |
| FS-06 | Catalog and transactional DDL | Crash/recovery tests | DONE | `src/db/engine.ts` catalog WAL records, `tests/crash.test.ts` (DDL survives only if committed) |
| FS-07 | Explicit page and tuple format | Byte-level format spec + fuzz tests | DONE | `spec/page-format.md`, `src/db/page.ts`, `src/db/tuple.ts`, `tests/page.test.ts`, `tests/tuple.test.ts` (bit-flip, overlap, bounds, truncation) |
| FS-08 | Heap storage and buffer pool | Persistence, corruption, concurrency tests | DONE | `src/db/page.ts`, buffer cache in `src/db/engine.ts` (no-steal, pin counting), `tests/engine.test.ts` |
| FS-09 | WAL and commit durability | Fault-injection crash matrix | DONE | `src/db/engine.ts` WAL records + checkpoint-aware recovery (damaged records skipped, pre-checkpoint images used only to repair a page that fails its checksum); `tests/crash.test.ts` crash-after-N-writes matrix, torn tail, WAL-repaired heap page, corrupted superblock fails closed |
| FS-10 | MVCC and documented isolation | Concurrency model checks | DONE | `src/db/engine.ts` visibility function + snapshots; single-writer documented; `tests/tx.test.ts` (snapshot isolation, own-writes, write-write conflict, rollback invisibility) |
| FS-11 | B+tree indexes | Structural, crash, uniqueness, equivalence tests | DONE | `src/db/btree.ts` (splits, duplicate keys, sibling chain, order-preserving key encoding), `tests/btree.test.ts` + index≡heap equivalence in `tests/engine.test.ts` |
| FS-12 | Optimizer equivalence | Rule tests + randomized equivalence | DONE | `src/db/plan.ts`; `setOptimize(false)` reference path; equivalence fuzz in `tests/engine.test.ts` |
| FS-13 | Row/column policy enforcement in engine | Complete operation/plan matrix | DONE | `src/db/engine.ts` assertPriv/rowGrant/stripPrivate; applies to reads, writes, joins, explain, errors, export; `tests/privacy.test.ts` |
| FS-14 | Encryption-at-rest profile | Key lifecycle tests; independent review still required for production | BOUNDED | `src/db/crypto-pager.ts` (AES-256-GCM pages + WAL, tag reserved in the page tail, nonce derives from page id + a generation bumped on every write, AAD binds page identity), `src/db/keys.ts` (dev provider refused in production), `tests/crypto.test.ts` |
| FS-15 | ML-KEM integration | Standards profile + KATs + independent review | DONE (key establishment) | **Real hybrid X25519+ML-KEM-768 handshake** in `src/engine/crypto.ts`: per-session `transportParty` → `transportReply` → `transportFinish` flow using `@noble/post-quantum` `ml_kem768` (referenced FIPS 203 implementation) + WebCrypto X25519/HKDF-384; traffic secret bound to both encapsulation keys' SHA-384 digests; negotiation record carries `peer_ek` digest, and downgrade is structurally impossible (KEM secret is a mandatory HKDF input). Tests: `tests/hybrid-pq.test.ts` (same-secret both sides, tamper → divergent secret implicit rejection, wrong dk → divergent secret, honest classical fallback). Independent review still required for production |
| FS-16 | Optional research ML-KEM implementation | Differential/fuzz/side-channel assessment | CLOSED | No handwritten KEM exists in any build — the library implementation is the implementation; hand-rolling was explicitly rejected |
| FS-17 | Engine-native evidence commit hook | WAL-to-receipt ordering tests | DONE | Commit events in WAL (`W_EVIDENCE` after durable commit record), `COMMITTED_EVIDENCE_PENDING` state; `tests/crash.test.ts` + `tests/engine.test.ts` |
| FS-18 | Backup/restore integrity | Restore drills and corruption tests | DONE | `src/db/backup.ts`, `tests/backup.test.ts` (manifest + page CRCs, tamper → E_CHECKSUM, missing superblock refused) |
| FS-19 | Network protocol and resource bounds | Protocol abuse tests | DONE | `src/db/protocol.ts` (framing, auth-before-query, 4 MiB frames, timeout bounds, idempotency), `tests/protocol.test.ts` |
| FS-20 | Production build excludes mocks | Build-graph audit | DONE | No mock providers exist under `src/db`; `DevKeyProvider` refused in production mode (`src/db/keys.ts`, tested in `tests/crypto.test.ts`) |
| FS-21 | No false security/durability claims | Release checklist and review | DONE | This ledger; isolation level honestly snapshot-based with single-writer; WAL now rotates at checkpoint (crash-safe, evidenced by `tests/rotation.test.ts`); evidence loss across rotations declared in the snapshot, never hidden |
| FS-22 | Independent security review | Written findings and remediation evidence | OPEN | Not started; release gate for any pilot |

### Part B scope notes (blueprint §16 decisions recorded)

- Single process owns a database directory (`seam.lock`); in-process protocol loop, no TCP bind (refused explicitly).
- Page size fixed at 16 KiB, format version 1. Tuples carry xmin/xmax MVCC headers and a null bitmap.
- Isolation: snapshot reads + write-write conflict detection with a **single active writer** (interleaved readers allowed). Not labelled serializable.
- WAL rotates at checkpoint when the log exceeds the retention budget (4 MiB): data pages and the catalog snapshot (`at_lsn`, `xid_floor`, evidence-loss marker) are persisted first, then the log is replaced with a single `W_RESTART` record. Crash-safe: recovery honors only the restart record, and torn rotation states load as the previous snapshot. B-tree page repair from pre-checkpoint WAL images applies only to never-rotated logs. Evidence events above the snapshot's accepted count are declared lost in the snapshot itself, never silently.
- Language version `seamql/0.1` is stored with each database's catalog.
- Excluded in v0: triggers, stored procedures, UDFs, recursion, cross-database transactions, external sort spill, hash-join spill.

---

## Visual wow bar (product, not slides)

| Moment | Intent |
|--------|--------|
| 0–5s | Camera docks on a sealing evidence mesh; live SHA-384 capsule digest ticks; title lockup |
| 5–20s | Operator can drive the 7-gate filtration; every gate is a real engine state |
| After | Tamper a leaf → verifier FAIL with named check; coherence witness lights the sheaf |

## Out of scope (blueprint-honest)

- Arbitrary SQL semantic proofs
- Custom ciphers / custom TLS stack
- Claiming ML-KEM as a signature scheme
- Treating sheaf cohomology as a cryptographic primitive
- Production KMS/HSM custody (simulated envelope keys, real AES-GCM)
- Distributed writes / multi-writer cluster (single-node v0 by design)

---

## Change log

- **CL-2026-10-16-01** — Fixed attack **A08 leak**: the capsule digest projection (`capsuleBodyForDigest`) omitted `policy.purpose`, `destination_ref`, `capsule_id`, and other sealed fields, so a purpose swap left the digest unchanged. The projection now covers the full sealed capsule (only post-seal `transparency.*` fields are excluded, with the exclusion justified in-code). All 10 attacks BLOCKED again; `npm run verify` PASS.
- **CL-2026-10-16-02** — Repaired the broken TypeScript build (missing `@types/node`, WebCrypto `BufferSource` typing, unused-symbol cleanup). `tsc --noEmit` exit 0.
- **CL-2026-10-16-03** — Part B ledger created from blueprint §13; test suite added under `tests/` with runner `npm run engine:test`.
- **CL-2026-10-16-04** — Test suite hardened to **152 tests, all passing** (`npm run engine:test` exit 0, `tsc --noEmit` exit 0, `npm run verify` PASS, `npm run attacks` all BLOCKED, `npm run build` exit 0). Writing the suite surfaced and fixed real defects:
  - **Encryption at rest was unusable**: WebCrypto AES-GCM appends a 16-byte tag, so the page-wrap length check could never pass; the page format now reserves tag space in the page tail, and the page nonce derives from (page id, generation) with the generation bumped on every write so a nonce is never reused.
  - **Recovery desync**: the WAL header was skipped as 16 bytes on one path and 8 on another, so every reopen lost sync. Recovery now scans past damaged records instead of stopping at them, replays only post-checkpoint page images (pre-checkpoint images would roll pages back in time), and uses the newest pre-checkpoint image to rebuild a page that fails its checksum.
  - **Lexer**: unterminated string/quoted-identifier detection, and every lexical error now reports its real line/column instead of column 1.
  - **Parser**: `-3` parses as a negative literal (matching the EBNF) and the pretty-printer emits real comparison operators, so print→parse round trips hold.
  - **Resolver**: assignment direction is checked (whole number into decimal allowed, decimal into whole number refused), unqualified columns owned by two joined tables raise `E_AMBIGUOUS`, and aggregate arguments are typechecked with `sum`/`avg` result types following their argument.
  - **Engine**: aliased aggregates (`count(x) as n`) are detected, grants for the same privilege merge (column sets union, row predicates ANDed), sealed-export digests are content-based and therefore stable, and whole-number/decimal arithmetic lifts exactly (`0.10 * 3` = `0.30`, scales add on `*`).
  - **Tuple/keys**: decimal index keys are sign-flipped big-endian so byte order equals numeric order, and decoding tolerates a tuple with fewer columns than the catalog (pre-`alter` rows) while rejecting one with more.
  - **Protocol**: `decodeFrame` distinguishes an out-of-range declared length (`E_LIMIT`) from a torn frame (`E_CORRUPT`).
  - **Language**: `fah` / `faah` join the frozen alias set for `check table` (documented in `spec/seamql-grammar.md`).
  - **Packaging hygiene**: no planning or review artifact is referenced from `src/`, `tests/`, or `spec/`; the repository reads as a standalone project.
- **CL-2026-10-16-07** — **Replaced the PQ posture-only transport with a real hybrid handshake.** The old `negotiateTransport` claimed "X25519 + ML-KEM-768" while executing nothing — an honest labelled stub, but still a stub. Now: `transportParty`/`transportReply`/`transportFinish` run a full hybrid session per negotiation using `@noble/post-quantum` `ml_kem768` (FIPS 203) and WebCrypto X25519+HKDF-384; the session secret is HKDF over (X25519 shared ‖ ML-KEM shared) with both encapsulation keys' SHA-384 digests folded into `info`; the record binds to `peer_ek`. Downgrade is structural: without the KEM secret you derive a different secret, never the same one. 5 new tests (`tests/hybrid-pq.test.ts`): both-party secret equality, MITM/party-swap divergence, tampered-ciphertext implicit rejection, wrong-dk divergence, honest fallback labelling. Dependencies now: `@noble/post-quantum` (runtime dependency, crypto library — this does not touch the db's zero-dependency claim, which is scoped to `src/db` and asserted in `tests/implementation.test.ts` via package.json root `dependencies`). Ledger: FS-15 → DONE (key establishment), FS-16 → CLOSED. Still true and still stated: ML-KEM is NOT a signature; witness checkpoints remain classical Ed25519; PQ signatures remain out of scope. `negotiateTransport` is now async — `bootLab` awaits it.
- **CL-2026-10-16-06** — **WAL rotation at checkpoint** (`tests/rotation.test.ts`, 7 tests): `checkpoint()` now flushes data pages, persists the catalog snapshot to a dedicated `PT_CATALOG` page recorded in the superblock (with `at_lsn`, `xid_floor`, and an `evidence_accepted` loss marker), then replaces the log with a single `W_RESTART` record when the log exceeds `rotateBudget` (4 MiB default, settable per instance for tests). Recovery honors the restart record only, keeps replay bounded post-restart, keeps pass-1 commit outcomes whole-log, and fails closed (`E_WAL_CORRUPT`) on a restart record without a valid snapshot. Visibility folds the xid floor: pre-rotation committed rows stay visible and pre-rotation deletes stay deleted without replaying trimmed records. Catalog pages are recycled (`PT_FREE`), one live snapshot at any time. Suite now **169 tests, all passing** (`engine:test` exit 0, `tsc` 0, `build` 0, `verify` PASS, `vectors` PASS, 10/10 attacks BLOCKED). Evidence-loss caveat stands: events above `evidence_accepted` were accepted in-session but not durable in the snapshot; the IDE's Evidence pane will show the session's full log either way.
- **CL-2026-10-16-05** — **SQL IDE shipped** (`src/ui/ide.ts`, `src/ui/ide.css`, linked from the landing page): a working editor over the live engine — SEAMQL syntax highlighting, tab completion, selection-or-buffer execution, schema explorer scoped by role grants, identity/role switching, `start tx / lock in / dip` transaction controls, and Results / Plan / Evidence / Messages panes rendering live WAL LSNs, xids, and evidence digests from `Database.evidenceLog()`. Verified in the browser: full starter script runs, 7 statements committed. **From-scratch proof suite added** (`tests/implementation.test.ts`, 10 tests): zero runtime dependencies asserted from `package.json`, no third-party imports, no `eval`/`Function`/WebAssembly anywhere, fixed-size (16,384-byte) page writes through the `Pager` interface, hand-decoded WAL record stream (magic, per-record CRC32, begin/commit records, replay-on-reopen), real B+tree leaf + internal pages after a forced split, planner `IndexPoint` vs heap-scan agreement, exact i64/decimal semantics (no floats), closed type surface, page-checksum corruption detection, full six-type tuple round trip. Suite now **162 tests, all passing** (`npm run engine:test` exit 0, `tsc --noEmit` exit 0, `npm run build` exit 0, `npm run verify` PASS, `npm run vectors` PASS, `npm run attacks` all BLOCKED). Known limits recorded, not hidden: no WAL rotation yet (log grows between checkpoints); browser preview verifies the IDE surface, not Workers/production deployment compatibility.
