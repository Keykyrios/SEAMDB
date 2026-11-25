# Threat model v0 (engine)

In scope: malformed queries, corrupt/truncated files, replayed grants, unauthorized sessions, checksum forgeries, write-write races, crash during WAL/page write.

Out of scope: malicious host administrator with memory access, side-channel across tenants on one VM, formally verified absence of bugs, truthfulness of user-inserted data.

Privacy: engine enforces row/column grants before result serialization. UI hiding is not access control. Errors for unauthorized callers are `E_DENIED` without confirming hidden row existence.

Residual: JavaScript runtime does not guarantee secret erasure. No-steal + fsync semantics depend on the OS actually flushing. Snapshot isolation allows write skew.
