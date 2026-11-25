# SEAMDB v0 engine decisions

Language version: `seamql/0.1`. Each decision lists alternatives, rationale, consequences, and test impact.

| ID | Decision | Alternatives | Rationale | Consequences | Test impact |
|---|---|---|---|---|---|
| D1 | Implementation language for v0 is TypeScript in this repository | Rust crates as in the layout sketch | The evidence plane, verifier, and interactive lab already run as a typed ES module. Splitting to Rust before a parser and storage codec exist would hide unfinished semantics behind FFI. Rust remains the intended later systems language. | Engine shares the Vite/Node toolchain. Production hardening still requires a memory-safe rewrite review. | Conformance runs under `tsx`; browser lab uses the same parser/executor. |
| D2 | One process owns a database directory | Multi-process shared directory | Avoids distributed latch design in v0. | A second process must refuse the lock file. | Open-twice test. |
| D3 | Page size is fixed at 16384 bytes | Configurable page size | Every parser, WAL record, backup, and recovery path would otherwise branch. | Existing files cannot change page size. | Decoder rejects other sizes. |
| D4 | Durability target is local filesystem `fsync` of WAL through the commit record | Group commit, direct I/O, replicated WAL | One supported matrix: Node.js `fs` on the host OS. | Browser lab is **not** crash-durable; it uses the same codecs on a memory store labelled `durable=false`. | Fault-injection tests use the file store only. |
| D5 | Isolation: snapshot isolation. Not serializable. | Read committed only; full SSI | Visibility is a single function with a snapshot of in-progress xids. SSI needs a serialization-graph checker we do not claim. | Product must not say “serializable.” Write-write conflicts abort the later writer. | Visibility + conflict tests; no serializable claim tests. |
| D6 | Types: `whole number` (i64), `decimal(p,s)`, `text`, `yesno` (boolean), `stamp` (µs UTC), `day` (days from Unix epoch), `null` | IEEE floats; host locale collations | No silent `f64` or locale. Text order is UTF-8 bytewise. | No `real`/`float` in v0. | Overflow, scale, collation tests. |
| D7 | Single namespace per database | Schemas | Name resolution stays unambiguous. | Table names are unique per database. | Duplicate-name tests. |
| D8 | Excluded: triggers, procedures, UDFs, recursion, window functions, implicit network/file reads | Include later | Injection and planner surface stay small. | Those tokens error as `E_FEATURE_NOT_SUPPORTED`. | Negative corpus. |
| D9 | Heap/index/WAL pages encrypted at rest with AES-256-GCM when a key provider is configured | Whole-file encryption only | Page identity is AAD. Dev provider is labelled and refused when `mode=production`. | Metadata such as page counts remains visible. | Wrong-key and nonce-generation tests. |
| D10 | Evidence is same-process outbox after WAL commit durability | Immediate external publish | No receipt may claim commit before durable LSN. Async publish is `COMMITTED_EVIDENCE_PENDING`. | Evidence layer cannot decide commit success. | Crash between WAL commit and outbox flush. |
| D11 | Canonical query language is Gen Z wording; the classical wording is a frozen alias set | Gen Z only; SQL only | Operators should be able to read a query aloud. Aliases parse to the same AST so neither corpus silently means something else. | Keywords are reserved. | Alias round-trip tests. |
| D12 | Production cryptography uses platform `SubtleCrypto` / Node WebCrypto | Hand-rolled AES/ML-KEM | Handwritten crypto is research-only until it has been reviewed. | ML-KEM is not a v0 runtime dependency. Hybrid PQ remains a labelled transport posture from the evidence plane. | Build does not import a mock AES. |

Owner: SEAMDB engine. Security/durability decisions (D3–D5, D9–D10, D12) require a reviewer who did not author the implementation before any production claim.
