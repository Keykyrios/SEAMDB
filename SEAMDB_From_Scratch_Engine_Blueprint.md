# SEAMDB From-Scratch Engine Blueprint
## Companion extension to `SEAMDB_Implementation_Blueprint.md`

**Purpose:** Turn SEAMDB from an evidence/control plane around an existing or simulated database into a database engine whose storage, SQL language, execution semantics, transactions, recovery, authorization, and privacy boundaries are designed and implemented by the SEAMDB project.

**Status:** Architecture and implementation contract. This document is not evidence that any component has already been implemented, audited, or proven secure.

**Hard rule:** A component is `DONE` only when its implementation, specification, conformance tests, adversarial tests, crash tests where relevant, and reproducible evidence all exist. A UI animation, mock response, in-memory substitute, fake digest, happy-path-only test, or wrapper around another SQL engine does not count.

---

# 0. The actual goal

The intended product is not “a dashboard that talks to Postgres.” It is **a database engine with a deliberately designed, approachable language**, and with the SEAMDB evidence plane built into the engine's real execution and storage paths.

That means SEAMDB owns, specifies, tests, and versions:

- The user-facing query language and grammar.
- Lexing, parsing, name resolution, type checking, planning, optimization, and execution.
- The catalog: databases, namespaces, tables, columns, indexes, constraints, roles, policies, and schema versions.
- Physical storage: page layout, record encoding, page identifiers, checksums, free-space management, and index pages.
- Buffer pool, page latches, locking rules, and memory ownership.
- Transactions, isolation levels, MVCC visibility, conflict detection, and commit semantics.
- Write-ahead logging (WAL), checkpointing, crash recovery, corruption detection, and backup/restore.
- Authorization, row/column policies, key ownership boundaries, audit events, and secure export.
- Engine-native lineage and evidence events, with receipts tied to actual committed data and actual query plans.
- Network protocol, session state, resource limits, and operational administration.
- Compatibility/versioning rules and a deterministic conformance suite.

Python libraries may assist development, testing, fuzzing, formal-model checking, benchmarks, and reference implementations. They must not secretly provide the core behavior that SEAMDB claims to own. In particular, `sqlite3`, SQLAlchemy, DuckDB, PostgreSQL drivers, or a remote Postgres server must not sit underneath the “from-scratch” engine and answer the queries.

## 0.1 What “from scratch” means here

“From scratch” means **SEAMDB owns the implementation and specification of the database semantics**. It does not mean reimplementing every operating-system primitive, inventing cryptographic algorithms, or pretending a small team can instantly reproduce decades of database-engine hardening.

Use the OS for file I/O, memory mapping where explicitly chosen, entropy, process isolation, and sockets. Use reviewed compiler/toolchain components. For production cryptography, use a vetted implementation of standardized primitives through a narrow SEAMDB-owned interface. A separate research track may implement algorithms such as ML-KEM from their standards for education and differential testing, but a handwritten implementation must not be the only production security boundary until it has undergone independent expert review and substantial side-channel testing.

**Control is not the same thing as privacy.** Owning the engine gives SEAMDB the ability to define and inspect behavior. Privacy still depends on correct access control, key custody, metadata minimization, memory handling, backups, logs, side-channel behavior, deployment, and operational discipline. No design can honestly promise “full privacy” against every threat.

## 0.2 Explicit non-goals for version 0

Version 0 is a single-node, durable, transactional relational engine. It is not a distributed consensus system, a multi-writer cluster, a general-purpose analytics warehouse, a SQL-standard compatibility clone, or a formally verified database. Do not add distributed writes until single-node crash recovery and transaction correctness are strong.

---

# 1. Product split: SEAMQL and the SEAMDB engine

The internal implementation can use a systems language such as Rust. The operator should not need to learn Rust, C, pointer arithmetic, or database-engine jargon to query data.

The user-facing language is named **SEAMQL** for this blueprint. It is SQL-inspired, intentionally small, consistent, and readable. It is not natural-language guessing. It is a precise language with friendly words, clear errors, and no ambiguous “best effort” interpretation.

Example:

```seamql
make table customers:
    customer_id: whole number, primary key
    name: text, private
    email: text, private, unique
    created_at: timestamp, required, default now()

make table orders:
    order_id: whole number, primary key
    customer_id: whole number, required, links to customers.customer_id
    total: decimal(12, 2), required, at least 0
    status: text, required, default "new"

add index orders_by_customer on orders(customer_id)

allow role analyst to read customers.customer_id, customers.name
allow role analyst to read orders where status is "complete"

read customers.name, orders.total
from customers
join orders on customers.customer_id = orders.customer_id
where orders.total >= 100
sort by orders.total descending
take 50
```

The syntax above is a **proposed language design**, not an already implemented parser. Every construct must be in the grammar and conformance suite before it is advertised as supported.

## 1.1 Language design principles

1. **Readable, not magical.** Keywords are stable, explicit, and documented. The engine never sends arbitrary prose to an LLM and executes the guess.
2. **Small core.** Prefer a precise, well-tested subset over a huge compatibility surface.
3. **Friendly nouns and verbs.** `make table`, `add index`, `read`, `change`, `remove`, `allow`, `deny`, `begin`, `commit`, `cancel`, `explain`, and `verify`.
4. **No silent coercion.** Invalid types, ambiguous names, invalid dates, overflowing numbers, and unsupported syntax are errors.
5. **No implicit unsafe behavior.** Exports require explicit authorization. Destructive operations require clear syntax and policy. There is no implicit network fetch or file read in a query.
6. **Readable errors.** Every error has a stable machine code, a human message, source span, and (when safe) a correction hint.
7. **Versioned grammar.** Each database stores its language version. A new release cannot silently reinterpret old queries.
8. **One canonical meaning.** The same parsed statement cannot mean different things in the UI, CLI, API, policy engine, or verifier.

## 1.2 Proposed syntax surface

| Task | SEAMQL form | Required behavior |
|---|---|---|
| Create table | `make table people: ...` | Catalog transaction; reject invalid schema before writing |
| Read rows | `read name, age from people where age >= 18` | Typed AST, plan, policy checks, deterministic semantics |
| Insert row | `add to people { name: "Ada", age: 37 }` | Constraint checks and transaction |
| Change rows | `change people set age = age + 1 where ...` | Atomic update, row policy checks, conflict handling |
| Delete rows | `remove from people where ...` | Explicit predicate; bulk delete requires elevated policy |
| Create index | `add index people_by_age on people(age)` | Build index transactionally; validate index after recovery |
| Begin transaction | `begin transaction` | Start a defined isolation level |
| Commit | `commit` | Durable commit acknowledgement only after WAL durability point |
| Roll back | `cancel transaction` | Release locks and discard uncommitted versions |
| Explain plan | `explain read ...` | Shows typed plan and estimates, not row contents |
| Verify object | `verify table people` | Structural/integrity verification, not a claim that all data is truthful |
| Export | `export customers to sealed file "..."` | Explicit policy, purpose, recipient, and evidence receipt |
| Schema change | `change table people add ...` | Versioned, transactional schema migration |

The exact syntax is intentionally open to a language-design review before parser implementation. Do not build a parser from examples alone. Freeze a grammar version, AST schema, type rules, null rules, and transaction semantics first.

## 1.3 Example errors

Good error:

```text
E_TYPE_MISMATCH at line 4, column 18
`total` is decimal(12,2), but "many" is text.
No implicit conversion was performed.
Try a decimal value, for example: 12.50
```

Bad error:

```text
Query failed.
```

Good security behavior: error details are useful to the authorized operator but do not reveal private row values, secret key material, hidden schema names, or whether a protected record exists to an unauthorized caller.

---

# 2. System architecture: owned core, narrow trusted boundary

```text
                 SEAMQL / CLI / SDK
                         |
                 Session + Protocol
                         |
               AuthN / AuthZ / Limits
                         |
              Lexer -> Parser -> AST
                         |
       Name Resolution -> Type Checker
                         |
              Logical Plan -> Optimizer
                         |
               Physical Plan Executor
                         |
         +---------------+----------------+
         |                                |
   Transaction Manager              Policy Runtime
   MVCC + locks + SSI                row/column rules
         |                                |
   Buffer Pool / Page Manager <-----------+
         |
   Heap / B+tree / Catalog / Blob pages
         |
   WAL -> Flush / Checkpoint / Recovery
         |
   Encrypted data files + key hierarchy
         |
   Engine-native event hooks
         |
   Evidence log / capsule / transparency receipts
```

This is a logical map, not permission to skip modules. Each arrow is a contract with preconditions, postconditions, failure modes, and tests.

## 2.1 Module ownership

| Module | SEAMDB owns | External dependencies allowed |
|---|---|---|
| SEAMQL grammar | Grammar, lexer, AST, semantic rules, error codes | Parser generator only if the generated parser is inspected and conformance-tested; handwritten parser is acceptable |
| Catalog | Catalog schema, migrations, transactional catalog operations | None for semantic decisions |
| Planner | Logical operators, cost model, physical operators, optimizer rules | Math/benchmark tooling |
| Storage | Page format, heap, indexes, buffer pool, free-space maps | OS file I/O and memory primitives |
| Transactions | MVCC, locks, snapshots, conflicts, commit ordering | None for semantic decisions |
| WAL/recovery | Record format, redo/undo or equivalent, checkpoints, recovery | OS durable-write primitives |
| Crypto interface | Key lifecycle contract, nonce rules, associated-data format, algorithm identifiers | Audited crypto provider in production |
| ML-KEM research implementation | Standards mapping, test harness, constant-time review | Reference implementations for differential tests; not silently used as implementation |
| Protocol | Framing, authentication binding, limits, version negotiation | Reviewed TLS implementation for transport |
| Authorization | Role model, object grants, row/column policy, policy compilation | Optional external policy language only if its semantics are pinned and tested |
| Evidence | Event schema, commit linkage, receipt verification | Transparency witnesses / external append-only storage |
| Testing | Conformance, fuzzing, crash harness, differential tests | Python test/fuzz orchestration libraries |

---

# 3. Implementation language and codebase rules

## 3.1 Recommended internal language

Use **Rust** for the engine core unless a written team capability review selects another memory-safe systems language. Rust is an implementation choice, not the query language. The user sees SEAMQL.

Reasons: explicit ownership, strong types, mature testing tooling, and the ability to isolate unsafe code. Rust does not automatically make the engine safe. Unsafe blocks, FFI, concurrency, parser bugs, transaction logic, and cryptographic misuse still require review.

## 3.2 Repository layout

```text
seamdb/
  spec/
    seamql-grammar.md
    seamql-grammar.ebnf
    type-system.md
    null-semantics.md
    transaction-model.md
    page-format.md
    wal-format.md
    wire-protocol.md
    crypto-profile.md
    threat-model.md
    error-catalog.yaml
    compatibility-policy.md
  crates/
    seamql_lexer/
    seamql_parser/
    seamql_ast/
    seamql_resolver/
    seamql_types/
    seamql_planner/
    seamql_optimizer/
    seamql_executor/
    seamdb_catalog/
    seamdb_storage/
    seamdb_buffer/
    seamdb_heap/
    seamdb_btree/
    seamdb_tx/
    seamdb_wal/
    seamdb_recovery/
    seamdb_auth/
    seamdb_policy/
    seamdb_crypto_api/
    seamdb_protocol/
    seamdb_evidence/
    seamdb_backup/
    seamdb_cli/
    seamdb_server/
  tests/
    grammar/
    semantics/
    known_answer/
    property/
    fuzz/
    crash_recovery/
    concurrency/
    corruption/
    privacy/
    compatibility/
    end_to_end/
  tools/
    corpus_minimizer/
    crash_runner/
    page_inspector/
    wal_inspector/
    plan_explainer/
  docs/
```

Every crate needs a clear owner and API. Cyclic dependencies are prohibited. The storage layer must not import the SQL parser. The evidence layer must not decide transaction success. The UI must not manufacture engine state.

## 3.3 Engineering quality gates

- `cargo fmt --check`, lints, static analysis, dependency audit, secret scanning, and reproducible builds run in CI.
- `unsafe` code is forbidden by default. Every exception has a documented safety argument, minimal scope, reviewer, and tests.
- Pin dependency versions and commit the lockfile. Generate an SBOM and record build provenance.
- No production code path may use `unwrap()`/panic for malformed user input, corrupt pages, network input, or expected I/O errors.
- Every parser/decoder must enforce size, depth, count, and time limits before allocating unbounded memory.
- Errors must not include secret material or protected row values.
- No `TODO`, fake digest, stubbed success, ignored test, or “temporary allow-all” policy may ship in a release build.
- A failing or unavailable security dependency produces `INDETERMINATE`/failure, never `PASS`.
- A feature flag cannot convert a security failure into success. Disabled features must be rejected explicitly.
- CI must prove the test ran. “Test file exists” is not evidence.

---

# 4. SEAMQL: define the language before writing the parser

## 4.1 Freeze the semantic spec

Before implementation, approve these documents:

1. EBNF grammar for every accepted statement.
2. Token definitions, Unicode policy, identifier normalization, quoting, comments, and string escape rules.
3. AST schema and source-span rules.
4. Name-resolution rules and namespace precedence.
5. Type system and exact numeric behavior.
6. Three-valued logic and `null` behavior.
7. Evaluation order where observable, error precedence, and deterministic functions.
8. Function catalog and volatility classes.
9. Transaction behavior for every statement.
10. Authorization order and non-disclosure behavior.
11. Error catalog with stable codes.
12. Compatibility/versioning rules.

Do not begin by adding “whatever syntax feels nice” to a string matcher. That creates ambiguous behavior and injection bugs.

## 4.2 Lexing

The lexer converts bytes into tokens with byte offsets and line/column spans.

Required tokens include identifiers, quoted identifiers if supported, keywords, integer/decimal literals, strings, booleans, `null`, punctuation, comparison operators, arithmetic operators, and end-of-input.

Rules:

- UTF-8 input must be validated.
- Identifier normalization must be specified. Do not silently treat visually confusable Unicode characters as identical.
- Keyword matching is case-insensitive only if the spec says so; identifier case rules are separate.
- String escapes are finite and specified. Invalid escapes fail.
- Numeric literals are parsed without floating-point round trips.
- Comments have a maximum length and cannot disable policy enforcement.
- The lexer must reject invalid bytes and oversized tokens.
- The lexer must not interpret environment variables, shell substitutions, file paths, or network references.

Test every token at boundary lengths, all malformed UTF-8 cases, nested comments if supported, escaped delimiters, Unicode confusables, and adversarially long tokens.

## 4.3 Parsing

Use a deterministic grammar. A Pratt parser is suitable for expressions; statement parsing should be explicit. A parser generator is acceptable only if its grammar is the source of truth and generated behavior is tested.

The parser emits an AST, never SQL strings for later concatenation. It must reject trailing garbage, duplicate clause combinations, invalid precedence, unsupported statements, and ambiguous forms.

Example AST shape:

```text
ReadStatement {
  projection: [ColumnRef("customers", "name"), ColumnRef("orders", "total")],
  source: Join(
    left = TableRef("customers"),
    right = TableRef("orders"),
    kind = Inner,
    predicate = Equals(ColumnRef("customers", "customer_id"),
                       ColumnRef("orders", "customer_id"))
  ),
  filter: GreaterOrEqual(ColumnRef("orders", "total"), Decimal(100, scale=0)),
  order_by: [OrderKey(ColumnRef("orders", "total"), Descending)],
  limit: 50
}
```

This is a conceptual AST. The real AST must use typed node variants, stable source spans, and no arbitrary executable callbacks.

## 4.4 Name resolution and type checking

Resolve every table, column, function, and role against a catalog snapshot before planning. Ambiguous names fail. Missing names fail without revealing protected names to unauthorized users.

The type checker must enforce:

- Exact numeric precision and scale.
- Overflow and division-by-zero behavior.
- Explicit cast rules.
- `null` semantics.
- Boolean-only predicates.
- Valid join-key comparisons.
- Function argument and return types.
- Time zone and timestamp semantics.
- Collation and string comparison semantics.
- Constraint compatibility.
- Deterministic behavior across supported platforms.

Do not use host-language defaults as the database specification. For example, Rust `f64`, Python `float`, and platform locale rules must not silently determine decimal arithmetic or text ordering.

## 4.5 Execution semantics

The engine evaluates a typed plan, not the original query string. Every operator has defined input/output schemas, null semantics, error behavior, cancellation points, memory limits, and policy interaction.

Minimum operators for v0:

- Table scan.
- Projection.
- Filter.
- Limit.
- Sort.
- Inner join.
- Left join only if null-extension semantics are completely specified.
- Hash aggregate with a deliberately limited aggregate set.
- Insert, update, delete.
- Unique and foreign-key checks.
- Index lookup and index range scan.
- Explicit transaction boundaries.

Anything not implemented is rejected. No fallback to Python `eval`, host SQL libraries, or an external SQL server.

---

# 5. Physical storage format

The storage format is a versioned on-disk protocol. It must be documented byte-for-byte before production data is written.

## 5.1 File and page layout

Start with a fixed page size (for example, 16 KiB) selected by benchmark and workload analysis. Do not make it configurable in v0 unless every page parser, WAL record, backup tool, and recovery path supports it.

Each page includes:

- Magic/version or a format identifier in the file header.
- Page type.
- Page identifier and owning object identifier.
- Page generation/version.
- LSN (log sequence number) or equivalent recovery position.
- Payload length and slot/directory metadata.
- Integrity checksum.
- Reserved fields that must be zero and are validated.

The exact byte order, alignment, integer widths, maximum payloads, and checksum coverage belong in `spec/page-format.md`. Parsers must reject invalid page types, impossible offsets, overlapping slots, out-of-bounds lengths, bad generation values, and invalid checksums.

Do not serialize Rust structs by dumping their memory layout. Encode and decode every field explicitly.

## 5.2 Heap records and null bitmap

Define a stable tuple format:

- Tuple format version.
- Null bitmap.
- Per-column values in catalog-defined order.
- Variable-length offsets or length-prefixed payloads.
- Explicit encodings for integers, decimals, booleans, dates, timestamps, and text.
- No unvalidated pointer or offset.
- No native-endian encoding unless the format explicitly fixes it.

A row's physical identity is not its primary key. Use an internal row identifier that cannot be confused with user-controlled identifiers. Updates create new visible versions under MVCC; they do not mutate a committed row in a way that invalidates old snapshots.

## 5.3 Page manager and buffer pool

The page manager allocates, reads, writes, validates, and frees pages. The buffer pool owns cached pages and their pin/latch lifecycle.

Required invariants:

- A page cannot be evicted while pinned.
- Latches protect in-memory page structure, not transaction-level logical isolation.
- Lock ordering is documented to avoid deadlocks.
- A failed read never returns an uninitialized page.
- A checksum failure never becomes a cache hit that silently returns old data.
- Dirty-page flush obeys WAL-before-data.
- Page reuse increments a generation counter to reduce stale-reference bugs.
- Free pages cannot be reallocated until recovery rules make reuse safe.

## 5.4 B+tree indexes

Implement B+tree indexes only after heap pages, WAL, and recovery have test coverage.

Specify:

- Key encoding and total ordering.
- Duplicate-key representation.
- Internal/leaf page layouts.
- Split, merge, redistribution, root growth, and root shrink rules.
- Concurrent access and latch coupling.
- Crash points for every structural change.
- Unique-index enforcement under concurrent inserts.
- MVCC visibility and stale index-entry cleanup.
- Rebuild and integrity-check procedures.

The index is an acceleration structure, not the authority on row visibility. Every index path must preserve the same results as a table scan.

## 5.5 Catalog

The catalog stores schemas, table IDs, columns, types, constraints, indexes, roles, grants, policies, language version, object versions, and migrations.

Catalog changes are transactions. DDL cannot leave a half-created table after a crash. Catalog reads use a defined snapshot. Object identifiers are never reused in a way that makes old receipts refer to a different object.

---

# 6. Transactions, MVCC, and durability

This is one of the highest-risk parts of the project. Do not describe a database as secure or durable until the transaction and recovery model is specified and tested under faults.

## 6.1 Initial transaction model

Choose a simple model for v0 and document it. Recommended starting point:

- Single-node operation.
- MVCC row versions.
- Snapshot-based reads.
- Write-write conflict detection.
- Serializable isolation only if implemented with a complete, tested method; otherwise expose the supported isolation levels honestly.
- Explicit transaction start/commit/rollback.
- No implicit success before durable commit.
- No cross-database transactions in v0.

Do not label snapshot isolation as serializable. Do not advertise isolation levels that have no independent concurrency tests.

## 6.2 Transaction identifiers and visibility

Each transaction receives a monotonically allocated transaction identifier from a crash-safe allocator. Each row version records creator and, where applicable, deleter transaction IDs or equivalent commit metadata.

The visibility function must be a single, tested specification:

`visible(version, snapshot, own_transaction) -> true | false`

Its rules must cover active, committed, aborted, and unknown transaction IDs; own writes; concurrent commit timing; deleted rows; and recovery after restart. Unknown state is not “committed by default.”

## 6.3 Write-ahead log

Every durable mutation must be represented in WAL before the corresponding data page is allowed to reach durable storage.

The WAL format needs:

- Record magic/version and record type.
- Record length with strict bounds.
- Transaction ID.
- LSN and previous-LSN linkage where used.
- Page/object identifiers where relevant.
- Checksums or another specified integrity mechanism.
- Commit/abort/checkpoint/allocator/catalog records.
- Torn-write detection.
- Rules for incomplete tail records.
- Rotation and retention policy.

WAL records must not leak plaintext row values if the threat model requires encrypted-at-rest WAL. If WAL is encrypted, recovery must still have a safe key-availability and nonce-uniqueness design. Encryption does not replace record integrity, ordering, or recovery correctness.

## 6.4 Commit protocol

A successful commit response means the engine has reached its specified durability point. The exact steps must be written and tested, typically:

1. Validate transaction state and deferred constraints.
2. Produce commit record.
3. Flush the WAL through the commit record to the required durability boundary.
4. Publish commit visibility.
5. Return success.
6. Flush data pages later under WAL-before-data rules.

If step 3 fails, the client must not receive a success response. The connection may fail with an ambiguous outcome if the client cannot know whether the commit record reached durable media. Provide a transaction-status lookup or idempotency key mechanism to resolve retries safely.

## 6.5 Recovery

Recovery is a deterministic state machine, not a “load files and hope” path.

At minimum, implement:

- Startup file/header validation.
- WAL scan with bounds and checksum validation.
- Torn/incomplete-tail handling according to spec.
- Redo of durable committed changes as required by the chosen algorithm.
- Undo or invisibility of uncommitted changes.
- Recovery of catalog and allocator state.
- Checkpoint validation.
- Rebuild or validation of secondary indexes.
- Recovery completion marker and startup refusal on unrecoverable corruption.

Test process termination after every durable write boundary, simulated disk-full, short writes, failed fsync, corrupted page, corrupted WAL record, stale checkpoint, and truncated files. Tests must restart the engine and verify exact expected committed rows and invariants.

## 6.6 Backup and restore

A backup must be a consistent database image with a manifest, format versions, page inventory, and integrity verification. A backup is not successful merely because a file was copied.

Restore must verify the manifest and all pages before exposing the database to clients. Key loss must produce a clear unrecoverable-key error, not an empty database. Test point-in-time recovery only if it is actually implemented.

---

# 7. Privacy and authorization are engine semantics

Privacy must be enforced before data reaches a caller, not just hidden in the UI.

## 7.1 Authentication and authorization

Separate authentication (who is calling) from authorization (what they may do).

The v0 authorization model must include:

- Roles and service identities.
- Object-level privileges.
- Column-level privileges.
- Row-level policies.
- Explicit export permission.
- Admin separation of duties.
- Revocation semantics.
- Policy versioning and audit.
- Safe behavior when policy evaluation fails.

Authorization must apply to reads, writes, joins, aggregates, indexes, `EXPLAIN`, errors, exports, backup administration, and metadata APIs. A query cannot bypass row policy by selecting an index or using an alternate execution plan.

## 7.2 Non-disclosure behavior

For unauthorized callers, distinguish only what the threat model permits. Error messages must not leak protected values, secret schema names, existence of protected rows, or key IDs. Timing and row-count side channels require explicit assessment. Hiding data in the UI is not an access-control mechanism.

## 7.3 Encryption at rest

Define a key hierarchy with separate keys or derived subkeys for distinct purposes. The spec must identify what is encrypted: heap pages, index pages, WAL, temporary spill files, backups, evidence capsules, and metadata. State what remains visible, such as page counts, file sizes, access patterns, and some catalog metadata.

Use a vetted AEAD implementation. Define nonce generation/uniqueness, associated data (including file/object/page identity and format version), rotation, backup, revocation, and recovery. A nonce reuse under a given key is a release-blocking incident.

Do not store production master keys beside the encrypted database files. Use a key manager or HSM/KMS integration when the deployment threat model requires it. Local development may use a clearly labelled dev-key provider, but the production server must refuse to start in production mode with the dev provider.

## 7.4 Post-quantum key establishment

The blueprint uses **ML-KEM**, standardized from the Kyber family, for post-quantum key establishment. It is not a digital signature scheme.

Specify the protocol binding: peer identity, algorithm negotiation, transcript, downgrade protection, session context, key derivation, key confirmation, and failure behavior. Hybrid X25519 + ML-KEM-768 is a candidate profile when supported by the selected audited transport stack and interoperable peers. The exact profile must be pinned to current standards and library capabilities.

A custom ML-KEM implementation can be developed as a separately isolated research project:

- Implement from the normative standard, not blog posts.
- Include published known-answer vectors.
- Differential-test against at least one independent implementation.
- Fuzz decoders and malformed ciphertexts.
- Test implicit rejection and error behavior as specified.
- Review constant-time behavior, compiler output, memory handling, and side channels.
- Obtain independent cryptographic review before production use.

**Production rule:** Until that review is complete, use a vetted implementation for real security. The handwritten implementation can be compiled only into an explicitly marked research/test build. Do not roll your own TLS. The SEAMDB protocol may be designed in-house while using a reviewed TLS stack.

## 7.5 Memory and lifecycle privacy

Document which buffers contain plaintext, when they are cleared, how long query results live, how temporary files are protected, and what crash dumps contain. Memory clearing is best-effort in many runtimes and does not erase copies made by the OS, compiler, allocator, or hardware. Do not promise perfect erasure.

---

# 8. Engine-native evidence: receipts must describe real engine events

The earlier SEAMDB blueprint's capsule, Merkle, transparency, coherence, and verifier concepts remain useful, but their inputs must originate from actual engine events.

## 8.1 Commit event contract

For every committed transaction, produce a canonical event containing at least:

- Engine build/version and storage-format version.
- Database and object identifiers.
- Transaction ID and commit LSN.
- Schema/catalog version.
- Statement fingerprint and typed-plan fingerprint, subject to privacy rules.
- Read/write object set at the appropriate granularity.
- Policy version and authorization decision reference.
- Relevant lineage parent references.
- Commit timestamp with clock-quality caveat.
- Integrity commitments to affected records or pages, where defined.
- Evidence schema version and canonicalization profile.

Do not include raw row values by default. Hashes of low-entropy values can leak information, so use keyed commitments or privacy-reviewed constructions where appropriate. A plain hash is not anonymization.

## 8.2 Evidence ordering

The event must not claim a transaction committed before the commit is durable. If evidence publication is asynchronous, use a transactional outbox or equivalent durable handoff. There must be a visible state such as `COMMITTED_EVIDENCE_PENDING`, never a fabricated “verified” receipt.

## 8.3 Verification claims

A verifier can establish that a receipt is well-formed, commitments match supplied data, signatures verify under known keys, inclusion proofs validate, and stated policy checks were performed according to a versioned profile. It cannot prove that source data was truthful, that an operator never copied data elsewhere, or that the engine has no implementation bug.

Each claim must state its assumptions, required evidence, and residual risk.

---

# 9. Protocol and server boundary

Define a versioned wire protocol with:

- Length-prefixed or otherwise unambiguous frames.
- Strict maximum frame and message sizes.
- Authentication before sensitive operations.
- Request IDs and idempotency semantics.
- Query timeout and cancellation.
- Backpressure and per-tenant resource budgets.
- Protocol version negotiation and downgrade protection.
- Bounded decompression if compression is supported.
- Safe parsing of every network-controlled field.
- Explicit handling of partial frames, oversized frames, duplicate requests, disconnects, and slow clients.

Do not expose a raw internal function call as a network API. The protocol decoder creates typed request objects; authorization runs before data access; results are serialized with explicit schema and size limits.

---

# 10. Query planning and optimization

The optimizer may change execution order only when equivalence is established under the engine's semantics, including nulls, errors, volatility, policies, and transaction snapshots.

## 10.1 Logical plan

Define operators such as `Scan`, `Filter`, `Project`, `Join`, `Sort`, `Limit`, `Aggregate`, `Insert`, `Update`, and `Delete`. Every operator carries a typed schema and source/query provenance.

## 10.2 Physical plan

Initial physical operators:

- Heap scan.
- B+tree point/range scan.
- Filter and projection.
- Nested-loop join.
- Hash join only after memory limits and spill semantics are tested.
- External sort only after secure temporary-file behavior is tested.
- Hash aggregate with explicit overflow behavior.

## 10.3 Optimizer rules

Each optimization has:

- Preconditions.
- A semantic equivalence argument.
- A plan rewrite test.
- Randomized equivalence tests against the unoptimized executor.
- A disable switch for diagnosis that cannot alter authorization.
- Performance benchmarks on representative data.
- A recorded optimizer-rule version for evidence reproducibility where needed.

Never let an optimizer push a predicate across a row-security boundary unless the rewrite is proven to preserve policy semantics.

## 10.4 Resource governance

Every query has limits for CPU time, memory, temporary storage, rows scanned, output bytes, join cardinality, recursion depth (if recursion is ever added), and cancellation latency. Limit exhaustion returns a stable error and rolls back partial writes. No unbounded allocation from query-controlled sizes.

---

# 11. Testing strategy: prove behavior, not file presence

A database engine needs layered evidence. A green unit test is necessary, not sufficient.

## 11.1 Parser and language tests

- Grammar conformance corpus for every statement.
- Invalid syntax corpus.
- Differential lexer tests against an independently written reference tokenizer.
- AST snapshots and canonical AST serialization.
- Fuzzing of arbitrary bytes, Unicode, nesting, comments, strings, and numeric literals.
- Property: accepted input consumes the complete statement.
- Property: pretty-print/parse round trips preserve AST semantics for supported constructs.
- Property: unsupported syntax always errors; never becomes a different valid statement.

## 11.2 SQL semantic tests

- Type and overflow boundaries.
- `null` truth tables.
- Duplicate and ambiguous names.
- Join cardinality and null-extension behavior.
- Ordering stability and collation.
- Constraints under concurrent transactions.
- DDL rollback.
- Policy correctness under every physical plan.
- Query equivalence with optimizer enabled and disabled.

Use a known database as a *test oracle* only for the explicitly shared subset where semantics match. This does not make that database a runtime dependency and does not prove equivalence for SEAMQL-specific features.

## 11.3 Storage and corruption tests

- Round-trip encoding for every page/tuple type.
- Malformed offset/length and overlapping slot rejection.
- Bit flips in headers, payloads, checksums, and WAL.
- Random truncation of every persistent file.
- Fuzzed page and WAL decoders.
- Page reuse and stale-generation tests.
- Index-vs-heap result equivalence.
- Full integrity checker against deliberately corrupted fixtures.

## 11.4 Transaction and crash tests

Build a deterministic fault injector that can crash or fail at every I/O boundary. For each generated schedule:

1. Run a transaction workload.
2. Inject failure at a chosen point.
3. Restart the engine.
4. Recover.
5. Check committed/uncommitted outcomes.
6. Verify catalog, heap, indexes, WAL, and evidence event ordering.
7. Repeat with randomized concurrency schedules.

Maintain a reference model for small workloads. Compare final state against all legal serializations for claimed isolation levels. For serializable mode, use a serialization-graph or equivalent checker.

## 11.5 Privacy and security tests

- Role matrix for every operation.
- Row/column policy tests across scans, indexes, joins, aggregates, `EXPLAIN`, and errors.
- Revocation races.
- Timing and count leakage tests where feasible.
- Secret scanning of logs, errors, metrics, crash artifacts, WAL, and evidence.
- Key rotation, missing key, wrong key, nonce misuse detection, and backup restore.
- Network fuzzing and resource-exhaustion tests.
- Authentication downgrade and replay tests.
- Independent review of cryptographic integrations.

## 11.6 No dummy implementation rule

A requirement is not `DONE` because a function exists or a demo looks convincing. To mark it `DONE`, attach:

- Spec section and version.
- Source module and public contract.
- Positive tests.
- Negative/adversarial tests.
- Fuzz/property tests where applicable.
- Crash/recovery tests for persistent state.
- Performance evidence for claimed scale.
- Security review and residual-risk record.
- Reproducible CI run identifier.
- Proof that production builds do not select mock providers.

Mocks are allowed only in tests, with explicit names and build-time separation. A mock provider must fail to compile into a production release unless a deliberate, audited test build is requested.

---

# 12. Delivery stages and non-negotiable exit gates

Do not build all modules at once. Keep every stage runnable and honest.

## Stage 0: specification freeze

Deliver grammar, type rules, null rules, transaction model, page/WAL format, threat model, error catalog, and test plan.

**Exit gate:** Two independent reviewers can predict the behavior of every accepted query and every failure case from the spec.

## Stage 1: parser and in-memory reference engine

Implement lexer, parser, AST, resolver, type checker, and a tiny in-memory executor for the defined subset. This is a semantic reference, not the product database.

**Exit gate:** Grammar corpus, fuzzing, and semantic tests pass. No storage durability claims.

## Stage 2: durable heap and catalog

Implement page encoding, heap storage, catalog transactions, checksums, buffer pool, and basic WAL.

**Exit gate:** Process-kill and corruption tests pass; reopening the database produces the specified state.

## Stage 3: transactions and recovery

Implement MVCC, commit protocol, recovery, locks/conflict handling, and isolation claims.

**Exit gate:** Crash matrix and concurrency model checks pass. No `DONE` status based only on happy paths.

## Stage 4: indexes and query planner

Implement B+tree, scans, joins, sort, and optimizer with equivalence testing.

**Exit gate:** Index results match heap scans; optimized results match reference execution.

## Stage 5: authorization and privacy

Implement identities, roles, column/row policy, encrypted storage profile, secure export, and key lifecycle integration.

**Exit gate:** Full policy matrix passes across all operators and error paths; external security review begins.

## Stage 6: evidence plane integration

Bind evidence events to durable commit records, policy versions, catalog versions, and actual plan fingerprints.

**Exit gate:** Crash tests prove no receipt can claim a commit that did not become durable; verifier detects tampering and missing evidence.

## Stage 7: protocol and operational hardening

Implement authenticated protocol, quotas, backups, restore, metrics, diagnostics, upgrades, and incident procedures.

**Exit gate:** Fuzzing, soak tests, restore drills, dependency audit, SBOM, reproducible build, and external review.

## Stage 8: limited pilot

Pilot with non-critical data and explicit limitations. No high-risk production workload until independent review approves the specific threat model and operational controls.

---

# 13. Revised requirements ledger for the from-scratch engine

These requirements extend, rather than silently replace, the previous SEAMDB ledger.

| ID | Requirement | Evidence required | Status at document creation |
|---|---|---|---|
| FS-01 | SEAMQL grammar and language version frozen | EBNF, AST spec, conformance corpus | OPEN |
| FS-02 | Lexer implemented from SEAMDB spec | Unit/property/fuzz tests | OPEN |
| FS-03 | Parser implemented from SEAMDB grammar | Conformance + malformed-input tests | OPEN |
| FS-04 | Resolver and type checker | Semantic test matrix | OPEN |
| FS-05 | Execution engine owned by SEAMDB | No runtime SQL-engine dependency; architecture review | OPEN |
| FS-06 | Catalog and transactional DDL | Crash/recovery tests | OPEN |
| FS-07 | Explicit page and tuple format | Byte-level format spec + fuzz tests | OPEN |
| FS-08 | Heap storage and buffer pool | Persistence, corruption, concurrency tests | OPEN |
| FS-09 | WAL and commit durability | Fault-injection crash matrix | OPEN |
| FS-10 | MVCC and documented isolation | Concurrency model checker | OPEN |
| FS-11 | B+tree indexes | Structural, crash, uniqueness, equivalence tests | OPEN |
| FS-12 | Optimizer equivalence | Rule tests + randomized equivalence | OPEN |
| FS-13 | Row/column policy enforcement in engine | Complete operation/plan matrix | OPEN |
| FS-14 | Encryption-at-rest profile | Key lifecycle tests + independent review | OPEN |
| FS-15 | ML-KEM integration | Standards profile + KATs + independent review | OPEN |
| FS-16 | Optional research ML-KEM implementation | Differential/fuzz/side-channel assessment | OPEN; not production by default |
| FS-17 | Engine-native evidence commit hook | WAL-to-receipt ordering tests | OPEN |
| FS-18 | Backup/restore integrity | Restore drills and corruption tests | OPEN |
| FS-19 | Network protocol and resource bounds | Protocol fuzzing and abuse tests | OPEN |
| FS-20 | Production build excludes mocks | Build-graph and artifact audit | OPEN |
| FS-21 | No false security/durability claims | Release checklist and review | OPEN |
| FS-22 | Independent security review | Written findings and remediation evidence | OPEN |

The prior ledger's `DONE` rows describe the earlier artifact/repository state only. They do **not** automatically satisfy these new from-scratch engine requirements. If the current codebase contains a synthetic connector or in-process engine, that is not the same as a durable database engine.

---

# 14. What must never be faked

The following are release-blocking:

- Calling an in-memory map a persistent database.
- Calling a Python SQL parser a SEAMDB-owned parser when it delegates to another engine.
- Calling a query regex a SQL parser.
- Returning a success-shaped object when a feature is unsupported.
- Claiming crash safety without injected crashes and restart assertions.
- Claiming MVCC without defined visibility rules and concurrency tests.
- Claiming serializable transactions when only snapshot isolation exists.
- Claiming encryption at rest when only exports are encrypted.
- Claiming “post-quantum secure” because ML-KEM appears in a label or handshake field.
- Claiming privacy because the UI omits row values.
- Claiming evidence proves source-data truth.
- Marking a security test `PASS` when a dependency was unavailable.
- Silently falling back to a mock or external database when the native engine fails.

Every unsupported feature must return a clear `FEATURE_NOT_SUPPORTED` error. Every integrity uncertainty must return `INDETERMINATE` or fail closed.

---

# 15. First 30 engineering tasks

1. Create `spec/seamql-grammar.ebnf`.
2. Write the token and identifier normalization spec.
3. Write the complete type and null semantics.
4. Approve the initial supported statement list.
5. Create stable error codes and source-span format.
6. Define the AST using typed node variants.
7. Implement lexer with no database dependency.
8. Add grammar corpus and malformed-input corpus.
9. Implement parser and complete-input check.
10. Add property-based parser tests and fuzz target.
11. Implement catalog-independent type checker for literals and expressions.
12. Implement a tiny in-memory reference evaluator for supported expressions.
13. Define page header bytes and versioning.
14. Define tuple encoding and null bitmap.
15. Define WAL record encoding and torn-tail behavior.
16. Define transaction visibility model.
17. Define commit durability point.
18. Build deterministic I/O fault injector.
19. Implement file/page decoder with bounds checks.
20. Implement heap page read/write.
21. Implement buffer pool pin/latch invariants.
22. Implement catalog persistence and transactional DDL.
23. Implement WAL append and flush ordering.
24. Implement startup recovery.
25. Add crash-after-every-write test harness.
26. Implement MVCC version chains and conflict detection.
27. Build concurrency schedule generator and reference model.
28. Implement heap scan and compare with reference evaluator.
29. Implement policy enforcement before executor output.
30. Only then start the B+tree implementation.

---

# 16. Decisions to make before coding

These are genuine design decisions, not details to guess during implementation:

- Is the engine strictly single-process in v0, or will multiple server processes access one database directory? Recommended: one process owns a database directory.
- Is page size fixed? Recommended: yes for v0.
- Is the first durability target local filesystem with `fsync` semantics? Recommended: define one supported OS/filesystem matrix.
- Which isolation levels are exposed? Start with read committed and snapshot isolation only if fully specified; add serializable only after implementation and verification.
- What are the initial data types and collation rules?
- Are schemas/namespaces supported in v0?
- Are triggers, stored procedures, user-defined functions, recursive queries, and extensions excluded? Recommended: exclude them.
- What is the threat model for a malicious database administrator who controls the machine?
- Are data files encrypted as a whole or page by page?
- How are keys recovered after host loss?
- Does evidence go to a separate trust domain?
- What is the exact export model?
- What is the migration/upgrade guarantee?
- What is the supported language version policy?

Record each decision with alternatives, rationale, consequences, owner, and test impact. If a decision affects security or durability, require a reviewer who did not author the implementation.

---

# 17. Honest launch statement

A credible early release statement would be:

> SEAMDB is an experimental, single-node relational engine with a versioned, readable query language and an engine-native evidence model. Its supported SQL-like subset, storage format, transaction semantics, and threat model are explicitly documented. It is not yet suitable for critical production data until crash recovery, privacy controls, cryptographic integrations, and independent security review meet the published release gates.

Do not use “fully private,” “unbreakable,” “fully quantum-safe,” “formally verified,” or “production-grade” without a precise, independently supported claim and a stated threat model.

---

# Appendix A. Compact SEAMQL example

```seamql
make table members:
    id: whole number, primary key
    display_name: text, required
    contact_email: text, private, unique
    joined_on: date, required, default today()

add to members {
    id: 1,
    display_name: "Ada",
    contact_email: "ada@example.invalid",
    joined_on: today()
}

read id, display_name
from members
where id >= 1
sort by display_name ascending
take 20
```

The parser must not execute this by translating it into a string and handing it to SQLite or PostgreSQL. It parses into SEAMDB's AST, resolves against SEAMDB's catalog, type-checks, plans, authorizes, executes through SEAMDB operators, and emits a receipt tied to the actual transaction/plan where policy allows.

# Appendix B. Production vs research cryptography

| Component | Production rule | Research rule |
|---|---|---|
| SHA-2/SHA-3 or other selected hash | Use a reviewed provider and fixed profile | May implement for learning and test vectors |
| AEAD | Reviewed provider; strict nonce and AAD contract | Independent test implementation allowed |
| TLS | Reviewed TLS stack | Protocol experiments isolated from production |
| ML-KEM | Vetted implementation until independent review | From-standard implementation, KATs, differential tests, fuzzing, side-channel work |
| Signatures | Standard scheme and reviewed provider | Experimental scheme never trusted by production verifier |
| Key management | Dedicated provider and documented recovery | Development-only keys clearly labelled and blocked in production |

A from-scratch database engine and a from-scratch cryptographic implementation are separate engineering projects. Keeping the interfaces SEAMDB-owned gives architectural control without pretending cryptographic review can be skipped.

# Appendix C. Definition of done for any core feature

A feature is `DONE` only if all applicable checks pass:

- [ ] Specification is versioned and unambiguous.
- [ ] Implementation is native to SEAMDB and has no hidden delegation.
- [ ] Unsupported input is rejected safely.
- [ ] Positive tests cover the specified behavior.
- [ ] Negative and adversarial tests cover failure paths.
- [ ] Fuzz/property tests cover parsers and decoders.
- [ ] Crash/recovery tests cover persistent state.
- [ ] Concurrency tests cover shared mutable state.
- [ ] Privacy tests cover logs, errors, metrics, and side channels.
- [ ] Benchmarks substantiate performance claims.
- [ ] Production build graph excludes mock providers.
- [ ] Independent review is complete where security-critical.
- [ ] Evidence is reproducible from a clean checkout.

**Final principle:** Build the engine you can explain byte by byte, state transition by state transition, and failure by failure. Make the language friendly; keep the semantics exact. Make ownership complete; keep security claims humble.
